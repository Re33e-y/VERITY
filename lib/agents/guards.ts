// lib/agents/guards.ts
// Everything the models are NOT trusted to do lives here, in plain code.

import type { Canon, Citation, Finding, Span, Suppressed } from "./types";

export const isAgent = (f: Finding): boolean => f.source.startsWith("agent:");

/**
 * Your existing invariant, widened slightly: a model may never clear or weaken
 * deterministic evidence (grade A) or a Contradicted finding raised by the rules.
 */
export const isImmutable = (f: Finding): boolean =>
  !isAgent(f) && (f.grade === "A" || f.category.toLowerCase() === "contradicted");

export const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

export function overlapRatio(a: Span, b: Span): number {
  const o = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (o <= 0) return 0;
  return o / Math.max(1, Math.min(a.end - a.start, b.end - b.start));
}

/** Strip control chars, collapse whitespace, cap length. Used on every model-written string. */
export const clean = (s: string, max: number): string =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Offsets are computed here, never trusted from the model. */
export function locate(text: string, quote: string): Span | null {
  const q = (quote ?? "").trim();
  if (q.length < 2 || q.length > 400) return null;
  let i = text.indexOf(q);
  if (i < 0) i = text.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? null : { start: i, end: i + q.length };
}

export function checkCitations(cits: Citation[], canon: Canon): Citation[] {
  const rules = new Set(canon.rules.map((r) => r.id));
  const facts = new Set(canon.facts.map((f) => f.id));
  return cits.filter((c) => (c.type === "rule" ? rules : facts).has(c.id));
}

/** Contradicted/Outdated need a fact, Tone needs a rule. Unsupported/Legal may legitimately cite nothing. */
export const needsCitation = (category: string): boolean => /contradict|outdated|tone/i.test(category);

/** Agent findings that land on a span offline already flagged are dropped (contests handle disagreement). */
export function mergeAgentFindings(
  base: Finding[],
  incoming: Finding[],
  cap = 8,
): { merged: Finding[]; dropped: string[] } {
  const merged = [...base];
  const dropped: string[] = [];
  let added = 0;
  for (const f of incoming) {
    const dup = merged.find((m) => overlapRatio(m, f) >= 0.6);
    if (dup) {
      dropped.push(`"${f.quote.slice(0, 30)}" duplicates ${dup.id}`);
      continue;
    }
    if (added >= cap) {
      dropped.push(`"${f.quote.slice(0, 30)}" over per-review cap`);
      continue;
    }
    merged.push(f);
    added++;
  }
  return { merged, dropped };
}

export interface Judgement {
  id: string;
  action: "keep" | "dismiss" | "downgrade";
  reason: string;
}

export function applyJudgements(
  findings: Finding[],
  judgements: Judgement[],
  suppressed: Suppressed[],
): { findings: Finding[]; overruled: string[] } {
  const byId = new Map(judgements.map((j) => [j.id, j]));
  const out: Finding[] = [];
  const overruled: string[] = [];
  for (const f of findings) {
    const j = byId.get(f.id);
    if (!j || j.action === "keep") {
      out.push(f);
      continue;
    }
    if (isImmutable(f)) {
      overruled.push(`${f.id}: ${j.action} refused (deterministic evidence)`);
      out.push({ ...f, notes: [...(f.notes ?? []), `AI disputed this (${clean(j.reason, 140)}); not applied because the evidence is deterministic.`] });
      continue;
    }
    if (j.action === "dismiss") {
      suppressed.push({ finding: f, reason: clean(j.reason, 200), by: "critic" });
      continue;
    }
    out.push({ ...f, grade: "C", notes: [...(f.notes ?? []), `Downgraded by critic: ${clean(j.reason, 140)}`] });
  }
  return { findings: out, overruled };
}

export const addNote = (f: Finding, note: string): Finding => ({ ...f, notes: [...(f.notes ?? []), note] });
