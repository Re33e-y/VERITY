import type { BrandFact } from "./types"

/**
 * Layer 2: offline semantic engine. Zero API calls.
 *
 * Splits content into sentences, decides which ones make claims that need
 * approved evidence, and compares each against the approved facts. The result
 * (covered, weak, uncovered, conflict, outdated) is the "evidence completeness"
 * signal the router uses to decide whether a model is needed at all.
 */

export type ClaimKind =
  | "numeric"
  | "price"
  | "capability"
  | "comparative"
  | "absolute"
  | "regulated"
  | "guarantee"

export interface Sentence {
  text: string
  start: number
  end: number
}

export interface Claim extends Sentence {
  kinds: ClaimKind[]
  numbers: string[]
  tokens: string[]
}

export type ClaimState =
  | "covered" // an approved fact supports it
  | "weak" // partial overlap with an approved fact
  | "uncovered" // no approved fact is close
  | "conflict" // matches a current fact but states different numbers
  | "outdated" // restates a retired fact
  | "not_applicable" // rule layer owns it (for example a bare superlative)

export interface ClaimAssessment {
  claim: Claim
  state: ClaimState
  factId: string | null
  /** The current fact that should replace an outdated or conflicting claim. */
  currentFactId: string | null
  overlap: number
  detail: string
  /** Price, regulated or guarantee language: always goes to a human. */
  highRisk: boolean
}

export interface CoverageThresholds {
  strong: number
  weak: number
}

export const DEFAULT_THRESHOLDS: CoverageThresholds = { strong: 0.6, weak: 0.3 }

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is", "it",
  "its", "of", "on", "or", "our", "that", "the", "their", "this", "to", "was", "we", "will", "with",
  "you", "your", "also", "can", "do", "does", "all", "any", "so", "if", "into", "per", "each",
  "against", "every", "about", "more", "just", "now", "new", "today",
])

export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
  return Array.from(new Set(tokens))
}

export function extractNumbers(text: string): string[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []
  return found.map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""))
}

export function splitSentences(content: string): Sentence[] {
  const out: Sentence[] = []
  let segStart = 0

  for (let i = 0; i < content.length; i++) {
    const ch = content.charAt(i)
    const next = content.charAt(i + 1)
    const boundary =
      ch === "\n" ||
      ((ch === "." || ch === "!" || ch === "?") && (i + 1 === content.length || /\s/.test(next)))

    if (boundary || i === content.length - 1) {
      let s = segStart
      let e = i + 1
      while (s < e && /\s/.test(content.charAt(s))) s++
      while (e > s && /\s/.test(content.charAt(e - 1))) e--
      if (e > s) out.push({ text: content.slice(s, e), start: s, end: e })
      segStart = i + 1
    }
  }
  return out
}

const PRICE =
  /(?:[$€£₹]\s?\d|\b\d[\d,.]*\s?(?:usd|eur|inr|dollars?|euros?|rupees?)\b|\bper\s+(?:user|seat|month|year|license)\b|\bprice[sd]?\b|\bcosts?\b)/i
const REGULATED =
  /\b(?:clinically|cures?d?|treats?|treatment|fda|hipaa|gdpr|soc\s?2|iso\s?\d{3,}|certified|compliant|risk[- ]free|no\s+side\s+effects|medical|diagnos\w+|guaranteed\s+returns?)\b/i
const GUARANTEE = /\b(?:guarantee[sd]?|warrant(?:y|ies|ed)|promise[sd]?)\b/i
const ABSOLUTE =
  /\b(?:best|#1|number\s+one|only|never|always|perfect|unbeatable|industry[- ]leading|world[- ]class|flawless)\b|\b100\s?%/i
const COMPARATIVE = /\b(?:better|faster|cheaper|smarter|safer)\s+than\b|\boutperforms?\b|\bsuperior\s+to\b|\bbeats?\b/i
const CAPABILITY =
  /\b(?:checks?|supports?|integrates?|includes?|works\s+with|offers?|provides?|detects?|generates?|reviews?|scans?|connects?|automates?|exports?|imports?|analy[sz]es?|translates?|handles?|verifies)\b/i

function detectKinds(sentence: string, brandTerms: string[] | undefined): ClaimKind[] {
  const kinds: ClaimKind[] = []
  if (PRICE.test(sentence)) kinds.push("price")
  if (/\d/.test(sentence)) kinds.push("numeric")
  if (REGULATED.test(sentence)) kinds.push("regulated")
  if (GUARANTEE.test(sentence)) kinds.push("guarantee")
  if (ABSOLUTE.test(sentence)) kinds.push("absolute")
  if (COMPARATIVE.test(sentence)) kinds.push("comparative")
  if (CAPABILITY.test(sentence)) {
    const lower = sentence.toLowerCase()
    const mentionsBrand =
      !brandTerms?.length ||
      brandTerms.some((term) => term.length > 0 && lower.includes(term.toLowerCase())) ||
      /\b(?:our|we)\b/i.test(sentence)
    if (mentionsBrand) kinds.push("capability")
  }
  return kinds
}

function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  let shared = 0
  for (const token of a) if (setB.has(token)) shared++
  return (2 * shared) / (a.length + b.length)
}

