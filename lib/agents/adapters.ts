import { supabase } from "@/lib/supabase"
import type { Fact, Finding as EngineFinding, Rule } from "@/types/engine"
import type { AgenticResult, CacheAdapter, Canon, CanonFact, CanonRule, Citation, Finding, Grade, OfflineFn, Patch } from "./types"

type Row = Record<string, unknown>
export type RawCanon = { version: number | string; rules: Rule[]; facts: Fact[] }
export type FindingRow = EngineFinding & { ai_notes?: string[]; patch?: Patch | null }

const asRow = (value: unknown): Row => value as Row
const str = (value: unknown, fallback = ""): string =>
  value === undefined || value === null ? fallback : String(value)

function indexCanon(raw: RawCanon) {
  return {
    ruleById: new Map(raw.rules.map((rule) => [rule.id, rule])),
    factById: new Map(raw.facts.map((fact) => [fact.id, fact])),
    ruleByCode: new Map(raw.rules.map((rule) => [rule.code, rule])),
    factByCode: new Map(raw.facts.map((fact) => [fact.code, fact])),
  }
}

type CanonIndex = ReturnType<typeof indexCanon>

const ruleCategory = (type: string): string =>
  type === "tone" || type === "messaging" ? "Tone" : type || "Rule"

export function toAgentCanon(raw: RawCanon): Canon {
  const rules: CanonRule[] = raw.rules.map((rule) => ({
    id: rule.code,
    category: ruleCategory(rule.type),
    text: rule.description,
    replacement: rule.preferred,
  }))
  const facts: CanonFact[] = raw.facts.map((fact) => ({
    id: fact.code,
    text: fact.statement,
    keywords: fact.keywords,
    valid_until: fact.expires_at,
  }))
  return { version: String(raw.version), rules, facts }
}

const toGrade = (grade: unknown): Grade =>
  grade === "A" || grade === "B" || grade === "C" ? grade : "C"

function toAgentFinding(raw: EngineFinding, canon: CanonIndex, fallbackId: string): Finding {
  const start = raw.span_start ?? 0
  const end = raw.span_end ?? start
  const rule = raw.rule_id ? canon.ruleById.get(raw.rule_id) : undefined
  const fact = raw.fact_id ? canon.factById.get(raw.fact_id) : undefined
  const citations: Citation[] = [
    ...(rule ? [{ type: "rule" as const, id: rule.code }] : []),
    ...(fact ? [{ type: "fact" as const, id: fact.code }] : []),
  ]

  return {
    id: str(asRow(raw).id, fallbackId),
    start,
    end,
    quote: raw.span_text ?? "",
    category: raw.verdict ?? ruleCategory(rule?.type ?? ""),
    grade: toGrade(raw.grade),
    source: raw.source ?? "offline",
    explanation: raw.explanation,
    suggestion: raw.suggested_fix,
    citations,
  }
}

const verdictFor = (category: string): EngineFinding["verdict"] => {
  if (category === "Legal") return "Needs legal review"
  if (category === "Contradicted" || category === "Outdated" || category === "Unsupported" || category === "Supported") {
    return category
  }
  return null
}

export function makeFindingMapper(raw: RawCanon) {
  const canon = indexCanon(raw)
  const canonVersion = Number(raw.version)
  const originals = new Map<string, EngineFinding>()
  let nextId = 0

  return {
    to(finding: EngineFinding): Finding {
      const mapped = toAgentFinding(
        finding,
        canon,
        `o_${finding.span_start ?? 0}_${finding.span_end ?? 0}_${nextId++}`,
      )
      originals.set(mapped.id, finding)
      return mapped
    },
    probe(finding: EngineFinding): Finding {
      return toAgentFinding(finding, canon, `p_${nextId++}`)
    },
    from(finding: Finding): FindingRow {
      const original = originals.get(finding.id)
      const aiNotes = [...(finding.notes ?? [])]
      const patch = finding.patch ?? null

      if (original) {
        return {
          ...original,
          grade: finding.grade,
          explanation: finding.explanation,
          suggested_fix: finding.suggestion ?? original.suggested_fix,
          ai_notes: aiNotes,
          patch,
        }
      }

      const rule = canon.ruleByCode.get(finding.citations.find((citation) => citation.type === "rule")?.id ?? "")
      const fact = canon.factByCode.get(finding.citations.find((citation) => citation.type === "fact")?.id ?? "")
      const verdict = verdictFor(finding.category)
      const kind = finding.source.replace(/^agent:/, "")
      const severity =
        rule?.severity ??
        (verdict === "Contradicted" || verdict === "Needs legal review" ? "high" : "medium")

      return {
        span_start: finding.start,
        span_end: finding.end,
        span_text: finding.quote,
        rule_id: rule?.id ?? null,
        fact_id: fact?.id ?? null,
        canon_version: canonVersion,
        grade: finding.grade,
        verdict,
        source: "ai",
        severity,
        suggested_fix: finding.patch?.replacement ?? finding.suggestion ?? null,
        explanation: `${finding.explanation} (AI-suggested, not independently verified).`,
        ai_notes: [`Raised by the ${kind} specialist as "${finding.category}".`, ...aiNotes],
        patch,
      }
    },
  }
}

export function makeOfflineRunner(
  mapper: ReturnType<typeof makeFindingMapper>,
  rerun: (text: string) => EngineFinding[],
): OfflineFn {
  return (text) => rerun(text).map(mapper.probe)
}

const TTL_MS = (Number(process.env.AGENT_CACHE_TTL_HOURS) || 24) * 3_600_000

export function supabaseCache(): CacheAdapter {
  return {
    async get(key) {
      const { data, error } = await supabase
        .from("llm_cache")
        .select("payload, expires_at")
        .eq("cache_key", key)
        .maybeSingle()
      if (error) {
        console.warn("Agent cache read failed; continuing without cache:", error.message)
        return null
      }
      if (!data) return null
      const expiresAt = Date.parse(String(data.expires_at))
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
      return data.payload as AgenticResult
    },
    async set(key, value) {
      const { error } = await supabase.from("llm_cache").upsert(
        {
          cache_key: key,
          payload: value,
          kind: "judge",
          expires_at: new Date(Date.now() + TTL_MS).toISOString(),
        },
        { onConflict: "cache_key" },
      )
      if (error) console.warn("Agent cache write failed; continuing without cache:", error.message)
    },
  }
}

export async function persistTrace(reviewRunId: string, result: AgenticResult): Promise<{ ok: boolean; reason?: string }> {
  const row = {
    review_run_id: reviewRunId,
    status: result.status,
    policy: result.plan.policy,
    calls_used: result.calls_used,
    cache_hit: result.cache_hit,
    plan: result.plan,
    trace: result.trace,
    suppressed: result.suppressed,
    warnings: result.warnings,
  }

  let { error } = await supabase.from("agent_traces").insert({ ...row, governance: result.governance })
  if (error && /governance/i.test(error.message)) {
    // 20261110_agent_governance.sql has not been applied yet: keep the trace without the governance report.
    console.warn("agent_traces.governance column missing; saving the trace without it. Run the governance migration.")
    ;({ error } = await supabase.from("agent_traces").insert(row))
  }
  return error ? { ok: false, reason: error.message } : { ok: true }
}