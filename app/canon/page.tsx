"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import FloatingNav from "@/components/floating/FloatingNav"
import SiteFooter from "@/components/floating/SiteFooter"

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
    <main className="vf-shell">
      <FloatingNav active="canon" />
      <section className="vf-card space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Brand Canon</h1>
          <p className="mt-1 text-sm text-slate-400">
            Approved rules and facts used by Verity reviews.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          Back to audit
        </Link>
      </header>

      {loading && <p className="text-sm text-slate-400">Loading canon…</p>}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-950/50 p-4 text-sm text-red-200"
        >
          Could not load the canon: {error}. Confirm that the Supabase schema
          has been applied and the server environment is configured.
        </div>
      )}

      {!loading && !error && (
        <>
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Rules</h2>
              <span className="text-sm text-slate-400">{rules.length} total</span>
            </div>
            {rules.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
                No rules are in the canon yet.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {rules.map((rule) => (
                  <article
                    key={rule.id}
                    className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-mono text-sm font-semibold text-indigo-300">
                        {rule.code}
                      </h3>
                      <span className="rounded-full border border-slate-700 px-2 py-1 text-xs uppercase text-slate-300">
                        {rule.active ? rule.severity : "inactive"} · {rule.type}
                      </span>
                    </div>
                    <p className="text-sm text-slate-200">{rule.description}</p>
                    {rule.pattern && (
                      <p className="text-xs text-slate-400">
                        Match: <code className="text-amber-300">{rule.pattern}</code>
                        {rule.preferred && (
                          <> · Preferred: <code className="text-emerald-300">{rule.preferred}</code></>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      Canon v{rule.canon_version}
                      {rule.source_page !== null && ` · Source page ${rule.source_page}`}
                      {rule.expires_at && ` · Expires ${rule.expires_at.slice(0, 10)}`}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Approved facts</h2>
              <span className="text-sm text-slate-400">{facts.length} total</span>
            </div>
            {facts.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
                No facts are in the canon yet.
              </p>
            ) : (
              <div className="space-y-3">
                {facts.map((fact) => (
                  <article
                    key={fact.id}
                    className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-4"
                  >
                    <h3 className="font-mono text-sm font-semibold text-indigo-300">
                      {fact.code}
                    </h3>
                    <p className="text-sm text-slate-200">{fact.statement}</p>
                    <p className="text-xs text-slate-500">
                      Canon v{fact.canon_version}
                      {fact.source_page !== null && ` · Source page ${fact.source_page}`}
                      {fact.expires_at && ` · Expires ${fact.expires_at.slice(0, 10)}`}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      </section>
      <SiteFooter />
    </main>
  )
}
