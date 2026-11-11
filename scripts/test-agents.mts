import { CONFIG_VERSION } from "../lib/agents/governance";
import assert from "node:assert/strict";
import { runAgenticReview } from "../lib/agents/pipeline";
import { getPolicy, resetQuotaCircuit, repairTruncatedJson } from "../lib/agents/llm";
import { applyPatches } from "../lib/agents/remediation";
import type { CacheAdapter, Canon, Finding, OfflineFn } from "../lib/agents/types";

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
let customHandler: ((url: unknown, init: { body: string }) => Promise<Response>) | null = null;
globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
  if (customHandler) return customHandler(_u, init);
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

// ============================================================================
// 12 Comprehensive Verification Tests for Verity 2.0 Agentic Pipeline
// ============================================================================
console.log("\n--- Running 12 Verity 2.0 Specialist & Governance Verification Tests ---");
resetQuotaCircuit();

const mockJson = (payload: unknown) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 }
  );

const aId = (txt: string, q: string, cat: string) =>
  `a_${txt.indexOf(q)}_${txt.indexOf(q) + q.length}_${cat.toLowerCase()}`;

// 1. Unsupported financial return claims (e.g. 'guaranteed 20% annual returns')
{
  const text1 = "Invest with us for a guaranteed 20% annual return on your capital.";
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: aId(text1, "guaranteed 20% annual return", "unsupported"), verdict: "keep", reason: "Guaranteed return claim has no supporting prospectus." }],
        consensus_summary: "Confirmed unsupported high-risk financial return claim.",
      });
    }
    return mockJson({
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "legal",
          verdict: "unsupported",
          confidence: 0.95,
          evidence: [],
          reasoning_summary: "Guaranteed 20% annual return lacks approved financial prospectus or regulatory substantiation.",
          recommended_action: "flag",
          requires_human_review: true,
          quote: "guaranteed 20% annual return",
        },
      ],
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res1 = await runAgenticReview({
    text: text1,
    canon: { version: "1", rules: [], facts: [] },
    offline: [],
    ambiguous: [{ start: 0, end: text1.length }],
    runOffline: () => [],
  });

  assert.equal(res1.status, "agentic");
  assert.equal(res1.findings.length, 1);
  const f1 = res1.findings[0];
  assert.equal(f1.category, "Unsupported");
  assert.equal(f1.quote, "guaranteed 20% annual return");
  assert.equal(res1.governance.summary.unverifiable, 1);
  assert.equal(res1.governance.findings[0].severity, "medium");
  assert.equal(res1.governance.findings[0].evidence_strength, "none");
  assert.equal(res1.governance.findings[0].requires_human_review, true);
  console.log("ok  1. Unsupported financial return claim flagged as unverifiable + human review required");
  customHandler = null;
}

// 2. Contradictory medical claims with disclaimers
{
  const text2 = "Our herbal blend completely cures diabetes permanently, though individual results may vary.";
  const canon2: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-MED-001", text: "No herbal supplement is approved to treat or cure diabetes." }],
  };
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: aId(text2, "completely cures diabetes permanently", "contradicted"), verdict: "keep", reason: "Direct conflict with F-MED-001; disclaimer does not relieve medical cure claims." }],
        consensus_summary: "Critic confirmed medical contradiction.",
      });
    }
    return mockJson({
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "fact",
          verdict: "contradicted",
          confidence: 0.96,
          evidence: [{ type: "fact", id: "F-MED-001" }],
          reasoning_summary: "Directly contradicts approved medical fact F-MED-001. A disclaimer does not mitigate false cure representations.",
          recommended_action: "flag",
          requires_human_review: true,
          quote: "completely cures diabetes permanently",
        },
      ],
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res2 = await runAgenticReview({
    text: text2,
    canon: canon2,
    offline: [],
    ambiguous: [{ start: 0, end: text2.length }],
    runOffline: () => [],
  });

  assert.equal(res2.findings.length, 1);
  const f2 = res2.findings[0];
  assert.equal(f2.category, "Contradicted");
  assert.equal(f2.grade, "B");
  assert.equal(f2.citations[0].id, "F-MED-001");
  assert.equal(res2.governance.findings[0].severity, "high");
  assert.equal(res2.governance.findings[0].evidence_strength, "canon_cited");
  console.log("ok  2. Contradictory medical claim retained despite disclaimer");
  customHandler = null;
}

// 3. Unsupported scientific performance claims
{
  const text3 = "Our quantum processor achieves 1000x faster execution than any classical cluster.";
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: aId(text3, "1000x faster execution", "unsupported"), verdict: "keep", reason: "No benchmarks verify 1000x quantum speedup." }],
        consensus_summary: "Unproven performance metric.",
      });
    }
    return mockJson({
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "fact",
          verdict: "unsupported",
          confidence: 0.88,
          evidence: [],
          reasoning_summary: "No empirical benchmark or canon entry verifies 1000x speedup.",
          recommended_action: "flag",
          requires_human_review: true,
          quote: "1000x faster execution",
        },
      ],
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res3 = await runAgenticReview({
    text: text3,
    canon: { version: "1", rules: [], facts: [] },
    offline: [],
    ambiguous: [{ start: 0, end: text3.length }],
    runOffline: () => [],
  });

  assert.equal(res3.findings.length, 1);
  const f3 = res3.findings[0];
  assert.equal(f3.category, "Unsupported");
  assert.equal(f3.citations.length, 0); // No synthetic citation fabricated!
  assert.equal(res3.governance.findings[0].evidence_strength, "none");
  console.log("ok  3. Unsupported scientific performance claim flagged without fabricated evidence");
  customHandler = null;
}

// 4. Valid claim with approved evidence (ensure 0 false findings)
{
  const text4 = "ProofGate Pro costs $29 per user per month.";
  const canon4: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-PRICE-001", text: "ProofGate Pro costs $29 per user per month." }],
  };
  customHandler = async () => {
    return mockJson({
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "fact",
          verdict: "supported",
          confidence: 0.99,
          evidence: [{ type: "fact", id: "F-PRICE-001" }],
          reasoning_summary: "Matches approved canon pricing fact F-PRICE-001.",
          recommended_action: "keep",
          requires_human_review: false,
          quote: text4,
        },
      ],
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res4 = await runAgenticReview({
    text: text4,
    canon: canon4,
    offline: [],
    ambiguous: [{ start: 0, end: text4.length }],
    runOffline: () => [],
  });

  assert.equal(res4.findings.length, 0, "Zero false findings for valid supported claim");
  assert.equal(res4.governance.consensus?.status, "no_findings_to_review");
  assert.equal(res4.governance.human_review_required, false);
  console.log("ok  4. Valid claim produces 0 false findings and consensus_reached/no_findings");
  customHandler = null;
}

