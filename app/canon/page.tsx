"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
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

interface CanonRule {
  id: string
  code: string
  type: string
  pattern: string | null
  preferred: string | null
  description: string
  severity: string
  source_page: number | null
  canon_version: number
  expires_at: string | null
  active: boolean
}

interface CanonFact {
  id: string
  code: string
  statement: string
  source_page: number | null
  canon_version: number
  expires_at: string | null
}

export default function CanonPage() {
  const [rules, setRules] = useState<CanonRule[]>([])
  const [facts, setFacts] = useState<CanonFact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadCanon() {
      try {
        const response = await fetch("/api/canon", {
          signal: controller.signal,
          cache: "no-store",
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error ?? `Canon request failed (${response.status}).`)
        }

        setRules(data.rules)
        setFacts(data.facts)
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the brand canon."
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadCanon()
    return () => controller.abort()
  }, [])

  return (
    <main className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-12 pt-3 sm:px-6">
      <SiteNav active="canon" />
      <div className="space-y-5">
        <Card>
          <CardHeader className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="text-2xl">Brand Canon</CardTitle>
              <p className="mb-0 mt-1 text-sm leading-6 text-muted-foreground">
                Approved rules and facts used by Verity reviews.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex min-h-9 w-fit items-center rounded-full border border-foreground/15 px-4 text-sm text-foreground no-underline transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Back to audit
            </Link>
          </CardHeader>
        </Card>

        {loading && (
          <Card><CardContent className="pt-4 text-sm text-muted-foreground">Loading canon…</CardContent></Card>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not load the canon</AlertTitle>
            <AlertDescription className="break-words">
              {error}. Confirm that the Supabase schema has been applied and the server environment is configured.
            </AlertDescription>
          </Alert>
        )}

        {!loading && !error && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-baseline justify-between gap-4">
                <CardTitle>Rules</CardTitle>
                <Badge variant="outline">{rules.length} total</Badge>
              </CardHeader>
              <CardContent>
                {rules.length === 0 ? (
                  <p className="m-0 rounded-lg border border-foreground/15 bg-muted/40 p-4 text-sm text-muted-foreground">
                    No rules are in the canon yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-foreground/10">
                    <Table className="min-w-[760px]">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Rule</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Match</TableHead>
                          <TableHead>Preferred</TableHead>
                          <TableHead>Type and severity</TableHead>
                          <TableHead>Canon details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rules.map((rule) => (
                          <TableRow key={rule.id} className="align-top">
                            <TableCell className="font-mono font-semibold text-primary">{rule.code}</TableCell>
                            <TableCell className="max-w-sm whitespace-normal break-words">{rule.description}</TableCell>
                            <TableCell className="max-w-xs whitespace-normal break-words [overflow-wrap:anywhere]">{rule.pattern ?? "-"}</TableCell>
                            <TableCell className="max-w-xs whitespace-normal break-words [overflow-wrap:anywhere]">{rule.preferred ?? "-"}</TableCell>
                            <TableCell className="whitespace-normal">
                              <Badge variant="outline" className={rule.active ? "border-success/35 bg-success/10 text-success" : "border-foreground/20 bg-muted text-muted-foreground"}>
                                {rule.active ? "Active" : "Inactive"}
                              </Badge>
                              <p className="mb-0 mt-2 text-[13px] leading-5 text-muted-foreground">
                                {rule.severity} · {rule.type}
                              </p>
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              <p className="m-0">Canon v{rule.canon_version}</p>
                              <p className="mb-0 mt-1 text-[13px] leading-5 text-muted-foreground">
                                {rule.source_page !== null && `Source page ${rule.source_page}`}
                                {rule.expires_at && ` · Expires ${rule.expires_at.slice(0, 10)}`}
                                {rule.source_page === null && !rule.expires_at && "No source page or expiry"}
                              </p>
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
              <CardHeader className="flex flex-row items-baseline justify-between gap-4">
                <CardTitle>Approved facts</CardTitle>
                <Badge variant="outline">{facts.length} total</Badge>
              </CardHeader>
              <CardContent>
                {facts.length === 0 ? (
                  <p className="m-0 rounded-lg border border-foreground/15 bg-muted/40 p-4 text-sm text-muted-foreground">
                    No facts are in the canon yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-foreground/10">
                    <Table className="min-w-[620px]">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Fact</TableHead>
                          <TableHead>Approved statement</TableHead>
                          <TableHead>Canon details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {facts.map((fact) => (
                          <TableRow key={fact.id} className="align-top">
                            <TableCell className="font-mono font-semibold text-primary">{fact.code}</TableCell>
                            <TableCell className="max-w-2xl whitespace-normal break-words">{fact.statement}</TableCell>
                            <TableCell className="whitespace-normal">
                              <p className="m-0">Canon v{fact.canon_version}</p>
                              <p className="mb-0 mt-1 text-[13px] leading-5 text-muted-foreground">
                                {fact.source_page !== null && `Source page ${fact.source_page}`}
                                {fact.expires_at && ` · Expires ${fact.expires_at.slice(0, 10)}`}
                                {fact.source_page === null && !fact.expires_at && "No source page or expiry"}
                              </p>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <SiteFooter />
    </main>
  )
}
