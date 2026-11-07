import Link from "next/link"
import { notFound } from "next/navigation"
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

function RunDetailError({ message }: { message: string }) {
  return (
    <main className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-12 pt-3 sm:px-6">
      <SiteNav active="history" />
      <Card>
        <CardHeader><CardTitle>Review details</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Review details could not be loaded</AlertTitle>
            <AlertDescription className="break-words">{message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <SiteFooter />
    </main>
  )
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
    return <RunDetailError message={`Could not load review run: ${runError.message}`} />
  }
  if (!run) notFound()

  const { data: findingData, error: findingsError } = await supabase
    .from("findings")
    .select("*")
    .eq("review_run_id", id)

  if (findingsError) {
    return <RunDetailError message={`Could not load findings: ${findingsError.message}`} />
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
      return <RunDetailError message={`Could not load decisions: ${decisionsError.message}`} />
    }
    decisions = (decisionData ?? []) as Row[]
  }

  const content = typeof run.target_content === "string" ? run.target_content : null
  const snapshot =
    typeof run.snapshot === "object" && run.snapshot !== null
      ? (run.snapshot as Record<string, unknown>)
      : null

  return (
    <main className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-12 pt-3 sm:px-6">
      <SiteNav active="history" />
      <div className="space-y-5">
        <Card>
          <CardHeader className="gap-3">
            <Link
              href="/history"
              className="w-fit rounded-sm text-[13px] text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Back to history
            </Link>
            <CardTitle className="text-2xl">Run {String(run.id).slice(0, 8)}</CardTitle>
            <p className="m-0 break-words text-sm leading-6 text-muted-foreground">
              {displayDate(run.created_at)}
              {" | route: "}
              {typeof snapshot?.route === "string" ? snapshot.route : "-"}
              {" | LLM calls: "}
              {typeof snapshot?.llm_calls === "number" ? snapshot.llm_calls : "-"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Status: {String(run.status ?? "-")}</Badge>
              <Badge variant="outline">
                Score: {typeof run.score === "number" ? run.score : "withheld"}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {content !== null && (
          <Card>
            <CardHeader><CardTitle>Reviewed text</CardTitle></CardHeader>
            <CardContent>
              <p className="m-0 whitespace-pre-wrap break-words rounded-xl border border-foreground/10 bg-muted/50 p-4 text-sm leading-6 [overflow-wrap:anywhere]">
                {content}
              </p>
            </CardContent>
          </Card>
        )}

        {snapshot && (
          <Card>
            <CardHeader><CardTitle>Review snapshot</CardTitle></CardHeader>
            <CardContent>
              <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-foreground/10 bg-muted/50 p-4 font-mono text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Findings ({findings.length})</CardTitle></CardHeader>
          <CardContent>
            {findings.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">None.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-foreground/10">
                <Table className="min-w-[700px]">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Verdict</TableHead>
                      <TableHead>Flagged text</TableHead>
                      <TableHead>Explanation</TableHead>
                      <TableHead>Finding data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {findings.map((finding, index) => (
                      <TableRow key={typeof finding.id === "string" ? finding.id : index} className="align-top">
                        <TableCell className="whitespace-normal">
                          <Badge variant="outline" className="whitespace-normal border-warning/35 bg-warning/10 text-warning">
                            {typeof finding.verdict === "string" ? finding.verdict : "Rule finding"}
                          </Badge>
                          {typeof finding.severity === "string" && (
                            <p className="mb-0 mt-2 text-[13px] text-muted-foreground">{finding.severity}</p>
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs whitespace-normal break-words [overflow-wrap:anywhere]">
                          {typeof finding.span_text === "string" ? finding.span_text : "-"}
                        </TableCell>
                        <TableCell className="max-w-lg whitespace-normal break-words [overflow-wrap:anywhere]">
                          {typeof finding.explanation === "string" ? finding.explanation : "-"}
                        </TableCell>
                        <TableCell className="max-w-sm whitespace-normal">
                          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                            {JSON.stringify(finding, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Decision log ({decisions.length})</CardTitle></CardHeader>
          <CardContent>
            {decisions.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No decisions yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-foreground/10">
                <Table className="min-w-[620px]">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Decision</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Decided by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decisions.map((decision, index) => (
                      <TableRow key={typeof decision.id === "string" ? decision.id : index} className="align-top">
                        <TableCell className="capitalize">{String(decision.decision ?? "decision")}</TableCell>
                        <TableCell className="max-w-lg whitespace-normal break-words">{String(decision.reason ?? "")}</TableCell>
                        <TableCell>{displayDate(decision.created_at)}</TableCell>
                        <TableCell>{typeof decision.decided_by === "string" ? decision.decided_by : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </main>
  )
}

export default function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-12 pt-3 sm:px-6">
          <SiteNav active="history" />
          <Card><CardContent className="pt-4">Loading review details...</CardContent></Card>
          <SiteFooter />
        </main>
      }
    >
      <RunDetailContent params={params} />
    </Suspense>
  )
}
