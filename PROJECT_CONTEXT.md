# PROJECT CONTEXT — VERITY

## Product Identity
**VERITY · AGENT-FIRST GOVERNANCE**
*Core Principle: AI reasons. Code verifies. Humans govern.*

## Architecture Overview
VERITY audits marketing and brand copy against an approved Brand Canon (rules and facts).
It uses a multi-tiered architecture:
1. **Deterministic & Offline Engine** (`lib/engine/deterministic.ts`, `lib/engine/offline.ts`):
   - 0 LLM calls.
   - Evaluates exact regex patterns, banned phrases, quantities, numerical claims, date expirations, prompt injections.
   - Outputs Grade A findings (immutable).
2. **Review Pipeline Routing**:
   - `POST /api/review` receives audit requests.
   - Depending on `REVIEW_PIPELINE` (`v1` or `v2`), delegates to:
     - **Pipeline V1** (`lib/engine/router.ts`): Call-budget router aiming for 0-2 LLM calls with judge/verifier via `gateway-llm.ts`.
     - **Pipeline V2** (`lib/review/orchestrator.ts`): Tiered caching, claim risk triage, validation, verification via `lib/llm/gateway.ts`.
3. **Agent Orchestration Layer** (`lib/agents/pipeline.ts` — active when `REVIEW_AGENTS=on`):
   - `makePlan()` in `orchestrator.ts`: Triage uncertain sentences/claims.
   - Specialist Panel (`specialists.ts`): Fact, Legal, and Tone specialist models.
   - First Guard (`guards.ts`): Drops duplicates, filters over-cap candidates.
   - Critic (`critic.ts`): Synthesizes consensus, challenges weak evidence (`keep`, `dismiss`, `downgrade`, `needs_evidence`).
   - Second Guard (`guards.ts`): Suppresses dismissed findings while enforcing invariants (Grade A immutability, absolute guarantee protection).
   - Remediation (`remediation.ts` / IntentLock): Proposes fixes with before/after diffs, verified deterministically before surfacing.
   - `mergeAgentFindings()` & `buildGovernance()`: Combines enriched findings, checks invariants, generates audit trace.
4. **Provider Fallback & LLM Gateway** (`lib/llm/gateway.ts`, `lib/agents/llm.ts`):
   - Primary: Google Gemini (`gemini-2.5-flash`).
   - Fallback: OpenRouter (`anthropic/claude-3.5-sonnet` or configured model).
   - Fallback: Cloudflare AI.
   - Resilient JSON repair, truncation detection, 1-retry logic, call budget tracking.
5. **Persistence (Supabase)**:
   - `review_runs`: History of reviews, scores, metadata, workspace isolation.
   - `findings`: Associated audit findings with lifecycle and provenance.
   - `llm_cache`: Deterministic/hashed cache of LLM outputs.
   - `canon_rules`: Rules table (versioned).
   - `canon_facts`: Facts table (versioned).
   - `agent_traces`: Step-by-step agent execution traces.
   - Workspaces, Decisons, Canon versions, Evaluation runs.

## Key Directories
- `app/`: Next.js 16 App Router pages (`/`, `/review`, `/canon`, `/history`, `/api/*`).
- `lib/agents/`: Agentic orchestration pipeline (orchestrator, specialists, critic, guards, remediation, governance, llm).
- `lib/engine/`: Deterministic rules, offline engine, call-budget router V1.
- `lib/review/`: Pipeline V2 engine, tiered cache, claims extraction, verifier.
- `lib/llm/`: Provider gateway and adapters (Gemini, OpenRouter, Cloudflare).
- `types/`: Core TypeScript interfaces (`engine.ts`, etc.).
- `scripts/`: Verification scripts (`test-agents.mts`, benchmarks).

## Core Governance Invariants
1. Grade A (deterministic rule) findings are immutable; no model may overrule them.
2. Absolute guarantee claims (zero risk, 100% guarantee, etc.) always require human review.
3. Closed-world evidence: models cannot invent Canon evidence.
4. Entity protection: evidence cannot transfer between distinct products; entity mismatches escalate rather than dismiss.
5. Remediation patches must pass deterministic re-verification.
6. Grade D findings are suppressed from the main view but recorded in audit trace.
