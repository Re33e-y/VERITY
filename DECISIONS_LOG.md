# DECISIONS LOG — VERITY

## Architectural Decisions & Records

### 2026-11-11 — Round 3 Architecture Audit & Findings
- **Audit Finding 1**: Production uses `REVIEW_AGENTS=on` with V1 Router as the base deterministic triage. V2 Review Engine is also functional and both are kept intact.
- **Audit Finding 2**: Provider fallback in `lib/engine/gateway-llm.ts` handles Gemini → OpenRouter for V1 router, and `lib/llm/gateway.ts` has multi-provider support for V2.
- **Audit Finding 3**: Round 2 commitments retrieved from `VERITY_Round2.pdf` (p. 3–4):
  1. *IntentLock*: Self-verified, intent-preserving fixes with before/after diff.
  2. *PolicyPulse*: Guideline Clarity Radar and governance dashboard (override rates, repeat violations, expiring facts).
  3. *Review Workflow / Precedent Library*: Full approval/dismiss/override flow with actor/timestamp, precedent reuse on similar content.

### 2026-11-11 — Phase 2: Agentic Engine & Provider Fallback
- **Decision**: Enhanced `lib/agents/llm.ts` with transparent provider failover chain:
  - Primary: Google Gemini (`gemini-2.5-flash`).
  - Fallback 1: OpenRouter (`OPENROUTER_API_KEY` & `OPENROUTER_MODEL`).
  - Fallback 2: Cloudflare AI (`CLOUDFLARE_ACCOUNT_ID` & `CLOUDFLARE_API_TOKEN`).
- **Decision**: Provider failover preserves single call budget (`budget.take()` taken once per logical call).
- **Decision**: Added `getProvidersUsed()`, `getLastProviderUsed()`, and added `providers_used` to `AgenticResult` and `agent_traces`.
- **Decision**: Added Test 24 in `scripts/test-agents.mts`, verifying 429 quota failover from Gemini to OpenRouter without degrading to offline.
