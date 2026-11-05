import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function POST(req: Request) {
  try {
    const { content } = await req.json()

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 })
    }

    // 1. Fetch active rules and facts from Supabase
    const [{ data: rules }, { data: facts }] = await Promise.all([
      supabase.from("rules").select("*"),
      supabase.from("facts").select("*"),
    ])

    const findings: Array<{
      rule_id?: string
      issue_type: string
      explanation: string
      suggested_fix?: string
    }> = []

    // 2. Rule evaluation / ProofGate check logic
    const lower = content.toLowerCase()

    // Rule: Superlative claim check
    if (lower.includes("the best") || lower.includes("#1") || lower.includes("industry-leading")) {
      const matchedRule = rules?.find((r) => r.rule_name.includes("Superlatives"))
      findings.push({
        rule_id: matchedRule?.id,
        issue_type: "Unsubstantiated Claim",
        explanation: "Content uses absolute or superlative claims without explicit citation.",
        suggested_fix: "Specify the verified benchmark or qualification instead of absolute terms.",
      })
    }

    // Rule: Naming compliance
    if (lower.includes("proof gate") || lower.includes("verification bot")) {
      const matchedRule = rules?.find((r) => r.rule_name.includes("Terminology"))
      findings.push({
        rule_id: matchedRule?.id,
        issue_type: "Brand Terminology Mismatch",
        explanation: 'Improper casing or naming detected. The approved term is "ProofGate".',
        suggested_fix: 'Replace references with "ProofGate".',
      })
    }

    // 3. Compute compliance score
    const score = Math.max(0, 100 - findings.length * 25)
    const status = findings.length === 0 ? "completed" : "flagged"

    // 4. Record review_run in Supabase
    const { data: run, error: runError } = await supabase
      .from("review_runs")
      .insert({
        target_content: content,
        score,
        status,
      })
      .select()
      .single()

    if (runError) throw runError

    // 5. Save findings if any were generated
    if (findings.length > 0) {
      const findingsToInsert = findings.map((f) => ({
        ...f,
        review_run_id: run.id,
      }))
      await supabase.from("findings").insert(findingsToInsert)
    }

    return NextResponse.json({
      runId: run.id,
      score,
      status,
      findings,
      rulesChecked: rules?.length || 0,
      factsAvailable: facts?.length || 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
