import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import FloatingNav from "@/components/floating/FloatingNav"
import SiteFooter from "@/components/floating/SiteFooter"
import { supabase } from "@/lib/supabase"

type Row = Record<string, unknown>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function displayDate(value: unknown): string {
  if (typeof value !== "string") return "Unknown time"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : `${date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
}

async function RunDetailContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const { data: run, error: runError } = await supabase
    .from("review_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (runError) {
    return (
      <main className="vf-shell">
        <FloatingNav active="history" />
        <div className="vf-notice vf-notice-danger" role="alert">
          <strong>Could not load review run:</strong> {runError.message}
        </div>
        <SiteFooter />
      </main>
    )
  }
  if (!run) notFound()

  const { data: findingData, error: findingsError } = await supabase
    .from("findings")
    .select("*")
    .eq("review_run_id", id)

  if (findingsError) {
    return (
      <main className="vf-shell">
        <FloatingNav active="history" />
        <div className="vf-notice vf-notice-danger" role="alert">
          <strong>Could not load findings:</strong> {findingsError.message}
        </div>
        <SiteFooter />
      </main>
    )
  }
  const findings = (findingData ?? []) as Row[]
  const findingIds = findings
    .map((finding) => finding.id)
    .filter((findingId): findingId is string => typeof findingId === "string")

  let decisions: Row[] = []
  if (findingIds.length > 0) {
    const { data: decisionData, error: decisionsError } = await supabase
      .from("decisions")
      .select("*")
      .in("finding_id", findingIds)
      .order("created_at", { ascending: true })

    if (decisionsError) {
      return (
        <main className="vf-shell">
          <FloatingNav active="history" />
          <div className="vf-notice vf-notice-danger" role="alert">
            <strong>Could not load decisions:</strong> {decisionsError.message}
          </div>
          <SiteFooter />
        </main>
      )
    }
    decisions = (decisionData ?? []) as Row[]
  }

  const content = typeof run.target_content === "string" ? run.target_content : null
  const snapshot =
    typeof run.snapshot === "object" && run.snapshot !== null
      ? (run.snapshot as Record<string, unknown>)
      : null

  return (
    <main className="vf-shell">
      <FloatingNav active="history" />
      <section className="vf-card space-y-6">
      <Link href="/history" className="text-sm text-indigo-300 underline">
        Back to history
      </Link>

      <header>
        <h1 className="text-2xl font-semibold">Run {String(run.id).slice(0, 8)}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {displayDate(run.created_at)}
          {" | route: "}
          {typeof snapshot?.route === "string" ? snapshot.route : "-"}
          {" | LLM calls: "}
          {typeof snapshot?.llm_calls === "number" ? snapshot.llm_calls : "-"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Status: {String(run.status ?? "-")} | Score: {run.score ?? "withheld"}
        </p>
      </header>

      {content !== null && (
        <section>
          <h2 className="mb-2 font-semibold">Reviewed text</h2>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
            {content}
          </pre>
        </section>
      )}

      {snapshot && (
        <section>
          <h2 className="mb-2 font-semibold">Review snapshot</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-900 p-4 text-xs text-slate-300">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Findings ({findings.length})</h2>
        {findings.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          <ul className="space-y-3">
            {findings.map((finding, index) => (
              <li
                key={typeof finding.id === "string" ? finding.id : index}
                className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm"
              >
                <p className="font-medium text-amber-200">
                  {typeof finding.verdict === "string" ? finding.verdict : "Rule finding"}
                  {typeof finding.severity === "string" ? ` · ${finding.severity}` : ""}
                </p>
                {typeof finding.span_text === "string" && (
                  <p className="mt-2 text-slate-200">{finding.span_text}</p>
                )}
                {typeof finding.explanation === "string" && (
                  <p className="mt-2 text-slate-400">{finding.explanation}</p>
                )}
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-500">
                  {JSON.stringify(finding, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Decision log ({decisions.length})</h2>
        {decisions.length === 0 ? (
          <p className="text-sm text-slate-400">No decisions yet.</p>
        ) : (
          <ol className="space-y-3">
            {decisions.map((decision, index) => (
              <li
                key={typeof decision.id === "string" ? decision.id : index}
                className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm"
              >
                <p className="font-medium capitalize">{String(decision.decision ?? "decision")}</p>
                <p className="mt-1 text-slate-300">{String(decision.reason ?? "")}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {displayDate(decision.created_at)}
                  {typeof decision.decided_by === "string" ? ` · ${decision.decided_by}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      </section>
      <SiteFooter />
    </main>
  )
}

export default function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="vf-shell">
          <FloatingNav active="history" />
          <div className="vf-card">Loading review details...</div>
          <SiteFooter />
        </main>
      }
    >
      <RunDetailContent params={params} />
    </Suspense>
  )
}
