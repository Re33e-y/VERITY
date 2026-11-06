import {
  SEVERITY_RANK,
  SOURCE_RANK,
  type BrandFact,
  type BrandRule,
  type CandidateFinding,
  type Grade,
  type RejectedFinding,
  type RejectReason,
  type ReviewFinding,
  type Severity,
  type Verdict,
} from "./types"

/**
 * Layer 5: ProofGate evidence validation. Entirely code, no model.
 *
 * The model proposes, VERITY validates. A finding is accepted only if its
 * citations exist and are current, and its quote is really in the content.
 */

export interface ValidationContext {
  content: string
  rules: Map<string, BrandRule>
  facts: Map<string, BrandFact>
  now: Date
  maxQuoteChars?: number
}

export function buildValidationContext(
  content: string,
  rules: BrandRule[],
  facts: BrandFact[],
  now: Date = new Date()
): ValidationContext {
  return {
    content,
    rules: new Map(rules.map((r) => [r.id, r])),
    facts: new Map(facts.map((f) => [f.id, f])),
    now,
  }
}

/** Code-detected findings in these categories need no rule or fact id. */
const CITATION_EXEMPT_CATEGORIES = new Set(["security", "legal"])
const MAX_LLM_CONFIDENCE = 0.9

function isExpired(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false
  const time = Date.parse(iso)
  return Number.isFinite(time) && time < now.getTime()
}

/** Length-preserving fold so offsets in the folded text match the original. */
function foldChar(ch: string): string {
  switch (ch) {
    case "\u2018":
    case "\u2019":
      return "'"
    case "\u201C":
    case "\u201D":
      return '"'
    case "\u00A0":
      return " "
    case "\u2013":
    case "\u2014":
      return "-"
    default: {
      const lower = ch.toLowerCase()
      return lower.length === 1 ? lower : ch
    }
  }
}

function fold(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) out += foldChar(text.charAt(i))
  return out
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export interface LocatedQuote {
  start: number
  end: number
  text: string
  repaired: boolean
}

/**
 * Find the quote in the content. Tries, in order: the offsets as given, exact
 * text, then a case, quote-style and whitespace tolerant match. The stored text
 * is always sliced from the real content, never trusted from the caller.
 */
export function locateQuote(
  content: string,
  quote: string,
  hintStart?: number | null,
  hintEnd?: number | null
): LocatedQuote | null {
  const hasHint =
    typeof hintStart === "number" && typeof hintEnd === "number" &&
    Number.isInteger(hintStart) && Number.isInteger(hintEnd)

  if (hasHint && hintStart! >= 0 && hintEnd! > hintStart! && hintEnd! <= content.length) {
    if (content.slice(hintStart!, hintEnd!) === quote) {
      return { start: hintStart!, end: hintEnd!, text: quote, repaired: false }
    }
  }

  const positions: number[] = []
  let from = 0
  for (;;) {
    const idx = content.indexOf(quote, from)
    if (idx === -1) break
    positions.push(idx)
    from = idx + 1
  }
  if (positions.length > 0) {
    const target = hasHint ? (hintStart as number) : 0
    const best = positions.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
    return { start: best, end: best + quote.length, text: quote, repaired: hasHint }
  }

  const words = fold(quote).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const pattern = new RegExp(words.map(escapeRegex).join("\\s+"), "g")
  const folded = fold(content)
  const matches: Array<{ index: number; length: number }> = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(folded)) !== null) {
    matches.push({ index: m.index, length: m[0].length })
    if (m[0].length === 0) pattern.lastIndex++
  }
  if (matches.length === 0) return null
  const target = hasHint ? (hintStart as number) : 0
  const pick = matches.reduce((a, b) => (Math.abs(b.index - target) < Math.abs(a.index - target) ? b : a))
  return {
    start: pick.index,
    end: pick.index + pick.length,
    text: content.slice(pick.index, pick.index + pick.length),
    repaired: true,
  }
}

function clampSeverity(value: unknown): Severity {
  return value === "low" || value === "medium" || value === "high" ? value : "medium"
}

function clampConfidence(value: unknown, source: CandidateFinding["source"]): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : source === "llm" ? 0.5 : 1
  const capped = Math.min(Math.max(n, 0), source === "llm" ? MAX_LLM_CONFIDENCE : 1)
  return Math.round(capped * 100) / 100
}

function initialGrade(source: CandidateFinding["source"]): Grade {
  // LLM findings start at C and are promoted to B only by independent verification.
  return source === "deterministic" ? "A" : source === "offline" ? "B" : "C"
}

function reject(candidate: CandidateFinding, reason: RejectReason, detail: string): RejectedFinding {
  return { candidate, reason, detail }
}

