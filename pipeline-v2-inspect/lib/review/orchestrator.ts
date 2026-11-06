import { GatewayExhaustedError, type ProviderGateway } from "../llm/gateway"
import { assessClaims, DEFAULT_THRESHOLDS, type ClaimAssessment, type CoverageThresholds } from "./claims"
import { buildCacheKey, computeRulesetDigest } from "./cache-key"
import type { LlmCache } from "./cache"
import { detectInjection, type InjectionReport } from "./injection"
import { buildJudgePrompt, JUDGE_PROMPT_VERSION, parseJudgeOutput } from "./judge"
import { builtinLocalEngine, type LocalEngine } from "./local"
import { planRoute, type LlmPolicy, type RoutePlan } from "./risk"
import { scoreFindings } from "./scoring"
import {
  applyVerification,
  buildValidationContext,
  dedupeFindings,
  validateFindings,
} from "./validator"
import {
  buildVerifierPrompt,
  citationText,
  isMaterial,
  parseVerifierOutput,
  VERIFIER_PROMPT_VERSION,
  type VerificationItem,
} from "./verifier"
import {
  SEVERITY_RANK,
  type CandidateFinding,
  type RejectedFinding,
  type ReviewFinding,
  type ReviewInput,
} from "./types"

export interface EngineConfig {
  policy: LlmPolicy
  /** Logical LLM calls per review. Two means judge plus an optional verifier. */
  maxLlmCalls: number
  maxContentChars: number
  maxFindings: number
  judgeTimeoutMs: number
  verifierTimeoutMs: number
  cacheTtlSeconds: number
  /** Model names used in cache keys. Changing a model invalidates its cache. */
  judgeModelId: string
  verifierModelId: string
  verifierModelByProvider: Record<string, string>
  coverage: CoverageThresholds
}

export const DEFAULT_CONFIG: EngineConfig = {
  policy: "auto",
  maxLlmCalls: 2,
  maxContentChars: 12_000,
  maxFindings: 8,
  judgeTimeoutMs: 20_000,
  verifierTimeoutMs: 15_000,
  cacheTtlSeconds: 7 * 24 * 3600,
  judgeModelId: "default",
  verifierModelId: "default",
  verifierModelByProvider: {},
  coverage: DEFAULT_THRESHOLDS,
}

export interface EngineDeps {
  gateway: ProviderGateway | null
  cache: LlmCache
  localEngine?: LocalEngine
  config?: Partial<EngineConfig>
  now?: () => Date
}

export interface ProviderUsage {
  purpose: "judge" | "verifier"
  provider: string
  model: string
  latencyMs: number
  httpAttempts: number
}

export type VerificationStatus = "not_needed" | "verified" | "cached" | "unavailable"

export interface ReviewOutcome {
  /** "local": no model. "hybrid": model or cache used. "degraded": model wanted but unavailable. */
  route: "local" | "hybrid" | "degraded"
  plan: RoutePlan
  findings: ReviewFinding[]
  rejected: RejectedFinding[]
  /** Null when the model was needed but unavailable: the score would be misleading. */
  score: number | null
  status: "completed" | "flagged" | "partial"
  llm: {
    calls: number
    httpAttempts: number
    cached: boolean
    providers: ProviderUsage[]
    verification: VerificationStatus
    degradedReason: string | null
  }
  injection: InjectionReport
  humanReview: { required: boolean; reasons: string[] }
  assessments: ClaimAssessment[]
  versions: { judgePrompt: string; verifierPrompt: string; rulesetDigest: string }
  timings: { totalMs: number }
}

function describeError(error: unknown): string {
  if (error instanceof GatewayExhaustedError) return error.message
  return error instanceof Error ? error.message : "unknown error"
}

function isCandidateArray(value: unknown): value is CandidateFinding[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "object" && v !== null && typeof (v as { category?: unknown }).category === "string")
  )
}

export class ReviewEngine {
  private readonly config: EngineConfig
  private readonly localEngine: LocalEngine

  constructor(private readonly deps: EngineDeps) {
    this.config = { ...DEFAULT_CONFIG, ...deps.config }
    this.localEngine = deps.localEngine ?? builtinLocalEngine
  }

