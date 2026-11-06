/**
 * Domain types for the review pipeline. They are deliberately independent of
 * `@/types/engine`, so this module can be dropped in and tested before it is
 * wired to the existing engine. `adapter.ts` maps outcomes onto the shapes the existing app uses.
 */

export type Severity = "low" | "medium" | "high"
export type FindingSource = "deterministic" | "offline" | "llm"
export type Grade = "A" | "B" | "C" | "D"
export type Verdict =
  | "Supported"
  | "Contradicted"
  | "Outdated"
  | "Unsupported"
  | "Needs legal review"

export const VERDICTS: readonly Verdict[] = [
  "Supported",
  "Contradicted",
  "Outdated",
  "Unsupported",
  "Needs legal review",
]

export interface BrandRule {
  id: string
  title: string
  description: string
  severity: Severity
  bannedTerms?: string[]
  preferredTerms?: string[]
  /** ISO date. A rule past this date can no longer be cited. */
  expiresAt?: string | null
  version?: number
}

export interface BrandFact {
  id: string
  statement: string
  /** "outdated" facts stay citable, but only to explain an Outdated verdict. */
  status?: "current" | "outdated"
  expiresAt?: string | null
  version?: number
}

export interface ReviewContext {
  brandId: string
  channel?: string
  audience?: string
  /** Product and brand names. Helps tell a product claim from small talk. */
  brandTerms?: string[]
}

export interface ReviewInput {
  /** Pass exactly the string the user will see highlighted (usually trimmed). */
  content: string
  context: ReviewContext
  rules: BrandRule[]
  facts: BrandFact[]
  rulesVersion: number
  factsVersion: number
}

export interface EvidenceSpan {
  text: string
  start: number
  end: number
}

/** A finding as proposed by any engine, before ProofGate validation. */
export interface CandidateFinding {
  ruleId?: string | null
  factId?: string | null
  category: string
  severity: Severity
  verdict: Verdict | null
  evidence: { text: string; start?: number | null; end?: number | null }
  explanation: string
  suggestedFix?: string | null
  confidence?: number
  source: FindingSource
}

/** A finding that passed code-level validation. */
export interface ReviewFinding {
  ruleId: string | null
  factId: string | null
  category: string
  severity: Severity
  verdict: Verdict | null
  evidence: EvidenceSpan
  explanation: string
  suggestedFix: string | null
  /** Informational only. Never used for scoring or routing decisions. */
  confidence: number
  source: FindingSource
  verified: boolean
  grade: Grade
  /** Set when the validator had to correct the span offsets. */
  repairedSpan: boolean
}

export type RejectReason =
  | "invalid_shape"
  | "no_citation"
  | "rule_not_found"
  | "fact_not_found"
  | "rule_expired"
  | "fact_expired"
  | "verdict_citation_mismatch"
  | "quote_empty"
  | "quote_too_long"
  | "quote_not_found"
  | "duplicate"

export interface RejectedFinding {
  candidate: CandidateFinding
  reason: RejectReason
  detail: string
}

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 }
export const SOURCE_RANK: Record<FindingSource, number> = { deterministic: 3, offline: 2, llm: 1 }
