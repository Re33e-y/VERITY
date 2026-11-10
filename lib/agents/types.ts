// lib/agents/types.ts
// Shared types for Verity's agentic review layer.

export type Policy = "auto" | "thorough" | "off";
export type Grade = "A" | "B" | "C";
export type SpecialistKind = "tone" | "fact" | "legal";

export interface Span {
  start: number;
  end: number;
}
export interface FocusSentence extends Span {
  text: string;
}

// ---- Brand Canon (as the agents see it; map your DB rows in adapters.ts) ----
export interface CanonRule {
  id: string;
  category: string;
  text: string;
  /** Approved replacement term/phrase, if the rule has one (banned term -> approved term). */
  replacement?: string | null;
}
export interface CanonFact {
  id: string;
  text: string;
  keywords?: string[];
  valid_until?: string | null;
}
export interface Canon {
  version: string;
  rules: CanonRule[];
  facts: CanonFact[];
}

export interface Citation {
  type: "rule" | "fact";
  id: string;
}

// ---- Remediation ----
export interface Patch {
  start: number;
  end: number;
  original: string;
  replacement: string;
  rationale: string;
  origin: "canon" | "panel" | "critic" | "retry";
  /** True only if the offline engine no longer flags the patched span. */
  verified: boolean;
  verification: string;
}

// ---- Findings ----
export interface Finding extends Span {
  /** In-flight id. Your persistence layer should keep assigning real UUIDs. */
  id: string;
  quote: string;
  category: string;
  grade: Grade;
  /** "rule" | "offline" | "agent:tone" | "agent:fact" | "agent:legal" */
  source: string;
  explanation: string;
  suggestion?: string | null;
  citations: Citation[];
  confidence?: number;
  notes?: string[];
  patch?: Patch;
  /** Internal: replacement proposed by an agent, consumed by remediation, stripped before returning. */
  draftFix?: string | null;
}

export interface Suppressed {
  finding: Finding;
  reason: string;
  by: "critic";
}

export type OfflineFn = (text: string, canon: Canon) => Finding[] | Promise<Finding[]>;

// ---- Orchestration ----
export interface Plan {
  engage: boolean;
  reason: string;
  policy: Policy;
  maxCalls: number;
  focus: FocusSentence[];
  specialists: SpecialistKind[];
  /** How specialists are packed into LLM calls under the budget. */
  groups: SpecialistKind[][];
  critic: boolean;
  /** Enables the self-correction loop (critic recheck) and remediation retry. */
  loop: boolean;
}

export interface TraceStep {
  agent: string;
  kind: "plan" | "llm" | "guard" | "verify" | "cache" | "skip";
  ok: boolean;
  calls: number;
  ms: number;
  detail: string;
}

// ---- Verity 2.0 governance report ----
export type Severity = "high" | "medium" | "low" | "info";
/** deterministic: proven by code | canon_cited: points at a real canon item, not proven | none: nothing approved backs it */
export type EvidenceStrength = "deterministic" | "canon_cited" | "none";

export interface GovernedFinding {
  /** In-flight id. The API assigns new UUIDs, so match UI findings to this list by start/end. */
  id: string;
  start: number;
  end: number;
  quote: string;
  category: string;
  grade: Grade;
  source: string;
  /** The model's own estimate. null for findings no model produced. Never combined with the other two. */
  confidence: number | null;
  evidence_strength: EvidenceStrength;
  severity: Severity;
  requires_human_review: boolean;
  review_reasons: string[];
  has_verified_patch: boolean;
}

export interface AgentActivity {
  agent: string;
  label: string;
  status: "completed" | "failed" | "skipped";
  calls: number;
  ms: number;
  summary: string;
}

export interface Disagreement {
  finding_id: string;
  raised_by: string;
  stance: "dismiss" | "downgrade";
  reason: string;
  resolution: string;
}

export interface Governance {
  config_version: string;
  /** Same input + canon + config + day gives the same key. Also the cache key. */
  idempotency_key: string;
  summary: {
    agents_involved: number;
    findings: number;
    needs_human_review: number;
    suppressed: number;
    unverifiable: number;
  };
  human_review_required: boolean;
  agents: AgentActivity[];
  findings: GovernedFinding[];
  disagreements: Disagreement[];
}

export interface AgenticResult {
  findings: Finding[];
  suppressed: Suppressed[];
  status: "skipped" | "agentic" | "degraded";
  /** True only when AI review was needed and no model call succeeded. Withhold the score, as you do today. */
  ai_unavailable: boolean;
  warnings: string[];
  calls_used: number;
  cache_hit: boolean;
  plan: Plan;
  trace: TraceStep[];
  governance: Governance;
}

export interface CacheAdapter {
  get(key: string): Promise<AgenticResult | null>;
  set(key: string, value: AgenticResult): Promise<void>;
}