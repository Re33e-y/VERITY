import type { Fact, Finding, Rule, Verdict } from "@/types/engine"

type KeywordFact = Fact & { keywords?: string[] | null }
type Sentence = { text: string; start: number; end: number }
type Quantity = {
  kind: "money" | "percent" | "duration" | "count"
  value: number
  unit: string
}

const MIN_MATCH = 2
const STRONG_MATCH = 3
const OFFLINE_TAG = " [offline engine: rule-based, not model-verified]"

const STOP_WORDS = new Set(
  (
    "a an the and or but of to in on for with by at from is are was were be been being it its this that these those " +
    "as we our you your they their will can may do does did has have had so also too very just more than into about"
  ).split(" ")
)

const stem = (word: string) =>
  word.length > 4
    ? word.replace(/ies$/, "y").replace(/(ing|ed)$/, "").replace(/s$/, "")
    : word

const tokens = (value: string) =>
  (value.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [])
    .filter((word) => !STOP_WORDS.has(word))
    .map(stem)

function splitSentences(text: string): Sentence[] {
  const result: Sentence[] = []
  for (const match of text.matchAll(/(?:[^.!?\n]|\.(?=\d))+[.!?]*/g)) {
    const raw = match[0]
    const leadingWhitespace = raw.length - raw.trimStart().length
    const sentenceText = raw.trim()
    if (sentenceText.length > 1 && match.index !== undefined) {
      const start = match.index + leadingWhitespace
      result.push({
        text: sentenceText,
        start,
        end: start + sentenceText.length,
      })
    }
  }
  return result
}

const DAYS_IN_UNIT: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
}

const parseNumber = (value: string) => Number.parseFloat(value.replace(/,/g, ""))

function quantities(text: string): Quantity[] {
  const result: Quantity[] = []

  for (const match of text.matchAll(
    /[$₹€£]\s?(\d+(?:[.,]\d+)*)|(\d+(?:[.,]\d+)*)\s?(?:usd|inr|eur|dollars?|rupees?)\b/gi
  )) {
    result.push({
      kind: "money",
      value: parseNumber(match[1] ?? match[2]),
      unit: "money",
    })
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s?(?:%|percent)/gi)) {
    result.push({ kind: "percent", value: parseNumber(match[1]), unit: "%" })
  }
  for (const match of text.matchAll(
    /(\d+(?:\.\d+)?)[\s-]?(day|week|month|year)s?\b/gi
  )) {
    result.push({
      kind: "duration",
      value: parseNumber(match[1]) * DAYS_IN_UNIT[match[2].toLowerCase()],
      unit: "days",
    })
  }
  for (const match of text.matchAll(
    /\b(\d+)\s?(users?|seats?|members?|projects?|languages?|integrations?|reviews?|checks?|rules?)\b/gi
  )) {
    result.push({
      kind: "count",
      value: parseNumber(match[1]),
      unit: stem(match[2].toLowerCase()),
    })
  }

  return result
}

function formatQuantity(quantity: Quantity) {
  if (quantity.kind === "percent") return `${quantity.value}%`
  if (quantity.kind === "duration") return `${quantity.value} days`
  if (quantity.kind === "count") return `${quantity.value} ${quantity.unit}`
  return `amount ${quantity.value}`
}

function findQuantityMismatch(
  claimQuantities: Quantity[],
  factQuantities: Quantity[]
): string | null {
  for (const claim of claimQuantities) {
    const comparable = factQuantities.filter(
      (fact) =>
        fact.kind === claim.kind &&
        (claim.kind !== "count" || fact.unit === claim.unit)
    )
    if (
      comparable.length > 0 &&
      !comparable.some((fact) => Math.abs(fact.value - claim.value) < 1e-9)
    ) {
      return `claim says ${formatQuantity(claim)}, approved source says ${formatQuantity(comparable[0])}`
    }
  }
  return null
}

const NEGATION_PATTERN =
  /\b(not|no|never|cannot|can't|isn't|aren't|doesn't|don't|won't|without|lacks?|unavailable|none|nor)\b|n't\b/gi

function polarity(text: string) {
  const negationCount = (text.match(NEGATION_PATTERN) ?? []).length
  return negationCount % 2 === 0 ? 1 : -1
}

function indexFacts(facts: KeywordFact[]) {
  const documents = facts.map(
    (fact) =>
      new Set([
        ...tokens(fact.statement),
        ...(fact.keywords ?? []).flatMap(tokens),
      ])
  )
  const inverseDocumentFrequency = new Map<string, number>()

  for (const document of documents) {
    for (const token of document) {
      inverseDocumentFrequency.set(
        token,
        (inverseDocumentFrequency.get(token) ?? 0) + 1
      )
    }
  }
  for (const [token, count] of inverseDocumentFrequency) {
    inverseDocumentFrequency.set(
      token,
      Math.log(1 + facts.length / count)
    )
  }

  return { documents, inverseDocumentFrequency }
}

