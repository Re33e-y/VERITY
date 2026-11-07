import { createHash, randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { makeFallbackLLM } from "@/lib/engine/gateway-llm"
import { reviewContent, supabaseCache, type Policy } from "@/lib/engine/router"
import { createReviewEngine, loadEngineConfig } from "@/lib/review/env"
import { toApiResponse, toSnapshot, toUiFinding } from "@/lib/review/adapter"
import { supabase } from "@/lib/supabase"
import type { BrandFact, BrandRule } from "@/lib/review/types"
import type { Fact, ReviewEngine, Rule, Verdict } from "@/types/engine"

export const maxDuration = 60

const MAX_CHARS = 5000
const MAX_REVIEWS_PER_MINUTE = 20
const PROMPT_VERSION = "router-v1"
const pipelineV2 = createReviewEngine({
  env: process.env,
  supabase,
  onGatewayEvent: (event) => {
    console.info(
      `[VERITY gateway] ${JSON.stringify({
        type: event.type,
        provider: event.provider,
        model: event.model,
        kind: event.kind,
        status: event.status,
        latencyMs: event.latencyMs,
      })}`
    )
  },
})
const pipelineV2MaxChars = loadEngineConfig(process.env).maxContentChars

const PENALTY = {
  rule: { high: 25, medium: 15, low: 5, info: 0 },
  claim: {
    Contradicted: 20,
    Outdated: 15,
    Unsupported: 8,
    "Needs legal review": 10,
    Supported: 0,
  },
} satisfies {
  rule: Record<"high" | "medium" | "low" | "info", number>
  claim: Record<Verdict, number>
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected error occurred."
}

function isExpired(item: { expires_at: string | null }, now: number) {
  if (!item.expires_at) return false
  const expiresAt = Date.parse(item.expires_at)
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

// LLM_POLICY: auto (default) | thorough | off. A legacy LLM_MODE=off is still honored.
function policyFromEnv(): Policy {
  const raw = (
    process.env.LLM_POLICY ??
    (process.env.LLM_MODE?.toLowerCase() === "off" ? "off" : "auto")
  ).toLowerCase()
  return raw === "off" ? "off" : raw === "thorough" ? "thorough" : "auto"
}

function severityForPipeline(severity: string): BrandRule["severity"] {
  if (severity === "critical" || severity === "high") return "high"
  if (severity === "warning" || severity === "medium") return "medium"
  return "low"
}

function mapRules(rules: Rule[]): BrandRule[] {
  return rules.map((rule) => ({
    id: rule.id,
    title: `${rule.code}: ${rule.description}`,
    description: rule.description,
    severity: severityForPipeline(rule.severity),
    ...(rule.pattern ? { bannedTerms: [rule.pattern] } : {}),
    ...(rule.preferred ? { preferredTerms: [rule.preferred] } : {}),
    expiresAt: rule.expires_at,
    version: rule.canon_version,
  }))
}

function mapFacts(facts: Fact[], now: number): BrandFact[] {
  return facts.map((fact) => ({
    id: fact.id,
    statement: fact.statement,
    status: isExpired(fact, now) ? "outdated" : "current",
    expiresAt: fact.expires_at,
    version: fact.canon_version,
  }))
}

function latestVersion(versions: number[]): number {
  return Math.max(1, ...versions)
}

async function reviewWithPipelineV2(
  content: string,
  rules: Rule[],
  facts: Fact[],
  canonVersion: number
) {
  const now = Date.now()
  const brandRules = mapRules(rules)
  const brandFacts = mapFacts(facts, now)
  const rulesVersion = latestVersion(rules.map((rule) => rule.canon_version))
  const factsVersion = latestVersion(facts.map((fact) => fact.canon_version))
  const outcome = await pipelineV2.engine.review({
    content,
    context: { brandId: "proofgate", brandTerms: ["ProofGate", "Verity"] },
    rules: brandRules,
    facts: brandFacts,
    rulesVersion,
    factsVersion,
  })
  await pipelineV2.health.flush()

  const uiFindings = outcome.findings
    .map((finding) => toUiFinding(finding, canonVersion, randomUUID()))
    .sort((left, right) => left.span_start - right.span_start)
  const contentHash = createHash("sha256").update(content).digest("hex")
  const snapshot = {
    content_hash: contentHash,
    canon_version: canonVersion,
    rule_codes: rules.map((rule) => rule.code),
    fact_codes: facts.map((fact) => fact.code),
    model: outcome.llm.providers.find((provider) => provider.purpose === "judge")?.model ?? null,
    verifier_model:
      outcome.llm.providers.find((provider) => provider.purpose === "verifier")?.model ?? null,
    prompt_version: outcome.versions.judgePrompt,
    engine: outcome.route === "degraded" ? "offline" : "llm",
    ai_status: outcome.llm.degradedReason === null ? "ok" : "failed",
    ...toSnapshot(outcome),
    findings: uiFindings,
  }

  const runResult = await supabase
    .from("review_runs")
    .insert({
      target_content: content,
      score: outcome.score,
      status: outcome.status,
      canon_version: canonVersion,
      content_hash: contentHash,
      snapshot,
    })
    .select("id")
    .single()

  let persistence: {
    status: "saved" | "partial" | "not_saved"
    reason?: string
  } = { status: "saved" }

  if (runResult.error) {
    console.error("Review run insert failed:", runResult.error)
    persistence = { status: "not_saved", reason: runResult.error.message }
  } else if (!runResult.data) {
    persistence = {
      status: "not_saved",
      reason: "Supabase did not return the saved review run.",
    }
  } else if (uiFindings.length > 0) {
    const insertResult = await supabase.from("findings").insert(
      uiFindings.map((finding) => ({
        ...finding,
        review_run_id: runResult.data.id,
      }))
    )

    if (insertResult.error) {
      console.error("Findings insert failed:", insertResult.error)
      persistence = { status: "partial", reason: insertResult.error.message }
    }
  }

  return NextResponse.json({
    ...toApiResponse(outcome, canonVersion),
    runId: runResult.data?.id ?? null,
    canonVersion,
    llmCalls: outcome.llm.calls,
    findings: uiFindings,
    hiddenGradeD: outcome.rejected.length,
    persistence,
    evaluated: { rules: rules.length, facts: facts.length },
  })
}

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null)
  const content =
    typeof body === "object" &&
    body !== null &&
    "content" in body &&
    typeof body.content === "string"
      ? body.content.trim()
      : ""

  if (!content) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 }
    )
  }

  const maxChars =
    process.env.REVIEW_PIPELINE === "v2" ? pipelineV2MaxChars : MAX_CHARS
  if (content.length > maxChars) {
    return NextResponse.json(
      { error: `content exceeds ${maxChars} characters` },
      { status: 413 }
    )
  }

  try {
    const since = new Date(Date.now() - 60_000).toISOString()
    const { count, error: rateLimitError } = await supabase
      .from("review_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)

    if (rateLimitError) {
      console.error("Review rate-limit check failed:", rateLimitError)
      return NextResponse.json(
        { error: "Could not verify review rate limit. Try again shortly." },
        { status: 503 }
      )
    }

    if ((count ?? 0) >= MAX_REVIEWS_PER_MINUTE) {
      return NextResponse.json(
        { error: "Too many reviews right now. Try again in a minute." },
        { status: 429 }
      )
    }

    const [rulesResult, factsResult] = await Promise.all([
      supabase.from("rules").select("*").eq("active", true),
      supabase.from("facts").select("*"),
    ])

    const contextError = rulesResult.error ?? factsResult.error
    if (contextError) {
      return NextResponse.json({ error: contextError.message }, { status: 500 })
    }

    const now = Date.now()
    const allRules = (rulesResult.data ?? []) as Rule[]
    const allFacts = (factsResult.data ?? []) as Fact[]
    const rules = allRules.filter((rule) => !isExpired(rule, now))
    const canonVersion = Math.max(
      1,
      ...rules.map((rule) => rule.canon_version)
    )

    if (process.env.REVIEW_PIPELINE === "v2") {
      return await reviewWithPipelineV2(content, rules, allFacts, canonVersion)
    }

    // Call-budget router: rules + offline engine first (0 calls), then at most
    // one batched judge call and one batched verifier call, with caching.
    const fallback = makeFallbackLLM()
    const result = await reviewContent({
      content,
      rules,
      facts: allFacts,
      canon: canonVersion,
      llm: fallback.llm,
      cache: supabaseCache(supabase),
      policy: policyFromEnv(),
    })

    const findings = result.findings
    const degraded = result.route === "degraded"
    const aiStatus: "ok" | "failed" = degraded ? "failed" : "ok"
    const aiError = degraded ? result.aiError : undefined
    // "offline" drives the degraded-mode badge in the UI; route tells the real story
    const engine: ReviewEngine = degraded ? "offline" : "llm"

    const identifiedFindings = findings.map((finding) => ({
      ...finding,
      id: randomUUID(),
    }))
    const visibleFindings = identifiedFindings.filter(
      (finding) => finding.grade !== "D"
    )
    const penalty = visibleFindings.reduce((total, finding) => {
      if (finding.verdict) {
        return total + PENALTY.claim[finding.verdict]
      }
      return total + (finding.grade === "C" ? 5 : PENALTY.rule[finding.severity])
    }, 0)
    const calculatedScore = Math.max(0, 100 - penalty)
    const score = degraded ? null : calculatedScore
    const status = degraded
      ? "partial"
      : visibleFindings.some((finding) => finding.severity !== "info")
        ? "flagged"
        : "completed"
    const hiddenGradeD =
      identifiedFindings.length - visibleFindings.length + result.rejected

    const snapshot = {
      content_hash: createHash("sha256").update(content).digest("hex"),
      canon_version: canonVersion,
      rule_codes: rules.map((rule) => rule.code),
      fact_codes: allFacts.map((fact) => fact.code),
      model:
        result.llmCalls > 0 ? process.env.GEMINI_MODEL ?? "gemini-2.5-flash" : null,
      verifier_model:
        result.llmCalls > 1 ? process.env.VERIFIER_MODEL ?? null : null,
      prompt_version: PROMPT_VERSION,
      engine,
      route: result.route,
      llm_calls: result.llmCalls,
      cached: result.cached,
      providers_used: fallback.used(),
      ai_status: aiStatus,
      findings: identifiedFindings,
    }

    const runResult = await supabase
      .from("review_runs")
      .insert({
        target_content: content,
        score,
        status,
        canon_version: canonVersion,
        content_hash: snapshot.content_hash,
        snapshot,
      })
      .select("id")
      .single()

    let persistence: {
      status: "saved" | "partial" | "not_saved"
      reason?: string
    } = { status: "saved" }

    if (runResult.error) {
      console.error("Review run insert failed:", runResult.error)
      persistence = {
        status: "not_saved",
        reason: runResult.error.message,
      }
    } else if (!runResult.data) {
      persistence = {
        status: "not_saved",
        reason: "Supabase did not return the saved review run.",
      }
    } else if (identifiedFindings.length > 0) {
      const insertResult = await supabase.from("findings").insert(
        identifiedFindings.map((finding) => ({
          ...finding,
          review_run_id: runResult.data.id,
        }))
      )

      if (insertResult.error) {
        console.error("Findings insert failed:", insertResult.error)
        persistence = {
          status: "partial",
          reason: insertResult.error.message,
        }
      }
    }

    return NextResponse.json({
      runId: runResult.data?.id ?? null,
      score,
      status,
      canonVersion,
      engine,
      route: result.route,
      llmCalls: result.llmCalls,
      cached: result.cached,
      providers_used: fallback.used(),
      findings: visibleFindings.sort(
        (left, right) => (left.span_start ?? 0) - (right.span_start ?? 0)
      ),
      hiddenGradeD,
      ai: { status: aiStatus, error: aiError },
      persistence,
      evaluated: { rules: rules.length, facts: allFacts.length },
    })
  } catch (error) {
    console.error("Review API failed:", error)
    return NextResponse.json({ error: messageFrom(error) }, { status: 500 })
  }
}