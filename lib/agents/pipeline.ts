// lib/agents/pipeline.ts
// runAgenticReview(): orchestrator -> specialists (parallel or packed) -> critic -> self-correction
// -> remediation -> findings -> governance report. Deterministic code first, models only on what's
// uncertain, and any failure degrades to the offline findings you already have.

import { createHash } from "node:crypto";
import { CallBudget, LlmError, getMaxCalls, getPolicy, getProvidersUsed, isQuotaOpen } from "./llm";
import { makePlan, kindOf } from "./orchestrator";
import { runGroup, type Contest, type Fix, type PanelResult } from "./specialists";
import { pickCandidates, runCritic, type CriticOutput, type Verdict } from "./critic";
import { remediate, type Proposal } from "./remediation";
import { addNote, applyJudgements, mergeAgentFindings, type Judgement } from "./guards";
import { CONFIG_VERSION, buildDisagreements, buildGovernance } from "./governance";
import type {
  AgenticResult, CacheAdapter, Canon, CriticConsensus, Disagreement, Finding, OfflineFn, Span, Suppressed, TraceStep,
} from "./types";

export const PIPELINE_VERSION = "verity-pipeline-2.2.0";
export const PROMPT_VERSION = "agents-prompt-v2.2";
export const SCHEMA_VERSION = "agents-schema-v2.2";

