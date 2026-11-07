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

| Run | Cache state | LLM calls (42 reviews) | Cache hits |
|---|---|---:|---:|
| Router, round 1 | Cache adapter schema mismatch | 5 | 0 |
| Router, rerun, round 1 | Cache adapter schema mismatch | 5 | 0 |
| Router, after fix, first run | Warm from earlier tests | 3 | 1 |
| Router, after fix, fresh server | Persisted in Supabase | 0 | 4 of 4 hybrid |

Of 42 reviews, 38 resolved locally with no model call and 4 went to the hybrid path. A truly empty cache would cost about 5 LLM calls for the 42-sample set; the 3-call figure reflects entries left by earlier test runs. The first rerun showed 0 cache hits because the router's cache adapter used column names that did not exist in the migration. It was fixed to use `cache_key`, `payload`, `kind` and `expires_at`, then re-verified, and the cache now persists across server restarts.

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
   # Optional fallback for the default router path; both are required:
   # OPENROUTER_API_KEY=
   # OPENROUTER_MODEL=
   # Optional v2-only provider settings:
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
   - In the default router, OpenRouter is an optional fallback after Gemini; set both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` to enable it. Cloudflare settings apply only to v2.
   - Before sending any real or customer content to a third-party provider, review that provider's data-use policy and disclose the configured provider and model to users. Use synthetic samples for provider testing.

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
- `/history` — browse the 100 most recent review runs, routing, findings, and decisions
- `/history/[id]` — inspect reviewed text, the saved review snapshot, findings, and decision log
- `POST /api/review` — run an audit, persist a review snapshot, and return findings
- `GET /api/canon` — retrieve canon data for the read-only panel
- `POST /api/decisions` — record an accepted, dismissed, or overridden decision for a finding

The review API returns both audit status and persistence results separately. A review can be successful and still fail to save to Supabase; check `persistence.status` and `persistence.reason`.

Decision submissions require a valid `finding_id`, one of `accepted`, `dismissed`, or `overridden`, and a reason between 5 and 1,000 characters. The API verifies that the finding exists before saving the decision. Its database relationship is finding-based; the review run is resolved through the finding's `review_run_id`.

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

The evaluation set contains 42 synthetic samples: 12 original examples and 30 held-out examples. `scripts/lib.mjs` contains the brand pack, sample labels, and scoring functions. `scripts/benchmark.mjs` tests the running review API; `scripts/benchmark.old.mjs` preserves the previous 12-sample runner. The optional `scripts/baseline-plain-llm.mjs` compares a plain Gemini call against the same labels without the rules engine or evidence validation.

Run the API benchmark locally with the app running:

```powershell
# Offline-only router
$env:LLM_POLICY="off"
npm run dev
# In a second terminal:
node scripts/benchmark.mjs http://localhost:3000 --tag offline-only

# Stop the dev server, remove the shell override, then restart in router mode:
Remove-Item Env:LLM_POLICY
npm run dev
# In a second terminal:
node scripts/benchmark.mjs http://localhost:3000 --tag router
node scripts/benchmark.mjs http://localhost:3000 --tag router-rerun
```

The runner defaults to all samples with a four-second delay, staying below the API's 20-reviews-per-minute cap. Select a subset with `--set original` or `--set heldout`; use `--tag <name>` to write a distinct `benchmark-<name>.json` file. Review the printed misses and unexpected flags alongside the summaries. The cache rerun should be done against the same running server and canon.

Do not run the benchmark against the live deployment until its server-side environment variables have been verified and a deployment is intentionally approved. The test samples are synthetic; do not substitute customer content. The plain-LLM baseline makes a direct Gemini API call for each sample and can consume quota:

```powershell
node scripts/baseline-plain-llm.mjs --set heldout --limit 10 --tag plain-llm
```

Historical result: the previous 12-sample benchmark reported 100% recall and precision, 0% false positives, 100% citation validity, and no prompt-injection leaks. Those tuned examples are not a held-out evaluation.

Results for the 42-sample set are summarized in the call-budget table above. On the held-out set, offline-only and router modes gave identical accuracy (84.0% recall, 73.3% precision, 25.0% false-positive rate). The router reduces LLM spend but did not improve accuracy on these samples; remaining errors come from offline-engine heuristics. Round 1 numbers were not changed after seeing them.

Held-out, plain LLM + guidelines: not measured (Gemini quota returned HTTP 429 on the first sample; 0 of 30 completed).

The round-one and post-fix benchmark reports are preserved under [`results/`](./results/).

## Decision API test

With the local development server running, check invalid submissions and a valid-but-unknown finding ID. These rejection cases do not write rows:

```powershell
node scripts/test-decision-api.mjs
```

An optional write test needs an existing finding ID and deliberately adds one decision row:

```powershell
$env:FINDING_ID="<existing finding UUID>"
$env:WRITE_TEST="1"
node scripts/test-decision-api.mjs
Remove-Item Env:FINDING_ID
Remove-Item Env:WRITE_TEST
```

History pages have no authentication and display submitted text and reviewer decisions. Authentication is intentionally omitted for judge access; this is disclosed for the demo. Do not use real or customer content.

## Housekeeping and deployment notes

- delete `.env.check` if it is still present in the project folder; it contained a live Vercel token that expires automatically
- keep a second Gemini key ready before any live demo
- check Gemini quota in AI Studio before presenting the app publicly

The demo review and decision endpoints use server-side Supabase credentials and intentionally do not require authentication so judges can access the app. The review endpoint enforces a global cap of 20 reviews per minute and a 5,000-character content limit. These are demo boundaries, not production defaults. Keep `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` on the server only.
