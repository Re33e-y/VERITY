# Verity

Verity is a brand-compliance review system for marketing copy and product claims. It checks draft content against a versioned Brand Canon using a deterministic engine, an offline fact-and-claim evaluator, and an optional Gemini judge/verifier path when the case is ambiguous.

Live production app:

- https://verity-two-chi.vercel.app

## Current status

This project is live on Vercel and connected to Supabase and Gemini. The production environment was fixed after the Supabase URL was re-entered correctly; the original issue was not `LLM_POLICY` and not the `eyJ2...` value itself.

Production validation completed successfully:

- browser test reported: `AI judge: ok`
- review and findings were saved to Supabase
- 12/12 benchmark samples completed with no request errors
- all rows reported `ai=ok`
- recall: 100%
- precision: 100% after the label fix
- false positives: 0%
- citation validity: 100%
- prompt-injection leaks: 0

Important nuance:

- the 12 benchmark samples are tuned samples, not a held-out set
- the only metrics that can be defended as real generalization are the held-out samples (H01 to H10)
- an earlier run reported precision of 68.8% before the label fix; that value is historical and not the current production result

## What Verity does

- audits text against approved rules and approved facts
- flags unsupported, contradicted, outdated, or legally sensitive claims
- only routes ambiguous cases to the model instead of calling Gemini for every review
- reduces repeated LLM spend through cache reuse
- persists review runs, findings, and decisions in Supabase

## Architecture

The review flow is budget-aware and intentionally layered:

1. deterministic checks run first
2. the offline engine checks facts, quantities, expiry, tone, readability, and prompt-injection patterns with zero LLM calls
3. only uncertain items are triaged to the model
4. a single batched judge call handles ambiguous claims
5. a second verifier pass is reserved for high-impact contradictions
6. repeated identical requests can use cached results

This keeps most reviews local and cheap while retaining a stronger model-assisted path for nuanced cases.

## Call budget evidence

The live production benchmark confirms the routing logic is working as intended:

- 12 reviews total
- 2 LLM calls on the first cold run
- 0 LLM calls on the warm rerun
- 11 of 12 reviews resolved locally with zero model usage
- the one hybrid review was served from cache on the rerun

This is the current call budget statement to cite in material or demos:

> 12 reviews, 2 LLM calls on a cold run, 0 on a warm one.

## Prerequisites

- Node.js 20+
- npm
- a Supabase project with the review schema in place
- optional Gemini credentials for model-assisted review

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` with the required variables:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY

   LLM_POLICY=auto
   # Optional: opt in to the new review pipeline; unset keeps the existing route.
   # Apply supabase/migrations/20261106_llm_cache_and_provider_health.sql first.
   # REVIEW_PIPELINE=v2
   # legacy support still works:
   # LLM_MODE=off

   GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   GEMINI_MODEL=gemini-2.5-flash
   VERIFIER_MODEL=gemini-2.5-flash-lite
   # Optional v2 fallbacks:
   # OPENROUTER_API_KEY=
   # OPENROUTER_MODEL=
   # CLOUDFLARE_ACCOUNT_ID=
   # CLOUDFLARE_API_TOKEN=
   # CLOUDFLARE_MODEL=
   # LLM_PROVIDER_ORDER=gemini,openrouter,cloudflare
   # LLM_MAX_CALLS=2
   # REVIEW_MAX_CHARS=12000
   ```

   Notes:
   - `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` must remain server-only.
   - do not prefix either value with `NEXT_PUBLIC_`.
   - `LLM_POLICY` supports `auto`, `thorough`, and `off`.
   - `LLM_MODE=off` is still accepted as a legacy fallback.
   - `REVIEW_PIPELINE=v2` opts into the new provider pipeline; unset or any other value keeps the existing review path.
   - The v2 path uses the rule patterns/preferred terms and fact expiry dates from the existing canon tables. Run its migration before enabling it.
   - OpenRouter and Cloudflare are optional fallbacks; configure the corresponding credentials and model settings to enable them.

3. Apply the Brand Canon and review schema in Supabase. The app expects tables such as `rules`, `facts`, `review_runs`, `findings`, and `decisions` to exist and contain the fields required for runtime evaluation.

4. If you want to run the app in offline-only mode, set:

   ```dotenv
   LLM_POLICY=off
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

## Application routes

- `/` — submit content, inspect highlighted findings, and save a decision with a required reason
- `/canon` — view the current rules and facts in Supabase
- `POST /api/review` — run an audit, persist a review snapshot, and return findings
- `GET /api/canon` — retrieve canon data for the read-only panel
- `POST /api/decisions` — record an accepted, dismissed, or overridden decision

The review API returns both audit status and persistence results separately. A review can be successful and still fail to save to Supabase; check `persistence.status` and `persistence.reason`.

## Smoke test

Use this sample in the UI:

> Verity is the best AI tool, built with our new Verification Bot! ProofGate Pro costs $19 per user per month and the free trial lasts 30 days. We check images too, all with a proof gate.

Expected behavior with the seeded canon:

- deterministic findings flag phrases like `the best`, `Verification Bot`, and `proof gate`
- numeric and money claims are routed for human legal review
- the offline engine catches expired trial claims and other mismatches
- the review page highlights findings and allows a decision with a reason
- the API response reports whether the run and findings were saved

The legal-review route is intentionally conservative for numeric and financial spans.

The offline engine uses sentence offsets, fact-keyword overlap, quantity normalization, negation checks, a weighted tone lexicon, readability heuristics, and prompt-injection detection. Grade A findings require strong evidence such as an expired fact, a quantity mismatch, or a clear injection pattern. Heuristic warnings are grade C and tagged as offline rather than model-verified.

## Benchmarking

The benchmark script exercises labeled violations, clean samples, and prompt-injection attempts. It reports per-sample misses, request errors, recall, precision, false-positive rate on clean content, citation validity, hidden grade-D findings, and prompt-injection leakage.

Run it locally or against a deployed URL:

```bash
node scripts/benchmark.mjs http://localhost:3000
node scripts/benchmark.mjs https://YOUR_DEPLOYMENT_URL
```

The script sends 12 review requests, waits four seconds between them to stay under the configured rate cap, and writes or replaces `benchmark-results.json` in the project root.

Current benchmark result summary:

- 12/12 sample requests succeeded
- 0 request errors
- recall: 100%
- precision: 100% after label fix
- false positives: 0%
- citation validity: 100%
- prompt-injection leaks: 0

## Housekeeping and deployment notes

- delete `.env.check` if it is still present in the project folder; it contained a live Vercel token that expires automatically
- keep a second Gemini key ready before any live demo
- check Gemini quota in AI Studio before presenting the app publicly

The demo review and decision endpoints use server-side Supabase credentials and do not implement user authentication.

Key cautions before exposing the app to untrusted users:

- add authentication and authorization for review and decision actions
- add rate limiting for decision submissions
- enforce content-length limits and abuse protections
- keep `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` on the server only
- review the database-backed throughput and quota limits on the review endpoint before launch

The review endpoint enforces a global cap of 20 reviews per minute and a 5,000-character content limit. These are demo boundaries, not production defaults.
