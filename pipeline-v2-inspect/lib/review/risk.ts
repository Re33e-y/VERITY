import type { ClaimAssessment } from "./claims"
import type { InjectionReport } from "./injection"
import type { ReviewFinding } from "./types"

/**
 * Layer 3: the risk-based decision router, the brain of the pipeline.
 *
 * It is pure: same inputs, same plan. It decides whether the model is needed
 * at all, whether a second (verifier) call may be needed, and whether a human
 * must look at the result. Gateway availability is handled by the caller.
 */

export type LlmPolicy = "auto" | "always" | "never"

export interface RouteInput {
  content: string
  injection: InjectionReport
  localFindings: ReviewFinding[]
  assessments: ClaimAssessment[]
  policy: LlmPolicy
  maxCalls: number
  maxContentChars: number
}

export interface RoutePlan {
  llm: "none" | "judge"
  /** "conditional": runs only if the judge reports a material finding. */
  verifier: "never" | "conditional"
  /** A human should review this result regardless of what the model says. */
  escalate: boolean
  blockedByInjection: boolean
  /** Claims the judge is asked to look at. Everything else is already settled. */
  focusClaims: string[]
  reasons: string[]
  /** 0 to 100. How much is at stake. */
  riskScore: number
  /** 0 to 100. How much code could not settle. */
  uncertainty: number
  expectedCalls: { min: number; max: number }
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

export function planRoute(input: RouteInput): RoutePlan {
  const { assessments, localFindings, injection } = input

  const uncovered = assessments.filter((a) => a.state === "uncovered")
  const weak = assessments.filter((a) => a.state === "weak")
  const settledAgainst = assessments.filter((a) => a.state === "conflict" || a.state === "outdated")
  const highRisk = assessments.filter((a) => a.highRisk)
  const hasHighLocal = localFindings.some((f) => f.severity === "high")

  const riskScore = clamp(
    Math.min(highRisk.length * 25, 50) +
      Math.min(settledAgainst.length * 20, 40) +
      (hasHighLocal ? 15 : 0) +
      (injection.detected ? 25 : 0)
  )
  const uncertainty = clamp(Math.min(uncovered.length * 35, 70) + Math.min(weak.length * 20, 40))

  const base = {
    escalate: highRisk.length > 0 || settledAgainst.length > 0 || injection.detected,
    blockedByInjection: false,
    focusClaims: [] as string[],
    riskScore,
    uncertainty,
  }
  const none = (reasons: string[], extra: Partial<RoutePlan> = {}): RoutePlan => ({
    llm: "none",
    verifier: "never",
    ...base,
    reasons,
    expectedCalls: { min: 0, max: 0 },
    ...extra,
  })

  if (input.policy === "never") return none(["LLM policy is set to never."])

  if (injection.detected) {
    return none(
      [`Instruction-like text detected (${injection.matches.length} match). Content is not sent to a model.`],
      { blockedByInjection: true, escalate: true }
    )
  }

  if (input.content.length > input.maxContentChars) {
    return none([`Content is longer than ${input.maxContentChars} characters. Local checks only; human review advised.`], {
      escalate: true,
    })
  }

  const needsJudge = uncovered.length + weak.length > 0
  if (!needsJudge && input.policy !== "always") {
    return none([
      assessments.length === 0
        ? "No checkable claims. Deterministic rules were enough."
        : "Every claim is covered, settled against a fact, or owned by a rule. No model needed.",
    ])
  }

  const focus = [...uncovered, ...weak].map((a) => a.claim.text)
  const reasons: string[] = []
  if (uncovered.length) reasons.push(`${uncovered.length} claim(s) have no approved evidence.`)
  if (weak.length) reasons.push(`${weak.length} claim(s) only partly match an approved fact.`)
  if (input.policy === "always" && !needsJudge) reasons.push("LLM policy is set to always.")

  return {
    llm: "judge",
    verifier: input.maxCalls >= 2 ? "conditional" : "never",
    ...base,
    focusClaims: focus,
    reasons,
    expectedCalls: { min: 1, max: input.maxCalls >= 2 ? 2 : 1 },
  }
}
