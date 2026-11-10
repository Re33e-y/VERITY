import { CONFIG_VERSION } from "../lib/agents/governance";
import assert from "node:assert/strict";
import { runAgenticReview } from "../lib/agents/pipeline";
import { getPolicy } from "../lib/agents/llm";
import { applyPatches } from "../lib/agents/remediation";
import type { Canon, Finding, OfflineFn } from "../lib/agents/types";

process.env.GEMINI_API_KEY = "test";
const TEXT =
  "Verity is the best AI tool, built with our new Verification Bot! ProofGate Pro costs $19 per user per month and the free trial lasts 30 days. We check images too, all with a proof gate.";
const canon: Canon = {
  version: "1",
  rules: [
    { id: "R-TONE-001", category: "Tone", text: "Do not use the term Verification Bot; say ProofGate.", replacement: "ProofGate" },
    { id: "R-LEGAL-001", category: "Legal", text: "No unqualified superlatives." },
  ],
  facts: [
    { id: "F-PRICE", text: "ProofGate Pro costs $29 per user per month." },
    { id: "F-TRIAL", text: "The free trial lasts 14 days." },
  ],
};
const at = (s: string) => ({ start: TEXT.indexOf(s), end: TEXT.indexOf(s) + s.length });
const mk = (o: Partial<Finding> & { id: string; quote: string }): Finding => ({
  ...at(o.quote), category: "Tone", grade: "C", source: "offline", explanation: "x", citations: [], ...o,
} as Finding);

const offlineFindings = [
  mk({ id: "o1", quote: "Verification Bot", grade: "A", category: "Tone", citations: [{ type: "rule", id: "R-TONE-001" }] }),
  mk({ id: "o2", quote: "the best", grade: "C", category: "Legal" }),
];
// Fake offline engine: flags banned term + superlative + wrong price/trial so patch verification is meaningful.
const runOffline: OfflineFn = (t) => {
  const out: Finding[] = [];
  const add = (q: string, cat: string, grade: "A" | "C") => { const i = t.indexOf(q); if (i >= 0) out.push({ id: q, start: i, end: i + q.length, quote: q, category: cat, grade, source: "offline", explanation: "", citations: [] }); };
  add("Verification Bot", "Tone", "A"); add("the best", "Legal", "C"); add("$19", "Contradicted", "A"); add("30 days", "Contradicted", "A");
  return out;
};

let fetchCalls = 0;
let mode: "ok" | "429" = "ok";
let needEvidence = false;
globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
  fetchCalls++;
  if (mode === "429") return new Response('{"error":{"message":"Quota exceeded PerDay"}}', { status: 429 });
  const sys: string = JSON.parse(init.body).systemInstruction.parts[0].text;
  const a = (s: string) => `a_${at(s).start}_${at(s).end}_contradicted`;
  const userText: string = JSON.parse(init.body).contents[0].parts[0].text;
  let payload: unknown;
  if (userText.includes("CRITIC QUESTIONS")) {
    payload = { findings: [], contests: [], fixes: [] };
  } else if (sys.includes("independent critic") && needEvidence) {
    payload = { verdicts: [
      { finding_id: a("$19 per user per month"), verdict: "keep", reason: "ok" },
      { finding_id: a("free trial lasts 30 days"), verdict: "needs_evidence", reason: "unsure", recheck: "Which canon fact states the trial length?" },
    ] };
  } else if (sys.includes("independent critic")) {
    payload = { verdicts: [
      { finding_id: a("$19 per user per month"), verdict: "keep", reason: "conflicts with F-PRICE" },
      { finding_id: a("free trial lasts 30 days"), verdict: "keep", reason: "conflicts with F-TRIAL" },
      { finding_id: "o2", verdict: "dismiss", reason: "puffery, no checkable claim" },
      { finding_id: "o1", verdict: "dismiss", reason: "trying to clear grade A" },
    ] };
  } else {
    payload = {
      findings: [
        { quote: "$19 per user per month", category: "Contradicted", explanation: "Price conflicts with canon.", citations: [{ type: "fact", id: "F-PRICE" }], confidence: 0.9, replacement: "$29 per user per month" },
        { quote: "free trial lasts 30 days", category: "Contradicted", explanation: "Trial length conflicts.", citations: [{ type: "fact", id: "F-TRIAL" }], confidence: 0.6, replacement: "free trial lasts 14 days" },
        { quote: "text that is not in the document", category: "Unsupported", explanation: "hallucinated span", confidence: 0.9 },
        { quote: "proof gate", category: "Tone", explanation: "uncited tone claim", citations: [{ type: "rule", id: "R-FAKE" }], confidence: 0.9 },
        { quote: "all with a proof gate", category: "Contradicted", explanation: "fake citation", citations: [{ type: "fact", id: "F-NOPE" }], confidence: 0.9 },
      ],
      contests: [{ finding_id: "o2", stance: "dismiss", reason: "puffery" }, { finding_id: "o1", stance: "dismiss", reason: "model disputes grade A" }, { finding_id: "ghost", stance: "dismiss", reason: "unknown id" }],
      fixes: [],
    };
  }
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });
}) as unknown as typeof fetch;

