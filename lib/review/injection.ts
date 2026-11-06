/**
 * Layer 0: input normalization and prompt-injection detection.
 *
 * Content under review is DATA. This module finds text that tries to act as
 * instructions, so the router can keep that content away from the model and
 * the UI can flag it. Normalization is length-preserving, so every offset it
 * reports is also valid in the original string.
 */

export interface InjectionMatch {
  id: string
  start: number
  end: number
  text: string
}

export interface InjectionReport {
  detected: boolean
  matches: InjectionMatch[]
}

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/** Same length as the input: invisible and control characters become spaces. */
export function normalizeForDetection(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (INVISIBLE.test(ch) || CONTROL.test(ch)) {
      out += " "
      continue
    }
    const folded = ch.normalize("NFKC")
    out += folded.length === 1 ? folded : ch
  }
  return out
}

interface Pattern {
  id: string
  regex: RegExp
}

const PATTERNS: Pattern[] = [
  {
    id: "ignore-previous",
    regex: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?)\b/gi,
  },
  { id: "role-marker", regex: /(?:^|\n)\s*(?:system|assistant|developer)\s*:/gi },
  { id: "role-reassign", regex: /\byou\s+are\s+(?:now|no\s+longer)\b/gi },
  {
    id: "reveal-prompt",
    regex: /\b(?:reveal|show|print|repeat|output)\b[^.\n]{0,30}\b(?:system\s+prompt|your\s+instructions|hidden\s+prompt)\b/gi,
  },
  {
    id: "force-output",
    regex: /\b(?:mark|label|rate|report|set|output|respond|answer)\b[^.\n]{0,40}\b(?:every|all|no)\b[^.\n]{0,30}\b(?:findings?|violations?|issues?)\b/gi,
  },
  { id: "fake-citation", regex: /\bcite\s+(?:rule|fact)\s+[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+/g },
  {
    id: "suppress-findings",
    regex: /\b(?:do\s+not|don'?t|never)\s+(?:report|flag|mention|list)\b[^.\n]{0,40}\b(?:violations?|findings?|issues?|errors?)\b/gi,
  },
  { id: "no-violations", regex: /\b(?:report|state|say|conclude)\s+that\s+(?:this|the)\s+content\s+has\s+no\s+violations?\b/gi },
  { id: "jailbreak", regex: /\b(?:jailbreak|developer\s+mode|dan\s+mode|bypass\s+(?:the\s+)?(?:filter|safety|policy))\b/gi },
  { id: "grade-forcing", regex: /\bgrade\s+[ab]\b[^.\n]{0,30}\b(?:for\s+(?:all|every)|every\s+finding)\b/gi },
  { id: "end-delimiter", regex: /<<<\s*(?:end|content)\b|<\/?\s*(?:system|instructions?|content_under_review)\s*>/gi },
]

/**
 * Second view of the text with invisible characters deleted, plus a map from
 * each kept character back to its index in the original. This defeats
 * obfuscation like "ig\u200Bnore", which a length-preserving view would turn
 * into "ig nore".
 */
function stripInvisible(text: string): { stripped: string; map: number[] } {
  let stripped = ""
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (INVISIBLE.test(ch) || CONTROL.test(ch)) continue
    const folded = ch.normalize("NFKC")
    stripped += folded.length === 1 ? folded : ch
    map.push(i)
  }
  return { stripped, map }
}

function scan(
  view: string,
  toOriginal: (index: number) => number,
  content: string,
  seen: Set<string>,
  out: InjectionMatch[]
): void {
  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(view)) !== null) {
      const raw = match[0]
      if (raw.length === 0) {
        regex.lastIndex++
        continue
      }
      // Skip a leading newline some patterns capture so spans stay tight.
      const lead = raw.length - raw.replace(/^\s+/, "").length
      const startInView = match.index + lead
      const endInView = match.index + raw.length
      if (endInView <= startInView) continue

      const start = toOriginal(startInView)
      const end = toOriginal(endInView - 1) + 1
      const key = `${pattern.id}:${start}:${end}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: pattern.id, start, end, text: content.slice(start, end) })
    }
  }
}

export function detectInjection(content: string): InjectionReport {
  const matches: InjectionMatch[] = []
  const seen = new Set<string>()

  scan(normalizeForDetection(content), (i) => i, content, seen, matches)

  const { stripped, map } = stripInvisible(content)
  if (stripped.length !== content.length) {
    scan(stripped, (i) => map[Math.min(i, map.length - 1)] ?? 0, content, seen, matches)
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  return { detected: matches.length > 0, matches }
}

/** Escape anything that could close the data block in a prompt. */
export function sanitizeForPrompt(content: string): string {
  return normalizeForDetection(content)
    .replace(/<<</g, "‹‹‹")
    .replace(/>>>/g, "›››")
    .replace(/<\s*\/?\s*(system|instructions?|content_under_review)\s*>/gi, "[tag removed]")
}
