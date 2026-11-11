// lib/agents/entities.ts
// Entity-aware governance: identifies products/services in marketing claims,
// extracts entities from Canon facts, resolves approved relationships/aliases,
// and protects against improper evidence transfer or dismissals.

import type { Canon, CanonFact, EntityResolutionResult, EntityRelationStatus } from "./types";

export const ABSOLUTE_SECURITY_REGEX =
  /\b(?:absolute\s+security|zero[- ]data[- ]loss|zero[- ](?:transaction[- ]failures?|failures?|downtime|defects?)|100%\s+(?:secure|security|unbreakable|data[- ]protection|fraud\s+prevention|fraud[- ]free|protection)|guarantees?\s+(?:100%|zero|absolute|unconditional)|completely\s+(?:unhackable|bulletproof)|flawless\s+security|unbreakable\s+(?:encryption|security))\b/i;

export function isAbsoluteSecurity(text: string): boolean {
  return ABSOLUTE_SECURITY_REGEX.test(text ?? "");
}

const GENERIC_PRODUCT_REGEX =
  /\b(?:our\s+(?:platform|cloud(?:\s+storage)?|product|service|software|system)|the\s+(?:platform|cloud(?:\s+storage)?|product|service|software|system))\b/i;

/** Known product hierarchy / canonical entity seeds if not explicitly in canon */
const DEFAULT_KNOWN_PRODUCTS = [
  "NovaPay",
  "ProofGate Cloud Storage",
  "ProofGate Pro",
  "ProofGate Enterprise",
  "ProofGate Starter",
  "ProofGate Cloud",
  "ProofGate Platform",
  "ProofGate",
];

const DEFAULT_APPROVED_ALIASES: Record<string, string> = {
  "proofgate cloud": "ProofGate Cloud Storage",
  "proofgate platform": "ProofGate",
};

/** Collect all known entity names from canon and defaults, sorted by longest string first */
export function getKnownEntities(canon?: Canon): string[] {
  const fromCanon = (canon?.entities ?? []).flatMap((e) => [e.name, ...(e.aliases ?? [])]);
  const combined = Array.from(new Set([...fromCanon, ...DEFAULT_KNOWN_PRODUCTS]));
  return combined.sort((a, b) => b.length - a.length);
}

/** Identify product/service entity in claim copy */
export function extractEntityFromClaim(
  text: string,
  canon?: Canon,
): { entity: string | null; isAmbiguous: boolean } {
  const s = String(text ?? "").trim();
  const known = getKnownEntities(canon);

  // 1. Look for explicit known product name (longest match first)
  for (const name of known) {
    const rx = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (rx.test(s)) {
      return { entity: name, isAmbiguous: false };
    }
  }

  // 1b. Check for brand names like NovaPay or CamelCase Product names
  const brandMatch = s.match(/\b([A-Z][a-z]+[A-Z][a-zA-Z0-9]+|[A-Z][a-zA-Z0-9]+Pay|[A-Z][a-zA-Z0-9]+Gate)\b/);
  if (brandMatch) {
    return { entity: brandMatch[1], isAmbiguous: false };
  }

  // 2. Check for generic reference (ambiguous product identity)
  if (GENERIC_PRODUCT_REGEX.test(s)) {
    return { entity: "our platform", isAmbiguous: true };
  }

  return { entity: null, isAmbiguous: false };
}

/** Identify product/service entity associated with a Canon fact */
export function extractEntityFromFact(fact: CanonFact, canon?: Canon): string | null {
  if (fact.entity) return fact.entity;
  const s = fact.text ?? "";
  const known = getKnownEntities(canon);

  for (const name of known) {
    const rx = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (rx.test(s)) {
      return name;
    }
  }
  return null;
}

/** Check if an explicit/approved relationship or alias exists between two entities */
export function hasApprovedRelationship(
  a: string,
  b: string,
  canon?: Canon,
): boolean {
  const normA = a.toLowerCase().trim();
  const normB = b.toLowerCase().trim();
  if (normA === normB) return true;

  // Check canon relationships
  if (canon?.relationships) {
    const found = canon.relationships.some(
      (rel) =>
        (rel.source.toLowerCase() === normA && rel.target.toLowerCase() === normB) ||
        (rel.source.toLowerCase() === normB && rel.target.toLowerCase() === normA),
    );
    if (found) return true;
  }

  // Check canon entity aliases
  if (canon?.entities) {
    for (const ent of canon.entities) {
      const allNames = [ent.name, ...(ent.aliases ?? [])].map((x) => x.toLowerCase());
      if (allNames.includes(normA) && allNames.includes(normB)) {
        return true;
      }
    }
  }

  // Check default aliases
  if (DEFAULT_APPROVED_ALIASES[normA]?.toLowerCase() === normB) return true;
  if (DEFAULT_APPROVED_ALIASES[normB]?.toLowerCase() === normA) return true;

  return false;
}

/** Resolve entity relationship between a marketing claim and a canon fact */
export function resolveEntityRelationship(
  claimText: string,
  fact: CanonFact | null,
  canon?: Canon,
): EntityResolutionResult {
  const { entity: claimEntity, isAmbiguous } = extractEntityFromClaim(claimText, canon);
  const factEntity = fact ? extractEntityFromFact(fact, canon) : null;

  if (isAmbiguous) {
    return {
      claimEntity,
      factEntity,
      status: "ambiguous",
      explanation: `Ambiguous entity identity in marketing claim ('${claimEntity ?? "unspecified"}'); cannot conclusively bind to '${factEntity ?? "Canon fact"}'. Escalating for human review.`,
    };
  }

  if (!claimEntity && !factEntity) {
    return {
      claimEntity: null,
      factEntity: null,
      status: "unknown",
      explanation: "No specific product entities identified in claim or fact.",
    };
  }

  if (claimEntity && !factEntity) {
    return {
      claimEntity,
      factEntity: null,
      status: "unknown",
      explanation: `Claim is for '${claimEntity}'; Canon fact does not specify an entity.`,
    };
  }

  if (!claimEntity && factEntity) {
    return {
      claimEntity: null,
      factEntity,
      status: "ambiguous",
      explanation: `Claim omits product entity, while Canon fact is specific to '${factEntity}'. Ambiguity requires human review.`,
    };
  }

  // Both claimEntity and factEntity exist
  if (claimEntity!.toLowerCase() === factEntity!.toLowerCase()) {
    return {
      claimEntity,
      factEntity,
      status: "exact_match",
      explanation: `Claim and Canon fact refer to the same product ('${claimEntity}').`,
    };
  }

  if (hasApprovedRelationship(claimEntity!, factEntity!, canon)) {
    return {
      claimEntity,
      factEntity,
      status: "approved_alias",
      explanation: `'${claimEntity}' is an explicitly approved alias/relationship for '${factEntity}'.`,
    };
  }

  // Different products! Never transfer evidence between unrelated products.
  return {
    claimEntity,
    factEntity,
    status: "different_product",
    explanation: `Entity mismatch: Claim specifies '${claimEntity}' while Canon fact specifies '${factEntity}'. Evidence cannot be transferred between unrelated products.`,
  };
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
