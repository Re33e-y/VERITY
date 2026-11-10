// lib/agents/pipeline.ts
// runAgenticReview(): orchestrator -> specialists (parallel or packed) -> critic -> self-correction
// -> remediation -> findings -> governance report. Deterministic code first, models only on what's
// uncertain, and any failure degrades to the offline findings you already have.

import { createHash } from "node:crypto";
import { CallBudget, LlmError, getMaxCalls, getPolicy, isQuotaOpen } from "./llm";
import { makePlan, kindOf } from "./orchestrator";
import { runGroup, type Contest, type Fix, type PanelResult } from "./specialists";
import { pickCandidates, runCritic, type Verdict } from "./critic";
import { remediate, type Proposal } from "./remediation";
import { addNote, applyJudgements, mergeAgentFindings, type Judgement } from "./guards";
import { CONFIG_VERSION, buildDisagreements, buildGovernance } from "./governance";
import type {
  AgenticResult, CacheAdapter, Canon, Disagreement, Finding, OfflineFn, Span, Suppressed, TraceStep,
} from "./types";

export interface PipelineInput {
  text: string;
  canon: Canon;
  /** Findings from your offline engine, already mapped to the agent Finding shape. */
  offline: Finding[];
  /** Spans your router marked ambiguous (what it would have sent to the judge). */
  ambiguous: Span[];
  /** Re-runs your offline engine on arbitrary text; used to verify patches. */
  runOffline: OfflineFn;
  cache?: CacheAdapter;
}

function normalizeIds(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.map((f, i) => {
    let id = f.id || `o_${f.start}_${f.end}`;
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    return { ...f, id };
  });
}

const strip = ({ draftFix: _drop, ...rest }: Finding): Finding => rest;

