import type { Finding, Rule } from "@/types/engine"

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function runDeterministic(
  content: string,
  rules: Rule[],
  canonVersion: number
): Finding[] {
  const findings: Finding[] = []

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

      findings.push({
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

  return findings
}