// 5. Ambiguous claim requiring human review
{
  const text5 = "Our platform may significantly reduce operational overhead under certain enterprise workflows.";
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: aId(text5, "may significantly reduce operational overhead", "unsupported"), verdict: "downgrade", reason: "Real ambiguity, lacks data for definitive proof." }],
        consensus_summary: "Needs human review to assess workflow applicability.",
      });
    }
    return mockJson({
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "legal",
          verdict: "insufficient_evidence",
          confidence: 0.5,
          evidence: [],
          reasoning_summary: "Hedged claim lacks concrete metrics; cannot substantiate without enterprise workflow audit.",
          recommended_action: "escalate",
          requires_human_review: true,
          quote: "may significantly reduce operational overhead",
        },
      ],
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res5 = await runAgenticReview({
    text: text5,
    canon: { version: "1", rules: [], facts: [] },
    offline: [],
    ambiguous: [{ start: 0, end: text5.length }],
    runOffline: () => [],
  });

  assert.equal(res5.findings.length, 1);
  const f5 = res5.findings[0];
  assert.equal(f5.grade, "C");
  assert.equal(res5.governance.findings[0].requires_human_review, true);
  console.log("ok  5. Ambiguous claim correctly escalated for human review");
  customHandler = null;
}

// 6. Specialist disagreement (e.g. Tone says compliant, Legal flags risk)
{
  const text6 = "We deploy aggressive growth hacking techniques to dominate competitors.";
  const offline6: Finding[] = [
    {
      id: "o_growth",
      start: 10,
      end: 46,
      quote: "aggressive growth hacking techniques",
      category: "Tone",
      grade: "C",
      source: "offline",
      explanation: "Tone check",
      citations: [],
    },
  ];
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: "o_growth", verdict: "keep", reason: "Legal risk outweighs tone leniency." }],
        consensus_summary: "Critic resolved disagreement: kept finding on legal compliance grounds.",
      });
    }
    return mockJson({
      findings: [],
      contests: [
        { finding_id: "o_growth", stance: "dismiss", reason: "Tone specialist views phrase as acceptable modern marketing jargon." },
      ],
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "legal",
          verdict: "non_compliant",
          confidence: 0.85,
          evidence: [],
          reasoning_summary: "Legal specialist flags predatory competition rhetoric.",
          recommended_action: "flag",
          requires_human_review: true,
          quote: "aggressive growth hacking techniques",
        },
      ],
      fixes: [],
    });
  };

  const res6 = await runAgenticReview({
    text: text6,
    canon: { version: "1", rules: [], facts: [] },
    offline: offline6,
    ambiguous: [{ start: 0, end: text6.length }],
    runOffline: () => [],
  });

  assert.ok(res6.governance.disagreements.length > 0, "Disagreement recorded between specialists");
  assert.equal(res6.governance.disagreements[0].finding_id, "o_growth");
  assert.ok(res6.governance.disagreements[0].resolution.includes("Critic kept"), "Adjudication logged");
  console.log("ok  6. Specialist disagreement logged and adjudicated by critic");
  customHandler = null;
}

// 7. Critic returning no findings to review / consensus reached with zero findings
{
  const text7 = "Antigravity provides verified brand governance.";
  let criticCalled = false;
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      criticCalled = true;
      return mockJson({ verdicts: [], consensus_summary: "" });
    }
    return mockJson({ evaluations: [], findings: [], contests: [], fixes: [] });
  };

  const res7 = await runAgenticReview({
    text: text7,
    canon: { version: "1", rules: [], facts: [] },
    offline: [],
    ambiguous: [{ start: 0, end: text7.length }],
    runOffline: () => [],
  });

  assert.equal(res7.findings.length, 0);
  assert.equal(criticCalled, false, "Critic used 0 LLM calls when 0 candidate findings existed");
  assert.equal(res7.governance.consensus?.status, "no_findings_to_review");
  assert.ok(res7.trace.some((t) => t.agent === "critic" && t.calls === 0));
  console.log("ok  7. Critic consensus with zero candidate findings consumes 0 calls");
  customHandler = null;
}

// 8. Gemini 503 and timeout recovery
{
  const text8 = "Testing 503 service unavailable resilience.";
  const offline8: Finding[] = [
    {
      id: "o_fixed",
      start: 0,
      end: 7,
      quote: "Testing",
      category: "Tone",
      grade: "A",
      source: "rule",
      explanation: "Deterministic finding",
      citations: [],
    },
  ];
  customHandler = async () => {
    return new Response(JSON.stringify({ error: { code: 503, message: "The service is temporarily unavailable." } }), { status: 503 });
  };

  const res8 = await runAgenticReview({
    text: text8,
    canon: { version: "1", rules: [], facts: [] },
    offline: offline8,
    ambiguous: [{ start: 0, end: text8.length }],
    runOffline: () => [],
  });

  assert.equal(res8.status, "degraded");
  assert.equal(res8.ai_unavailable, true);
  assert.equal(res8.findings.length, 1);
  assert.equal(res8.findings[0].id, "o_fixed");
  assert.equal(res8.governance.consensus?.status, "model_failure");
  console.log("ok  8. Gemini 503 failure handled gracefully (degraded status, offline findings preserved)");
  customHandler = null;
}

// 9. Invalid structured model output recovery
{
  const text9 = "This copy tests robust parsing against malformed model JSON.";
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: "invalid_id_not_in_candidates", verdict: "keep" }],
      });
    }
    // Return mixture of invalid and valid findings
    return mockJson({
      findings: [
        { quote: 12345, category: "bad_type" }, // malformed
        { quote: "malformed model JSON", category: "Tone", explanation: "Valid finding syntax", confidence: 0.8, citations: [{ type: "rule", id: "R-TONE-01" }] },
      ],
      evaluations: [
        { invalid_field: "gibberish" }, // malformed
      ],
      contests: [{ broken: true }],
      fixes: [],
    });
  };

  const canon9: Canon = {
    version: "1",
    rules: [{ id: "R-TONE-01", category: "Tone", text: "Tone guideline." }],
    facts: [],
  };

  const res9 = await runAgenticReview({
    text: text9,
    canon: canon9,
    offline: [],
    ambiguous: [{ start: 0, end: text9.length }],
    runOffline: () => [],
  });

  assert.equal(res9.status, "agentic");
  assert.equal(res9.findings.length, 1);
  assert.equal(res9.findings[0].quote, "malformed model JSON");
  console.log("ok  9. Invalid structured model outputs recovered safely without pipeline crash");
  customHandler = null;
}

// 10. Remediation patch rejected by deterministic verification
{
  const text10 = "We use Verification Bot for all reviews.";
  const canon10: Canon = {
    version: "1",
    rules: [{ id: "R-TONE-001", category: "Tone", text: "Do not say Verification Bot or Magic Bot." }],
    facts: [],
  };
  const offline10: Finding[] = [
    {
      id: "o_bot",
      start: 7,
      end: 23,
      quote: "Verification Bot",
      category: "Tone",
      grade: "A",
      source: "rule",
      explanation: "Banned phrase",
      citations: [{ type: "rule", id: "R-TONE-001" }],
    },
  ];

  // Offline engine rejects both "Verification Bot" AND "Magic Bot"
  const runOffline10: OfflineFn = (t) => {
    const out: Finding[] = [];
    const check = (bad: string) => {
      const idx = t.indexOf(bad);
      if (idx >= 0) out.push({ id: `bad_${bad}`, start: idx, end: idx + bad.length, quote: bad, category: "Tone", grade: "A", source: "offline", explanation: "Banned", citations: [] });
    };
    check("Verification Bot");
    check("Magic Bot");
    return out;
  };

  // Specialist proposes "Magic Bot" (which also fails offline engine)
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({ verdicts: [{ finding_id: "o_bot", verdict: "keep" }] });
    }
    return mockJson({
      findings: [],
      contests: [],
      fixes: [{ finding_id: "o_bot", replacement: "Magic Bot", rationale: "Bad fix that violates another rule" }],
    });
  };

  const res10 = await runAgenticReview({
    text: text10,
    canon: canon10,
    offline: offline10,
    ambiguous: [{ start: 0, end: text10.length }],
    runOffline: runOffline10,
  });

  const botFinding = res10.findings.find((f) => f.id === "o_bot")!;
  assert.ok(botFinding.patch, "Patch object exists");
  assert.equal(botFinding.patch?.status, "rejected");
  assert.equal(botFinding.patch?.verified, false);
  assert.ok(botFinding.patch?.failed_reason?.includes("Tone"), `Expected failure reason, got: ${botFinding.patch?.failed_reason}`);
  console.log("ok 10. Remediation patch correctly rejected by deterministic verification with exact failure reason");
  customHandler = null;
}

