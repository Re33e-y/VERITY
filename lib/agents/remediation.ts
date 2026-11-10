// lib/agents/remediation.ts
// Remediation agent. Proposals come from (1) a canon rule's approved replacement, (2) a specialist
// or critic rewrite. Nothing is shown as a fix until the OFFLINE engine re-reads the patched text and
// no longer flags the span. That closes the loop: the model proposes, deterministic code disposes.
// If a patch fails and the budget allows (thorough only), ONE batched retry call gets the failure reasons.

import { z } from "zod";
import { callJson, type CallBudget } from "./llm";
import { canonBlock, contextFor } from "./retrieval";
import { clean, overlaps } from "./guards";
import type { Canon, Finding, OfflineFn, Patch, Span } from "./types";

const MAX_PATCHES = 12;

export interface Proposal {
  replacement: string;
  origin: Patch["origin"];
  rationale: string;
}

export function applyPatches(text: string, patches: Pick<Patch, "start" | "end" | "replacement">[]): string {
  let out = text;
  let floor = Infinity; // apply right-to-left; skip anything overlapping a patch already applied
  for (const p of [...patches].sort((a, b) => b.start - a.start)) {
    if (p.end > floor) continue;
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
    floor = p.start;
  }
  return out;
}

async function verify(
  text: string,
  f: Finding,
  replacement: string,
  runOffline: OfflineFn,
  canon: Canon,
): Promise<{ ok: boolean; why: string }> {
  const r = replacement.trim();
  if (!r) return { ok: false, why: "empty replacement" };
  if (r === f.quote.trim()) return { ok: false, why: "replacement is identical to the original" };
  if (r.length > f.quote.length * 2 + 120) return { ok: false, why: "replacement is much longer than the original" };

  const patched = text.slice(0, f.start) + r + text.slice(f.end);
  const after = await runOffline(patched, canon);
  const window: Span = { start: f.start, end: f.start + r.length };
  const cat = f.category.toLowerCase();
  const still = after.find((a) => overlaps(a, window) && (a.grade === "A" || a.category.toLowerCase() === cat));
  if (still) return { ok: false, why: `offline engine still flags the patched span (${still.category})` };
  return { ok: true, why: "offline engine no longer flags the patched span" };
}

function proposalFor(f: Finding, proposals: Map<string, Proposal>, canon: Canon): Proposal | null {
  // Term-level canon replacement (banned term -> approved term). Only for short quotes.
  if (f.quote.length <= 60) {
    for (const c of f.citations) {
      if (c.type !== "rule") continue;
      const rule = canon.rules.find((r) => r.id === c.id);
      if (rule?.replacement) return { replacement: rule.replacement, origin: "canon", rationale: `Approved term from rule ${rule.id}.` };
    }
  }
  return proposals.get(f.id) ?? null;
}

const RetryRaw = z.object({ fixes: z.array(z.unknown()).default([]) });
const RetryFix = z.object({ finding_id: z.string(), replacement: z.string(), rationale: z.string().default("") });

const RETRY_SYSTEM = `You are Verity's remediation agent. Each earlier rewrite below failed verification.
Propose a new minimal replacement for each quote, using only facts and terms from the CANON. If the fix needs a human decision, omit it.
Return JSON only: {"fixes":[{"finding_id","replacement","rationale"}]}`;

export async function remediate(ctx: {
  text: string;
  canon: Canon;
  findings: Finding[];
  proposals: Map<string, Proposal>;
  runOffline: OfflineFn;
  budget: CallBudget;
  deadlineAt: number;
  allowRetry: boolean;
}): Promise<{ findings: Finding[]; log: string[] }> {
  const out = [...ctx.findings];
  const log: string[] = [];
  const failed: { i: number; why: string; prev: string }[] = [];

  const accept = (i: number, prop: Proposal, why: string) => {
    const f = out[i];
    out[i] = {
      ...f,
      patch: { start: f.start, end: f.end, original: f.quote, replacement: prop.replacement.trim(), rationale: clean(prop.rationale, 200), origin: prop.origin, verified: true, verification: why },
    };
  };

  for (let i = 0; i < out.length && i < MAX_PATCHES; i++) {
    const prop = proposalFor(out[i], ctx.proposals, ctx.canon);
    if (!prop) continue;
    const v = await verify(ctx.text, out[i], prop.replacement, ctx.runOffline, ctx.canon);
    if (v.ok) accept(i, prop, v.why);
    else {
      failed.push({ i, why: v.why, prev: prop.replacement });
      log.push(`patch for ${out[i].id} rejected: ${v.why}`);
    }
  }

  if (ctx.allowRetry && failed.length && ctx.budget.left >= 1) {
    try {
      const { rules, facts } = contextFor(["fact", "legal", "tone"], failed.map((x) => out[x.i].quote).join(" "), ctx.canon);
      const lines = failed.map(
        (x) => `- id=${out[x.i].id} category=${out[x.i].category} quote="${clean(out[x.i].quote, 160)}" problem="${clean(out[x.i].explanation, 200)}" failed_rewrite="${clean(x.prev, 160)}" failure="${x.why}"`,
      );
      const raw = await callJson({
        system: RETRY_SYSTEM,
        context: canonBlock(rules, facts),
        document: `DOCUMENT\n${ctx.text}\n\nFAILED PATCHES\n${lines.join("\n")}`,
        parse: (x) => RetryRaw.parse(x),
        budget: ctx.budget,
        deadlineAt: ctx.deadlineAt,
      });
      for (const item of raw.fixes.slice(0, MAX_PATCHES)) {
        const p = RetryFix.safeParse(item);
        if (!p.success) continue;
        const slot = failed.find((x) => out[x.i].id === p.data.finding_id);
        if (!slot) continue;
        const prop: Proposal = { replacement: clean(p.data.replacement, 400), origin: "retry", rationale: p.data.rationale };
        const v = await verify(ctx.text, out[slot.i], prop.replacement, ctx.runOffline, ctx.canon);
        if (v.ok) {
          accept(slot.i, prop, v.why);
          log.push(`retry fixed ${out[slot.i].id}`);
        }
      }
    } catch (e) {
      log.push(`remediation retry failed: ${(e as Error).message}`);
    }
  }

  for (const x of failed) {
    if (!out[x.i].patch) {
      out[x.i] = { ...out[x.i], notes: [...(out[x.i].notes ?? []), `No auto-fix: ${x.why}.`] };
    }
  }
  return { findings: out, log };
}
