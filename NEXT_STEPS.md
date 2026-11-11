# NEXT STEPS — VERITY

## Current Status
- **Current Stage**: Starting Phase 3 — Governance and Evidence Reliability
- **Last Completed Task**: Phase 2 — Complete the Agentic Engine (Multi-provider fallback implemented & verified)

## Immediate Next Steps (Phase 3)
1. **ProofGate Invariant Verification**:
   - Verify Grade D findings strictly hidden from normal user results, counted in summary, stored in audit trace.
   - Verify Grade A findings are immutable.
2. **Finding Decision Lifecycle & Audit Logging**:
   - Complete human decision workflow in `app/api/decisions/route.ts` & `lib/review/decisionValidation.ts`:
     - `accept`, `dismiss`, `override`, `request_review`.
     - Associate `decided_by` (actor) and `timestamp`.
3. **IntentLock Remediation Inspection & UI Integration**:
   - Verify before/after diff representation and deterministic re-verification.