const amb = [{ start: 0, end: TEXT.length }]; // router marked the whole draft ambiguous
const narrow = [at("ProofGate Pro costs $19 per user per month and the free trial lasts 30 days.")];
const base = { text: TEXT, canon, offline: offlineFindings, ambiguous: amb, runOffline };

// 1. auto: router resolved locally -> 0 calls
process.env.LLM_POLICY = "auto";
let r = await runAgenticReview({ ...base, ambiguous: [] });
assert.equal(r.status, "skipped"); assert.equal(fetchCalls, 0);
console.log("ok  skip when router resolved locally");

// 2. auto: <= 2 calls, guards, critic, remediation
r = await runAgenticReview(base);
assert.equal(r.status, "agentic"); assert.ok(r.calls_used <= 2, `calls ${r.calls_used}`); assert.equal(fetchCalls, r.calls_used);
const q = (s: string) => r.findings.find((f) => f.quote === s);
assert.ok(q("$19 per user per month"), "price finding kept");
assert.ok(q("free trial lasts 30 days"), "trial finding kept");
assert.equal(q("$19 per user per month")!.grade, "B");
assert.equal(q("free trial lasts 30 days")!.grade, "C"); // confidence 0.6 -> C
assert.ok(!r.findings.some((f) => f.quote.includes("not in the document")), "hallucinated span rejected");
assert.ok(!r.findings.some((f) => f.quote === "proof gate" || f.quote === "all with a proof gate"), "uncited / bad-citation findings rejected");
assert.ok(!r.findings.some((f) => f.id === "o2") && r.suppressed.some((s) => s.finding.id === "o2"), "grade-C false positive suppressed by critic");
const bot = r.findings.find((f) => f.id === "o1")!;
assert.equal(bot.grade, "A"); assert.ok(bot.notes?.some((n) => n.includes("not applied")), "critic cannot clear grade A");
assert.equal(bot.patch?.replacement, "ProofGate"); assert.equal(bot.patch?.origin, "canon"); assert.ok(bot.patch?.verified);
assert.equal(q("$19 per user per month")!.patch?.replacement, "$29 per user per month");
assert.ok(r.findings.every((f) => f.draftFix === undefined), "internal draftFix stripped");
const fixed = applyPatches(TEXT, r.findings.flatMap((f) => (f.patch ? [f.patch] : [])));
assert.ok(fixed.includes("ProofGate Pro costs $29 per user per month") && fixed.includes("lasts 14 days") && !fixed.includes("Verification Bot"));
console.log("ok  auto mode: calls=%d, guards, critic, grade-A immutability, verified patches", r.calls_used);
console.log("    trace:", r.trace.map((t) => `${t.agent}${t.ok ? "" : "!"}(${t.calls})`).join(" > "));

// 2.0 governance on a real agentic run
{
  const g = r.governance;
  assert.equal(g.config_version, CONFIG_VERSION);
  assert.ok(g.agents.some((a) => a.label === "Critic & Consensus Agent" && a.status === "completed"), "critic shown in activity");
  assert.ok(g.agents.some((a) => a.label.includes("Claim Verification")), "claim agent shown in activity");
  const price = g.findings.find((f) => f.quote === "$19 per user per month")!;
  assert.equal(price.evidence_strength, "canon_cited");
  assert.equal(price.severity, "high");
  assert.equal(price.confidence, 0.9);
  assert.ok(g.disagreements.some((d) => d.finding_id === "o2" && /dismissed/i.test(d.resolution)), "critic dismissal logged");
  assert.ok(g.disagreements.some((d) => d.finding_id === "o1" && /deterministic/i.test(d.resolution)), "grade A refusal logged");
  console.log("ok  governance: roles, separate scores, disagreements");
}

// 2b. documented limitation: with a narrow router focus, grade-C findings outside it are left alone
fetchCalls = 0;
const rn = await runAgenticReview({ ...base, ambiguous: narrow });
assert.ok(rn.findings.some((f) => f.id === "o2"), "out-of-focus grade C untouched in auto mode");
console.log("ok  auto mode leaves findings outside the router's focus untouched (by design)");

// 3. cache: second identical review = 0 calls
const store = new Map<string, any>();
const cache = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v) };
fetchCalls = 0;
const first = await runAgenticReview({ ...base, cache });
const used = fetchCalls;
const second = await runAgenticReview({ ...base, cache });
assert.ok(first.calls_used > 0 && second.cache_hit && second.calls_used === 0 && fetchCalls === used);
console.log("ok  cache: first=%d calls, repeat=0 calls", first.calls_used);