// 11. Duplicate agent findings deduplication
{
  const text11 = "The platform delivers revolutionary performance metrics.";
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: aId(text11, "delivers revolutionary performance metrics", "unsupported"), verdict: "keep" }],
      });
    }
    return mockJson({
      findings: [
        { quote: "delivers revolutionary performance metrics", category: "Unsupported", explanation: "Duplicated finding 1", confidence: 0.8 },
        { quote: "revolutionary performance metrics", category: "Unsupported", explanation: "Duplicated finding 2", confidence: 0.8 },
      ],
      contests: [],
      fixes: [],
    });
  };

  const res11 = await runAgenticReview({
    text: text11,
    canon: { version: "1", rules: [], facts: [] },
    offline: [],
    ambiguous: [{ start: 0, end: text11.length }],
    runOffline: () => [],
  });

  assert.equal(res11.findings.length, 1, "Duplicate findings on same span deduplicated to 1");
  const guardStep = res11.trace.find((t) => t.agent === "guards" && t.kind === "guard")!;
  assert.ok(guardStep.detail.includes("1 dropped as duplicates"), `Expected duplicate drop in detail: ${guardStep.detail}`);
  assert.equal(guardStep.guard_status, "deduplicated");
  console.log("ok 11. Duplicate agent findings cleanly deduplicated by guards");
  customHandler = null;
}

// 12. Successful agent finding accepted by guards
{
  const text12 = "ProofGate Pro costs $15 per month for teams.";
  const canon12: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-PRICE-100", text: "ProofGate Pro costs $29 per month." }],
  };
  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [{ finding_id: aId(text12, "$15 per month", "contradicted"), verdict: "keep", reason: "Direct contradiction with F-PRICE-100." }],
        consensus_summary: "Confirmed price contradiction.",
      });
    }
    return mockJson({
      findings: [
        {
          quote: "$15 per month",
          category: "Contradicted",
          explanation: "Price contradicts official pricing fact F-PRICE-100.",
          citations: [{ type: "fact", id: "fact:F-PRICE-100" }], // citation with prefix
          confidence: 0.94,
          replacement: "$29 per month",
        },
      ],
      contests: [],
      fixes: [],
    });
  };

  const res12 = await runAgenticReview({
    text: text12,
    canon: canon12,
    offline: [],
    ambiguous: [{ start: 0, end: text12.length }],
    runOffline: (t) => (t.includes("$15") ? [{ id: "p1", start: 0, end: 1, quote: "", category: "Contradicted", grade: "A", source: "offline", explanation: "", citations: [] }] : []),
  });

  assert.equal(res12.findings.length, 1);
  const f12 = res12.findings[0];
  assert.equal(f12.category, "Contradicted");
  assert.equal(f12.grade, "B");
  assert.equal(f12.citations[0].id, "F-PRICE-100"); // normalized by guards!
  assert.ok(f12.patch?.verified, "Verified patch generated and accepted");
  assert.equal(f12.patch?.status, "verified");
  console.log("ok 12. Successful agent finding with prefixed citation accepted by guards & verified");
  customHandler = null;
}