function bestFact(
  sentence: string,
  facts: KeywordFact[],
  index: ReturnType<typeof indexFacts>
) {
  const sentenceTokens = new Set(tokens(sentence))
  const lowerSentence = sentence.toLowerCase()
  let best: { fact: KeywordFact; score: number } | null = null

  for (let factIndex = 0; factIndex < facts.length; factIndex++) {
    const fact = facts[factIndex]
    let score = 0
    for (const token of sentenceTokens) {
      if (index.documents[factIndex].has(token)) {
        score += index.inverseDocumentFrequency.get(token) ?? 0
      }
    }
    for (const keyword of fact.keywords ?? []) {
      if (keyword && lowerSentence.includes(keyword.toLowerCase())) score += 2
    }
    if (score >= MIN_MATCH && (!best || score > best.score)) {
      best = { fact, score }
    }
  }

  return best
}

function isExpired(fact: KeywordFact) {
  if (!fact.expires_at) return false
  const expiry = Date.parse(fact.expires_at)
  return Number.isFinite(expiry) && expiry <= Date.now()
}

const LEGAL_PATTERN =
  /(\d[\d,.]*\s?(%|percent)|[$₹€£]\s?\d|\bguarantee\w*|\bcure[sd]?\b|clinically|risk-free|\bfda\b|lawsuit|\binvest\w*|\breturns?\b|\bcompliant\b|\bcertified\b)/i

const CLAIM_SIGNAL_PATTERN =
  /\d|[$₹€£%]|\b(free|costs?|price[sd]?|lasts?|supports?|includes?|offers?|checks?|available|works?|integrat\w+|compatible|unlimited|every|all|always|never|only|trusted|proven|guarantee\w*)\b/i

const TONE_PATTERNS: [RegExp, number, string][] = [
  [/!{2,}/g, 3, "stacked exclamation marks"],
  [/\b[A-Z]{4,}\b/g, 2, "all-caps shouting"],
  [/\b(omg|lol|wow|yay|gonna|wanna|gotta|dude|guys|folks)\b/gi, 2, "slang"],
  [
    /\b(insane|crazy|mind-?blowing|game-?changer|revolutionary|unbelievable|incredible|amazing|epic|magical)\b/gi,
    2,
    "hype wording",
  ],
  [
    /\b(hurry|act now|don't miss|last chance|limited time|must try|have to try|you (?:have|need) to)\b/gi,
    2,
    "pressure language",
  ],
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, 1, "emoji"],
]

const ALLOWED_CAPS = /^(NASA|HTTP|HTTPS|JSON|HTML|SAAS|HIPAA|GDPR|WCAG|API|OCR)$/
const ABSOLUTE_PATTERN =
  /\b(unbeatable|unmatched|world-?class|best-in-class|number one|never fails?|always works?|zero risk|flawless|perfect(?:ly)?|100\s?%|market leader|(?:industry|market)-leading|leading provider|#\s?1)\b/gi
const INJECTION_PATTERN =
  /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|above|prior|all)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?)\b|\b(?:system|assistant)\s*:|\bmark every\b|\bdo not (?:flag|report)\b|\breport that this content\b/gi

