// lib/agents/guards.ts
// Everything the models are NOT trusted to do lives here, in plain code.

import { normalizeCitationId } from "./retrieval";
import { isAbsoluteSecurity } from "./entities";
import type { Canon, Citation, Finding, FindingLifecycle, Span, SpecialistEnrichment, Suppressed } from "./types";

export const isAgent = (f: Finding): boolean => f.source.startsWith("agent:");

export const isAbsoluteSecurityFinding = (f: Finding): boolean =>
  isAbsoluteSecurity(f.quote) || isAbsoluteSecurity(f.explanation);

/**
 * Your existing invariant, widened slightly: a model may never clear or weaken
 * deterministic evidence (grade A), a Contradicted finding raised by the rules,
 * or an absolute security/zero-data-loss guarantee.
 */
export const isImmutable = (f: Finding): boolean =>
  (!isAgent(f) && (f.grade === "A" || f.category.toLowerCase() === "contradicted")) ||
  isAbsoluteSecurityFinding(f);

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
  const out: Citation[] = [];
  const seen = new Set<string>();

  for (const c of cits) {
    const rawId = String(c?.id ?? "").trim();
    if (!rawId) continue;
    const cleanId = normalizeCitationId(rawId).toLowerCase();

    // Match against canon rules and facts (exact ID or normalized ID)
    const matchedRule = canon.rules.find(
      (r) =>
        r.id.toLowerCase() === rawId.toLowerCase() ||
        r.id.toLowerCase() === cleanId ||
        normalizeCitationId(r.id).toLowerCase() === cleanId ||
        normalizeCitationId(r.id).toLowerCase() === rawId.toLowerCase()
    );
    const matchedFact = canon.facts.find(
      (f) =>
        f.id.toLowerCase() === rawId.toLowerCase() ||
        f.id.toLowerCase() === cleanId ||
        normalizeCitationId(f.id).toLowerCase() === cleanId ||
        normalizeCitationId(f.id).toLowerCase() === rawId.toLowerCase()
    );

    if (matchedRule && (c.type === "rule" || !matchedFact)) {
      const key = `rule:${matchedRule.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ type: "rule", id: matchedRule.id });
      }
    } else if (matchedFact && (c.type === "fact" || !matchedRule)) {
      const key = `fact:${matchedFact.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ type: "fact", id: matchedFact.id });
      }
    }
  }
  return out;
}

/** Contradicted/Outdated need a fact, Tone needs a rule. Unsupported/Legal may legitimately cite nothing. */
export const needsCitation = (category: string): boolean => /contradict|outdated|tone/i.test(category);

export interface MergeResult {
  merged: Finding[];
  kept: Finding[];
  enriched: { findingId: string; specialist: string; reasoning: string; category: string }[];
  refined: { findingId: string; specialist: string; reasoning: string; category: string }[];
  dropped: string[];
}

