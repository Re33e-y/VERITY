import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

const decisionValues = ["accepted", "dismissed", "overridden"] as const
type DecisionValue = (typeof decisionValues)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null)
  if (!isRecord(body)) {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 })
  }

  const findingId = body.finding_id
  const decision = body.decision
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (
    typeof findingId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      findingId
    )
  ) {
    return NextResponse.json({ error: "A valid finding_id is required." }, { status: 400 })
  }
  if (
    typeof decision !== "string" ||
    !decisionValues.includes(decision as DecisionValue)
  ) {
    return NextResponse.json(
      { error: "decision must be accepted, dismissed, or overridden." },
      { status: 400 }
    )
  }
  if (!reason) {
    return NextResponse.json(
      { error: "A reason is required for every decision." },
      { status: 400 }
    )
  }
  if (reason.length > 2000) {
    return NextResponse.json(
      { error: "Reason must be 2000 characters or fewer." },
      { status: 400 }
    )
  }
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
        decided_by:
          typeof body.decided_by === "string" && body.decided_by.trim()
            ? body.decided_by.trim().slice(0, 200)
            : "local reviewer",
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