// 13. Reproduction trace: Specialist enrichment, Critic explanations & Second guard suppression lifecycle
{
  const text13 = "Our enterprise cloud platform guarantees 100% SLA uptime, provides instantaneous database failover, processes unlimited queries, and complies with all global privacy laws without audits.";
  const canon13: Canon = {
    version: "1",
    rules: [
      { id: "R-LEGAL-01", category: "Legal", text: "Do not claim compliance with all global privacy laws without qualification or audit verification." },
    ],
    facts: [],
  };

  // 4 offline candidate findings (3 Grade C tone/heuristic findings + 1 Grade B legal finding)
  const offline13: Finding[] = [
    {
      id: "off_sla",
      start: text13.indexOf("guarantees 100% SLA uptime"),
      end: text13.indexOf("guarantees 100% SLA uptime") + "guarantees 100% SLA uptime".length,
      quote: "guarantees 100% SLA uptime",
      category: "Tone",
      grade: "C",
      source: "offline",
      explanation: "Absolute guarantee tone check",
      citations: [],
    },
    {
      id: "off_failover",
      start: text13.indexOf("provides instantaneous database failover"),
      end: text13.indexOf("provides instantaneous database failover") + "provides instantaneous database failover".length,
      quote: "provides instantaneous database failover",
      category: "Tone",
      grade: "C",
      source: "offline",
      explanation: "Instantaneous claim heuristic",
      citations: [],
    },
    {
      id: "off_queries",
      start: text13.indexOf("processes unlimited queries"),
      end: text13.indexOf("processes unlimited queries") + "processes unlimited queries".length,
      quote: "processes unlimited queries",
      category: "Tone",
      grade: "C",
      source: "offline",
      explanation: "Unlimited claim heuristic",
      citations: [],
    },
    {
      id: "off_privacy",
      start: text13.indexOf("complies with all global privacy laws without audits"),
      end: text13.indexOf("complies with all global privacy laws without audits") + "complies with all global privacy laws without audits".length,
      quote: "complies with all global privacy laws without audits",
      category: "Legal",
      grade: "B",
      source: "offline",
      explanation: "Potential unverified legal compliance claim",
      citations: [{ type: "rule", id: "R-LEGAL-01" }],
    },
  ];

  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      // Critic returns 4 verdicts: dismiss, dismiss, dismiss, keep with explicit explanations
      return mockJson({
        verdicts: [
          { finding_id: "off_sla", verdict: "dismiss", reason: "SLA uptime guarantee is defined in enterprise MSA and acceptable in B2B tier context." },
          { finding_id: "off_failover", verdict: "dismiss", reason: "Failover phrasing is industry-standard technical marketing for distributed raft consensus." },
          { finding_id: "off_queries", verdict: "dismiss", reason: "Fair use policy limits prevent predatory claims; dismissed as benign marketing puffery." },
          { finding_id: "off_privacy", verdict: "keep", reason: "Unqualified global privacy compliance violates statutory truthfulness and requires formal legal sign-off." },
        ],
        consensus_summary: "Critic dismissed 3 heuristic tone findings and confirmed 1 high-risk legal finding.",
      });
    }

    // Specialists return 4 findings and 4 contests
    return mockJson({
      findings: [
        {
          quote: "guarantees 100% SLA uptime",
          category: "Tone",
          explanation: "Overpromise on uptime",
          confidence: 0.65,
          citations: [],
        },
        {
          quote: "provides instantaneous database failover",
          category: "Tone",
          explanation: "Unrealistic latency promise",
          confidence: 0.60,
          citations: [],
        },
        {
          quote: "processes unlimited queries",
          category: "Tone",
          explanation: "Theoretical ceiling exists",
          confidence: 0.62,
          citations: [],
        },
        {
          quote: "complies with all global privacy laws without audits",
          category: "Legal",
          explanation: "Substantive GDPR/CCPA statutory liability risk without third-party compliance certification.",
          confidence: 0.95,
          citations: [{ type: "rule", id: "R-LEGAL-01" }],
          requires_human_review: true,
          legal_interpretation: "Extending blanket GDPR/HIPAA compliance guarantees without audited controls creates strict liability.",
        },
      ],
      contests: [
        { finding_id: "off_sla", stance: "dismiss", reason: "Standard enterprise SLA terminology." },
        { finding_id: "off_failover", stance: "dismiss", reason: "Standard marketing term." },
        { finding_id: "off_queries", stance: "dismiss", reason: "Puffery allowed under commercial terms." },
        { finding_id: "off_privacy", stance: "keep", reason: "Critical regulatory exposure." },
      ],
      fixes: [],
    });
  };

  const res13 = await runAgenticReview({
    text: text13,
    canon: canon13,
    offline: offline13,
    ambiguous: [{ start: 0, end: text13.length }],
    runOffline: () => [],
  });

  // Verify:
  // 1. First guard refined/enriched rather than falsely dropping as duplicates
  const firstGuardTrace = res13.trace.find((t) => t.agent === "guards" && t.kind === "guard");
  assert.ok(firstGuardTrace, "First guard trace recorded");
  assert.ok(
    firstGuardTrace.detail.includes("refined") || firstGuardTrace.detail.includes("enriched"),
    `Expected enriched/refined in first guard trace detail, got: ${firstGuardTrace.detail}`
  );
  assert.ok(
    !firstGuardTrace.detail.includes("4 dropped as duplicates"),
    "First guard does not falsely report all specialist findings as dropped duplicates"
  );

  // 2. Critic issued 4 verdicts
  const criticTrace = res13.trace.find((t) => t.agent === "critic" && t.kind === "llm");
  assert.ok(criticTrace, "Critic trace recorded");
  assert.ok(criticTrace.detail.includes("4 verdict(s)"), `Expected 4 verdicts in critic detail, got: ${criticTrace.detail}`);

  // 3. Second guard applied 4 judgements: 3 suppressed, 1 kept
  assert.equal(res13.findings.length, 1, "Exactly 1 finding kept");
  assert.equal(res13.suppressed.length, 3, "Exactly 3 findings suppressed");
  assert.equal(res13.governance.summary.suppressed, 3, "Governance summary tracks 3 suppressed");
  assert.equal(res13.governance.suppressed_details?.length, 3, "Governance report contains 3 suppressed details");

  // 4. Critic and second guard explanations are preserved for all suppressed findings
  for (const sup of res13.governance.suppressed_details!) {
    assert.equal(sup.critic_verdict, "dismiss", "Critic verdict is dismiss");
    assert.ok(sup.critic_explanation && sup.critic_explanation.length > 10, "Critic explanation preserved");
    assert.ok(sup.second_guard_explanation && sup.second_guard_explanation.length > 10, "Second guard explanation preserved");
  }

  // 5. The kept finding preserves specialist intelligence (enrichment, confidence, legal interpretation)
  const keptFinding = res13.findings[0];
  assert.equal(keptFinding.id, "off_privacy");
  assert.equal(keptFinding.grade, "B");
  assert.equal(keptFinding.requires_human_review, true, "Requires human review preserved");
  assert.ok(keptFinding.enrichments && keptFinding.enrichments.length > 0, "Specialist enrichments attached");
  const legalEnrichment = keptFinding.enrichments.find((e) => e.category === "Legal");
  assert.ok(legalEnrichment, "Legal enrichment present");
  assert.equal(legalEnrichment.confidence, 0.95, "Confidence preserved");
  assert.ok(legalEnrichment.legal_interpretation?.includes("GDPR/HIPAA"), "Legal interpretation preserved");

  // 6. Complete lifecycle is tracked
  assert.ok(keptFinding.lifecycle, "Lifecycle is tracked");
  assert.equal(keptFinding.lifecycle?.first_guard?.action, "refined", "First guard lifecycle tracked");
  assert.equal(keptFinding.lifecycle?.critic?.verdict, "keep", "Critic lifecycle tracked");
  assert.equal(keptFinding.lifecycle?.second_guard?.action, "accepted", "Second guard lifecycle tracked");

  console.log("ok 13. Reproduction trace: 4 specialist findings, 4 contests, 3 critic-suppressed with explanations, 1 enriched legal finding kept with full lifecycle");
  customHandler = null;
}

// 14. Deterministic Grade A rule violation immutability: Critic cannot dismiss Grade A rule
{
  const text14 = "Our system operates with 100% guarantee of zero downtime.";
  const canon14: Canon = {
    version: "1",
    rules: [{ id: "R-DOWNTIME", category: "Tone", text: "Do not claim zero downtime." }],
    facts: [],
  };

  const offline14: Finding[] = [
    {
      id: "off_downtime_a",
      start: text14.indexOf("zero downtime"),
      end: text14.indexOf("zero downtime") + "zero downtime".length,
      quote: "zero downtime",
      category: "Tone",
      grade: "A", // Immutable deterministic rule violation
      source: "rule",
      explanation: "Deterministic banned phrase",
      citations: [{ type: "rule", id: "R-DOWNTIME" }],
    },
  ];

  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      // Critic attempts to dismiss the deterministic Grade A finding
      return mockJson({
        verdicts: [{ finding_id: "off_downtime_a", verdict: "dismiss", reason: "Model claims phrase is fine." }],
        consensus_summary: "Critic mistakenly attempted to dismiss Grade A rule violation.",
      });
    }
    return mockJson({
      findings: [
        {
          quote: "zero downtime",
          category: "Legal",
          explanation: "Legal review notes high customer SLA breach risk.",
          citations: [{ type: "rule", id: "R-DOWNTIME" }],
          confidence: 0.9,
          requires_human_review: true,
          legal_interpretation: "Zero downtime warranties trigger consequential damages under standard commercial terms.",
        },
      ],
      contests: [{ finding_id: "off_downtime_a", stance: "dismiss", reason: "AI thinks it is harmless" }],
      fixes: [],
    });
  };

  const res14 = await runAgenticReview({
    text: text14,
    canon: canon14,
    offline: offline14,
    ambiguous: [{ start: 0, end: text14.length }],
    runOffline: () => [],
  });

  // Verify:
  // 1. Finding is KEPT because Grade A is immutable
  assert.equal(res14.findings.length, 1);
  const f14 = res14.findings[0];
  assert.equal(f14.grade, "A", "Grade A is strictly preserved");
  assert.equal(f14.requires_human_review, true, "Human sign-off required");

  // 2. Second guard overruled the critic dismissal
  assert.equal(f14.lifecycle?.second_guard?.action, "overruled", "Second guard overruled critic dismissal");
  assert.ok(f14.lifecycle?.second_guard?.detail.includes("immutable"), "Second guard recorded immutability invariant");

  // 3. Specialist legal intelligence is preserved on the Grade A finding via enrichments
  assert.ok(f14.enrichments && f14.enrichments.length > 0, "Specialist enrichment preserved on Grade A finding");
  assert.equal(f14.enrichments[0].category, "Legal");
  assert.ok(f14.enrichments[0].legal_interpretation?.includes("consequential damages"));

  // 4. Trace records overruling
  const secondGuardStep = res14.trace.filter((t) => t.agent === "guards" && t.kind === "guard")[1];
  assert.ok(secondGuardStep.detail.includes("1 overruled"), `Expected 1 overruled in trace detail: ${secondGuardStep.detail}`);

  console.log("ok 14. Deterministic Grade A rule violation strictly immutable: Second guard overruled critic dismissal and preserved specialist enrichment");
  customHandler = null;
}

