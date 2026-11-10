// Runs the REAL pipeline through the adapters, with fixtures shaped like router.ts's Rule/Fact/Finding.
import assert from "node:assert/strict";
import { runAgenticReview } from "../lib/agents/pipeline";
import { isImmutable } from "../lib/agents/guards";
import { makeFindingMapper, makeOfflineRunner, toAgentCanon, type FindingRow } from "../lib/agents/adapters";
import type { Fact, Finding as EngineFinding, Rule } from "../types/engine";

process.env.GEMINI_API_KEY = "test";
process.env.LLM_POLICY = "auto";
delete process.env.LLM_MODE;

const TEXT =
  "Verity is the best AI tool, built with our new Verification Bot! ProofGate Pro costs $19 per user per month and the free trial lasts 30 days. We check images too, all with a proof gate.";
const at = (s: string) => ({ span_start: TEXT.indexOf(s), span_end: TEXT.indexOf(s) + s.length, span_text: s });

const rules: Rule[] = [
  { id: "rule-uuid-1", code: "TONE-001", type: "tone", description: "No hype or slogans.", severity: "medium", pattern: null, preferred: null, source_page: null, canon_version: 3, expires_at: null, active: true },
  { id: "rule-uuid-2", code: "TERM-001", type: "terminology", description: "Say ProofGate, not Verification Bot.", severity: "high", pattern: "Verification Bot", preferred: "ProofGate", source_page: null, canon_version: 3, expires_at: null, active: true },
  { id: "rule-uuid-3", code: "MSG-001", type: "messaging", description: "Lead with outcomes.", severity: "low", pattern: null, preferred: null, source_page: null, canon_version: 3, expires_at: null, active: true },
];
const facts: Fact[] = [
  { id: "fact-uuid-1", code: "F-PRICE", statement: "ProofGate Pro costs $29 per user per month.", keywords: [], source_page: null, canon_version: 3, expires_at: null },
  { id: "fact-uuid-2", code: "F-TRIAL", statement: "The free trial lasts 14 days.", keywords: [], source_page: null, canon_version: 3, expires_at: null },
];
const raw = { version: 3, rules, facts };

const base = { canon_version: 3, suggested_fix: null, explanation: "x" };
const engineFindings: EngineFinding[] = [
  { ...at("Verification Bot"), rule_id: "rule-uuid-2", fact_id: null, grade: "A", verdict: null, source: "rule", severity: "high", ...base },
  // negation-style conflict: grade C Contradicted, the exact case the router sends to the judge
  { ...at("$19 per user per month"), rule_id: null, fact_id: "fact-uuid-1", grade: "C", verdict: "Contradicted", source: "ai", severity: "high", ...base },
  { ...at("the best"), rule_id: "rule-uuid-1", fact_id: null, grade: "C", verdict: null, source: "rule", severity: "medium", ...base },
  { span_start: null, span_end: null, span_text: "", rule_id: "rule-uuid-3", fact_id: null, grade: "A", verdict: null, source: "rule", severity: "low", ...base },
];
// Stand-in for router.ts `rerun`: the same engine on other text.
const rerun = (t: string): EngineFinding[] => {
  const out: EngineFinding[] = [];
  const add = (q: string, extra: Partial<EngineFinding>) => {
    const i = t.indexOf(q);
    if (i >= 0) out.push({ span_start: i, span_end: i + q.length, span_text: q, grade: "A", source: "rule", severity: "high", canon_version: 3, suggested_fix: null, explanation: "", rule_id: null, fact_id: null, verdict: null, ...extra });
  };
  add("Verification Bot", { rule_id: "rule-uuid-2", fact_id: null, verdict: null });
  add("$19", { rule_id: null, fact_id: "fact-uuid-1", verdict: "Contradicted" });
  return out;
};

// ---- canon ----
const canon = toAgentCanon(raw);
assert.deepEqual(canon.rules.map((r) => r.id), ["TONE-001", "TERM-001", "MSG-001"], "agents see codes");
assert.equal(canon.rules[1].replacement, "ProofGate");
assert.equal(canon.rules[2].category, "Tone", "messaging rules are tone rules");
assert.equal(canon.facts[0].text, facts[0].statement);
console.log("ok  canon: codes as ids, replacement + category mapped");

// ---- engine -> agent ----
const mapper = makeFindingMapper(raw);
const offline = engineFindings.map((f) => mapper.to(f));
const [bot, price, best, docLevel] = offline;
assert.equal(bot.start, TEXT.indexOf("Verification Bot")); assert.equal(bot.quote, "Verification Bot");
assert.equal(price.category, "Contradicted"); assert.deepEqual(price.citations, [{ type: "fact", id: "F-PRICE" }]);
assert.equal(bot.category, "terminology"); assert.deepEqual(bot.citations, [{ type: "rule", id: "TERM-001" }]);
assert.equal(docLevel.start, 0); assert.equal(docLevel.end, 0); assert.equal(docLevel.quote, "");
assert.ok(isImmutable(price), "a Contradicted finding is immutable (grade C included)");
assert.ok(isImmutable(bot), "grade A is immutable");
assert.ok(!isImmutable(best));
console.log("ok  engine -> agent: spans, categories, id->code citations, immutability");