  async review(input: ReviewInput): Promise<ReviewOutcome> {
    const startedAt = Date.now()
    const cfg = this.config
    const { content } = input
    const now = this.deps.now?.() ?? new Date()
    const vctx = buildValidationContext(content, input.rules, input.facts, now)
    const rulesetDigest = computeRulesetDigest(input.rules, input.facts)

    // Layer 0 to 2: normalize, detect injection, assess claims, run local checks.
    const injection = detectInjection(content)
    const assessments = assessClaims(content, input.facts, {
      ...(input.context.brandTerms ? { brandTerms: input.context.brandTerms } : {}),
      thresholds: cfg.coverage,
    })
    const localCandidates = await this.localEngine({ input, assessments, injection })
    const local = validateFindings(localCandidates, vctx)

    // Layer 3: decide whether a model is needed at all.
    const plan = planRoute({
      content,
      injection,
      localFindings: local.accepted,
      assessments,
      policy: cfg.policy,
      maxCalls: cfg.maxLlmCalls,
      maxContentChars: cfg.maxContentChars,
    })

    const usage: ProviderUsage[] = []
    let calls = 0
    let httpAttempts = 0
    let cached = false
    let degradedReason: string | null = null
    let verification: VerificationStatus = "not_needed"
    let llmFindings: ReviewFinding[] = []
    const rejected: RejectedFinding[] = [...local.rejected]

    if (plan.llm === "judge") {
      const gateway = this.deps.gateway
      if (!gateway || !gateway.isAvailable()) {
        degradedReason = "No LLM provider is available. Local findings are shown."
      } else {
        const judged = await this.runJudge(input, plan, rulesetDigest, gateway)
        calls += judged.calls
        httpAttempts += judged.httpAttempts
        cached = judged.cached
        usage.push(...judged.usage)
        degradedReason = judged.degradedReason

        if (judged.candidates) {
          const validated = validateFindings(judged.candidates, vctx)
          llmFindings = validated.accepted
          rejected.push(...validated.rejected)
        }

        // Layer 5b: independent verification, only when a material finding exists.
        const material = llmFindings.filter(isMaterial)
        if (!degradedReason && plan.verifier === "conditional" && material.length > 0) {
          if (calls >= cfg.maxLlmCalls && !cached) {
            verification = "unavailable"
          } else {
            const verified = await this.runVerifier(
              material, input, rulesetDigest, gateway, usage[0]?.provider, calls, cached
            )
            calls += verified.calls
            httpAttempts += verified.httpAttempts
            usage.push(...verified.usage)
            verification = verified.status
            if (verified.results) {
              llmFindings = llmFindings.map((finding) => {
                const index = material.indexOf(finding)
                const result = index === -1 ? undefined : verified.results?.get(index)
                return result ? applyVerification(finding, result) : finding
              })
            }
          }
        }
      }
    }

    const merged = dedupeFindings([...local.accepted, ...llmFindings])
    for (const dropped of merged.dropped) {
      rejected.push({
        candidate: {
          ruleId: dropped.ruleId,
          factId: dropped.factId,
          category: dropped.category,
          severity: dropped.severity,
          verdict: dropped.verdict,
          evidence: dropped.evidence,
          explanation: dropped.explanation,
          source: dropped.source,
        },
        reason: "duplicate",
        detail: "Local and model findings overlapped; the stronger source was kept.",
      })
    }
    const findings = [...merged.kept].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.evidence.start - b.evidence.start
    )

    const degraded = degradedReason !== null
    const humanReasons: string[] = []
    if (injection.detected) humanReasons.push("Instruction-like text was found in the content.")
    if (findings.some((f) => f.verdict === "Needs legal review")) humanReasons.push("Pricing, guarantee or regulated wording.")
    if (findings.some((f) => f.grade === "C")) humanReasons.push("A finding could not be independently confirmed (grade C).")
    if (plan.escalate && humanReasons.length === 0) humanReasons.push("The router marked this review as high risk.")
    if (degraded) humanReasons.push("The AI layer was unavailable, so some claims were not judged.")

