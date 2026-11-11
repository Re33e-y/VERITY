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
- **Decision**: Added `getProvidersUsed()`, `getLastProviderUsed()`, and added `providers_used` to `AgenticResult` and `agent_traces`.
- **Decision**: Added Tests 24, 25, 26 in `scripts/test-agents.mts`, verifying:
  - Gemini 429 failover to OpenRouter
  - Gemini 500 & OpenRouter 502 failover to Cloudflare AI
  - Total outage graceful fallback to labeled offline findings with `ai_unavailable: true`.

### 2026-11-11 — Phase 3 & 4: Round 3 Delivery
- **Decision**: Expanded human decision lifecycle in `lib/review/decisionValidation.ts` to include `request_review` alongside `accepted`, `dismissed`, and `overridden`.
- **Decision**: Embedded IntentLock Before/After visual diff directly on findings with red strike-through, green verified rewrite, and deterministic re-verification badge.
- **Decision**: Created `app/api/eval/route.ts` with 8 labeled benchmark test cases, calculating Precision, Recall, F1, and confusion matrix live.
- **Decision**: Integrated PolicyPulse™ dashboard into the main console with Guideline Clarity Radar, human override tracking (8.2%), repeat violations leaderboard, and fact freshness watchlist.
- **Decision**: Added Versioned Brand Canon management with change proposals, governance approval flow, and instant rollback to v1.
- **Decision**: Added multi-workspace switcher (Default Brand Workspace, Enterprise Security Team, Judge Demo Workspace) with zero-friction Judge Demo mode.

### 2026-11-11 — Phase 9: Final Production Audit & Server-Side Workspace Access Controls
- **Audit Verification 1 (Workspace Security & Server-Side Access Controls)**: Verified `lib/supabase.ts` enforces `import "server-only"`; `SUPABASE_SERVICE_ROLE_KEY` is never bundled into client chunks. Added server-side `workspace_id` header and payload extraction to `POST /api/review`, `POST /api/decisions`, `/history`, and `/history/[id]`. Enforces cross-workspace access isolation so finding decisions and review runs from one private workspace cannot be accessed, modified, or inspected from another workspace without authorization.
- **Audit Verification 2 (Provider Fallback Chain)**: Verified all 3 providers with automated tests 24, 25, and 26. Final response identifies `providers_used`.
- **Audit Verification 3 (Evaluation Suite Framing)**: Explicitly labeled the 8-case benchmark in UI and docs as an internal regression verification suite rather than claiming unconstrained generalization.
- **Audit Verification 4 (Production Build & Streaming)**: Solved Next.js 16 Partial Prerender requirement on `/history` and `/history/[id]` by moving `searchParams` consumption inside `<Suspense>` boundaries.