export function validateFinding(
  candidate: CandidateFinding,
  ctx: ValidationContext
): ReviewFinding | RejectedFinding {
  if (
    typeof candidate !== "object" || candidate === null ||
    typeof candidate.category !== "string" || candidate.category.length === 0 ||
    typeof candidate.explanation !== "string" ||
    typeof candidate.evidence !== "object" || candidate.evidence === null
  ) {
    return reject(candidate, "invalid_shape", "Finding is missing required fields.")
  }

  const quote = candidate.evidence.text
  if (typeof quote !== "string" || quote.trim().length === 0) {
    return reject(candidate, "quote_empty", "Quoted span is empty.")
  }
  if (quote.length > (ctx.maxQuoteChars ?? 400)) {
    return reject(candidate, "quote_too_long", "Quoted span is longer than 400 characters.")
  }

  const ruleId = candidate.ruleId ?? null
  const factId = candidate.factId ?? null
  const rule = ruleId ? ctx.rules.get(ruleId) : undefined
  const fact = factId ? ctx.facts.get(factId) : undefined

  // Layer 1: existence and freshness of every citation.
  if (ruleId && !rule) return reject(candidate, "rule_not_found", `Rule ${ruleId} does not exist in the active canon.`)
  if (factId && !fact) return reject(candidate, "fact_not_found", `Fact ${factId} does not exist in the active canon.`)
  if (rule && isExpired(rule.expiresAt, ctx.now)) {
    return reject(candidate, "rule_expired", `Rule ${rule.id} has expired.`)
  }
  if (fact && isExpired(fact.expiresAt, ctx.now) && candidate.verdict !== "Outdated") {
    return reject(candidate, "fact_expired", `Fact ${fact.id} has expired and can only support an Outdated verdict.`)
  }

  const verdict: Verdict | null = candidate.verdict
  const exempt = candidate.source === "deterministic" && CITATION_EXEMPT_CATEGORIES.has(candidate.category)
  // "Unsupported" is evidence-free by definition: the lack of an approved source is the finding.
  const needsCitation = !exempt && verdict !== "Unsupported"
  if (needsCitation && !rule && !fact) {
    return reject(candidate, "no_citation", "Finding cites no approved rule or fact.")
  }
  if ((verdict === "Contradicted" || verdict === "Outdated") && !fact) {
    return reject(candidate, "verdict_citation_mismatch", `${verdict} requires an approved fact citation.`)
  }
  if (verdict === "Supported" && !fact) {
    return reject(candidate, "verdict_citation_mismatch", "Supported requires an approved fact citation.")
  }

  // Layer 2: the quote must really be in the content.
  const located = locateQuote(ctx.content, quote, candidate.evidence.start, candidate.evidence.end)
  if (!located) {
    return reject(candidate, "quote_not_found", "Quoted span does not appear in the submitted content.")
  }

  return {
    ruleId,
    factId,
    category: candidate.category,
    severity: clampSeverity(candidate.severity),
    verdict,
    evidence: { text: located.text, start: located.start, end: located.end },
    explanation: candidate.explanation.trim(),
    suggestedFix: candidate.suggestedFix?.trim() || null,
    confidence: clampConfidence(candidate.confidence, candidate.source),
    source: candidate.source,
    verified: true,
    grade: initialGrade(candidate.source),
    repairedSpan: located.repaired,
  }
}

function isRejected(value: ReviewFinding | RejectedFinding): value is RejectedFinding {
  return "reason" in value
}

function identity(finding: ReviewFinding): string {
  return `${finding.ruleId ?? finding.factId ?? finding.category}|${finding.verdict ?? ""}`
}

function overlapRatio(a: ReviewFinding, b: ReviewFinding): number {
  const start = Math.max(a.evidence.start, b.evidence.start)
  const end = Math.min(a.evidence.end, b.evidence.end)
  if (end <= start) return 0
  const shortest = Math.min(a.evidence.end - a.evidence.start, b.evidence.end - b.evidence.start)
  return (end - start) / shortest
}

function priority(finding: ReviewFinding): number {
  return SOURCE_RANK[finding.source] * 10 + SEVERITY_RANK[finding.severity]
}

/** Drop findings that restate another finding on the same span. */
export function dedupeFindings(findings: ReviewFinding[]): {
  kept: ReviewFinding[]
  dropped: ReviewFinding[]
} {
  const ordered = [...findings].sort((a, b) => priority(b) - priority(a))
  const kept: ReviewFinding[] = []
  const dropped: ReviewFinding[] = []

  for (const finding of ordered) {
    const twin = kept.find((k) => identity(k) === identity(finding) && overlapRatio(k, finding) >= 0.5)
    if (twin) dropped.push(finding)
    else kept.push(finding)
  }
  kept.sort((a, b) => a.evidence.start - b.evidence.start || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  return { kept, dropped }
}

export function validateFindings(
  candidates: CandidateFinding[],
  ctx: ValidationContext
): { accepted: ReviewFinding[]; rejected: RejectedFinding[] } {
  const accepted: ReviewFinding[] = []
  const rejected: RejectedFinding[] = []

  for (const candidate of candidates) {
    const result = validateFinding(candidate, ctx)
    if (isRejected(result)) rejected.push(result)
    else accepted.push(result)
  }

  const { kept, dropped } = dedupeFindings(accepted)
  for (const finding of dropped) {
    rejected.push({
      candidate: {
        ruleId: finding.ruleId,
        factId: finding.factId,
        category: finding.category,
        severity: finding.severity,
        verdict: finding.verdict,
        evidence: finding.evidence,
        explanation: finding.explanation,
        source: finding.source,
      },
      reason: "duplicate",
      detail: "Restates another finding on the same span.",
    })
  }
  return { accepted: kept, rejected }
}

/** Promote or hold a finding after independent verification. */
export function applyVerification(
  finding: ReviewFinding,
  result: { applies: boolean; reason: string }
): ReviewFinding {
  if (result.applies) return { ...finding, grade: "B" }
  return {
    ...finding,
    grade: "C",
    explanation: `${finding.explanation} Independent verifier disagreed: ${result.reason}`.trim(),
  }
}
