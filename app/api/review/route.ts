import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

interface FindingPayload {
  id: string
  span: {
    start: number
    end: number
    text: string
  }
  rule_id: string | null
  fact_id: string | null
  canon_version: number
  verdict: string
  grade: string
  source: "rule" | "ai"
  explanation: string
  suggested_fix: string | null
}

const fallbackRules = [
  { id: "rule-superlatives", rule_name: "Superlatives" },
  { id: "rule-terminology", rule_name: "Terminology" },
]

async function loadReviewContext() {
  if (!supabase) {
    return { rules: fallbackRules, facts: [] as Array<Record<string, unknown>> }
  }

  try {
    const [{ data: rules }, { data: facts }] = await Promise.all([
      supabase.from("rules").select("*"),
      supabase.from("facts").select("*"),
    ])

    return {
      rules: Array.isArray(rules) && rules.length > 0 ? rules : fallbackRules,
      facts: Array.isArray(facts) ? facts : [],
    }
  } catch {
    return { rules: fallbackRules, facts: [] as Array<Record<string, unknown>> }
  }
}

function toFinding(
  ruleId: string | null,
  verdict: string,
  text: string,
  start: number,
  explanation: string,
  suggestedFix: string,
  grade = "D",
  source: "rule" | "ai" = "rule",
  factId: string | null = null
): FindingPayload {
  const end = start + text.length

  return {
    id: `${verdict}-${start}-${end}`,
    span: {
      start,
      end,
      text,
    },
    rule_id: ruleId,
    fact_id: factId,
    canon_version: 1,
    verdict,
    grade,
    source,
    explanation,
    suggested_fix: suggestedFix,
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const content = typeof body?.content === "string" ? body.content.trim() : ""

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 })
    }

    const { rules, facts } = await loadReviewContext()
    const lower = content.toLowerCase()
    const findings: FindingPayload[] = []

    const superlativePatterns = ["the best", "#1", "industry-leading"]
    const superlativeMatch = superlativePatterns.find((pattern) => lower.includes(pattern))
    if (superlativeMatch) {
      const start = lower.indexOf(superlativeMatch)
      const text = content.slice(start, start + superlativeMatch.length)
      const matchedRule = rules.find((rule: { rule_name?: string }) =>
        rule.rule_name?.toLowerCase().includes("superlatives")
      )

      findings.push(
        toFinding(
          matchedRule?.id ?? null,
          "absolute_claim",
          text,
          start,
          "Content uses absolute or superlative claims without explicit citation.",
          "Specify the verified benchmark or qualification instead of absolute terms."
        )
      )
    }

    const namingMatch = ["proof gate", "verification bot"].find((pattern) => lower.includes(pattern))
    if (namingMatch) {
      const start = lower.indexOf(namingMatch)
      const text = content.slice(start, start + namingMatch.length)
      const matchedRule = rules.find((rule: { rule_name?: string }) =>
        rule.rule_name?.toLowerCase().includes("terminology")
      )

      findings.push(
        toFinding(
          matchedRule?.id ?? null,
          "brand_terminology_mismatch",
          text,
          start,
          'Improper casing or naming detected. The approved term is "ProofGate".',
          'Replace references with "ProofGate".'
        )
      )
    }

    const score = Math.max(0, 100 - findings.length * 25)
    const status = findings.length === 0 ? "completed" : "flagged"
    const runId = `local-${Date.now()}`

    if (supabase) {
      try {
        const { data: run, error: runError } = await supabase
          .from("review_runs")
          .insert({
            target_content: content,
            score,
            status,
          })
          .select()
          .single()

        if (!runError && run) {
          if (findings.length > 0) {
            const findingsToInsert = findings.map((finding) => ({
              ...finding,
              review_run_id: run.id,
              issue_type: finding.verdict,
            }))

            await supabase.from("findings").insert(findingsToInsert)
          }

          return NextResponse.json({
            runId: run.id,
            score,
            status,
            findings,
            rulesChecked: rules.length,
            factsAvailable: facts.length,
          })
        }
      } catch {
        // Fall through to the client-safe response below when Supabase is unavailable.
      }
    }

    return NextResponse.json({
      runId,
      score,
      status,
      findings,
      rulesChecked: rules.length,
      factsAvailable: facts.length,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "An unexpected error occurred.",
      },
      { status: 500 }
    )
  }
}
