"use client"

import { useState } from "react"

export default function Home() {
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const handleReview = async () => {
    if (!content.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      alert("Error: " + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8 max-w-4xl mx-auto font-sans">
      <header className="border-b border-slate-800 pb-6 mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Verity</h1>
          <p className="text-sm text-slate-400 mt-1">ProofGate Brand Governance &amp; Content Verification Engine</p>
        </div>
        <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full font-mono">
          System Live
        </span>
      </header>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Draft Content for Governance Audit:
          </label>
          <textarea
            rows={5}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            placeholder="e.g. Verity is the best AI tool on the market, built with our new Verification Bot..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <button
          onClick={handleReview}
          disabled={loading || !content.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition"
        >
          {loading ? "Auditing via ProofGate..." : "Run Governance Audit"}
        </button>

        {result && (
          <div className="mt-8 border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Audit Summary</h2>
                <p className="text-xs text-slate-400 font-mono">Run ID: {result.runId}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{result.score}/100</div>
                <span className={`text-xs uppercase font-bold tracking-wider ${result.status === "completed" ? "text-emerald-400" : "text-amber-400"}`}>
                  {result.status}
                </span>
              </div>
            </div>

            <div className="text-xs text-slate-400 border-t border-slate-800 pt-3">
              Evaluated against {result.rulesChecked} active rules and {result.factsAvailable} verified facts.
            </div>

            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-semibold text-slate-200">
                Findings ({result.findings?.length || 0}):
              </h3>
              {result.findings?.length === 0 ? (
                <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg">
                  No policy or fact violations detected. Content is verified for release.
                </div>
              ) : (
                result.findings?.map((f: any, idx: number) => (
                  <div key={idx} className="bg-slate-950/80 border border-amber-500/30 rounded-lg p-3 text-xs space-y-1">
                    <div className="font-semibold text-amber-400">{f.issue_type}</div>
                    <div className="text-slate-300">{f.explanation}</div>
                    {f.suggested_fix && (
                      <div className="text-slate-400 pt-1">
                        <span className="text-slate-500 font-semibold">Recommendation:</span> {f.suggested_fix}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