export function canonDigest(canon: Canon): string {
  const rules = (canon.rules || []).map((r) => `${r.id}:${r.category}:${r.text}:${r.replacement ?? ""}`).sort();
  const facts = (canon.facts || []).map((f) => `${f.id}:${f.text}:${(f.keywords || []).sort().join(",")}:${f.valid_until ?? ""}`).sort();
  const entities = (canon.entities || []).map((e) => `${e.name}:${(e.aliases ?? []).sort().join(",")}`).sort();
  const rels = (canon.relationships || []).map((rel) => `${rel.source}:${rel.target}:${rel.type}`).sort();
  return createHash("sha256")
    .update(JSON.stringify([canon.version, rules, facts, entities, rels]))
    .digest("hex")
    .slice(0, 16);
}

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
  const step = (
    agent: string,
    kind: TraceStep["kind"],
    ok: boolean,
    detail: string,
    calls = 0,
    since = t0,
    extra?: Partial<TraceStep>
  ) =>
    trace.push({ agent, kind, ok, calls, ms: Date.now() - since, detail, ...extra });

  const offline = normalizeIds(input.offline);
  const plan = makePlan({ text, offline, ambiguous: input.ambiguous, policy, maxCalls });
  step("orchestrator", "plan", true, plan.reason);

  // Whole-review key (text + canon version + config). Doubles as the idempotency key in the governance report.
  // A fact can expire overnight and flip a verdict, so the day is part of the key, and the offline findings
  // themselves (not just their count) are fingerprinted.
  const offlineSig = offline
    .map((f) => [f.start, f.end, f.grade, f.category, f.citations.map((c) => c.id).join("+")].join(":"))
    .join("|");
  const cDigest = canonDigest(canon);
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify([
        PIPELINE_VERSION,
        CONFIG_VERSION,
        PROMPT_VERSION,
        SCHEMA_VERSION,
        policy,
        maxCalls,
        process.env.GEMINI_MODEL ?? "",
        canon.version,
        cDigest,
        new Date().toISOString().slice(0, 10),
        offlineSig,
        text,
      ]),
    )
    .digest("hex");

  /** Every result leaves through here so it always carries the governance report. */
  const seal = (
    r: Omit<AgenticResult, "governance">,
    disagreements: Disagreement[] = [],
    consensus?: CriticConsensus
  ): AgenticResult => ({
    ...r,
    pipeline_version: PIPELINE_VERSION,
    config_version: CONFIG_VERSION,
    schema_version: SCHEMA_VERSION,
    canon_digest: cDigest,
    providers_used: getProvidersUsed(),
    governance: buildGovernance({
      findings: r.findings,
      suppressed: r.suppressed,
      trace: r.trace,
      disagreements,
      idempotencyKey: cacheKey,
      consensus,
    }),
  });

  const base = { suppressed: [] as Suppressed[], warnings, plan, trace };
  if (!plan.engage) {
    return seal(
      { ...base, findings: offline, status: "skipped", ai_unavailable: false, calls_used: 0, cache_hit: false },
      [],
      {
        status: "no_findings_to_review",
        verdicts: [],
        agreed_count: 0,
        disagreed_count: 0,
        summary: "Review skipped (no ambiguous claims identified).",
      }
    );
  }
  if (isQuotaOpen()) {
    warnings.push("Gemini quota circuit is open; using offline findings.");
    step("orchestrator", "skip", false, "quota circuit open");
    return seal(
      { ...base, findings: offline, status: "degraded", ai_unavailable: true, calls_used: 0, cache_hit: false },
      [],
      {
        status: "model_failure",
        verdicts: [],
        agreed_count: 0,
        disagreed_count: 0,
        summary: "Gemini quota circuit is open; used offline findings.",
      }
    );
  }

  // ---- cache ----
  if (input.cache) {
    try {
      const hit = await input.cache.get(cacheKey);
      if (hit) {
        // Cache validation: ensure entry was generated under current pipeline, config, schema, and canon
        const isStale =
          hit.pipeline_version !== PIPELINE_VERSION ||
          hit.config_version !== CONFIG_VERSION ||
          hit.schema_version !== SCHEMA_VERSION ||
          hit.canon_digest !== cDigest;

        if (isStale) {
          step(
            "cache",
            "skip",
            false,
            `stale cache entry invalidated: version mismatch (cached: ${hit.pipeline_version ?? "legacy"}, current: ${PIPELINE_VERSION})`,
          );
        } else {
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
              consensus: hit.governance?.consensus,
            }),
          };
        }
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
      step(
        label,
        "llm",
        true,
        `${v.findings.length} finding(s), ${v.contests.length} contest(s), ${v.rejected.length} rejected by guards`,
        1,
        tPanel,
        {
          verdict: v.findings.length > 0 ? v.findings.map((f) => f.verdict || f.category).join(", ") : "no_issue",
          evidence: v.findings.flatMap((f) => f.citations.map((c) => c.id)).join(", ") || undefined,
          reasoning: v.findings.map((f) => f.reasoning_summary || f.explanation).join("; ") || v.evaluations?.map((e) => e.reasoning_summary).join("; "),
          confidence: v.findings.length > 0 ? Math.max(...v.findings.map((f) => f.confidence ?? 0)) : undefined,
        }
      );
    } else {
      const err = r.reason as Error;
      warnings.push(`${label}: ${err.message}`);
      const isTruncated = /truncated|max_tokens|finishreason/i.test(err.message);
      const isInvalidJson = /invalid json|syntaxerror|unexpected end/i.test(err.message);
      const failureKind = isTruncated
        ? "model output was truncated"
        : isInvalidJson
        ? "model produced invalid JSON"
        : "specialist execution failed";
      step(
        label,
        "llm",
        false,
        `${label} failed (${failureKind}): ${err.message}`,
        err instanceof LlmError && err.kind === "disabled" ? 0 : 1,
        tPanel,
        { reasoning: `Specialist failure classification: ${failureKind}. Detail: ${err.message}` }
      );
    }
  });

  if (panelOk === 0) {
    step(
      "pipeline",
      "skip",
      false,
      "No specialist call succeeded; fell back to deterministic rule-based findings (offline)",
      0,
      Date.now(),
      { reasoning: "Deterministic fallback findings are rule-based offline findings, not model-verified." }
    );
    const offlineLabeled: Finding[] = offline.map((f) => ({
      ...f,
      source: "offline",
      notes: [
        ...(f.notes ?? []),
        "Deterministic rule-based finding (AI specialist validation unavailable or failed validation).",
      ],
    }));
    return seal(
      { ...base, findings: offlineLabeled, status: "degraded", ai_unavailable: true, calls_used: budget.used, cache_hit: false },
      [],
      {
        status: "model_failure",
        verdicts: [],
        agreed_count: 0,
        disagreed_count: 0,
        summary: "No specialist call succeeded; fell back to offline rule-based findings.",
      }
    );
  }

  const merged = mergeAgentFindings(working, agentFindings);
  working = merged.merged;
  const keptSummary = `${merged.kept.length} new finding(s) kept`;
  const enrichedSummary = merged.enriched.length > 0 ? `${merged.enriched.length} enriched` : "";
  const refinedSummary = merged.refined.length > 0 ? `${merged.refined.length} refined` : "";
  const droppedSummary = `${merged.dropped.length} dropped as duplicates/over cap`;
  const firstGuardDetail = [keptSummary, enrichedSummary, refinedSummary, droppedSummary].filter(Boolean).join(", ");

  step(
    "guards",
    "guard",
    true,
    `First guard processed ${agentFindings.length} specialist finding(s): ${firstGuardDetail}`,
    0,
    Date.now(),
    {
      guard_status: merged.dropped.length === 0 ? "accepted" : "deduplicated",
      reasoning: [
        ...merged.enriched.map((e) => `[${e.findingId}] Enriched by ${e.specialist} (${e.category}): ${e.reasoning}`),
        ...merged.refined.map((r) => `[${r.findingId}] Refined by ${r.specialist} (${r.category}): ${r.reasoning}`),
        ...merged.dropped.map((d) => `Dropped: ${d}`),
      ].join("; ") || undefined,
    }
  );

  // ---- 2. critic (reflection & judge) ----
  let verdicts: Verdict[] = [];
  let criticConsensus: CriticConsensus | undefined = undefined;
  let criticRan = false;
  if (plan.critic) {
    const candidates = pickCandidates(working, contests, plan.focus);
    if (candidates.length === 0) {
      // 0 candidates to review - runCritic handles zero candidates deterministically with 0 calls
      const criticOutput = await runCritic({ text, canon, candidates, contests, focus: plan.focus, budget, deadlineAt });
      verdicts = criticOutput.verdicts;
      criticConsensus = criticOutput.consensus;
      criticRan = true;
      step("critic", "plan", true, `Consensus: ${criticConsensus.status}. 0 findings to review.`, 0, Date.now(), {
        critic_result: criticConsensus.status,
        reasoning: criticConsensus.summary,
      });
    } else if (budget.left >= 1) {
      const tCritic = Date.now();
      try {
        const criticOutput = await runCritic({ text, canon, candidates, contests, focus: plan.focus, budget, deadlineAt });
        verdicts = criticOutput.verdicts;
        criticConsensus = criticOutput.consensus;
        criticRan = true;
        step(
          "critic",
          "llm",
          true,
          `Consensus: ${criticConsensus.status}. ${verdicts.length} verdict(s): ${verdicts.map((v) => v.verdict).join(", ") || "none"}`,
          1,
          tCritic,
          {
            critic_result: criticConsensus.status,
            verdict: verdicts.map((v) => `${v.id}:${v.verdict}`).join(", "),
            reasoning: criticConsensus.summary,
          }
        );
      } catch (e) {
        warnings.push(`critic: ${(e as Error).message}`);
        criticConsensus = {
          status: "model_failure",
          verdicts: [],
          agreed_count: 0,
          disagreed_count: 0,
          summary: `Critic execution failed: ${(e as Error).message}`,
        };
        step("critic", "llm", false, (e as Error).message, e instanceof LlmError && e.kind === "disabled" ? 0 : 1, tCritic, {
          critic_result: "model_failure",
        });
      }
    } else {
      criticConsensus = {
        status: "incomplete_review",
        verdicts: [],
        agreed_count: 0,
        disagreed_count: 0,
        summary: "Critic skipped due to call budget exhaustion.",
      };
      step("critic", "skip", false, "call budget exhausted", 0, Date.now(), {
        critic_result: "incomplete_review",
      });
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
            const whyCritic = "Critic requested evidence; specialist could not supply it.";
            const whyGuard = `Second guard suppressed unproven finding (${f.category}) following failed evidence recheck.`;
            suppressed.push({
              finding: f,
              reason: whyCritic,
              by: "critic",
              critic_verdict: "dismiss",
              critic_explanation: whyCritic,
              second_guard_explanation: whyGuard,
              lifecycle: {
                ...f.lifecycle,
                critic: { verdict: "dismiss", reason: whyCritic },
                second_guard: { action: "suppressed", detail: whyGuard },
              },
            });
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
        reason: v.reason || (v.verdict === "needs_evidence" ? "critic could not verify from the canon" : "critic evaluated finding"),
      }));
    const applied = applyJudgements(working, judgements, suppressed);
    working = applied.findings;

    const secondGuardSuppressedDetail = suppressed
      .filter((s) => s.by === "critic" && judgements.some((j) => j.id === s.finding.id && j.action === "dismiss"))
      .map((s) => `[${s.finding.id}] ${s.second_guard_explanation || s.reason}`)
      .join("; ");

    step(
      "guards",
      "guard",
      true,
      `Second guard applied ${judgements.length} critic judgement(s): ${applied.suppressedCount} suppressed by critic, ${applied.overruled.length} overruled (deterministic Grade A), ${working.length} kept in final findings`,
      0,
      Date.now(),
      {
        guard_status: applied.overruled.length > 0 ? "overruled" : applied.suppressedCount > 0 ? "rejected" : "accepted",
        reasoning: secondGuardSuppressedDetail || undefined,
      }
    );
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
  const patched = working.filter((f) => f.patch?.status === "verified" || f.patch?.verified).length;
  const rejectedPatches = working.filter((f) => f.patch?.status === "rejected").length;
  step(
    "remediation",
    "verify",
    true,
    `${patched} verified patch(es), ${rejectedPatches} rejected patch(es)${rem.log.length ? `; ${rem.log.join("; ")}` : ""}`,
    0,
    tFix,
    {
      remediation_verification: patched > 0 ? "verified" : rejectedPatches > 0 ? "rejected" : "none",
      reasoning: rem.log.join("; ") || undefined,
    }
  );

  // ---- finalize ----
  const findings = working.map(strip).sort((a, b) => a.start - b.start);
  const result = seal(
    {
      findings, suppressed, status: "agentic", ai_unavailable: false, warnings,
      calls_used: budget.used, cache_hit: false, plan, trace,
    },
    disagreements,
    criticConsensus,
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