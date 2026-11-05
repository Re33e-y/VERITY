import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET() {
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    )
  }

  try {
    const [rulesResult, factsResult] = await Promise.all([
      supabase.from("rules").select("*").order("code"),
      supabase.from("facts").select("*").order("code"),
    ])
    const error = rulesResult.error ?? factsResult.error

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      rules: rulesResult.data ?? [],
      facts: factsResult.data ?? [],
    })
  } catch (error) {
    console.error("Canon API failed:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "An unexpected error occurred.",
      },
      { status: 500 }
    )
  }
}
