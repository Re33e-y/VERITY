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

function toFinding(
  ruleId: string | null,
  verdict: string,
  text: string,
  start: number,
  explanation: string,
  suggestedFix: string
): FindingPayload {
  return {
    id: `${verdict}-${start}-${start + text.length}`,
    span: {
      start,
      end: start + text.length,
      text,
    },
    rule_id: ruleId,
    fact_id: null,
    canon_version: 1,
    verdict,
    grade: "D",
    source: "rule",
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

    let fetchedRules: Array<{ id: string; rule_name?: string }> | null = null
    let facts: Array<Record<string, unknown>> | null = null
    const persistenceIssues: string[] = []

    if (supabase) {
      try {
        const [{ data: rulesData, error: rulesErr }, { data: factsData, error: factsErr }] =
          await Promise.all([
            supabase.from("rules").select("*"),
            supabase.from("facts").select("*"),
          ])

        if (rulesErr) {
          console.error("Rules fetch error:", rulesErr)
          persistenceIssues.push(`Could not load rules: ${rulesErr.message}`)
        } else {
          fetchedRules = rulesData
        }

        if (factsErr) {
          console.error("Facts fetch error:", factsErr)
          persistenceIssues.push(`Could not load facts: ${factsErr.message}`)
        } else {
          facts = factsData
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown Supabase connection error."
        console.error("Supabase context fetch error:", error)
        persistenceIssues.push(`Could not connect to Supabase: ${message}`)
      }
    } else {
      persistenceIssues.push("Supabase is not configured; this review will not be saved.")
    }

    const rules = Array.isArray(fetchedRules) && fetchedRules.length > 0
      ? fetchedRules
      : fallbackRules
    const lower = content.toLowerCase()
    const findings: FindingPayload[] = []

    const superlativePatterns = ["the best", "#1", "industry-leading"]
    const superlativeMatch = superlativePatterns.find((pattern) =>
      lower.includes(pattern)
    )
    if (superlativeMatch) {
      const start = lower.indexOf(superlativeMatch)
      const matchedRule = rules.find((rule: { rule_name?: string }) =>
        rule.rule_name?.toLowerCase().includes("superlatives")
      )

      findings.push(
        toFinding(
          matchedRule?.id ?? null,
          "absolute_claim",
          content.slice(start, start + superlativeMatch.length),
          start,
          "Content uses absolute or superlative claims without explicit citation.",
          "Specify the verified benchmark or qualification instead of absolute terms."
        )
      )
    }

    const terminologyPatterns = ["verification bot", "proof gate"]
    const terminologyMatch = terminologyPatterns.find((pattern) =>
      lower.includes(pattern)
    )
    if (terminologyMatch) {
      const start = lower.indexOf(terminologyMatch)
      const matchedRule = rules.find((rule: { rule_name?: string }) =>
        rule.rule_name?.toLowerCase().includes("terminology")
      )

      findings.push(
        toFinding(
          matchedRule?.id ?? null,
          "brand_terminology_mismatch",
          content.slice(start, start + terminologyMatch.length),
          start,
          'Improper casing or naming detected. The approved term is "ProofGate".',
          'Replace references with "ProofGate".'
        )
      )
    }

    const score = Math.max(0, 100 - findings.length * 25)
    const status = findings.length === 0 ? "completed" : "flagged"
    let runId: string | null = null

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

        if (runError) {
          console.error("review_runs insert error:", runError)
          persistenceIssues.push(`Could not save review: ${runError.message}`)
        } else if (!run) {
          persistenceIssues.push("Supabase did not return the saved review run.")
        } else {
          runId = run.id

          if (findings.length > 0) {
            const findingsToInsert = findings.map((finding) => ({
              review_run_id: run.id,
              rule_id: finding.rule_id,
              issue_type: finding.verdict,
              explanation: finding.explanation,
              suggested_fix: finding.suggested_fix,
            }))

            const { error: findingsError } = await supabase
              .from("findings")
              .insert(findingsToInsert)
            if (findingsError) {
              console.error("findings insert error:", findingsError)
              persistenceIssues.push(
                `Could not save findings: ${findingsError.message}`
              )
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown Supabase connection error."
        console.error("Supabase save error:", error)
        persistenceIssues.push(`Could not save review to Supabase: ${message}`)
      }
    }

    return NextResponse.json({
      runId,
      score,
      status,
      findings,
      rulesChecked: fetchedRules?.length ?? fallbackRules.length,
      factsAvailable: facts?.length ?? 0,
      persistence: {
        status:
          persistenceIssues.length === 0
            ? "saved"
            : runId
              ? "partial"
              : "not_saved",
        message:
          persistenceIssues.length > 0
            ? persistenceIssues.join(" ")
            : "Review and findings saved to Supabase.",
      },
    })
  } catch (error) {
    console.error("API handler error:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "An unexpected error occurred.",
      },
      { status: 500 }
    )
  }
}