function sameNumbers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((n) => setB.has(n))
}

/** A claim is a sentence that makes a checkable statement. Small talk is not. */
export function extractClaims(content: string, brandTerms?: string[]): Claim[] {
  const claims: Claim[] = []
  for (const sentence of splitSentences(content)) {
    const kinds = detectKinds(sentence.text, brandTerms)
    if (kinds.length === 0) continue
    claims.push({
      ...sentence,
      kinds,
      numbers: extractNumbers(sentence.text),
      tokens: tokenize(sentence.text),
    })
  }
  return claims
}

const HIGH_RISK_KINDS: ClaimKind[] = ["price", "regulated", "guarantee"]
const EVIDENCE_KINDS: ClaimKind[] = ["numeric", "price", "capability", "comparative", "regulated", "guarantee"]

export function assessClaims(
  content: string,
  facts: BrandFact[],
  options: { brandTerms?: string[]; thresholds?: CoverageThresholds } = {}
): ClaimAssessment[] {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS
  const factViews = facts.map((fact) => ({
    fact,
    tokens: tokenize(fact.statement),
    numbers: extractNumbers(fact.statement),
  }))

  return extractClaims(content, options.brandTerms).map((claim): ClaimAssessment => {
    const highRisk = claim.kinds.some((k) => HIGH_RISK_KINDS.includes(k))
    const needsEvidence = claim.kinds.some((k) => EVIDENCE_KINDS.includes(k))

    if (!needsEvidence) {
      return {
        claim, state: "not_applicable", factId: null, currentFactId: null, overlap: 0,
        detail: "Handled by deterministic rules; no approved fact is needed.", highRisk,
      }
    }

    const scored = factViews
      .map((view) => ({ ...view, overlap: dice(claim.tokens, view.tokens) }))
      .sort((a, b) => b.overlap - a.overlap)
    const best = scored[0]
    const strong = scored.filter((s) => s.overlap >= thresholds.strong)

    if (!best || best.overlap < thresholds.weak) {
      return {
        claim, state: "uncovered", factId: null, currentFactId: null, overlap: best?.overlap ?? 0,
        detail: "No approved fact covers this claim. That does not mean it is false.", highRisk,
      }
    }

    if (strong.length === 0) {
      return {
        claim, state: "weak", factId: best.fact.id, currentFactId: null, overlap: best.overlap,
        detail: `Only partial overlap with approved fact ${best.fact.id}.`, highRisk,
      }
    }

    const isCurrent = (s: (typeof strong)[number]) => (s.fact.status ?? "current") === "current"
    const sameNumbersAs = (s: (typeof strong)[number]) =>
      claim.numbers.length === 0 || s.numbers.length === 0 || sameNumbers(claim.numbers, s.numbers)

    const currentMatch = strong.find((s) => isCurrent(s) && sameNumbersAs(s))
    if (currentMatch) {
      return {
        claim, state: "covered", factId: currentMatch.fact.id, currentFactId: currentMatch.fact.id,
        overlap: currentMatch.overlap, detail: `Supported by approved fact ${currentMatch.fact.id}.`, highRisk,
      }
    }

    const currentFact = strong.find(isCurrent)
    const outdatedMatch = strong.find((s) => !isCurrent(s) && sameNumbersAs(s))
    if (outdatedMatch) {
      return {
        claim, state: "outdated", factId: outdatedMatch.fact.id, currentFactId: currentFact?.fact.id ?? null,
        overlap: outdatedMatch.overlap,
        detail: `Restates retired fact ${outdatedMatch.fact.id}${currentFact ? `; current fact ${currentFact.fact.id} says otherwise` : ""}.`,
        highRisk,
      }
    }

    if (currentFact) {
      return {
        claim, state: "conflict", factId: currentFact.fact.id, currentFactId: currentFact.fact.id,
        overlap: currentFact.overlap,
        detail: `States different figures than approved fact ${currentFact.fact.id}.`, highRisk,
      }
    }

    return {
      claim, state: "weak", factId: best.fact.id, currentFactId: null, overlap: best.overlap,
      detail: `Related to ${best.fact.id}, which is not a current approved fact.`, highRisk,
    }
  })
}
