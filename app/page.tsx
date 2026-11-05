
"use client"

import { useState } from "react"

interface Finding {
  id: string
  span: {
    start: number
    end: number
    text: string
  }
  rule_id: string | null
  fact_id: string | null
  canon_version: number
  verdict: string
  grade: string
  source: "rule" | "ai"
  explanation: string
  suggested_fix: string | null
}

interface ReviewResult {
  runId: string
  score: number
  status: string
  rulesChecked: number
  factsAvailable: number
  findings: Finding[]
}

export default function Home() {
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleReview = async () => {
    if (!content.trim() || loading) return

    setLoading(true)
    setResult(null)
    setErrorMsg(null)

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      })

      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(
          data.error || `Review failed with status ${res.status}`
        )
      }

      if (!Array.isArray(data.findings)) {
        throw new Error("Invalid response: findings must be an array.")
      }

      setResult(data as ReviewResult)
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred."
      )
    } finally {
      setLoading(false)
    }
  }

  const getGradeColor = (grade: string) => {
    switch (grade.toUpperCase()) {
      case "A":
        return "text-emerald-400"
      case "B":
        return "text-blue-400"
      case "C":
        return "text-amber-400"
      case "D":
        return "text-red-400"
      default:
        return "text-slate-400"
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-8 max-w-5xl mx-auto font-sans">

      <header className="border-b border-slate-800 pb-6 mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Verity
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            ProofGate Brand Governance &amp; Content Verification Engine
          </p>
        </div>

        <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full font-mono">
          System Live
        </span>
      </header>

      <div className="space-y-6">

        <section>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Draft Content for Governance Audit
          </label>

          <textarea
            rows={7}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm resize-y"
            placeholder="Paste your brand content here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          <p className="text-xs text-slate-500 mt-2">
            Verity will evaluate your content against active brand rules and verified facts.
          </p>
        </section>

        <button
          onClick={handleReview}
          disabled={loading || !content.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-lg text-sm transition"
        >
          {loading ? "Auditing via ProofGate..." : "Run Governance Audit"}
        </button>

        {errorMsg && (
          <div className="p-4 bg-red-950/60 border border-red-500/50 rounded-xl text-red-200 text-sm">
            <div className="font-bold text-red-400 mb-1">
              Server Error
            </div>
            <p className="break-words">{errorMsg}</p>
          </div>
        )}

        {result && (
          <section className="mt-8 border border-slate-800 bg-slate-900/60 rounded-xl p-5 md:p-6 space-y-5">

            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Audit Summary
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  Run ID: {result.runId}
                </p>
              </div>

              <div className="text-right">
                <div className="text-3xl font-bold text-white">
                  {result.score}/100
                </div>
                <span className="text-xs uppercase font-bold tracking-wider text-emerald-400">
                  {result.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-y border-slate-800 py-4">
              <div>
                <p className="text-xs text-slate-400">Rules evaluated</p>
                <p className="text-xl font-semibold">
                  {result.rulesChecked}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">Verified facts</p>
                <p className="text-xl font-semibold">
                  {result.factsAvailable}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">
                Findings ({result.findings.length})
              </h3>

              {result.findings.length === 0 ? (
                <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg">
                  No policy or factual issues detected.
                </div>
              ) : (
                result.findings.map((finding) => (
                  <article
                    key={finding.id}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3"
                  >

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-indigo-400 uppercase">
                        {finding.verdict.replace(/_/g, " ")}
                      </span>

                      <div className="flex gap-3 text-xs">
                        <span className={`font-bold ${getGradeColor(finding.grade)}`}>
                          Grade {finding.grade}
                        </span>

                        <span className="text-slate-500 uppercase">
                          {finding.source}
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-900 rounded-md p-3 border-l-2 border-amber-400">
                      <p className="text-xs text-slate-500 mb-1">
                        Detected text
                      </p>
                      <p className="text-sm text-amber-300">
                        {finding.span.text}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-500 mb-1">
                        Explanation
                      </p>
                      <p className="text-sm text-slate-300">
                        {finding.explanation}
                      </p>
                    </div>

                    {finding.suggested_fix && (
                      <div>
                        <p className="text-xs text-slate-500 mb-1">
                          Suggested correction
                        </p>
                        <p className="text-sm text-emerald-300">
                          {finding.suggested_fix}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3 text-xs text-slate-500 border-t border-slate-800 pt-3">
                      <span>Rule: {finding.rule_id ?? "N/A"}</span>
                      <span>Fact: {finding.fact_id ?? "N/A"}</span>
                      <span>Canon v{finding.canon_version}</span>
                      <span>
                        Span: {finding.span.start}–{finding.span.end}
                      </span>
                    </div>

                  </article>
                ))
              )}
            </div>
          </section>
        )}

      </div>
    </main>
  )
}
