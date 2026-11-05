# Verity

Verity is a brand-compliance review system for marketing copy and product claims. It checks draft content against a versioned Brand Canon using three layers of review:

- deterministic rule checks for explicit violations
- a zero-LLM fallback engine for claims, quantities, expiry checks, tone, readability, and prompt-injection patterns
- an optional Gemini judge/verifier path for uncertain claims and high-impact contradictions

The app is built with Next.js and stores review data in Supabase. It exposes a small UI for submitting content, reading highlighted findings, and recording decisions with reasons.

## What Verity does

- audits draft text against approved rules and approved facts
- flags unsupported, contradicted, outdated, or legally sensitive claims
- routes only uncertain claims to the model instead of calling Gemini for every request
- keeps a cached review path to reduce repeated LLM spend
- records review runs, findings, and decisions for later inspection

## Architecture at a glance

The review flow is intentionally budget-aware:

1. deterministic checks run first
2. the offline engine scores the text without any LLM call
3. only ambiguous cases are triaged to the model
4. a single batched judge call is used when needed
5. a second verifier pass is reserved for high-impact contradictions only
6. repeated identical requests can reuse cached results

This keeps normal reviews cheap and predictable while still allowing a stronger model-assisted path when necessary.

## Prerequisites

- Node.js 20+
- npm
- a Supabase project with the review schema in place
- optional Gemini credentials for LLM-assisted review

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env.local` file and configure the required variables:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY

   # Preferred model policy for the runtime router
   LLM_POLICY=auto
   # legacy fallback still works: LLM_MODE=off

   GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   GEMINI_MODEL=gemini-2.5-flash
   VERIFIER_MODEL=gemini-2.5-flash-lite
   ```

   Notes:
   - `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` must stay server-only.
   - Do not prefix either with `NEXT_PUBLIC_`.
   - `LLM_POLICY` supports: `auto`, `thorough`, and `off`.
   - `LLM_MODE=off` is still accepted as a legacy fallback and maps to the same behavior.

3. Apply the Brand Canon and review schema in Supabase. The app expects tables such as `rules`, `facts`, `review_runs`, `findings`, and `decisions` to exist and contain the fields required by the runtime.

4. If you want to run offline-only mode, disable Gemini by setting:

   ```dotenv
   LLM_POLICY=off
   ```

   The offline engine expects fact records with approved keyword metadata for claim overlap checks. A typical migration looks like:

   ```sql
   alter table facts
     add column if not exists keywords text[] not null default '{}';

   update facts set keywords = '{price,cost,per user,per month}'
     where code = 'F-PRICE-001';
   update facts set keywords = '{claim,approved source,sources}'
     where code = 'F-FEAT-001';
   update facts set keywords = '{image,ocr,vision}'
     where code = 'F-FEAT-002';
   update facts set keywords = '{trial}'
     where code = 'F-OLD-001';
   ```

   This is only a baseline example; review keywords against your canonical source data before relying on them in production.

5. Start the app:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

## Application routes

- `/` — submit content, inspect highlighted findings, and save a decision with a required reason
- `/canon` — view the current rules and facts stored in Supabase
- `POST /api/review` — run an audit, persist a review snapshot, and return findings
- `GET /api/canon` — retrieve canon data for the read-only panel
- `POST /api/decisions` — record an accepted, dismissed, or overridden decision

The review API returns both audit status and persistence results separately. A review can be successful but still fail to save to Supabase; check `persistence.status` and `persistence.reason`.

## Manual smoke test

After the schema and credentials are live, submit this sample through the UI:

> Verity is the best AI tool, built with our new Verification Bot! ProofGate Pro costs $19 per user per month and the free trial lasts 30 days. We check images too, all with a proof gate.

Expected behavior with the seeded canon:

- deterministic findings catch phrases like `the best`, `Verification Bot`, and `proof gate`
- numeric and money claims are routed for human legal review
- the offline engine identifies expired trial claims and other mismatches
- the review page highlights spans and allows a decision with a reason
- the API response indicates whether the run and findings were saved

The legal-review route intentionally errs on the cautious side when handling numeric and financial spans. It can be stricter than a full legal assessment.

The offline engine uses sentence offsets, fact-keyword overlap, quantity normalization, negation checks, a weighted tone lexicon, readability heuristics, and prompt-injection detection. Grade A findings require strong evidence such as an expired fact, a quantity mismatch, or a clear injection pattern. Heuristic warnings are grade C and are tagged as offline, not model-verified.

## Benchmarking

The benchmark script exercises labeled violations, clean samples, and prompt-injection attempts. It reports per-sample misses, request errors, recall, precision, false-positive rate on clean content, citation validity, hidden grade-D findings, and prompt-injection leakage.

Run it against a local app or a deployed URL:

```bash
node scripts/benchmark.mjs http://localhost:3000
node scripts/benchmark.mjs https://YOUR_DEPLOYMENT_URL
```

The script sends 12 review requests, waits four seconds between them to respect the configured rate cap, and writes or replaces `benchmark-results.json` in the project root. Use a non-production environment because review runs and AI calls can consume quota.

## Deployment notes

The demo review and decision endpoints currently use server-side Supabase credentials and no user authentication.

Key cautions before exposing the app to untrusted users:

- add authentication and authorization for review and decision actions
- add rate limiting for decision submissions
- enforce content-length limits and abuse protections
- keep `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` on the server only
- review the database-backed throughput and quota limits on the review endpoint before launch

The review endpoint enforces a global cap of 20 reviews per minute and a 5,000-character content limit. These are demo boundaries, not production defaults.
