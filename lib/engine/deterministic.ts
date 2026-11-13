import type { Finding, Rule } from "@/types/engine"

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const SEVERITY_WEIGHT: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
}

export function runDeterministic(
  content: string,
  rules: Rule[],
  canonVersion: number
): Finding[] {
  const rawFindings: Finding[] = []

  for (const rule of rules) {
    if (
      !["banned_term", "absolute_claim", "preferred_term"].includes(rule.type) ||
      !rule.pattern
    ) {
      continue
    }

    const pattern = new RegExp(
      `(?<!\\w)${escapeRegExp(rule.pattern)}(?!\\w)`,
      "gi"
    )

    for (const match of content.matchAll(pattern)) {
      const start = match.index
      if (start === undefined) continue

      rawFindings.push({
        span_start: start,
        span_end: start + match[0].length,
        span_text: match[0],
        rule_id: rule.id,
        fact_id: null,
        canon_version: canonVersion,
        grade: "A",
        verdict: null,
        source: "rule",
        severity: rule.severity,
        explanation: `${rule.code}: ${rule.description}`,
        suggested_fix: rule.preferred,
      })
    }
  }

  // Deduplicate overlapping spans: if multiple rules flag the exact same or overlapping phrase,
  // keep the higher severity finding (or longer span) to prevent duplicate findings.
  const deduped: Finding[] = []
  rawFindings.sort((a, b) => {
    const spanDiff = (a.span_start ?? 0) - (b.span_start ?? 0)
    if (spanDiff !== 0) return spanDiff
    // Higher severity first
    const weightA = SEVERITY_WEIGHT[a.severity] ?? 0
    const weightB = SEVERITY_WEIGHT[b.severity] ?? 0
    if (weightA !== weightB) return weightB - weightA
    // Longer match first
    return (b.span_text?.length ?? 0) - (a.span_text?.length ?? 0)
  })

  for (const finding of rawFindings) {
    const start = finding.span_start ?? 0
    const end = finding.span_end ?? 0

    // Check if an existing accepted finding substantially covers or is identical to this span
    const isDuplicate = deduped.some((existing) => {
      const exStart = existing.span_start ?? 0
      const exEnd = existing.span_end ?? 0
      // Exact span match
      if (exStart === start && exEnd === end) return true
      // Overlapping span on the same phrase
      const overlapStart = Math.max(start, exStart)
      const overlapEnd = Math.min(end, exEnd)
      if (overlapStart < overlapEnd) {
        const overlapLen = overlapEnd - overlapStart
        const thisLen = end - start
        // If 75% or more of this span is already covered by a higher-priority finding
        return overlapLen / thisLen >= 0.75
      }
      return false
    })

    if (!isDuplicate) {
      deduped.push(finding)
    }
  }

  return deduped
}