// 15. Same product, matching Canon fact
{
  const text15 = "ProofGate Pro costs $29 per user per month for enterprise teams.";
  const canon15: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-PRICE-PRO", text: "ProofGate Pro costs $29 per user per month." }],
  };

  customHandler = async () => {
    return mockJson({
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "fact",
          verdict: "supported",
          confidence: 0.95,
          evidence: [{ type: "fact", id: "F-PRICE-PRO" }],
          reasoning_summary: "Price stated matches Canon fact F-PRICE-PRO for ProofGate Pro.",
          recommended_action: "dismiss",
          requires_human_review: false,
          quote: "ProofGate Pro costs $29 per user per month",
        },
      ],
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res15 = await runAgenticReview({
    text: text15,
    canon: canon15,
    offline: [],
    ambiguous: [{ start: 0, end: text15.length }],
    runOffline: () => [],
  });

  assert.equal(res15.findings.length, 0, "0 findings for compliant claim matching Canon fact");
  assert.equal(res15.governance.summary.findings, 0);
  console.log("ok 15. Same product matching Canon fact verified compliant with 0 findings");
  customHandler = null;
}

// 16. Same product, unsupported claim
{
  const text16 = "ProofGate Pro provides 99.9999% uptime and daily automated backups.";
  const canon16: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-PRICE-PRO", text: "ProofGate Pro costs $29 per user per month." }],
  };

  const offline16: Finding[] = [
    {
      id: "off_uptime",
      start: text16.indexOf("99.9999% uptime"),
      end: text16.indexOf("99.9999% uptime") + "99.9999% uptime".length,
      quote: "99.9999% uptime",
      category: "Unsupported",
      grade: "B",
      source: "offline",
      explanation: "No approved Canon fact validates 99.9999% uptime for ProofGate Pro.",
      citations: [],
    },
    {
      id: "off_backups",
      start: text16.indexOf("daily automated backups"),
      end: text16.indexOf("daily automated backups") + "daily automated backups".length,
      quote: "daily automated backups",
      category: "Unsupported",
      grade: "B",
      source: "offline",
      explanation: "No approved Canon fact validates daily automated backups for ProofGate Pro.",
      citations: [],
    },
  ];

  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [
          { finding_id: "off_uptime", verdict: "keep", reason: "Uptime guarantee is unsubstantiated by Canon." },
          { finding_id: "off_backups", verdict: "keep", reason: "Backup cadence is unsubstantiated by Canon." },
        ],
        consensus_summary: "Confirmed unsupported claims on ProofGate Pro.",
      });
    }
    return mockJson({
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res16 = await runAgenticReview({
    text: text16,
    canon: canon16,
    offline: offline16,
    ambiguous: [{ start: 0, end: text16.length }],
    runOffline: () => [],
  });

  assert.equal(res16.findings.length, 2, "Both unsupported claims are preserved");
  assert.ok(res16.findings.every((f) => f.category === "Unsupported" && f.grade === "B"));
  console.log("ok 16. Same product unsupported claims correctly preserved as Unsupported findings");
  customHandler = null;
}

// 17. Different product, unrelated Canon fact (evidence not transferred, unsupported claim not dismissed)
{
  const text17 = "ProofGate costs $15 per month for starter teams.";
  const canon17: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-PRICE-PRO", text: "ProofGate Pro costs $29 per user per month." }],
  };

  const offline17: Finding[] = [
    {
      id: "off_price_diff",
      start: text17.indexOf("$15 per month"),
      end: text17.indexOf("$15 per month") + "$15 per month".length,
      quote: "$15 per month",
      category: "Unsupported",
      grade: "B",
      source: "offline",
      explanation: "Price claim for ProofGate is not substantiated in Brand Canon.",
      citations: [{ type: "fact", id: "F-PRICE-PRO" }],
    },
  ];

  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [
          {
            finding_id: "off_price_diff",
            verdict: "dismiss",
            reason: "Canon fact F-PRICE-PRO refers to ProofGate Pro, whereas copy mentions ProofGate (different product).",
          },
        ],
        consensus_summary: "Critic mistakenly attempted to dismiss unsupported claim due to entity mismatch.",
      });
    }
    return mockJson({
      findings: [],
      contests: [{ finding_id: "off_price_diff", stance: "dismiss", reason: "Entity mismatch with Canon fact." }],
      fixes: [],
    });
  };

  const res17 = await runAgenticReview({
    text: text17,
    canon: canon17,
    offline: offline17,
    ambiguous: [{ start: 0, end: text17.length }],
    runOffline: () => [],
  });

  assert.equal(res17.findings.length, 1, "Finding is preserved as Unsupported");
  const f17 = res17.findings[0];
  assert.equal(f17.category, "Unsupported");
  assert.equal(f17.grade, "B");
  assert.equal(f17.requires_human_review, true);
  assert.ok(f17.lifecycle?.second_guard?.action === "overruled" || f17.lifecycle?.critic?.verdict !== "dismiss");
  console.log("ok 17. Different product entity mismatch prevented from converting unsupported claim into compliant");
  customHandler = null;
}

// 18. Product alias with an explicitly approved relationship
{
  const text18 = "ProofGate Cloud includes AES-256 encryption at rest.";
  const canon18: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-ENC", text: "ProofGate Cloud Storage includes AES-256 encryption at rest." }],
    entities: [
      {
        name: "ProofGate Cloud Storage",
        aliases: ["ProofGate Cloud"],
      },
    ],
    relationships: [
      {
        source: "ProofGate Cloud",
        target: "ProofGate Cloud Storage",
        type: "alias",
      },
    ],
  };

  customHandler = async () => {
    return mockJson({
      evaluations: [
        {
          claim_id: "c_1",
          agent_name: "fact",
          verdict: "supported",
          confidence: 0.94,
          evidence: [{ type: "fact", id: "F-ENC" }],
          reasoning_summary: "ProofGate Cloud is an approved alias for ProofGate Cloud Storage; fact F-ENC confirms AES-256 encryption.",
          recommended_action: "dismiss",
          requires_human_review: false,
          quote: "ProofGate Cloud includes AES-256 encryption at rest",
        },
      ],
      findings: [],
      contests: [],
      fixes: [],
    });
  };

  const res18 = await runAgenticReview({
    text: text18,
    canon: canon18,
    offline: [],
    ambiguous: [{ start: 0, end: text18.length }],
    runOffline: () => [],
  });

  assert.equal(res18.findings.length, 0, "Approved alias resolves cleanly to 0 findings");
  console.log("ok 18. Product alias with explicitly approved relationship verified successfully");
  customHandler = null;
}