// ---- full pipeline: critic tries to dismiss everything ----
let calls = 0;
const taId = (s: string, cat: string) => `a_${TEXT.indexOf(s)}_${TEXT.indexOf(s) + s.length}_${cat}`;
globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
  calls++;
  const body = JSON.parse(init.body);
  const sys: string = body.systemInstruction.parts[0].text;
  const payload = sys.includes("independent critic")
    ? { verdicts: [
        { finding_id: price.id, verdict: "dismiss", reason: "model disagrees" },
        { finding_id: bot.id, verdict: "dismiss", reason: "model disagrees" },
        { finding_id: best.id, verdict: "dismiss", reason: "puffery" },
        { finding_id: taId("all with a proof gate", "tone"), verdict: "keep", reason: "ok" },
      ] }
    : { findings: [{ quote: "all with a proof gate", category: "Tone", explanation: "Slogan-style phrasing.", citations: [{ type: "rule", id: "TONE-001" }], confidence: 0.9 }], contests: [], fixes: [] };
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });
}) as unknown as typeof fetch;

const r = await runAgenticReview({
  text: TEXT, canon, offline, ambiguous: [{ start: 0, end: TEXT.length }], runOffline: makeOfflineRunner(mapper, rerun),
});
assert.equal(r.status, "agentic"); assert.ok(r.calls_used <= 2);
assert.ok(r.findings.some((f) => f.id === price.id), "Contradicted finding survives a critic dismissal");
assert.ok(r.findings.some((f) => f.id === bot.id), "grade A finding survives a critic dismissal");
assert.ok(!r.findings.some((f) => f.id === best.id) && r.suppressed.some((s) => s.finding.id === best.id), "grade-C puffery is still suppressible");
console.log("ok  pipeline: critic cannot dismiss Contradicted or grade A (calls=%d)", r.calls_used);

// ---- agent -> rows ----
const rows: FindingRow[] = r.findings.map((f) => mapper.from(f));
const FORBIDDEN = ["start", "end", "quote", "category", "suggestion", "citations"];
for (const row of rows) for (const k of FORBIDDEN) assert.ok(!(k in row), `row must not carry agent-only key "${k}"`);
const botRow = rows.find((x) => x.span_text === "Verification Bot");
assert.equal(botRow!.rule_id, "rule-uuid-2"); assert.equal(botRow!.source, "rule"); assert.equal(botRow!.severity, "high");
assert.equal(botRow!.patch?.replacement, "ProofGate"); assert.ok(botRow!.patch?.verified, "patch verified through rerun + probe");
const priceRow = rows.find((x) => x.span_text?.startsWith("$19"));
assert.equal(priceRow!.verdict, "Contradicted"); assert.equal(priceRow!.fact_id, "fact-uuid-1"); assert.equal(priceRow!.grade, "C");
assert.ok(priceRow!.ai_notes?.some((n) => /not applied/.test(n)), "critic dismissal of a Contradicted finding was refused and noted");
const agentRow = rows.find((x) => x.span_text === "all with a proof gate");
assert.equal(agentRow!.rule_id, "rule-uuid-1", "code citation mapped back to the rule's id");
assert.equal(agentRow!.verdict, null); assert.equal(agentRow!.source, "ai"); assert.equal(agentRow!.severity, "medium"); assert.equal(agentRow!.canon_version, 3);
assert.match(agentRow!.explanation, /not independently verified/);
const docRow = rows.find((x) => x.rule_id === "rule-uuid-3");
assert.equal(docRow!.span_start, null); assert.equal(docRow!.span_end, null, "document-level finding keeps its null span");
console.log("ok  agent -> rows: real column names, ids restored, patch verified, null spans preserved");

// ---- policy off: layer returns the offline findings untouched ----
process.env.LLM_POLICY = "off"; calls = 0;
const off = await runAgenticReview({ text: TEXT, canon, offline, ambiguous: [{ start: 0, end: TEXT.length }], runOffline: makeOfflineRunner(mapper, rerun) });
assert.equal(off.status, "skipped"); assert.equal(calls, 0); assert.equal(off.ai_unavailable, false);
assert.deepEqual(off.findings.map((f) => f.id), offline.map((f) => f.id));
console.log("ok  policy off: skipped, 0 calls, same findings");