export async function runAgenticReview(input: PipelineInput): Promise<AgenticResult> {
  const t0 = Date.now();
  const { text, canon, runOffline } = input;
  const policy = getPolicy();
  const maxCalls = getMaxCalls(policy);
  const trace: TraceStep[] = [];
  const warnings: string[] = [];
  const step = (agent: string, kind: TraceStep["kind"], ok: boolean, detail: string, calls = 0, since = t0) =>
    trace.push({ agent, kind, ok, calls, ms: Date.now() - since, detail });

  const offline = normalizeIds(input.offline);
  const plan = makePlan({ text, offline, ambiguous: input.ambiguous, policy, maxCalls });
  step("orchestrator", "plan", true, plan.reason);

  // Whole-review key (text + canon version + config). Doubles as the idempotency key in the governance report.
  // A fact can expire overnight and flip a verdict, so the day is part of the key, and the offline findings
  // themselves (not just their count) are fingerprinted.
  const offlineSig = offline
    .map((f) => [f.start, f.end, f.grade, f.category, f.citations.map((c) => c.id).join("+")].join(":"))
    .join("|");
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify([
        CONFIG_VERSION, policy, maxCalls, process.env.GEMINI_MODEL ?? "", canon.version,
        new Date().toISOString().slice(0, 10), offlineSig, text,
      ]),
    )
    .digest("hex");

  /** Every result leaves through here so it always carries the governance report. */
  const seal = (r: Omit<AgenticResult, "governance">, disagreements: Disagreement[] = []): AgenticResult => ({
    ...r,
    governance: buildGovernance({
      findings: r.findings,
      suppressed: r.suppressed,
      trace: r.trace,
      disagreements,
      idempotencyKey: cacheKey,
    }),
  });

  const base = { suppressed: [] as Suppressed[], warnings, plan, trace };
  if (!plan.engage) {
    return seal({ ...base, findings: offline, status: "skipped", ai_unavailable: false, calls_used: 0, cache_hit: false });
  }
  if (isQuotaOpen()) {
    warnings.push("Gemini quota circuit is open; using offline findings.");
    step("orchestrator", "skip", false, "quota circuit open");
    return seal({ ...base, findings: offline, status: "degraded", ai_unavailable: true, calls_used: 0, cache_hit: false });
  }

  // ---- cache ----
  if (input.cache) {
    try {
      const hit = await input.cache.get(cacheKey);
      if (hit) {
        step("cache", "cache", true, "served identical review from cache; 0 calls");
        return {
          ...hit,
          cache_hit: true,
          calls_used: 0,
          trace: [...trace],
          governance: buildGovernance({
            findings: hit.findings,
            suppressed: hit.suppressed,
            trace,
            disagreements: hit.governance?.disagreements ?? [],
            idempotencyKey: cacheKey,
          }),
        };
      }
    } catch {
      /* cache is best-effort */
    }
  }

  const budget = new CallBudget(maxCalls);
  const deadlineAt = t0 + (Number(process.env.AGENT_DEADLINE_MS) || 25_000);
  const suppressed: Suppressed[] = [];
  let working: Finding[] = offline.map((f) => ({ ...f }));

  // ---- 1. specialist panel ----
  const ctxBase = { text, canon, offline, focus: plan.focus, budget, deadlineAt };
  const tPanel = Date.now();
  const settled = await Promise.allSettled(plan.groups.map((g) => runGroup(g, ctxBase)));
  const contests: Contest[] = [];
  const fixes: Fix[] = [];
  const agentFindings: Finding[] = [];
  let panelOk = 0;
  settled.forEach((r, i) => {
    const label = `specialist:${plan.groups[i].join("+")}`;
    if (r.status === "fulfilled") {
      const v: PanelResult = r.value;
      panelOk++;
      agentFindings.push(...v.findings);
      contests.push(...v.contests);
      fixes.push(...v.fixes);
      step(label, "llm", true, `${v.findings.length} finding(s), ${v.contests.length} contest(s), ${v.rejected.length} rejected by guards`, 1, tPanel);
    } else {
      const err = r.reason as Error;
      warnings.push(`${label}: ${err.message}`);
      step(label, "llm", false, err.message, err instanceof LlmError && err.kind === "disabled" ? 0 : 1, tPanel);
    }
  });

  if (panelOk === 0) {
    step("pipeline", "skip", false, "no specialist call succeeded; falling back to offline findings");
    return seal({ ...base, findings: offline, status: "degraded", ai_unavailable: true, calls_used: budget.used, cache_hit: false });
  }

  const merged = mergeAgentFindings(working, agentFindings);
  working = merged.merged;
  step("guards", "guard", true, `${agentFindings.length - merged.dropped.length} agent finding(s) kept, ${merged.dropped.length} dropped as duplicates/over cap`);

  // ---- 2. critic (reflection & judge) ----
  let verdicts: Verdict[] = [];
  let criticRan = false;
  if (plan.critic && budget.left >= 1) {
    const candidates = pickCandidates(working, contests, plan.focus);
    if (candidates.length) {
      const tCritic = Date.now();
      try {
        verdicts = await runCritic({ text, canon, candidates, contests, focus: plan.focus, budget, deadlineAt });
        criticRan = true;
        step("critic", "llm", true, `${verdicts.length} verdict(s): ${verdicts.map((v) => v.verdict).join(", ") || "none"}`, 1, tCritic);
      } catch (e) {
        warnings.push(`critic: ${(e as Error).message}`);
        step("critic", "llm", false, (e as Error).message, e instanceof LlmError && e.kind === "disabled" ? 0 : 1, tCritic);
      }
    }
  }

  // Without a critic, specialists can only annotate offline findings, never change them.
  if (!criticRan) {
    for (const c of contests) {
      working = working.map((f) => (f.id === c.id ? addNote(f, `AI specialist disputes this (${c.stance}): ${c.reason}. Not verified by the critic.`) : f));
    }
  }

  // ---- 3. self-correction: critic asked for evidence -> one targeted specialist recheck ----
  const recheck = verdicts.filter((v) => v.verdict === "needs_evidence" && v.recheck);
  const rechecked = new Set<string>();
  if (recheck.length && plan.loop && budget.left >= 1) {
    const targets = working.filter((f) => recheck.some((v) => v.id === f.id) && f.source.startsWith("agent:"));
    if (targets.length) {
      const tLoop = Date.now();
      try {
        const kinds = [...new Set(targets.map((f) => kindOf(f.category)))];
        const feedback = targets.map((f) => `- [${f.id}] "${f.quote.slice(0, 80)}": ${recheck.find((v) => v.id === f.id)?.recheck}`).join("\n");
        const redo = await runGroup(kinds, {
          ...ctxBase,
          offline: [],
          focus: targets.map((f) => ({ start: f.start, end: f.end, text: f.quote })),
          feedback,
        });
        const targetIds = new Set(targets.map((f) => f.id));
        const without = working.filter((f) => !targetIds.has(f.id));
        const again = mergeAgentFindings(without, redo.findings).merged
          .filter((f) => !without.includes(f))
          // No second critic pass after a recheck, so these are capped at C and labelled.
          .map((f) => ({ ...addNote(f, "Re-checked after critic feedback; not re-verified."), grade: "C" as const }));
        for (const f of targets) {
          if (!again.some((a) => a.start === f.start && a.end === f.end)) {
            suppressed.push({ finding: f, reason: "critic requested evidence; specialist could not supply it", by: "critic" });
          }
          rechecked.add(f.id);
        }
        working = [...without, ...again];
        step("self-correction", "llm", true, `rechecked ${targets.length} finding(s); ${again.length} survived`, 1, tLoop);
      } catch (e) {
        warnings.push(`recheck: ${(e as Error).message}`);
        step("self-correction", "llm", false, (e as Error).message, e instanceof LlmError && e.kind === "disabled" ? 0 : 1, tLoop);
      }
    }
  }

  // ---- 4. apply critic judgements (bounded by guards) ----
  if (criticRan) {
    const judgements: Judgement[] = verdicts
      .filter((v) => !rechecked.has(v.id))
      .map((v) => ({
        id: v.id,
        // Unresolved needs_evidence is treated as "real but unproven": downgrade, let a human decide.
        action: v.verdict === "keep" ? "keep" : v.verdict === "dismiss" ? "dismiss" : "downgrade",
        reason: v.reason || (v.verdict === "needs_evidence" ? "critic could not verify from the canon" : ""),
      }));
    const applied = applyJudgements(working, judgements, suppressed);
    working = applied.findings;
    step("guards", "guard", true, `applied ${judgements.length} judgement(s); ${suppressed.length} suppressed; ${applied.overruled.length} refused (deterministic evidence)`);
  }

  // Where specialists disputed an offline finding, record who won and why (for the audit trail).
  const disagreements = buildDisagreements({ contests, verdicts, criticRan, suppressed, findings: working });

  // ---- 5. remediation ----
  const proposals = new Map<string, Proposal>();
  for (const f of working) if (f.draftFix) proposals.set(f.id, { replacement: f.draftFix, origin: "panel", rationale: "Proposed by the specialist." });
  for (const fx of fixes) if (!proposals.has(fx.id)) proposals.set(fx.id, { replacement: fx.replacement, origin: "panel", rationale: fx.rationale || "Proposed by the specialist." });
  for (const v of verdicts) if (v.replacement && v.verdict === "keep") proposals.set(v.id, { replacement: v.replacement, origin: "critic", rationale: v.reason || "Corrected by the critic." });

  const tFix = Date.now();
  const rem = await remediate({ text, canon, findings: working, proposals, runOffline, budget, deadlineAt, allowRetry: plan.loop });
  working = rem.findings;
  const patched = working.filter((f) => f.patch?.verified).length;
  step("remediation", "verify", true, `${patched} verified patch(es)${rem.log.length ? `; ${rem.log.join("; ")}` : ""}`, 0, tFix);

  // ---- finalize ----
  const findings = working.map(strip).sort((a, b) => a.start - b.start);
  const result = seal(
    {
      findings, suppressed, status: "agentic", ai_unavailable: false, warnings,
      calls_used: budget.used, cache_hit: false, plan, trace,
    },
    disagreements,
  );
  if (input.cache && !warnings.length) {
    try {
      await input.cache.set(cacheKey, result);
    } catch {
      /* best-effort */
    }
  }
  return result;
}