/** Agent findings that land on a span offline already flagged are merged responsibly. */
export function mergeAgentFindings(
  base: Finding[],
  incoming: Finding[],
  cap = 8,
): MergeResult {
  const merged = base.map((b) => ({ ...b }));
  const kept: Finding[] = [];
  const enriched: { findingId: string; specialist: string; reasoning: string; category: string }[] = [];
  const refined: { findingId: string; specialist: string; reasoning: string; category: string }[] = [];
  const dropped: string[] = [];
  let added = 0;

  for (const f of incoming) {
    const dupIdx = merged.findIndex((m) => overlapRatio(m, f) >= 0.6);
    if (dupIdx >= 0) {
      const dup = merged[dupIdx];

      // 1. True Duplicate: identical agent finding from the same specialist on the same category
      if (dup.source.startsWith("agent:") && dup.source === f.source && dup.category === f.category) {
        dropped.push(`"${f.quote.slice(0, 30)}" duplicates agent finding ${dup.id}`);
        continue;
      }

      // Create structured enrichment metadata
      const specialistEnrichment: SpecialistEnrichment = {
        agent: f.source,
        category: f.category,
        verdict: f.verdict ?? f.category.toLowerCase(),
        confidence: f.confidence,
        citations: f.citations,
        reasoning: f.reasoning_summary || f.explanation,
        legal_interpretation: f.legal_interpretation || (f.category === "Legal" ? (f.reasoning_summary || f.explanation) : undefined),
        requires_human_review: f.requires_human_review || f.category === "Legal",
        suggested_fix: f.draftFix || f.suggestion || null,
      };

      // 2. Overlapping an immutable deterministic finding (Grade A):
      if (isImmutable(dup)) {
        const existingEnrichments = dup.enrichments ?? [];
        const updatedEnrichments = [...existingEnrichments, specialistEnrichment];

        const notes = [...(dup.notes ?? [])];
        const noteText = `Specialist enrichment (${f.source}): ${clean(f.reasoning_summary || f.explanation, 160)}`;
        if (!notes.includes(noteText)) {
          notes.push(noteText);
        }

        // Preserve human sign-off for legal and high-severity findings
        const requiresReview = Boolean(dup.requires_human_review || f.requires_human_review || f.category === "Legal");

        merged[dupIdx] = {
          ...dup,
          citations: dup.citations.length > 0 ? dup.citations : f.citations,
          notes,
          enrichments: updatedEnrichments,
          requires_human_review: requiresReview,
          legal_interpretation: dup.legal_interpretation || specialistEnrichment.legal_interpretation,
          draftFix: dup.draftFix ?? f.draftFix,
          lifecycle: {
            ...dup.lifecycle,
            specialist: {
              agent: f.source,
              verdict: f.verdict,
              confidence: f.confidence,
              reasoning: f.reasoning_summary || f.explanation,
              citations: f.citations,
            },
            first_guard: {
              action: "enriched",
              detail: `Immutable Grade A rule violation enriched with ${f.source} reasoning & legal interpretation.`,
            },
          },
        };

        enriched.push({
          findingId: dup.id,
          specialist: f.source,
          reasoning: f.reasoning_summary || f.explanation,
          category: f.category,
        });
        continue;
      }

      // 3. Overlapping non-immutable heuristic finding (Grade C) or another specialist:
      const existingEnrichments = dup.enrichments ?? [];
      const updatedEnrichments = [...existingEnrichments, specialistEnrichment];

      const notes = [
        ...(dup.notes ?? []),
        `Offline heuristic refined by ${f.source} (${f.confidence ? `confidence: ${f.confidence}` : ""}).`,
      ];

      merged[dupIdx] = {
        ...f,
        id: dup.id, // preserve ID for trace stability
        grade: f.grade,
        citations: f.citations.length > 0 ? f.citations : dup.citations,
        notes,
        enrichments: updatedEnrichments,
        requires_human_review: Boolean(dup.requires_human_review || f.requires_human_review || f.category === "Legal"),
        lifecycle: {
          specialist: {
            agent: f.source,
            verdict: f.verdict,
            confidence: f.confidence,
            reasoning: f.reasoning_summary || f.explanation,
            citations: f.citations,
          },
          first_guard: {
            action: "refined",
            detail: `Offline heuristic refined by ${f.source} with confidence ${f.confidence ?? 0.8}.`,
          },
        },
      };

      refined.push({
        findingId: dup.id,
        specialist: f.source,
        reasoning: f.reasoning_summary || f.explanation,
        category: f.category,
      });
      continue;
    }

    // 4. Over cap check
    if (added >= cap) {
      dropped.push(`"${f.quote.slice(0, 30)}" over per-review cap`);
      continue;
    }

    // 5. Distinct finding added
    const findingWithLifecycle: Finding = {
      ...f,
      lifecycle: {
        specialist: {
          agent: f.source,
          verdict: f.verdict,
          confidence: f.confidence,
          reasoning: f.reasoning_summary || f.explanation,
          citations: f.citations,
        },
        first_guard: {
          action: "kept",
          detail: "Accepted as distinct specialist finding.",
        },
      },
    };
    merged.push(findingWithLifecycle);
    kept.push(findingWithLifecycle);
    added++;
  }

  return { merged, kept, enriched, refined, dropped };
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
): { findings: Finding[]; overruled: string[]; suppressedCount: number } {
  const byId = new Map(judgements.map((j) => [j.id, j]));
  const out: Finding[] = [];
  const overruled: string[] = [];
  let suppressedCount = 0;

  for (const f of findings) {
    const j = byId.get(f.id);
    if (!j || j.action === "keep") {
      const criticReason = j?.reason || "Finding substantiated by active brand canon.";
      const isEntityMismatch = /different product|entity mismatch|canon refers to|applies to proofgate|refers to proofgate/i.test(criticReason);
      const requiresReview = Boolean(f.requires_human_review || f.category === "Legal" || f.category === "Unsupported" || isEntityMismatch);
      const updatedFinding: Finding = {
        ...f,
        requires_human_review: requiresReview,
        lifecycle: {
          ...f.lifecycle,
          critic: {
            verdict: "keep",
            reason: criticReason,
          },
          second_guard: {
            action: "accepted",
            detail: `Critic verdict 'keep' confirmed by second guard (${clean(criticReason, 120)}).`,
          },
        },
      };
      if (j) {
        updatedFinding.notes = [...(updatedFinding.notes ?? []), `Confirmed by critic: ${clean(criticReason, 140)}`];
      }
      out.push(updatedFinding);
      continue;
    }

    if (isImmutable(f)) {
      const isAbsolute = isAbsoluteSecurityFinding(f);
      const guardMsg = isAbsolute
        ? "Critic attempted dismissal of absolute security / zero-data-loss guarantee; overruled by second guard to preserve immutable evidence and human review."
        : `Critic attempted ${j.action} (${clean(j.reason, 120)}); overruled by second guard to preserve immutable Grade A evidence.`;

      overruled.push(`${f.id}: ${j.action} refused (${isAbsolute ? "absolute guarantee" : "deterministic evidence"})`);
      out.push({
        ...f,
        severity: isAbsolute ? "high" : f.severity,
        requires_human_review: isAbsolute ? true : f.requires_human_review,
        verdict: isAbsolute ? "Needs legal review" : f.verdict,
        notes: [
          ...(f.notes ?? []),
          isAbsolute
            ? "Absolute security / zero-data-loss guarantee is non-dismissible; requires legal sign-off."
            : `AI disputed this (${clean(j.reason, 140)}); not applied because the evidence is deterministic.`,
        ],
        lifecycle: {
          ...f.lifecycle,
          critic: {
            verdict: j.action === "dismiss" ? "dismiss" : "downgrade",
            reason: j.reason,
          },
          second_guard: {
            action: "overruled",
            detail: guardMsg,
          },
        },
      });
      continue;
    }

    // Entity mismatch check: A different product in Canon does NOT make an unsupported claim compliant!
    const isEntityMismatch =
      /different product|entity mismatch|canon refers to|applies to proofgate|refers to proofgate|unrelated product|not substantiated/i.test(j.reason ?? "") ||
      f.entity_resolution?.status === "different_product";

    if (j.action === "dismiss" && (isEntityMismatch || f.category === "Unsupported")) {
      overruled.push(`${f.id}: dismiss refused (unsupported claim / entity mismatch)`);
      out.push({
        ...f,
        category: "Unsupported",
        grade: "B",
        requires_human_review: true,
        verdict: "Needs legal review",
        explanation: `${f.explanation} (Entity mismatch: Canon does not substantiate this claim for this product; preserved as Unsupported).`,
        notes: [
          ...(f.notes ?? []),
          `Critic attempted dismissal based on entity mismatch (${clean(j.reason, 120)}); preserved as Unsupported by Second Guard.`,
        ],
        lifecycle: {
          ...f.lifecycle,
          critic: { verdict: "dismiss", reason: j.reason },
          second_guard: {
            action: "overruled",
            detail: `Second guard prevented dismissal: entity mismatch does not make an unverified claim compliant. Preserved as Unsupported for human review.`,
          },
        },
      });
      continue;
    }

    if (j.action === "dismiss") {
      const criticExplanation = clean(j.reason, 200) || "Critic determined claim is uncheckable puffery or lacks canon conflict.";
      const secondGuardExplanation = `Second guard verified finding is non-deterministic (source: ${f.source}, grade: ${f.grade}) and confirmed critic dismissal.`;

      suppressed.push({
        finding: f,
        reason: criticExplanation,
        by: "critic",
        critic_verdict: "dismiss",
        critic_explanation: criticExplanation,
        second_guard_explanation: secondGuardExplanation,
        lifecycle: {
          ...f.lifecycle,
          critic: {
            verdict: "dismiss",
            reason: criticExplanation,
          },
          second_guard: {
            action: "suppressed",
            detail: secondGuardExplanation,
          },
        },
      });
      suppressedCount++;
      continue;
    }

    // Downgrade action
    const criticExplanation = clean(j.reason, 200) || "Critic downgraded finding.";
    const secondGuardExplanation = `Second guard downgraded finding to Grade C for mandatory human review (${criticExplanation}).`;
    out.push({
      ...f,
      grade: "C",
      requires_human_review: true,
      notes: [...(f.notes ?? []), `Downgraded by critic: ${clean(j.reason, 140)}`],
      lifecycle: {
        ...f.lifecycle,
        critic: {
          verdict: "downgrade",
          reason: criticExplanation,
        },
        second_guard: {
          action: "downgraded",
          detail: secondGuardExplanation,
        },
      },
    });
  }

  return { findings: out, overruled, suppressedCount };
}

export const addNote = (f: Finding, note: string): Finding => ({ ...f, notes: [...(f.notes ?? []), note] });
