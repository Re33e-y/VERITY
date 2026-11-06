import type { ClaimAssessment } from "./claims"
import type { InjectionReport } from "./injection"
import type { BrandRule, CandidateFinding, ReviewInput } from "./types"

/**
 * Layers 1 and 2 combined: everything code can decide with zero API calls.
 * Plug in your own engine with the same signature to reuse existing rules.
 */
export interface LocalEngineArgs {
  input: ReviewInput
  assessments: ClaimAssessment[]
  injection: InjectionReport
}

export type LocalEngine = (args: LocalEngineArgs) => CandidateFinding[] | Promise<CandidateFinding[]>

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function termRegex(term: string): RegExp {
  const body = term.trim().split(/\s+/).map(escapeRegex).join("\\s+")
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu")
}

function terminologyFindings(content: string, rules: BrandRule[]): CandidateFinding[] {
  const out: CandidateFinding[] = []
  for (const rule of rules) {
    for (const term of rule.bannedTerms ?? []) {
      if (!term.trim()) continue
      const regex = termRegex(term)
      let match: RegExpExecArray | null
      while ((match = regex.exec(content)) !== null) {
        const preferred = rule.preferredTerms?.[0]
        out.push({
          ruleId: rule.id,
          category: "terminology",
          severity: rule.severity,
          verdict: null,
          evidence: { text: match[0], start: match.index, end: match.index + match[0].length },
          explanation: `"${match[0]}" is not allowed. ${rule.title}.`,
          suggestedFix: preferred ?? null,
          confidence: 1,
          source: "deterministic",
        })
        if (match[0].length === 0) regex.lastIndex++
      }
    }
  }
  return out
}

function claimFindings(assessments: ClaimAssessment[]): CandidateFinding[] {
  const out: CandidateFinding[] = []

  for (const a of assessments) {
    const evidence = { text: a.claim.text, start: a.claim.start, end: a.claim.end }

    if (a.highRisk) {
      out.push({
        category: "legal",
        severity: "high",
        verdict: "Needs legal review",
        evidence,
        explanation:
          "Pricing, guarantee or regulated wording must be signed off by a legal or compliance reviewer before publishing.",
        confidence: 1,
        source: "deterministic",
      })
    }

    if (a.state === "conflict" && a.factId) {
      out.push({
        factId: a.factId,
        category: "claim",
        severity: "high",
        verdict: "Contradicted",
        evidence,
        explanation: a.detail,
        confidence: 0.95,
        source: "offline",
      })
    } else if (a.state === "outdated" && a.factId) {
      out.push({
        factId: a.factId,
        category: "claim",
        severity: "medium",
        verdict: "Outdated",
        evidence,
        explanation: a.detail,
        confidence: 0.95,
        source: "offline",
      })
    }
  }
  return out
}

function injectionFindings(injection: InjectionReport): CandidateFinding[] {
  return injection.matches.map((m) => ({
    category: "security",
    severity: "high" as const,
    verdict: null,
    evidence: { text: m.text, start: m.start, end: m.end },
    explanation:
      "Instruction-like text found in the content. It is treated as data and was not followed or sent to a model.",
    confidence: 1,
    source: "deterministic" as const,
  }))
}

export const builtinLocalEngine: LocalEngine = ({ input, assessments, injection }) => [
  ...terminologyFindings(input.content, input.rules),
  ...claimFindings(assessments),
  ...injectionFindings(injection),
]