// 4. thorough: fans out, stays within budget, no duplicate findings
process.env.LLM_POLICY = "thorough"; fetchCalls = 0;
r = await runAgenticReview(base);
assert.ok(r.plan.groups.length > 1, "specialists fan out"); assert.ok(r.calls_used <= 6);
const spans = r.findings.map((f) => `${f.start}-${f.end}`); assert.equal(new Set(spans).size, spans.length, "no duplicate spans");
console.log("ok  thorough: groups=%d calls=%d", r.plan.groups.length, r.calls_used);

// 4b. self-correction loop: critic asks for evidence, specialist can't supply it -> finding suppressed
process.env.LLM_POLICY = "thorough"; needEvidence = true; fetchCalls = 0;
r = await runAgenticReview(base);
assert.ok(r.trace.some((t) => t.agent === "self-correction" && t.ok), "recheck ran");
assert.ok(!r.findings.some((f) => f.quote === "free trial lasts 30 days"), "unsupported finding dropped after recheck");
assert.ok(r.suppressed.some((s) => s.finding.quote === "free trial lasts 30 days"), "and recorded as suppressed");
assert.ok(r.findings.some((f) => f.quote === "$19 per user per month"), "verified finding survives");
assert.ok(r.calls_used <= 6, `calls ${r.calls_used}`);
needEvidence = false;
console.log("ok  self-correction loop: calls=%d", r.calls_used);

// 5. quota exhausted -> degrade to offline, then circuit breaker prevents more calls
process.env.LLM_POLICY = "auto"; mode = "429"; fetchCalls = 0;
r = await runAgenticReview({ ...base, text: TEXT + " " });
assert.equal(r.status, "degraded"); assert.equal(r.ai_unavailable, true); assert.equal(r.findings.length, offlineFindings.length);
const before = fetchCalls;
r = await runAgenticReview(base);
assert.equal(r.status, "degraded"); assert.equal(fetchCalls, before, "circuit breaker: no further calls");
console.log("ok  429 -> degraded, ai_unavailable, circuit open");

// 6. policy precedence must match app/api/review/route.ts (both now call getPolicy)
{
  const saved = { p: process.env.LLM_POLICY, m: process.env.LLM_MODE };
  const setEnv = (policy: string | undefined, legacy: string | undefined) => {
    if (policy === undefined) delete process.env.LLM_POLICY; else process.env.LLM_POLICY = policy;
    if (legacy === undefined) delete process.env.LLM_MODE; else process.env.LLM_MODE = legacy;
  };
  try {
    setEnv("auto", "off");      assert.equal(getPolicy(), "auto", "LLM_POLICY wins over legacy LLM_MODE");
    setEnv(undefined, "off");   assert.equal(getPolicy(), "off", "legacy LLM_MODE=off honored when LLM_POLICY unset");
    setEnv(undefined, "OFF");   assert.equal(getPolicy(), "off", "legacy value is case-insensitive");
    setEnv("OFF", undefined);   assert.equal(getPolicy(), "off", "LLM_POLICY is case-insensitive");
    setEnv("Thorough", undefined); assert.equal(getPolicy(), "thorough");
    setEnv("garbage", undefined);  assert.equal(getPolicy(), "auto", "unknown value falls back to auto");
    setEnv(undefined, undefined);  assert.equal(getPolicy(), "auto", "defaults to auto");
  } finally {
    setEnv(saved.p, saved.m);
  }
  console.log("ok  policy precedence matches route.ts");
}

// 7. governance on a result that needed no model (works even with the circuit open)
{
  process.env.LLM_POLICY = "auto";
  const s = await runAgenticReview({ ...base, ambiguous: [] });
  assert.equal(s.status, "skipped");
  const g = s.governance;
  assert.match(g.idempotency_key, /^[0-9a-f]{64}$/);
  const s2 = await runAgenticReview({ ...base, ambiguous: [] });
  assert.equal(s2.governance.idempotency_key, g.idempotency_key, "same input -> same idempotency key");
  const o1 = g.findings.find((f) => f.id === "o1")!;
  assert.equal(o1.evidence_strength, "deterministic");
  assert.equal(o1.severity, "low");
  assert.equal(o1.requires_human_review, false);
  const o2 = g.findings.find((f) => f.id === "o2")!;
  assert.equal(o2.evidence_strength, "none");
  assert.equal(o2.confidence, null);
  assert.equal(o2.requires_human_review, true);
  assert.equal(g.summary.findings, 2);
  assert.equal(g.summary.needs_human_review, 1);
  assert.equal(g.human_review_required, true);
  console.log("ok  governance on skipped review: idempotency key, evidence strength, escalation");
}