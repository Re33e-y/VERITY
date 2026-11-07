import Link from "next/link"
import { Suspense } from "react"
import FloatingNav from "@/components/floating/FloatingNav"
import SiteFooter from "@/components/floating/SiteFooter"
import { supabase } from "@/lib/supabase"

interface ReviewRunRow {
  id: string
  created_at: string
  score: number | null
  status: string
  target_content: string
  snapshot: unknown
}

interface FindingRow {
  id: string
  review_run_id: string
}

interface DecisionRow {
  id: string
  finding_id: string
  decision: string
  reason: string
  decided_by: string | null
  created_at: string
}

function snapshotOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function callCount(run: ReviewRunRow): number | null {
  const count = snapshotOf(run.snapshot).llm_calls
  return typeof count === "number" ? count : null
}

const decisionStyles: Record<string, string> = {
  accepted: "bg-emerald-500/15 text-emerald-300",
  dismissed: "bg-slate-700 text-slate-300",
  overridden: "bg-amber-500/15 text-amber-300",
}

async function HistoryContent() {
  const { data: runData, error: runsError } = await supabase
    .from("review_runs")
    .select("id, created_at, score, status, target_content, snapshot")
    .order("created_at", { ascending: false })
    .limit(100)

  if (runsError) {
    return (
      <main className="vf-shell">
        <FloatingNav active="history" />
        <div className="vf-notice vf-notice-danger" role="alert">
          <strong>Could not load history:</strong> {runsError.message}
        </div>
        <SiteFooter />
      </main>
    )
  }

  const runs = (runData ?? []) as ReviewRunRow[]
  const runIds = runs.map((run) => run.id)
  let findings: FindingRow[] = []
  let decisions: DecisionRow[] = []

  if (runIds.length > 0) {
    const findingsResult = await supabase
      .from("findings")
      .select("id, review_run_id")
      .in("review_run_id", runIds)

    if (findingsResult.error) {
      return (
        <main className="vf-shell">
          <FloatingNav active="history" />
          <div className="vf-notice vf-notice-danger" role="alert">
            <strong>Could not load review findings:</strong>{" "}
            {findingsResult.error.message}
          </div>
          <SiteFooter />
        </main>
      )
    }

    findings = (findingsResult.data ?? []) as FindingRow[]
    const findingIds = findings.map((finding) => finding.id)
    if (findingIds.length > 0) {
      const decisionsResult = await supabase
        .from("decisions")
        .select("id, finding_id, decision, reason, decided_by, created_at")
        .in("finding_id", findingIds)
        .order("created_at", { ascending: true })

      if (decisionsResult.error) {
        return (
          <main className="vf-shell">
            <FloatingNav active="history" />
            <div className="vf-notice vf-notice-danger" role="alert">
              <strong>Could not load decisions:</strong>{" "}
              {decisionsResult.error.message}
            </div>
            <SiteFooter />
          </main>
        )
      }

      decisions = (decisionsResult.data ?? []) as DecisionRow[]
    }
  }

  const findingsByRun = new Map<string, FindingRow[]>()
  for (const finding of findings) {
    const group = findingsByRun.get(finding.review_run_id) ?? []
    group.push(finding)
    findingsByRun.set(finding.review_run_id, group)
  }
  const findingById = new Map(findings.map((finding) => [finding.id, finding]))
  const decisionsByRun = new Map<string, DecisionRow[]>()
  for (const decision of decisions) {
    const runId = findingById.get(decision.finding_id)?.review_run_id
    if (!runId) continue
    const group = decisionsByRun.get(runId) ?? []
    group.push(decision)
    decisionsByRun.set(runId, group)
  }

  const knownCallCounts = runs
    .map(callCount)
    .filter((count): count is number => count !== null)
  const localRuns = knownCallCounts.filter((count) => count === 0).length

  return (
    <main className="vf-shell">
      <FloatingNav active="history" />
      <section className="vf-card space-y-6">

      <header>
        <h1 className="text-2xl font-semibold">Review history</h1>
        <p className="mt-1 text-sm text-slate-400">
          Audit trail of review runs, findings, LLM usage, and human decisions. This demo
          history is read-only and has no authentication; submitted text is visible here.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Runs shown", String(runs.length)],
          ["Resolved locally", knownCallCounts.length ? `${localRuns} of ${knownCallCounts.length}` : "-"],
          ["Total LLM calls", String(knownCallCounts.reduce((sum, count) => sum + count, 0))],
          ["Decisions recorded", String(decisions.length)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="text-xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      {runs.length === 0 ? (
        <p className="text-sm text-slate-400">No review runs yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="p-3">Time (IST)</th>
                <th className="p-3">Route</th>
                <th className="p-3">LLM calls</th>
                <th className="p-3">Findings</th>
                <th className="p-3">Decisions</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const snapshot = snapshotOf(run.snapshot)
                const runFindings = findingsByRun.get(run.id) ?? []
                const runDecisions = decisionsByRun.get(run.id) ?? []
                const count = callCount(run)
                return (
                  <tr key={run.id} className="border-t border-slate-800 align-top">
                    <td className="whitespace-nowrap p-3">
                      {new Date(run.created_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </td>
                    <td className="p-3">{typeof snapshot.route === "string" ? snapshot.route : "-"}</td>
                    <td className="p-3">{count === null ? "-" : count === 0 ? "0 (local)" : count}</td>
                    <td className="p-3">{runFindings.length}</td>
                    <td className="max-w-sm p-3">
                      {runDecisions.length === 0 ? (
                        <span className="text-slate-500">pending</span>
                      ) : (
                        <div className="space-y-2">
                          {runDecisions.map((decision) => (
                            <div key={decision.id} className="text-xs">
                              <span className={`rounded px-1.5 py-0.5 ${decisionStyles[decision.decision] ?? "bg-slate-800"}`}>
                                {decision.decision}
                              </span>
                              <span className="ml-2 text-slate-300">{decision.reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <Link href={`/history/${run.id}`} className="text-indigo-300 underline">
                        Details
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      </section>
      <SiteFooter />
    </main>
  )
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <main className="vf-shell">
          <FloatingNav active="history" />
          <div className="vf-card">Loading review history...</div>
          <SiteFooter />
        </main>
      }
    >
      <HistoryContent />
    </Suspense>
  )
}