export function runOfflineEngine(
  content: string,
  rules: Rule[],
  facts: Fact[],
  canonVersion: number,
  existingFindings: Finding[] = []
): Finding[] {
  const keywordFacts = facts as KeywordFact[]
  const factIndex = indexFacts(keywordFacts)
  const findings: Finding[] = []
  const usedSpans: Array<[number, number]> = existingFindings
    .filter(
      (finding): finding is Finding & { span_start: number; span_end: number } =>
        finding.span_start !== null && finding.span_end !== null
    )
    .map((finding) => [finding.span_start, finding.span_end])
  const overlapsUsedSpan = (start: number, end: number) =>
    usedSpans.some(([usedStart, usedEnd]) => start < usedEnd && usedStart < end)

  const makeFinding = (
    start: number,
    end: number,
    properties: Pick<Finding, "grade" | "severity" | "explanation"> &
      Partial<Finding>
  ): Finding => ({
    span_start: start,
    span_end: end,
    span_text: content.slice(start, end),
    rule_id: null,
    fact_id: null,
    canon_version: canonVersion,
    verdict: null,
    source: "rule",
    suggested_fix: null,
    ...properties,
  })

  for (const match of content.matchAll(INJECTION_PATTERN)) {
    if (match.index === undefined) continue
    const start = match.index
    const end = start + match[0].length
    findings.push(
      makeFinding(start, end, {
        grade: "A",
        severity: "medium",
        explanation:
          "Instruction-like text was found inside the content. It was treated as data and ignored by the review." +
          OFFLINE_TAG,
      })
    )
    usedSpans.push([start, end])
  }

  const injectionSpans = findings
    .filter((finding) => finding.grade === "A" && finding.rule_id === null)
    .map((finding) => [finding.span_start!, finding.span_end!] as const)
  const reviewableSentences = splitSentences(content).filter(
    (sentence) =>
      !injectionSpans.some(
        ([start, end]) => sentence.start < end && start < sentence.end
      )
  )
  const toneRule = rules.find((rule) => rule.type === "tone")
  const absoluteRule = rules.find((rule) => rule.type === "absolute_claim")

  for (const match of content.matchAll(ABSOLUTE_PATTERN)) {
    if (match.index === undefined) continue
    const start = match.index
    const end = start + match[0].length
    if (overlapsUsedSpan(start, end)) continue
    usedSpans.push([start, end])
    findings.push(
      makeFinding(start, end, {
        grade: "C",
        severity: "medium",
        rule_id: absoluteRule?.id ?? null,
        explanation: `${absoluteRule ? `${absoluteRule.code}: ` : ""}Absolute or superlative wording cannot be verified from approved sources. Human confirmation needed.${OFFLINE_TAG}`,
      })
    )
  }

  for (const sentence of reviewableSentences) {
    const toneHits: Array<{
      start: number
      end: number
      weight: number
      reason: string
    }> = []
    for (const [pattern, weight, reason] of TONE_PATTERNS) {
      for (const match of sentence.text.matchAll(pattern)) {
        if (match.index === undefined) continue
        if (reason === "all-caps shouting" && ALLOWED_CAPS.test(match[0])) {
          continue
        }
        toneHits.push({
          start: sentence.start + match.index,
          end: sentence.start + match.index + match[0].length,
          weight,
          reason,
        })
      }
    }

    const toneScore = toneHits.reduce((total, hit) => total + hit.weight, 0)
    if (toneScore < 3) continue
    const start = Math.min(...toneHits.map((hit) => hit.start))
    const end = Math.max(...toneHits.map((hit) => hit.end))
    if (overlapsUsedSpan(start, end)) continue
    usedSpans.push([start, end])

    const reasons = [...new Set(toneHits.map((hit) => hit.reason))].join(", ")
    findings.push(
      makeFinding(start, end, {
        grade: "C",
        severity: toneScore >= 6 ? "medium" : "low",
        rule_id: toneRule?.id ?? null,
        explanation: `${toneRule ? `${toneRule.code}: ` : ""}Tone may not match a confident, plain, professional voice (${reasons}; score ${toneScore}). Tone is subjective; human review is recommended.${OFFLINE_TAG}`,
      })
    )
  }

  for (const sentence of reviewableSentences) {
    if (sentence.text.endsWith("?") || !CLAIM_SIGNAL_PATTERN.test(sentence.text)) {
      continue
    }

    const matched = bestFact(sentence.text, keywordFacts, factIndex)
    const mismatch = matched
      ? findQuantityMismatch(
          quantities(sentence.text),
          quantities(matched.fact.statement)
        )
      : null
    const addClaimFinding = (
      verdict: Verdict,
      grade: Finding["grade"],
      severity: Finding["severity"],
      explanation: string
    ) => {
      findings.push(
        makeFinding(sentence.start, sentence.end, {
          verdict,
          grade,
          severity,
          fact_id: matched?.fact.id ?? null,
          explanation: `${explanation}${OFFLINE_TAG}`,
        })
      )
    }

    if (matched && isExpired(matched.fact)) {
      addClaimFinding(
        "Outdated",
        "A",
        "medium",
        `${matched.fact.code} expired on ${matched.fact.expires_at?.slice(0, 10)}. The approved source is out of date.`
      )
    } else if (LEGAL_PATTERN.test(sentence.text)) {
      addClaimFinding(
        "Needs legal review",
        "C",
        "high",
        `Numbers, finance, health or legal-sounding claim. Always routed to a human.${matched && mismatch ? ` It also conflicts with ${matched.fact.code}: ${mismatch}.` : ""}`
      )
    } else if (!matched) {
      addClaimFinding(
        "Unsupported",
        "C",
        "medium",
        "No approved source covers this claim. This does not mean it is false."
      )
    } else if (mismatch) {
      addClaimFinding(
        "Contradicted",
        "A",
        "high",
        `Conflicts with ${matched.fact.code} ("${matched.fact.statement}"): ${mismatch}.`
      )
    } else if (
      matched.score >= STRONG_MATCH &&
      polarity(sentence.text) !== polarity(matched.fact.statement)
    ) {
      addClaimFinding(
        "Contradicted",
        "C",
        "high",
        `Appears to conflict with ${matched.fact.code}: "${matched.fact.statement}" (negation mismatch, needs a human check).`
      )
    } else if (matched.score < STRONG_MATCH) {
      addClaimFinding(
        "Unsupported",
        "C",
        "medium",
        `Closest approved fact ${matched.fact.code} only partly overlaps with this claim.`
      )
    } else {
      addClaimFinding(
        "Supported",
        "C",
        "info",
        `Matches ${matched.fact.code} ("${matched.fact.statement}") by lexical overlap.`
      )
    }
  }

  for (const sentence of reviewableSentences) {
    const wordCount = sentence.text.split(/\s+/).length
    if (wordCount > 35 && !overlapsUsedSpan(sentence.start, sentence.end)) {
      findings.push(
        makeFinding(sentence.start, sentence.end, {
          grade: "C",
          severity: "low",
          explanation: `Sentence has ${wordCount} words. Consider splitting it for readability.${OFFLINE_TAG}`,
        })
      )
    }
  }

  return findings.sort(
    (left, right) => (left.span_start ?? 0) - (right.span_start ?? 0)
  )
}
