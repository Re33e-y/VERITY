// Usage: node scripts/benchmark.mjs <baseUrl> [--set original|heldout|all] [--tag name] [--delay 4000]
// Writes benchmark-<tag>.json. Run once per configuration (e.g. offline-only, router, rerun for cache).
import { writeFileSync } from "node:fs"
import { SAMPLES, scoreRow, summarize } from "./lib.mjs"

const args = process.argv.slice(2)
const BASE = args.find((a) => /^https?:/.test(a)) ?? "http://localhost:3000"
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const SET = opt("set", "all")
const TAG = opt("tag", "run")
const DELAY = Number(opt("delay", 4000))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const samples = SAMPLES.filter((s) => SET === "all" || s.set === SET)

async function review(text) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${BASE}/api/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    })
    const raw = await r.text()
    let body
    try { body = JSON.parse(raw) } catch { throw new Error(`non-JSON response (${r.status}): ${raw.slice(0, 80)}`) }
    if (r.status === 429 && attempt === 0) { await sleep(20000); continue } // server-side rate cap
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
    return body
  }
  throw new Error("rate limited")
}

const rows = []
for (const s of samples) {
  try {
    const res = await review(s.text)
    const score = scoreRow(s, res.findings ?? [])
    const row = {
      id: s.id,
      set: s.set,
      text: s.text,
      score,
      route: res.route ?? null,
      llmCalls: res.llmCalls ?? null,
      cached: res.cached ?? null,
      aiStatus: res.ai?.status ?? null,
      aiError: res.ai?.error ?? null,
      runScore: res.score,
    }
    rows.push(row)
    console.log(`${s.id} [${s.set}] flagged=${score.flagged} missed=${score.missed.length} unexpected=${score.unexpected.length} ` +
      `route=${row.route} calls=${row.llmCalls} cached=${row.cached} score=${res.score}`)
    if (row.aiError) console.log(`   ai error: ${String(row.aiError).slice(0, 160)}`)
  } catch (e) {
    rows.push({ id: s.id, set: s.set, text: s.text, error: String(e.message ?? e) })
    console.log(`${s.id} ERROR ${e.message}`)
  }
  await sleep(DELAY)
}

const bySet = (name) => rows.filter((r) => name === "all" || r.set === name)
const calls = rows.filter((r) => r.llmCalls !== null && r.llmCalls !== undefined)
const budget = {
  reviews: calls.length,
  totalLlmCalls: calls.reduce((t, r) => t + r.llmCalls, 0),
  avgCallsPerReview: calls.length ? +(calls.reduce((t, r) => t + r.llmCalls, 0) / calls.length).toFixed(2) : null,
  local: calls.filter((r) => r.route === "local").length,
  hybrid: calls.filter((r) => r.route === "hybrid").length,
  degraded: calls.filter((r) => r.route === "degraded").length,
  cacheHits: calls.filter((r) => r.cached).length,
}
const summary = {
  tag: TAG,
  base: BASE,
  at: new Date().toISOString(),
  original: summarize(bySet("original")),
  heldout: summarize(bySet("heldout")),
  all: summarize(rows),
  budget,
}

console.log("\n=== MISSES AND UNEXPECTED FLAGS (read these first) ===")
for (const r of rows.filter((x) => !x.error && (x.score.missed.length || x.score.unexpected.length)))
  console.log(`${r.id} [${r.set}] "${r.text.slice(0, 55)}" missed=${JSON.stringify(r.score.missed)} unexpected=${JSON.stringify(r.score.unexpected)}`)
console.log("\n=== SUMMARY ===")
console.log(JSON.stringify(summary, null, 2))
writeFileSync(`benchmark-${TAG}.json`, JSON.stringify({ summary, rows }, null, 2))
console.log(`\nWrote benchmark-${TAG}.json`)
process.exitCode = rows.some((r) => r.error) ? 1 : 0
