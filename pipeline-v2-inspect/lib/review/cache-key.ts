import { createHash } from "node:crypto"
import type { BrandFact, BrandRule } from "./types"

export function normalizeContent(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim()
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/**
 * Digest of everything in the canon that can change a verdict. Version numbers
 * alone are not enough: an edited rule with a forgotten version bump would
 * otherwise keep serving stale cached answers.
 */
export function computeRulesetDigest(rules: BrandRule[], facts: BrandFact[]): string {
  const stableRules = [...rules]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => [r.id, r.title, r.description, r.severity, r.bannedTerms ?? [], r.expiresAt ?? null, r.version ?? 0])
  const stableFacts = [...facts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => [f.id, f.statement, f.status ?? "current", f.expiresAt ?? null, f.version ?? 0])
  return sha256(JSON.stringify([stableRules, stableFacts])).slice(0, 24)
}

export interface CacheKeyParts {
  kind: "judge" | "verify"
  content: string
  brandId: string
  rulesVersion: number
  factsVersion: number
  rulesetDigest: string
  promptVersion: string
  model: string
}

export function buildCacheKey(parts: CacheKeyParts): string {
  const payload = JSON.stringify([
    parts.kind,
    normalizeContent(parts.content),
    parts.brandId,
    parts.rulesVersion,
    parts.factsVersion,
    parts.rulesetDigest,
    parts.promptVersion,
    parts.model,
  ])
  return `${parts.kind}:${sha256(payload)}`
}
