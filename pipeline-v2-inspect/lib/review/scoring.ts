import type { Grade, ReviewFinding, Severity } from "./types"

/**
 * Score from validated findings only. A model's own confidence is never an
 * input. Weights are explicit so they can be defended and tuned in one place.
 */
export const SEVERITY_PENALTY: Record<Severity, number> = { low: 5, medium: 15, high: 25 }
export const GRADE_WEIGHT: Record<Grade, number> = { A: 1, B: 1, C: 0.5, D: 0 }
const LEGAL_REVIEW_MIN_PENALTY = 10

export function scoreFindings(findings: ReviewFinding[]): number {
  let penalty = 0
  for (const finding of findings) {
    let base = SEVERITY_PENALTY[finding.severity]
    if (finding.verdict === "Needs legal review") base = Math.max(base, LEGAL_REVIEW_MIN_PENALTY)
    penalty += base * GRADE_WEIGHT[finding.grade]
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}
