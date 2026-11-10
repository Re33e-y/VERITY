// lib/agents/retrieval.ts
// The "Canon DB / Guidelines" tools from the diagram.
// Your canon is tiny (9 rules, 4 facts), so the whole thing is inlined into the prompt:
// zero extra calls, zero embeddings, and the model can't miss a relevant fact.
// If the canon ever outgrows INLINE_LIMIT, this falls back to lexical top-k.
// Swap in pgvector at that point, not before.

import type { Canon, CanonFact, CanonRule, SpecialistKind } from "./types";

const INLINE_LIMIT = 40; // rules + facts

const STOP = new Set(
  "a an the and or but of to in on for with by at from as is are was were be been it its this that these those we our you your us they their not no".split(" "),
);

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

function overlapScore(query: Set<string>, doc: string[]): number {
  if (!doc.length) return 0;
  const d = new Set(doc);
  let hit = 0;
  for (const w of query) if (d.has(w)) hit++;
  return hit / Math.sqrt(d.size);
}

export function retrieveFacts(query: string, canon: Canon, k = 6): CanonFact[] {
  const q = new Set(tokens(query));
  return canon.facts
    .map((f) => ({ f, s: overlapScore(q, [...tokens(f.text), ...(f.keywords ?? []).flatMap(tokens)]) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.f);
}

const KIND_RULE_HINT: Record<SpecialistKind, RegExp> = {
  tone: /tone|term|style|voice|brand|read/i,
  fact: /fact|claim|price|date|number|support/i,
  legal: /legal|claim|guarantee|superlative|compliance|safety|inject/i,
};

export function retrieveRules(kinds: SpecialistKind[], query: string, canon: Canon, k = 8): CanonRule[] {
  const q = new Set(tokens(query));
  return canon.rules
    .map((r) => {
      const hint = kinds.some((kd) => KIND_RULE_HINT[kd].test(`${r.id} ${r.category}`)) ? 0.5 : 0;
      return { r, s: overlapScore(q, tokens(`${r.category} ${r.text}`)) + hint };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.r);
}

export function contextFor(
  kinds: SpecialistKind[],
  focusText: string,
  canon: Canon,
): { rules: CanonRule[]; facts: CanonFact[] } {
  if (canon.rules.length + canon.facts.length <= INLINE_LIMIT) {
    return { rules: canon.rules, facts: canon.facts };
  }
  return { rules: retrieveRules(kinds, focusText, canon), facts: retrieveFacts(focusText, canon) };
}

export function canonBlock(rules: CanonRule[], facts: CanonFact[]): string {
  const r = rules.map((x) => `R:${x.id} [${x.category}] ${x.text}`).join("\n") || "(none)";
  const f =
    facts.map((x) => `F:${x.id} ${x.text}${x.valid_until ? ` (valid until ${x.valid_until})` : ""}`).join("\n") || "(none)";
  return `CANON RULES\n${r}\n\nCANON FACTS\n${f}`;
}
