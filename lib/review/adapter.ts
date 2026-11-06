import type { ReviewOutcome } from "./orchestrator"
import type { ReviewFinding } from "./types"

/**
 * Maps the pipeline's outcome onto the shapes the existing app already uses.
 * Field names follow what page.tsx and the review_runs snapshot read; adjust
 * here if your API differs, and nowhere else.
 */

export interface UiFinding {
  id: string | null
  rule_id: string | null
  fact_id: string | null
  verdict: ReviewFinding["verdict"]
  grade: ReviewFinding["grade"]
  severity: ReviewFinding["severity"]
  /** "rule" for code-detected findings, "ai" for model findings. */
  source: "rule" | "ai"
  span_text: string
  span_start: number
  span_end: number
  explanation: string
  suggested_fix: string | null
  canon_version: number
}

export function toUiFinding(finding: ReviewFinding, canonVersion: number, id: string | null = null): UiFinding {
  return {
    id,
    rule_id: finding.ruleId,
    fact_id: finding.factId,
    verdict: finding.verdict,
    grade: finding.grade,
    severity: finding.severity,
    source: finding.source === "llm" ? "ai" : "rule",
    span_text: finding.evidence.text,
    span_start: finding.evidence.start,
    span_end: finding.evidence.end,
    explanation: finding.explanation,
    suggested_fix: finding.suggestedFix,
    canon_version: canonVersion,
  }
}

/** The routing fields the UI banner reads. */
export function routingFields(outcome: ReviewOutcome) {
  return {
    route: outcome.route,
    llm_calls: outcome.llm.calls,
    cached: outcome.llm.cached,
  }
}

/** Store this in review_runs.snapshot so every decision can be replayed and audited. */
export function toSnapshot(outcome: ReviewOutcome) {
  return {
    ...routingFields(outcome),
    http_attempts: outcome.llm.httpAttempts,
    providers: outcome.llm.providers,
    verification: outcome.llm.verification,
    degraded_reason: outcome.llm.degradedReason,
    plan: {
      llm: outcome.plan.llm,
      verifier: outcome.plan.verifier,
      escalate: outcome.plan.escalate,
      risk_score: outcome.plan.riskScore,
      uncertainty: outcome.plan.uncertainty,
      reasons: outcome.plan.reasons,
    },
    injection_detected: outcome.injection.detected,
    human_review: outcome.humanReview,
    rejected_findings: outcome.rejected.map((r) => ({
      reason: r.reason,
      detail: r.detail,
      quote: r.candidate.evidence.text,
      rule_id: r.candidate.ruleId ?? null,
      fact_id: r.candidate.factId ?? null,
    })),
    versions: outcome.versions,
  }
}

/** Fields to merge into the existing /api/review JSON response. */
export function toApiResponse(outcome: ReviewOutcome, canonVersion: number) {
  return {
    score: outcome.score,
    status: outcome.status,
    engine: outcome.route === "degraded" ? ("offline" as const) : ("llm" as const),
    findings: outcome.findings.map((f) => toUiFinding(f, canonVersion)),
    hiddenGradeD: outcome.rejected.length,
    ai:
      outcome.llm.degradedReason === null
        ? { status: "ok" as const }
        : { status: "failed" as const, error: outcome.llm.degradedReason },
    humanReview: outcome.humanReview,
    ...routingFields(outcome),
  }
}
