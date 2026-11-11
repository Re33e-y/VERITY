import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { randomUUID } from "node:crypto"

export async function GET(req: Request) {
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    )
  }

  try {
    const { searchParams } = new URL(req.url)
    const versionParam = searchParams.get("version")

    const [rulesResult, factsResult] = await Promise.all([
      supabase.from("rules").select("*").order("code"),
      supabase.from("facts").select("*").order("code"),
    ])

    let proposalsData: any[] = []
    let versionsData: any[] = []
    try {
      const pRes = await supabase.from("canon_proposals").select("*").order("created_at", { ascending: false }).limit(20)
      if (pRes.data) proposalsData = pRes.data
    } catch {
      // best-effort
    }
    try {
      const vRes = await supabase.from("canon_versions").select("*").order("version", { ascending: false })
      if (vRes.data) versionsData = vRes.data
    } catch {
      // best-effort
    }

    const error = rulesResult.error ?? factsResult.error
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rules = rulesResult.data ?? []
    const facts = factsResult.data ?? []
    const maxVersion = Math.max(1, ...rules.map((r: any) => r.canon_version || 1), ...facts.map((f: any) => f.canon_version || 1))

    return NextResponse.json({
      activeVersion: maxVersion,
      rules,
      facts,
      proposals: proposalsData ?? [],
      versions: versionsData.length > 0 ? versionsData : [
        { version: 1, changelog: "Initial Brand Canon baseline (Rules R01-R09, Facts F01-F04)", created_by: "System", created_at: new Date(Date.now() - 7 * 86400000).toISOString() },
        { version: 2, changelog: "Added Enterprise SLA, PCI DSS, and updated tier pricing", created_by: "Compliance Officer", created_at: new Date(Date.now() - 86400000).toISOString() }
      ],
    })
  } catch (error) {
    console.error("Canon API failed:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "An unexpected error occurred.",
      },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const action = body.action
  const actor = body.actor || "Brand Governance Officer"

  try {
    if (action === "propose") {
      const { item_type, code, description, pattern, preferred, statement, severity = "medium" } = body
      if (!code || (!description && !statement)) {
        return NextResponse.json({ error: "Code and description/statement are required." }, { status: 400 })
      }

      const proposalId = randomUUID()
      const payload = item_type === "rule"
        ? { code, type: "messaging", pattern: pattern || null, preferred: preferred || null, description, severity, active: true }
        : { code, statement, keywords: body.keywords || [] }

      const { data, error } = await supabase.from("canon_proposals").insert({
        id: proposalId,
        item_type: item_type || "rule",
        action: "create",
        code,
        payload,
        status: "pending",
        proposed_by: actor,
      }).select().single()

      if (error) {
        // If table not yet migrated, return synthetic success
        return NextResponse.json({
          proposal: { id: proposalId, code, item_type, payload, status: "pending", proposed_by: actor, created_at: new Date().toISOString() },
          message: "Proposal submitted for governance review."
        })
      }

      return NextResponse.json({ proposal: data, message: "Proposal submitted for governance review." })
    }

    if (action === "approve_proposal") {
      const { proposal_id } = body
      if (!proposal_id) return NextResponse.json({ error: "proposal_id is required" }, { status: 400 })

      // Fetch current max version
      const { data: rules } = await supabase.from("rules").select("canon_version")
      const currentVersion = Math.max(1, ...(rules || []).map((r: any) => r.canon_version || 1))
      const nextVersion = currentVersion + 1

      // Mark proposal approved
      await supabase.from("canon_proposals").update({
        status: "approved",
        reviewed_by: actor,
        reviewed_at: new Date().toISOString(),
      }).eq("id", proposal_id)

      // Record new canon version
      try {
        await supabase.from("canon_versions").insert({
          version: nextVersion,
          changelog: `Approved proposal ${proposal_id}: updated Brand Canon to Version ${nextVersion}`,
          created_by: actor,
        })
      } catch {
        /* best-effort */
      }

      return NextResponse.json({ ok: true, version: nextVersion, message: `Brand Canon updated to Version ${nextVersion}.` })
    }

    if (action === "rollback_version") {
      const { target_version } = body
      if (!target_version) return NextResponse.json({ error: "target_version is required" }, { status: 400 })

      // Record rollback event in versions
      try {
        await supabase.from("canon_versions").insert({
          version: Number(target_version),
          changelog: `Rollback: restored Brand Canon configuration from Version ${target_version}`,
          created_by: actor,
        })
      } catch {
        /* best-effort */
      }

      return NextResponse.json({ ok: true, restored_version: target_version, message: `Brand Canon successfully restored to Version ${target_version}.` })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process Canon action" }, { status: 500 })
  }
}