// 19. Ambiguous product identity
{
  const text19 = "Our cloud platform guarantees instantaneous database failover and unlimited query throughput.";
  const canon19: Canon = {
    version: "1",
    rules: [],
    facts: [
      { id: "F-PRO-FAILOVER", text: "ProofGate Pro supports sub-second database failover." },
      { id: "F-STD-FAILOVER", text: "ProofGate Starter supports 5-minute automated failover." },
    ],
  };

  const offline19: Finding[] = [
    {
      id: "off_failover_ambig",
      start: text19.indexOf("instantaneous database failover"),
      end: text19.indexOf("instantaneous database failover") + "instantaneous database failover".length,
      quote: "instantaneous database failover",
      category: "Unsupported",
      grade: "C",
      source: "offline",
      explanation: "Failover claim for unspecified platform tier",
      citations: [],
    },
  ];

  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [
          {
            finding_id: "off_failover_ambig",
            verdict: "keep",
            reason: "Ambiguous entity identity ('our cloud platform') leaves tier undefined; requires human review.",
          },
        ],
        consensus_summary: "Confirmed ambiguous claim requiring human review.",
      });
    }
    return mockJson({
      findings: [
        {
          quote: "instantaneous database failover",
          category: "Unsupported",
          explanation: "Copy refers ambiguously to 'our cloud platform'; different tiers provide different SLA guarantees.",
          confidence: 0.85,
          requires_human_review: true,
          citations: [],
        },
      ],
      contests: [],
      fixes: [],
    });
  };

  const res19 = await runAgenticReview({
    text: text19,
    canon: canon19,
    offline: offline19,
    ambiguous: [{ start: 0, end: text19.length }],
    runOffline: () => [],
  });

  assert.equal(res19.findings.length, 1, "Ambiguous claim preserved");
  const f19 = res19.findings[0];
  assert.equal(f19.requires_human_review, true, "Ambiguous entity escalated for human review");
  console.log("ok 19. Ambiguous product identity preserves uncertainty and escalates for human review");
  customHandler = null;
}

// 20. Stale cache after pipeline version changes
{
  const text20 = "ProofGate Pro costs $29 per user per month.";
  const canon20: Canon = {
    version: "1",
    rules: [],
    facts: [{ id: "F-PRICE", text: "ProofGate Pro costs $29 per user per month." }],
  };

  let mockCalls = 0;
  customHandler = async () => {
    mockCalls++;
    return mockJson({ evaluations: [], findings: [], contests: [], fixes: [] });
  };

  // Seed cache with a stale entry generated under an older pipeline version
  const stalePayload = {
    findings: [],
    suppressed: [],
    status: "agentic" as const,
    ai_unavailable: false,
    warnings: [],
    calls_used: 1,
    cache_hit: false,
    plan: { engage: true, reason: "test", groups: [["fact"]], critic: false, loop: false, focus: [] },
    trace: [],
    governance: {
      summary: { agents_involved: 1, findings: 0, needs_human_review: 0, suppressed: 0, unverifiable: 0 },
      human_review_required: false,
      agents: [],
      findings: [],
      disagreements: [],
    },
    pipeline_version: "verity-pipeline-1.0.0", // STALE OLD PIPELINE VERSION!
    config_version: "verity-agents-1.0.0",
    schema_version: "agents-schema-1.0.0",
    canon_digest: "stale_digest_123",
  };

  const staleCache: CacheAdapter = {
    get: async () => stalePayload as any,
    set: async () => {},
  };

  const res20 = await runAgenticReview({
    text: text20,
    canon: canon20,
    offline: [],
    ambiguous: [{ start: 0, end: text20.length }],
    runOffline: () => [],
    cache: staleCache,
  });

  // Must NOT have used stale cache!
  assert.equal(res20.cache_hit, false, "Stale cache was not accepted");
  assert.ok(mockCalls > 0, "Live evaluation ran because stale cache was invalidated");
  assert.ok(
    res20.trace.some((t) => t.agent === "cache" && t.detail.includes("stale cache entry invalidated")),
    "Trace records stale cache invalidation",
  );
  console.log("ok 20. Stale cache after pipeline version changes invalidated; live evaluation executed");
  customHandler = null;
}

// 21. Absolute security guarantee remains immutable against critic dismissal
{
  const text21 = "ProofGate provides absolute security and a 100% guarantee of zero data loss.";
  const canon21: Canon = {
    version: "1",
    rules: [{ id: "R-ABSOLUTE", category: "Legal", text: "No absolute security or zero risk guarantees." }],
    facts: [],
  };

  const offline21: Finding[] = [
    {
      id: "off_abs_sec",
      start: text21.indexOf("absolute security and a 100% guarantee of zero data loss"),
      end: text21.indexOf("absolute security and a 100% guarantee of zero data loss") + "absolute security and a 100% guarantee of zero data loss".length,
      quote: "absolute security and a 100% guarantee of zero data loss",
      category: "Legal",
      grade: "B",
      source: "offline",
      explanation: "Unqualified absolute security and zero data loss guarantee.",
      citations: [{ type: "rule", id: "R-ABSOLUTE" }],
    },
  ];

  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [
          {
            finding_id: "off_abs_sec",
            verdict: "dismiss",
            reason: "Critic considers absolute security to be standard marketing language.",
          },
        ],
        consensus_summary: "Critic mistakenly attempted to dismiss absolute guarantee.",
      });
    }
    return mockJson({
      findings: [],
      contests: [{ finding_id: "off_abs_sec", stance: "dismiss", reason: "AI claims phrase is standard." }],
      fixes: [],
    });
  };

  const res21 = await runAgenticReview({
    text: text21,
    canon: canon21,
    offline: offline21,
    ambiguous: [{ start: 0, end: text21.length }],
    runOffline: () => [],
  });

  assert.equal(res21.findings.length, 1, "Absolute security guarantee is preserved");
  const f21 = res21.findings[0];
  assert.equal(f21.grade, "B");
  assert.equal(f21.severity, "high");
  assert.equal(f21.requires_human_review, true, "Mandatory human legal review");
  assert.equal(f21.lifecycle?.second_guard?.action, "overruled", "Second guard overruled critic dismissal");
  assert.ok(
    f21.lifecycle?.second_guard?.detail.includes("absolute security") ||
    f21.lifecycle?.second_guard?.detail.includes("zero-data-loss"),
    "Second guard detail references absolute security protection",
  );
  console.log("ok 21. Absolute security and zero-data-loss guarantee strictly immutable against critic dismissal");
  customHandler = null;
}

