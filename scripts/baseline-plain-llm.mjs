// Baseline: a plain LLM with the whole brand pack pasted into the prompt (no rules engine, no ProofGate).
// Usage: node scripts/baseline-plain-llm.mjs [--set heldout|original|all] [--limit 10] [--delay 6000] [--tag plain-llm]
// Needs GEMINI_API_KEY (and optionally GEMINI_MODEL). One call per sample, so mind your daily quota.
import { writeFileSync } from "node:fs"
import { BRAND_PACK, SAMPLES, scoreRow, summarize } from "./lib.mjs"

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const SET = opt("set", "heldout")
const LIMIT = Number(opt("limit", 10))
const DELAY = Number(opt("delay", 6000))
const TAG = opt("tag", "plain-llm")
const KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
const BASE = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com"
if (!KEY) { console.error("GEMINI_API_KEY is not set"); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const known = new Set([...BRAND_PACK.rules, ...BRAND_PACK.facts].map((x) => x.code))
const SYSTEM = `You are a brand reviewer. Review the CONTENT against the RULES and FACTS below.
RULES:\n${BRAND_PACK.rules.map((r) => `${r.code}: ${r.text}`).join("\n")}
FACTS:\n${BRAND_PACK.facts.map((f) => `${f.code} (${f.status}): ${f.text}`).join("\n")}
Return ONLY JSON: {"findings":[{"code":string,"verdict":string|null,"quote":string,"explanation":string}]}
Use a rule code for rule violations (verdict null). For factual claims use the fact code and one verdict:
Supported, Contradicted, Outdated, Unsupported, Needs legal review. quote must be copied from the content.`

const samples = SAMPLES.filter((s) => SET === "all" || s.set === SET).slice(0, LIMIT)
const rows = []
let hallucinated = 0
let findingTotal = 0
for (const s of samples) {
  try {
    const r = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `CONTENT:\n${s.text}` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    })
    if (r.status === 429) { console.log("Quota hit (429). Stopping and writing partial results."); break }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("")
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim())
    const raw = Array.isArray(parsed.findings) ? parsed.findings : []
    const findings = raw.map((f) => ({
      explanation: `${f.code ?? ""}: ${f.explanation ?? ""}`,
      verdict: f.verdict ?? null,
      severity: f.verdict === "Supported" ? "info" : "medium",
      span_text: f.quote ?? "",
      _code: f.code ?? null,
    }))
    findingTotal += findings.length
    hallucinated += findings.filter((f) => f._code && !known.has(f._code)).length // invented rule or fact IDs
    const score = scoreRow(s, findings)
    rows.push({ id: s.id, set: s.set, text: s.text, score })
    console.log(`${s.id} flagged=${score.flagged} missed=${score.missed.length} unexpected=${score.unexpected.length}`)
  } catch (e) {
    rows.push({ id: s.id, set: s.set, text: s.text, error: String(e.message ?? e) })
    console.log(`${s.id} ERROR ${e.message}`)
  }
  await sleep(DELAY)
}
const summary = {
  tag: TAG,
  model: MODEL,
  at: new Date().toISOString(),
  ...summarize(rows),
  hallucinatedCitations: hallucinated,
  findingsReturned: findingTotal,
  note: "No evidence gate: citations are not verified, so hallucinated codes would reach the user.",
}
console.log("\n=== SUMMARY ===\n" + JSON.stringify(summary, null, 2))
writeFileSync(`benchmark-${TAG}.json`, JSON.stringify({ summary, rows }, null, 2))
