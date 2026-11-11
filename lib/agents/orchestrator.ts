// lib/agents/orchestrator.ts
// The orchestrator is code, not a model. Decomposition here is "which sentences are uncertain,
// which specialists apply, and how many calls can we afford" - a 0-token decision.
// An LLM planner would spend one of your two calls on something a regex does better.

import { overlaps } from "./guards";
import type { FocusSentence, Finding, Plan, Policy, Span, SpecialistKind } from "./types";

export const KINDS: SpecialistKind[] = ["fact", "legal", "tone"];

const SIGNALS: Record<SpecialistKind, RegExp[]> = {
  fact: [
    /\d/,
    /[$€£₹]/,
    /\b(free|trial|days?|weeks?|months?|years?|per (user|seat|month)|launch(ed)?|available|version|v\d)\b/i,
  ],
  legal: [
    /\b(guarantee[sd]?|100%|risk[- ]free|no risk|certified|compliant|compliance|clinically|proven|#1|best|fastest|cheapest|only|never|always|unlimited)\b/i,
    /\d+\s?%/,
    /[$€£₹]\s?\d/,
  ],
  tone: [/!/, /\b[A-Z]{4,}\b/, /\b(amazing|revolutionary|game[- ]?changing|incredible|unbeatable|insane|killer)\b/i],
};

const CATEGORY_KIND: [RegExp, SpecialistKind][] = [
  [/tone|terminolog|readab|style/i, "tone"],
  [/legal|instruction|inject|safety/i, "legal"],
  [/unsupported|contradict|outdated|fact|claim/i, "fact"],
];

export const kindOf = (category: string): SpecialistKind => {
  for (const [re, k] of CATEGORY_KIND) if (re.test(category)) return k;
  return "fact";
};

const anySignal = (s: string): boolean => KINDS.some((k) => SIGNALS[k].some((r) => r.test(s)));

export function sentences(text: string): FocusSentence[] {
  const rawMatches: { start: number; end: number; text: string }[] = [];
  const re = /[\s\S]+?(?:[.!?]+(?=\s|$)|\n|$)/g; // keeps "$19.99" and "v1.2" in one piece
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const t = raw.trim();
    if (t) {
      const start = m.index + (raw.length - raw.trimStart().length);
      rawMatches.push({ start, end: start + t.length, text: t });
    }
    if (re.lastIndex === m.index) re.lastIndex++;
  }

  const out: FocusSentence[] = [];
  for (let i = 0; i < rawMatches.length; i++) {
    const prev = i > 0 ? rawMatches[i - 1].text : "";
    const next = i < rawMatches.length - 1 ? rawMatches[i + 1].text : "";
    const context = [prev, rawMatches[i].text, next].filter(Boolean).join(" ");
    out.push({
      id: `c_${i + 1}`,
      start: rawMatches[i].start,
      end: rawMatches[i].end,
      text: rawMatches[i].text,
      context,
      extracted_claim: rawMatches[i].text,
    });
  }
  return out;
}

const skip = (policy: Policy, maxCalls: number, reason: string): Plan => ({
  engage: false, reason, policy, maxCalls, focus: [], specialists: [], groups: [], critic: false, loop: false,
});

export function makePlan(i: {
  text: string;
  offline: Finding[];
  /** Spans your router already marked ambiguous (the claims it would have sent to the judge). */
  ambiguous: Span[];
  policy: Policy;
  maxCalls: number;
}): Plan {
  const { policy, maxCalls } = i;
  if (policy === "off" || maxCalls < 1) return skip(policy, maxCalls, "LLM policy is off");

  const sents = sentences(i.text);
  let focusSpans: Span[];

  if (policy === "auto") {
    // Same gate as today: only reviews the router already sends to a model.
    if (!i.ambiguous.length) return skip(policy, maxCalls, "router resolved this review locally; 0 calls");
    focusSpans = i.ambiguous;
  } else {
    // thorough: also look at heuristic (grade C) findings and claim-like sentences nothing has judged.
    const gradeC = i.offline.filter((f) => f.grade === "C");
    const unresolved = sents.filter((s) => anySignal(s.text) && !i.offline.some((f) => overlaps(f, s)));
    focusSpans = [...i.ambiguous, ...gradeC, ...unresolved];
    if (!focusSpans.length) return skip(policy, maxCalls, "nothing uncertain to review");
  }

  let focus = sents.filter((s) => focusSpans.some((sp) => overlaps(sp, s)));
  if (!focus.length) {
    focus = focusSpans.map((sp, idx) => ({
      id: `c_${idx + 1}`,
      ...sp,
      text: i.text.slice(sp.start, sp.end),
      context: i.text.slice(Math.max(0, sp.start - 80), Math.min(i.text.length, sp.end + 80)),
      extracted_claim: i.text.slice(sp.start, sp.end),
    }));
  }

  const active = new Set<SpecialistKind>();
  for (const s of focus) for (const k of KINDS) if (SIGNALS[k].some((r) => r.test(s.text))) active.add(k);
  for (const f of i.offline) {
    if (!focus.some((s) => overlaps(f, s))) continue;
    for (const [re, k] of CATEGORY_KIND) {
      if (re.test(f.category)) {
        active.add(k);
        break;
      }
    }
  }
  if (!active.size) active.add("fact");
  const specialists = KINDS.filter((k) => active.has(k));

  // Budget: reserve one call for the critic, two more for recheck + remediation retry when looping.
  const critic = maxCalls >= 2;
  const loop = maxCalls >= 5;
  const forSpecialists = Math.max(1, maxCalls - (critic ? 1 : 0) - (loop ? 2 : 0));
  const groups = specialists.length <= forSpecialists ? specialists.map((k) => [k]) : [specialists];

  return {
    engage: true,
    reason: `${focus.length} uncertain sentence(s); specialists: ${specialists.join(", ")}; ${groups.length} panel call(s) + ${critic ? "critic" : "no critic"} within ${maxCalls}`,
    policy, maxCalls, focus, specialists, groups, critic, loop,
  };
}