// 22. Specialist model output JSON truncation repair & controlled retry
{
  // Test direct repair of truncated JSON (simulating cut-off at position 6888)
  const truncatedPayload =
    '{"evaluations": [{"claim_id": "c_1", "verdict": "contradicted"}], "findings": [{"quote": "test claim", "category": "Tone"}], "contests": [{"finding_id": "o1", "stance": "d';
  const repaired = repairTruncatedJson(truncatedPayload) as any;
  assert.ok(repaired, "repairTruncatedJson successfully repaired truncated JSON");
  assert.equal(Array.isArray(repaired.evaluations), true, "Evaluations recovered");
  assert.equal(repaired.evaluations.length, 1, "First evaluation preserved");
  assert.equal(repaired.findings.length, 1, "First finding preserved");

  // Test controlled retry when model returns malformed JSON on attempt 1, followed by clean output on attempt 2
  let calls = 0;
  customHandler = async () => {
    calls++;
    if (calls === 1) {
      // First attempt returns malformed/unparseable JSON that triggers retry
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "THIS IS NOT VALID JSON AT ALL {" }] } }],
        }),
        { status: 200 }
      );
    }
    // Second attempt (the controlled retry) returns valid JSON
    return mockJson({
      findings: [
        {
          quote: "Verification Bot",
          category: "Tone",
          explanation: "Disallowed bot term.",
          citations: [{ type: "rule", id: "R-TONE-001" }],
          confidence: 0.95,
        },
      ],
      contests: [],
      fixes: [],
    });
  };

  const text22 = "Meet our new Verification Bot.";
  const canon22: Canon = {
    version: "1",
    rules: [{ id: "R-TONE-001", category: "Tone", text: "Do not use Verification Bot." }],
    facts: [],
  };

  const res22 = await runAgenticReview({
    text: text22,
    canon: canon22,
    offline: [],
    ambiguous: [{ start: 0, end: text22.length }],
    runOffline: () => [],
  });

  assert.ok(calls >= 2, "Controlled retry was executed");
  assert.ok(res22.findings.length > 0, "Findings recovered via controlled retry");
  assert.equal(res22.findings[0].quote, "Verification Bot");
  console.log("ok 22. Specialist model output JSON repair & retry resiliently recover valid findings");
  customHandler = null;
}

// 23. NovaPay Comprehensive Regression Test: 7 claims, absolute guarantees, entity mismatch
{
  const text23 =
    "NovaPay is our digital payment platform designed for businesses. It processes transactions in under 0.2 seconds and guarantees 100% fraud prevention. Our AI-powered fraud detection system achieves 99.97% accuracy across all transactions. NovaPay reduces payment processing costs by 45% compared to traditional providers. We use AES-256 encryption and are certified under PCI DSS Level 1. Our platform guarantees 99.999% uptime and zero transaction failures. Businesses can start using NovaPay for just $9 per month, with no hidden charges or additional fees.";

  const canon23: Canon = {
    version: "1",
    rules: [
      { id: "R-ABS-001", category: "Legal", text: "No absolute security, 100% fraud prevention, or zero failure guarantees." },
      { id: "R-EVID-001", category: "Legal", text: "Performance, accuracy, cost-reduction, uptime, and certification claims must be substantiated by approved facts." },
    ],
    facts: [
      { id: "F-PRICE-001", text: "ProofGate Pro costs $29 per user per month." },
      { id: "F-SEC-001", text: "ProofGate uses AES-256 encryption." },
      { id: "F-UPTIME-001", text: "ProofGate provides 99.9% uptime." },
    ],
  };

  customHandler = async (_u, init) => {
    const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (sys.includes("independent critic")) {
      return mockJson({
        verdicts: [
          { finding_id: aId(text23, "$9 per month", "unsupported"), verdict: "dismiss", reason: "Canon refers to ProofGate Pro, so NovaPay pricing is dismissed." },
          { finding_id: aId(text23, "guarantees 100% fraud prevention", "legal"), verdict: "dismiss", reason: "Standard fintech marketing language." },
          { finding_id: aId(text23, "zero transaction failures", "legal"), verdict: "dismiss", reason: "Puffery about reliability." },
          { finding_id: aId(text23, "AES-256 encryption", "unsupported"), verdict: "dismiss", reason: "ProofGate uses AES-256 encryption in Canon." },
          { finding_id: aId(text23, "certified under PCI DSS Level 1", "unsupported"), verdict: "keep", reason: "No certification on file for NovaPay." },
          { finding_id: aId(text23, "achieves 99.97% accuracy across all transactions", "unsupported"), verdict: "keep", reason: "Unsupported statistical accuracy claim." },
          { finding_id: aId(text23, "reduces payment processing costs by 45%", "unsupported"), verdict: "keep", reason: "Unsupported comparative claim." },
          { finding_id: aId(text23, "guarantees 99.999% uptime", "unsupported"), verdict: "dismiss", reason: "ProofGate provides 99.9% uptime in Canon." },
        ],
        consensus_summary: "Critic reviewed NovaPay candidate findings.",
      });
    }

    return mockJson({
      findings: [
        { quote: "guarantees 100% fraud prevention", category: "Legal", explanation: "Absolute fraud guarantee is prohibited.", confidence: 0.95 },
        { quote: "zero transaction failures", category: "Legal", explanation: "Absolute zero-failure guarantee is prohibited.", confidence: 0.95 },
        { quote: "achieves 99.97% accuracy across all transactions", category: "Unsupported", explanation: "Unsubstantiated accuracy claim for NovaPay.", confidence: 0.85 },
        { quote: "reduces payment processing costs by 45%", category: "Unsupported", explanation: "Unsubstantiated comparative cost reduction claim.", confidence: 0.85 },
        { quote: "AES-256 encryption", category: "Unsupported", explanation: "Encryption claim not substantiated in Canon for NovaPay.", confidence: 0.85 },
        { quote: "certified under PCI DSS Level 1", category: "Unsupported", explanation: "PCI DSS Level 1 certification not substantiated in Canon for NovaPay.", confidence: 0.85 },
        { quote: "guarantees 99.999% uptime", category: "Unsupported", explanation: "SLA uptime claim not substantiated in Canon for NovaPay.", confidence: 0.85 },
        { quote: "$9 per month", category: "Unsupported", explanation: "Pricing not substantiated for NovaPay in Canon (F-PRICE-001 applies to ProofGate Pro).", confidence: 0.9 },
      ],
      contests: [],
      fixes: [],
    });
  };

  const res23 = await runAgenticReview({
    text: text23,
    canon: canon23,
    offline: [],
    ambiguous: [{ start: 0, end: text23.length }],
    runOffline: () => [],
  });

  // Verify all 7 required claims:
  // 1. "100% fraud prevention" (absolute guarantee: Grade B, High severity, requires legal review, non-dismissible)
  const fFraud = res23.findings.find(f => f.quote.includes("100% fraud prevention"));
  assert.ok(fFraud, "100% fraud prevention finding preserved");
  assert.equal(fFraud!.grade, "B");
  assert.equal(fFraud!.severity, "high");
  assert.equal(fFraud!.requires_human_review, true);
  assert.equal(fFraud!.lifecycle?.second_guard?.action, "overruled", "Second guard overruled critic dismissal of 100% fraud prevention");

  // 2. "zero transaction failures" (absolute guarantee: Grade B, High severity, requires legal review, non-dismissible)
  const fZeroFail = res23.findings.find(f => f.quote.includes("zero transaction failures"));
  assert.ok(fZeroFail, "zero transaction failures finding preserved");
  assert.equal(fZeroFail!.grade, "B");
  assert.equal(fZeroFail!.severity, "high");
  assert.equal(fZeroFail!.requires_human_review, true);
  assert.equal(fZeroFail!.lifecycle?.second_guard?.action, "overruled", "Second guard overruled critic dismissal of zero transaction failures");

  // 3. "achieves 99.97% accuracy" (unsupported, needs evidence)
  const fAcc = res23.findings.find(f => f.quote.includes("99.97% accuracy"));
  assert.ok(fAcc, "99.97% accuracy finding preserved as Unsupported");
  assert.equal(fAcc!.category, "Unsupported");

  // 4. "reduces payment processing costs by 45%" (unsupported comparative claim)
  const fCost = res23.findings.find(f => f.quote.includes("costs by 45%"));
  assert.ok(fCost, "45% cost reduction finding preserved as Unsupported");
  assert.equal(fCost!.category, "Unsupported");

  // 5. "certified under PCI DSS Level 1" (unsupported certification claim)
  const fPci = res23.findings.find(f => f.quote.includes("PCI DSS Level 1"));
  assert.ok(fPci, "PCI DSS Level 1 finding preserved as Unsupported");
  assert.equal(fPci!.category, "Unsupported");

  // 6. "guarantees 99.999% uptime" (unsupported SLA uptime claim)
  const fUptime = res23.findings.find(f => f.quote.includes("99.999% uptime"));
  assert.ok(fUptime, "99.999% uptime finding preserved as Unsupported");

  // 7. "$9 per month" (conflict with F-PRICE-001 $29; entity mismatch prevents dismissal!)
  const fPrice = res23.findings.find(f => f.quote.includes("$9 per month"));
  assert.ok(fPrice, "$9 per month finding preserved as Unsupported due to entity mismatch");
  assert.equal(fPrice!.category, "Unsupported");
  assert.equal(fPrice!.requires_human_review, true);
  assert.equal(fPrice!.lifecycle?.second_guard?.action, "overruled", "Second guard overruled critic dismissal based on entity mismatch");

  console.log("ok 23. NovaPay regression test: all 7 claims verified, entity mismatch prevents evidence transfer, absolute guarantees immutable");
  customHandler = null;
}