    return {
      route: degraded ? "degraded" : calls > 0 || cached ? "hybrid" : "local",
      plan,
      findings,
      rejected,
      score: degraded ? null : scoreFindings(findings),
      status: degraded ? "partial" : findings.length > 0 ? "flagged" : "completed",
      llm: { calls, httpAttempts, cached, providers: usage, verification, degradedReason },
      injection,
      humanReview: { required: humanReasons.length > 0, reasons: humanReasons },
      assessments,
      versions: { judgePrompt: JUDGE_PROMPT_VERSION, verifierPrompt: VERIFIER_PROMPT_VERSION, rulesetDigest },
      timings: { totalMs: Date.now() - startedAt },
    }
  }

  private async runJudge(
    input: ReviewInput,
    plan: RoutePlan,
    rulesetDigest: string,
    gateway: ProviderGateway
  ): Promise<{
    candidates: CandidateFinding[] | null
    calls: number
    httpAttempts: number
    cached: boolean
    usage: ProviderUsage[]
    degradedReason: string | null
  }> {
    const cfg = this.config
    const key = buildCacheKey({
      kind: "judge",
      content: input.content,
      brandId: input.context.brandId,
      rulesVersion: input.rulesVersion,
      factsVersion: input.factsVersion,
      rulesetDigest,
      promptVersion: JUDGE_PROMPT_VERSION,
      model: cfg.judgeModelId,
    })

    const hit = await this.safeGet(key)
    if (hit && isCandidateArray(hit.payload)) {
      return { candidates: hit.payload, calls: 0, httpAttempts: 0, cached: true, usage: [], degradedReason: null }
    }

    const { system, prompt } = buildJudgePrompt({
      content: input.content,
      context: input.context,
      rules: input.rules,
      facts: input.facts,
      focusClaims: plan.focusClaims,
      maxFindings: cfg.maxFindings,
    })

    try {
      const result = await gateway.generate({ system, prompt, json: true, timeoutMs: cfg.judgeTimeoutMs })
      const usage: ProviderUsage = {
        purpose: "judge",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        httpAttempts: result.attempts.length,
      }
      const parsed = parseJudgeOutput(result.text, cfg.maxFindings)
      if (!parsed.ok) {
        return {
          candidates: null, calls: 1, httpAttempts: result.attempts.length, cached: false, usage: [usage],
          degradedReason: "The AI judge returned output that could not be parsed.",
        }
      }
      await this.safeSet(key, "judge", { payload: parsed.candidates, provider: result.provider, model: result.model })
      return {
        candidates: parsed.candidates, calls: 1, httpAttempts: result.attempts.length, cached: false,
        usage: [usage], degradedReason: null,
      }
    } catch (error) {
      const attempts = error instanceof GatewayExhaustedError ? error.attempts.length : 0
      return {
        candidates: null, calls: attempts > 0 ? 1 : 0, httpAttempts: attempts, cached: false, usage: [],
        degradedReason: `AI judge unavailable: ${describeError(error)}`,
      }
    }
  }

  private async runVerifier(
    material: ReviewFinding[],
    input: ReviewInput,
    rulesetDigest: string,
    gateway: ProviderGateway,
    judgeProvider: string | undefined,
    callsSoFar: number,
    judgeWasCached: boolean
  ): Promise<{
    results: Map<number, { applies: boolean; reason: string }> | null
    status: VerificationStatus
    calls: number
    httpAttempts: number
    usage: ProviderUsage[]
  }> {
    const cfg = this.config
    const rules = new Map(input.rules.map((r) => [r.id, r]))
    const facts = new Map(input.facts.map((f) => [f.id, f]))
    const items: VerificationItem[] = material.map((finding, index) => ({
      index,
      quote: finding.evidence.text,
      verdict: finding.verdict,
      citation: citationText(finding, rules, facts),
    }))

    const key = buildCacheKey({
      kind: "verify",
      content: JSON.stringify(items),
      brandId: input.context.brandId,
      rulesVersion: input.rulesVersion,
      factsVersion: input.factsVersion,
      rulesetDigest,
      promptVersion: VERIFIER_PROMPT_VERSION,
      model: cfg.verifierModelId,
    })

    const hit = await this.safeGet(key)
    if (hit && Array.isArray(hit.payload)) {
      const results = new Map<number, { applies: boolean; reason: string }>()
      for (const entry of hit.payload as Array<{ index: number; applies: boolean; reason: string }>) {
        results.set(entry.index, { applies: entry.applies, reason: entry.reason })
      }
      return { results, status: "cached", calls: 0, httpAttempts: 0, usage: [] }
    }

    // A cached judge answer used no call, so the budget is still intact.
    if (!judgeWasCached && callsSoFar >= cfg.maxLlmCalls) {
      return { results: null, status: "unavailable", calls: 0, httpAttempts: 0, usage: [] }
    }

    try {
      const { system, prompt } = buildVerifierPrompt(items)
      const result = await gateway.generate(
        { system, prompt, json: true, timeoutMs: cfg.verifierTimeoutMs },
        {
          ...(judgeProvider ? { avoidProvider: judgeProvider } : {}),
          modelByProvider: cfg.verifierModelByProvider,
        }
      )
      const usage: ProviderUsage = {
        purpose: "verifier",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        httpAttempts: result.attempts.length,
      }
      const results = parseVerifierOutput(result.text, items.length)
      if (!results) {
        return { results: null, status: "unavailable", calls: 1, httpAttempts: result.attempts.length, usage: [usage] }
      }
      await this.safeSet(key, "verify", {
        payload: Array.from(results, ([index, value]) => ({ index, ...value })),
        provider: result.provider,
        model: result.model,
      })
      return { results, status: "verified", calls: 1, httpAttempts: result.attempts.length, usage: [usage] }
    } catch (error) {
      const attempts = error instanceof GatewayExhaustedError ? error.attempts.length : 0
      return { results: null, status: "unavailable", calls: attempts > 0 ? 1 : 0, httpAttempts: attempts, usage: [] }
    }
  }

  private async safeGet(key: string) {
    try {
      return await this.deps.cache.get(key)
    } catch {
      return null
    }
  }

  private async safeSet(key: string, kind: string, entry: { payload: unknown; provider: string; model: string }) {
    try {
      await this.deps.cache.set(key, kind, entry, this.config.cacheTtlSeconds)
    } catch {
      // A failed cache write never fails a review.
    }
  }
}
