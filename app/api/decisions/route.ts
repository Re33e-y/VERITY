import { NextResponse } from "next/server"
import { validateDecision } from "@/lib/review/decisionValidation"
import { supabase } from "@/lib/supabase"

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const validation = validateDecision(body)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }
  const { finding_id: findingId, decision, reason, decided_by: decidedBy } =
    validation.value
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    )
  }

  try {
    const { data: finding, error: findingError } = await supabase
      .from("findings")
      .select("id")
      .eq("id", findingId)
      .maybeSingle()

    if (findingError) {
      return NextResponse.json({ error: findingError.message }, { status: 500 })
    }
    if (!finding) {
      return NextResponse.json({ error: "Finding not found." }, { status: 404 })
    }

    const { data, error } = await supabase
      .from("decisions")
      .insert({
        finding_id: findingId,
        decision,
        reason,
        decided_by: decidedBy ?? "local reviewer",
      })
      .select("id, finding_id, decision, reason, decided_by, created_at")
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json(
        { error: "Supabase did not return the saved decision." },
        { status: 500 }
      )
    }

    return NextResponse.json({ decision: data }, { status: 201 })
  } catch (error) {
    console.error("Decision API failed:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "An unexpected error occurred.",
      },
      { status: 500 }
    )
  }
}