// 24. Multi-provider fallback: Gemini 429 fails over to OpenRouter seamlessly
{
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_MODEL = "test-model";
  const { resetQuotaCircuit, resetProvidersUsed, getLastProviderUsed } = await import("../lib/agents/llm");
  resetQuotaCircuit();
  resetProvidersUsed();

  let geminiCalls = 0;
  let openRouterCalls = 0;

  customHandler = async (url: unknown, init: { body: string }) => {
    const urlStr = String(url);
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      geminiCalls++;
      return new Response(JSON.stringify({ error: { message: "Quota exceeded 429" } }), { status: 429 });
    }
    if (urlStr.includes("openrouter.ai")) {
      openRouterCalls++;
      const body = JSON.parse(init.body);
      const isCritic = body.messages?.[0]?.content?.includes("independent critic");
      if (isCritic) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                status: "consensus_reached",
                verdicts: [],
                summary: "OpenRouter critic reached consensus",
              }),
            },
          }],
        }), { status: 200 });
      } else {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                evaluations: [{
                  claim_id: "claim_1",
                  agent_name: "fact",
                  verdict: "unsupported",
                  confidence: 0.95,
                  evidence: [],
                  reasoning_summary: "OpenRouter verified claim is unsupported",
                  recommended_action: "flag",
                  requires_human_review: true,
                }],
                contests: [],
                fixes: [],
              }),
            },
          }],
        }), { status: 200 });
      }
    }
    return new Response("Not found", { status: 404 });
  };

  const res24 = await runAgenticReview({
    ...base,
    text: "Our new database achieves 100% quantum compression without loss.",
    ambiguous: [{ start: 0, end: 60 }],
  });

  assert.ok(geminiCalls > 0, "Gemini was attempted first");
  assert.ok(openRouterCalls > 0, "OpenRouter was called as fallback after Gemini 429");
  assert.equal(res24.status, "agentic", "Review status is agentic, not degraded to offline");
  assert.equal(res24.ai_unavailable, false, "AI is available via OpenRouter fallback");
  console.log("ok 24. Multi-provider fallback: Gemini 429 fails over to OpenRouter, maintaining full specialist reasoning");

  // Cleanup
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  customHandler = null;
  resetQuotaCircuit();
  resetProvidersUsed();
}

// 25. Multi-provider fallback: Gemini 500 & OpenRouter 500 fail over to Cloudflare AI
{
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_MODEL = "test-model";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-cf-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-cf-token";
  const { resetQuotaCircuit, resetProvidersUsed, getProvidersUsed } = await import("../lib/agents/llm");
  resetQuotaCircuit();
  resetProvidersUsed();

  let geminiCalls = 0;
  let openRouterCalls = 0;
  let cloudflareCalls = 0;

  customHandler = async (url: unknown, _init: { body: string }) => {
    const urlStr = String(url);
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      geminiCalls++;
      return new Response(JSON.stringify({ error: { message: "Gemini 500 Internal Error" } }), { status: 500 });
    }
    if (urlStr.includes("openrouter.ai")) {
      openRouterCalls++;
      return new Response(JSON.stringify({ error: { message: "OpenRouter 502 Bad Gateway" } }), { status: 502 });
    }
    if (urlStr.includes("api.cloudflare.com")) {
      cloudflareCalls++;
      return new Response(JSON.stringify({
        result: {
          response: JSON.stringify({
            status: "consensus_reached",
            verdicts: [],
            summary: "Cloudflare critic consensus reached",
          })
        }
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const res25 = await runAgenticReview({
    ...base,
    text: "Verification Bot runs on Cloudflare edge.",
    ambiguous: [{ start: 0, end: 40 }],
  });

  assert.ok(geminiCalls > 0, "Gemini attempted first");
  assert.ok(openRouterCalls > 0, "OpenRouter attempted second");
  assert.ok(cloudflareCalls > 0, "Cloudflare called and succeeded as final fallback");
  assert.equal(res25.status, "agentic", "Status remained agentic through Cloudflare");
  assert.ok(res25.providers_used?.includes("cloudflare"), "Trace recorded cloudflare in providers_used");
  console.log("ok 25. Multi-provider fallback: Gemini 500 & OpenRouter 502 fail over to Cloudflare AI successfully");

  // Cleanup
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  customHandler = null;
  resetQuotaCircuit();
  resetProvidersUsed();
}

// 26. All providers unavailable -> clearly disclosed degraded/offline result with ai_unavailable=true
{
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_MODEL = "test-model";
  const { resetQuotaCircuit, resetProvidersUsed } = await import("../lib/agents/llm");
  resetQuotaCircuit();
  resetProvidersUsed();

  customHandler = async (url: unknown, _init: { body: string }) => {
    const urlStr = String(url);
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({ error: { message: "Gemini 503 Service Unavailable" } }), { status: 503 });
    }
    if (urlStr.includes("openrouter.ai")) {
      return new Response(JSON.stringify({ error: { message: "OpenRouter 503 Service Unavailable" } }), { status: 503 });
    }
    return new Response("Not found", { status: 404 });
  };

  const res26 = await runAgenticReview({
    ...base,
    text: "Our platform guarantees 100% uptime with zero latency.",
    ambiguous: [{ start: 0, end: 55 }],
  });

  assert.equal(res26.status, "degraded", "Status degraded gracefully when all providers fail");
  assert.equal(res26.ai_unavailable, true, "AI unavailable flag set accurately");
  assert.ok(res26.findings.length > 0, "Offline rule-based findings preserved safely");
  assert.ok(res26.findings.every(f => f.notes?.some(n => n.includes("offline")) || f.source === "offline"), "Findings labeled as offline");
  console.log("ok 26. Complete provider outage: Gracefully degrades to labeled offline findings with ai_unavailable=true");

  // Cleanup
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  customHandler = null;
  resetQuotaCircuit();
  resetProvidersUsed();
}

console.log("\n--- All 26 Verity Agentic Verification Tests PASSED! ---");
