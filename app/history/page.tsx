import Link from "next/link"
import { Suspense } from "react"
import SiteFooter from "@/components/SiteFooter"
import SiteNav from "@/components/site-nav"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  accepted: "border-success/35 bg-success/10 text-success",
  dismissed: "border-foreground/20 bg-muted text-muted-foreground",
  overridden: "border-warning/35 bg-warning/10 text-warning",
}

function HistoryError({ title, message }: { title: string; message: string }) {
  return (
    <main className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-12 pt-3 sm:px-6">
      <SiteNav active="history" />
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>History could not be loaded</AlertTitle>
            <AlertDescription className="break-words">{message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <SiteFooter />
    </main>
  )
}

async function HistoryContent() {
  const { data: runData, error: runsError } = await supabase
    .from("review_runs")
    .select("id, created_at, score, status, target_content, snapshot")
    .order("created_at", { ascending: false })
    .limit(100)

  if (runsError) {
    return <HistoryError title="Review history" message={runsError.message} />
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
        <HistoryError
          title="Review history"
          message={`Could not load review findings: ${findingsResult.error.message}`}
        />
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
          <HistoryError
            title="Review history"
            message={`Could not load decisions: ${decisionsResult.error.message}`}
          />
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
    <main className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-12 pt-3 sm:px-6">
      <SiteNav active="history" />
      <Card className="gap-6">
        <CardHeader>
          <CardTitle className="text-2xl">Review history</CardTitle>
          <p className="m-0 text-sm leading-6 text-muted-foreground">
            Audit trail of review runs, findings, LLM usage, and human decisions.
            Submitted text is visible here.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <section aria-label="History summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Runs shown", String(runs.length)],
              ["Resolved locally", knownCallCounts.length ? `${localRuns} of ${knownCallCounts.length}` : "-"],
              ["Total LLM calls", String(knownCallCounts.reduce((sum, count) => sum + count, 0))],
              ["Decisions recorded", String(decisions.length)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-lg border border-foreground/15 bg-background/40 p-3">
                <p className="m-0 text-[13px] leading-5 text-muted-foreground">{label}</p>
                <p className="mb-0 mt-1 break-words text-2xl font-bold leading-7 text-foreground">{value}</p>
              </div>
            ))}
          </section>

          {runs.length === 0 ? (
            <p className="m-0 rounded-lg border border-foreground/15 bg-muted/40 p-4 text-sm text-muted-foreground">
              No review runs yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-foreground/10">
              <Table className="min-w-[760px]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Time (IST)</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>LLM calls</TableHead>
                    <TableHead>Findings</TableHead>
                    <TableHead>Decisions</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const snapshot = snapshotOf(run.snapshot)
                    const runFindings = findingsByRun.get(run.id) ?? []
                    const runDecisions = decisionsByRun.get(run.id) ?? []
                    const count = callCount(run)
                    return (
                      <TableRow key={run.id} className="align-top">
                        <TableCell>{new Date(run.created_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}</TableCell>
                        <TableCell>{typeof snapshot.route === "string" ? snapshot.route : "-"}</TableCell>
                        <TableCell>{count === null ? "-" : count === 0 ? "0 (local)" : count}</TableCell>
                        <TableCell>{runFindings.length}</TableCell>
                        <TableCell className="max-w-sm whitespace-normal">
                          {runDecisions.length === 0 ? (
                            <span className="text-muted-foreground">Pending</span>
                          ) : (
                            <div className="space-y-2">
                              {runDecisions.map((decision) => (
                                <div key={decision.id} className="space-y-1">
                                  <Badge
                                    variant="outline"
                                    className={`capitalize ${decisionStyles[decision.decision] ?? "border-foreground/20 bg-muted text-muted-foreground"}`}
                                  >
                                    {decision.decision}
                                  </Badge>
                                  <p className="m-0 break-words text-[13px] leading-5 text-muted-foreground">
                                    {decision.reason}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/history/${run.id}`}
                            className="rounded-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Details
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <SiteFooter />
    </main>
  )
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <main className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-12 pt-3 sm:px-6">
          <SiteNav active="history" />
          <Card><CardContent className="pt-4">Loading review history...</CardContent></Card>
          <SiteFooter />
        </main>
      }
    >
      <HistoryContent />
    </Suspense>
  )
}
