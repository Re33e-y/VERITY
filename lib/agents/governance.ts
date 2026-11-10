// lib/agents/governance.ts
// Verity 2.0 governance layer. Pure code, zero model calls.
// It turns what the pipeline already knows into the structured report a human reviewer and the UI need:
//   - severity, confidence and evidence strength as three SEPARATE fields (never one blended score)
//   - which findings must be escalated to a qualified human, and why
//   - which agents ran and what each did (2.0 role names)
//   - where agents disagreed and how it was resolved

import { isAgent, isImmutable } from "./guards";
import type {
  AgentActivity, Disagreement, EvidenceStrength, Finding, Governance, GovernedFinding,
  Severity, Suppressed, TraceStep,
} from "./types";

/** Bump when prompts, roles or guard rules change. Part of the cache key, so old cached reviews never match. */
export const CONFIG_VERSION = "verity-agents-2.0.0";

const SPECIALIST_LABEL: Record<string, string> = {
  fact: "Claim Verification Agent",
  legal: "Risk Intelligence Agent",
  tone: "Brand Compliance & Voice Agent",
};

const FIXED_LABEL: Record<string, string> = {
  orchestrator: "Orchestrator Agent",
  critic: "Critic & Consensus Agent",
  guards: "Deterministic Guards",
  remediation: "Remediation (offline-verified)",
  "self-correction": "Critic recheck",
  cache: "Review cache",
  pipeline: "Review pipeline",
};

export function labelFor(agent: string): string {
  if (FIXED_LABEL[agent]) return FIXED_LABEL[agent];
  if (agent.startsWith("specialist:")) {
    return agent
      .slice("specialist:".length)
      .split("+")
      .map((k) => SPECIALIST_LABEL[k] ?? k)
      .join(" + ");
  }
  return agent;
}

export function activityFrom(trace: TraceStep[]): AgentActivity[] {
  return trace.map((t) => ({
    agent: t.agent,
    label: labelFor(t.agent),
    status: t.kind === "skip" ? "skipped" : t.ok ? "completed" : "failed",
    calls: t.calls,
    ms: t.ms,
    summary: t.detail,
  }));
}

/** Potential impact if the claim is published. Independent of how sure anyone is. */
export function severityOf(f: Finding): Severity {
  const c = f.category;
  if (/^supported/i.test(c)) return "info";
  if (/contradict|legal|instruction|inject/i.test(c)) return "high";
  if (/outdated|unsupported/i.test(c)) return "medium";
  if (/tone|terminolog|readab|style/i.test(c)) return "low";
  return f.grade === "A" ? "medium" : "low";
}

/**
 * Quality of the actual evidence. A model's confidence never raises this:
 * deterministic = code proved it (grade A, not raised by a model)
 * canon_cited   = points at a real canon rule/fact (guards verified the id exists), but not proven by code
 * none          = nothing approved backs it
 */
export function evidenceOf(f: Finding): EvidenceStrength {
  if (!isAgent(f) && f.grade === "A") return "deterministic";
  return f.citations.length > 0 ? "canon_cited" : "none";
}

export function reviewReasons(f: Finding, severity: Severity, evidence: EvidenceStrength): string[] {
  const reasons: string[] = [];
  if (/legal|instruction|inject/i.test(f.category)) {
    reasons.push("Legal, safety or instruction-like content needs a qualified human reviewer.");
  }
  if (severity === "high" && evidence !== "deterministic") {
    reasons.push("High-impact finding without deterministic evidence.");
  }
  if (/unsupported/i.test(f.category) && evidence === "none") {
    reasons.push("Unverifiable: no approved evidence exists for this claim. That does not mean it is false.");
  }
  if (isAgent(f) && f.grade === "C") {
    reasons.push("Raised by an AI specialist and not fully verified by the critic.");
  }
  return reasons;
}

export function buildDisagreements(i: {
  contests: { id: string; stance: "dismiss" | "downgrade"; reason: string }[];
  verdicts: { id: string; verdict: "keep" | "dismiss" | "downgrade" | "needs_evidence" }[];
  criticRan: boolean;
  suppressed: Suppressed[];
  findings: Finding[];
}): Disagreement[] {
  const verdictById = new Map(i.verdicts.map((v) => [v.id, v.verdict]));
  const dismissed = new Set(i.suppressed.filter((s) => s.by === "critic").map((s) => s.finding.id));
  const byId = new Map(i.findings.map((f) => [f.id, f]));

  return i.contests.map((c) => {
    const v = verdictById.get(c.id);
    const f = byId.get(c.id);
    let resolution: string;
    if (dismissed.has(c.id)) resolution = "Critic dismissed the finding as a false positive.";
    else if (!i.criticRan) resolution = "No critic ran; the finding is kept for a human to decide.";
    else if (!v) resolution = "Critic did not rule on this; the finding is kept.";
    else if (v === "keep") resolution = "Critic kept the finding.";
    else if (f && isImmutable(f)) resolution = "Kept: deterministic evidence cannot be cleared by a model.";
    else if (v === "downgrade") resolution = "Critic downgraded the finding to grade C.";
    else if (v === "needs_evidence") resolution = "Critic could not decide from the canon; downgraded for human review.";
    else resolution = "Critic ruled on this finding.";
    return { finding_id: c.id, raised_by: "Specialist panel", stance: c.stance, reason: c.reason, resolution };
  });
}

export function buildGovernance(i: {
  findings: Finding[];
  suppressed: Suppressed[];
  trace: TraceStep[];
  disagreements: Disagreement[];
  idempotencyKey: string;
}): Governance {
  const findings: GovernedFinding[] = i.findings.map((f) => {
    const severity = severityOf(f);
    const evidence = evidenceOf(f);
    const reasons = reviewReasons(f, severity, evidence);
    return {
      id: f.id,
      start: f.start,
      end: f.end,
      quote: f.quote,
      category: f.category,
      grade: f.grade,
      source: f.source,
      confidence: typeof f.confidence === "number" ? f.confidence : null,
      evidence_strength: evidence,
      severity,
      requires_human_review: reasons.length > 0,
      review_reasons: reasons,
      has_verified_patch: Boolean(f.patch?.verified),
    };
  });

  // Count roles, not calls: one packed call can run three specialists.
  const involved = new Set<string>();
  for (const t of i.trace) {
    if (!t.ok || (t.kind !== "plan" && t.kind !== "llm") || t.agent === "self-correction") continue;
    if (t.agent.startsWith("specialist:")) {
      for (const k of t.agent.slice("specialist:".length).split("+")) involved.add(k);
    } else involved.add(t.agent);
  }

  const needs = findings.filter((f) => f.requires_human_review).length;
  return {
    config_version: CONFIG_VERSION,
    idempotency_key: i.idempotencyKey,
    summary: {
      agents_involved: involved.size,
      findings: findings.length,
      needs_human_review: needs,
      suppressed: i.suppressed.length,
      unverifiable: findings.filter((f) => /unsupported/i.test(f.category) && f.evidence_strength === "none").length,
    },
    human_review_required: needs > 0,
    agents: activityFrom(i.trace),
    findings,
    disagreements: i.disagreements,
  };
}