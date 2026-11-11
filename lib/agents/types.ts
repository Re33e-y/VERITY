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
  id?: string;
  text: string;
  context?: string;
  extracted_claim?: string;
}

// Structured specialist verdict
export type SpecialistVerdict =
  | "supported"
  | "unsupported"
  | "contradicted"
  | "compliant"
  | "non_compliant"
  | "insufficient_evidence"
  | "no_issue";

export interface SpecialistEvaluation {
  claim_id: string;
  agent_name: SpecialistKind;
  verdict: SpecialistVerdict;
  confidence: number;
  evidence: Citation[];
  evidence_quote?: string;
  reasoning_summary: string;
  recommended_action: "keep" | "flag" | "remedy" | "escalate" | "dismiss";
  requires_human_review: boolean;
  quote?: string;
  replacement?: string | null;
}

export type ConsensusStatus =
  | "consensus_reached"
  | "no_findings_to_review"
  | "disagreement"
  | "incomplete_review"
  | "model_failure";

export interface CriticVerdictItem {
  id: string;
  verdict: "keep" | "dismiss" | "downgrade" | "needs_evidence";
  reason: string;
  recheck: string | null;
  replacement: string | null;
}

export interface CriticConsensus {
  status: ConsensusStatus;
  verdicts: CriticVerdictItem[];
  agreed_count: number;
  disagreed_count: number;
  summary: string;
}

// ---- Brand Canon (as the agents see it; map your DB rows in adapters.ts) ----
export interface CanonRule {
  id: string;
  category: string;
  text: string;
  /** Approved replacement term/phrase, if the rule has one (banned term -> approved term). */
  replacement?: string | null;
}
// Product Entity and Relationship definitions for Entity-Aware Governance
export interface ProductEntity {
  name: string;
  aliases?: string[];
  tier?: string;
  parent?: string;
  description?: string;
}

export interface EntityRelationship {
  source: string;
  target: string;
  type: "alias" | "tier" | "feature_of" | "umbrella_brand";
}

export type EntityRelationStatus =
  | "exact_match"
  | "approved_alias"
  | "different_product"
  | "ambiguous"
  | "unknown";

export interface EntityResolutionResult {
  claimEntity: string | null;
  factEntity: string | null;
  status: EntityRelationStatus;
  explanation: string;
}

export interface CanonFact {
  id: string;
  text: string;
  keywords?: string[];
  valid_until?: string | null;
  entity?: string;
}
export interface Canon {
  version: string;
  rules: CanonRule[];
  facts: CanonFact[];
  entities?: ProductEntity[];
  relationships?: EntityRelationship[];
}

export interface Citation {
  type: "rule" | "fact";
  id: string;
}

// Specialist enrichment metadata attached when specialist findings overlap existing deterministic findings
export interface SpecialistEnrichment {
  agent: string;
  category: string;
  verdict?: string | null;
  confidence?: number;
  citations: Citation[];
  reasoning: string;
  legal_interpretation?: string;
  requires_human_review?: boolean;
  suggested_fix?: string | null;
}

// Complete lifecycle tracking: Specialist -> First guard -> Critic -> Second guard -> Final finding
export interface FindingLifecycle {
  specialist?: {
    agent: string;
    verdict?: string | null;
    confidence?: number;
    reasoning?: string;
    citations?: Citation[];
  };
  first_guard?: {
    action: "kept" | "enriched" | "refined" | "dropped";
    detail: string;
  };
  critic?: {
    verdict: "keep" | "dismiss" | "downgrade" | "needs_evidence";
    reason: string;
  };
  second_guard?: {
    action: "accepted" | "overruled" | "downgraded" | "suppressed";
    detail: string;
  };
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
  status?: "verified" | "rejected" | "proposed";
  failed_reason?: string;
  attempts?: number;
}

// ---- Findings ----
export interface Finding extends Span {
  /** In-flight id. Your persistence layer should keep assigning real UUIDs. */
  id: string;
  claim_id?: string;
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
  verdict?: string | null;
  reasoning_summary?: string;
  legal_interpretation?: string;
  requires_human_review?: boolean;
  severity?: Severity;
  enrichments?: SpecialistEnrichment[];
  lifecycle?: FindingLifecycle;
  entity_resolution?: EntityResolutionResult;
}

export interface SuppressedFindingDetail {
  id: string;
  quote: string;
  category: string;
  source: string;
  critic_verdict: string;
  critic_explanation: string;
  second_guard_explanation: string;
}

export interface Suppressed {
  finding: Finding;
  reason: string;
  by: "critic" | "second_guard";
  critic_verdict?: "dismiss" | "downgrade";
  critic_explanation?: string;
  second_guard_explanation?: string;
  lifecycle?: FindingLifecycle;
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
  claim?: string;
  verdict?: string;
  confidence?: number;
  evidence?: string;
  reasoning?: string;
  guard_status?: "accepted" | "rejected" | "overruled" | "deduplicated";
  critic_result?: string;
  remediation_verification?: string;
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
  enrichments?: SpecialistEnrichment[];
  lifecycle?: FindingLifecycle;
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
  critic_explanation?: string;
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
  consensus?: CriticConsensus;
  suppressed_details?: SuppressedFindingDetail[];
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
  pipeline_version?: string;
  config_version?: string;
  schema_version?: string;
  canon_digest?: string;
}

export interface CacheAdapter {
  get(key: string): Promise<AgenticResult | null>;
  set(key: string, value: AgenticResult): Promise<void>;
}