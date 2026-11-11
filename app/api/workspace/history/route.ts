import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

const DEFAULT_WORKSPACE = "00000000-0000-0000-0000-000000000001"

export async function GET(req: Request) {
  if (!supabase) {
    return NextResponse.json({ history: [] })
  }

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get("workspace_id") || DEFAULT_WORKSPACE

  try {
    const { data: runs } = await supabase
      .from("review_runs")
      .select("id, created_at, content, pipeline, llm_calls, findings_count, status, workspace_id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50)

    if (!runs || runs.length === 0) {
      return NextResponse.json({ history: [] })
    }

    const history = runs.map((r: any) => ({
      id: r.id,
      timestamp: new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      copy: r.content ? r.content.slice(0, 120) + (r.content.length > 120 ? "…" : "") : "(no content)",
      route: (r.llm_calls ?? 0) === 0 ? "local" : `agent:fact+legal+tone`,
      calls: r.llm_calls ?? 0,
      findingsCount: r.findings_count ?? 0,
      status: (r.findings_count ?? 0) > 0 ? "FLAGGED" : "PASSED",
      decision: "PENDING" as const,
    }))

    return NextResponse.json({ history })
  } catch (error) {
    console.error("Workspace history failed:", error)
    return NextResponse.json({ history: [] })
  }
}
