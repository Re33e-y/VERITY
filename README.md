# Verity

Verity reviews marketing copy and product claims against a versioned Brand Canon. Deterministic rules and an offline fact-and-claim evaluator run first; ambiguous claims can be sent to a Gemini judge and verifier. Reviewers can accept, dismiss, or override findings with a written reason. Review runs and decisions are shown in a read-only history.

**Live app:** [verity-two-chi.vercel.app](https://verity-two-chi.vercel.app)

> **Demo notice:** Use synthetic content only. The app has no authentication, and submitted text and decisions are visible in the history.

## What Verity does

- Checks drafts against approved brand rules and facts.
- Flags unsupported, contradicted, outdated, legally sensitive, and instruction-like content.
- Resolves many reviews locally without an LLM call and routes only ambiguous cases to a model.
- Reuses cached judge results for identical reviews.
- Requires a 5–1,000 character reason for each human decision.
- Saves review runs, findings, and decisions in Supabase.

## How it works

1. Deterministic checks run first.
2. The offline engine checks facts, quantities, expiry dates, tone, readability, and prompt-injection patterns.
3. Only uncertain claims are routed to the model.
4. A single batched Gemini judge call handles ambiguous claims.
5. A verifier pass is reserved for high-impact contradictions. A model cannot clear a Contradicted finding raised by the rules.
6. Identical reviews can use a Supabase-backed cache. Cache keys include model names; expired entries count as misses.
7. Model calls time out after 20 seconds. If no provider succeeds, the review falls back to offline findings, withholds the score, and reports that the AI judge is unavailable.
8. A reviewer records a decision and reason for each finding.

## Call budget

| Run | Cache state | LLM calls (42 reviews) | Cache hits |
|---|---|---:|---:|
| Router, round 1 | Cache adapter schema mismatch | 5 | 0 |
| Router rerun, round 1 | Cache adapter schema mismatch | 5 | 0 |
| Router after fix, first run | Warm from earlier tests | 3 | 1 |
| Router after fix, fresh server | Persisted in Supabase | 0 | 4 of 4 hybrid |

Across 42 reviews, 38 resolved locally and 4 used the hybrid path. A truly empty cache would require about 5 LLM calls; the 3-call first run reused entries from earlier tests. The initial rerun had no cache hits because the adapter used columns absent from the migration. It was corrected to use `cache_key`, `payload`, `kind`, and `expires_at`. A synthetic ambiguous production review used 2 calls on its first run and 0 on the cached repeat.

## Benchmark

The evaluation set contains 42 synthetic samples: 12 original samples used during rule tuning and 30 held-out samples. [`scripts/lib.mjs`](./scripts/lib.mjs) contains the brand pack, labels, and scoring functions. [`scripts/benchmark.mjs`](./scripts/benchmark.mjs) tests the running review API; [`scripts/baseline-plain-llm.mjs`](./scripts/baseline-plain-llm.mjs) compares a plain Gemini call against the same labels.

| Set | Mode | Samples | Recall | Precision | False-positive rate | LLM calls |
|---|---|---:|---:|---:|---:|---:|
| Original | Offline only | 12 | 100.0% | 100.0% | 0.0% | 0 |
| Original | Router | 12 | 100.0% | 100.0% | 0.0% | 2 |
| Held-out | Offline only | 30 | 84.0% | 73.3% | 25.0% | 0 |
| Held-out | Router | 30 | 84.0% | 73.3% | 25.0% | 3 |
| Held-out | Plain LLM + guidelines | 30 | Not measured | Not measured | Not measured | 0 completed |

Citation validity was 100% and prompt-injection leaks were 0 in the router runs.

### Interpreting the results

- Offline-only and router modes had identical accuracy on the held-out set. The router reduced model spend but did not improve accuracy on these samples; remaining errors came from offline heuristics.
- The original 12 samples were used while tuning the rules, so their 100% result is a development result, not evidence of generalization. An earlier run reported 68.8% precision before a label correction; the corrected labels produced 100% on this tuned set.
- The held-out results are the generalization evidence. Round-one results were not changed after they were seen.
- The plain-LLM baseline did not complete: Gemini returned HTTP 429 on the first sample, so no baseline metric is reported.
- All samples are synthetic. No customer content was used.

Benchmark reports are kept in [`results/`](./results/).

## Known limits

- **Held-out misses:** H02 (Outdated), H03 (Contradicted or Unsupported), H06 (R-TONE-001), and H18 (Instruction-like).
- **Held-out false positives:** H02, H11, H13, H16, H17, H23, H25, and H28. These include heuristic `Unsupported` flags on claims such as “saves hours” and conservative legal-review flags on phrases such as “100% accurate” and “guaranteed.”
- **Injection detection is imperfect:** the benchmark reported no prompt-injection leaks, but the engine missed H18 as a finding.
- **Small sample size:** the evaluation has 42 samples, including 30 held-out samples, so percentages have substantial uncertainty.
- **Gemini quota:** when quota is exhausted, ambiguous reviews fall back to offline results. Cached reviews can still be served.
- **OpenRouter fallback:** disabled in production. It is implemented and tested with mocks, but no fallback model is configured. Any future use requires `data_collection: deny`, zero-data-retention routing, and review of the provider’s data-use policy.
- **No authentication:** review, decision, and history endpoints are open for demo access. This is not suitable for untrusted production use. The review endpoint has a global limit of 20 reviews per minute and a 5,000-character content limit; these are demo boundaries.

## Interface

- **Review:** draft input and results use a two-column desktop layout and stack on small screens. Includes a demo notice, example buttons, a loading state, and Ctrl+Enter submission.
- **Results:** an audit summary and score ring, route and persistence notices, statistics, highlighted reviewed text, and an accordion of findings. Opening a finding emphasizes its span and shows its explanation, suggested correction, and decision form.
- **History and Brand Canon:** read-only pages for review runs, decisions, rules, and approved facts.
- **Accessibility:** visible keyboard focus, reduced-motion support, and findings with both icon and text labels. Palette contrast can be checked with [`scripts/ui-contrast.mjs`](./scripts/ui-contrast.mjs).
- **Built with:** Next.js, Tailwind CSS v4, shadcn/ui components, Radix Accordion, and lucide-react.

## Application routes

- `/` — submit content, inspect highlighted findings, and record a decision with a reason
- `/canon` — view current rules and facts
- `/history` — browse the 100 most recent review runs, findings, routing, and decisions
- `/history/[id]` — inspect reviewed text, the saved review snapshot, findings, and decision log
- `POST /api/review` — run an audit, persist a review snapshot, and return findings
- `GET /api/canon` — retrieve canon data for the read-only panel
- `POST /api/decisions` — record an accepted, dismissed, or overridden decision

The review API reports audit status and persistence separately. A review can succeed while saving fails; check `persistence.status` and `persistence.reason`.

Decision submissions require a valid `finding_id`, a decision of `accepted`, `dismissed`, or `overridden`, and a reason of 5–1,000 characters. The API verifies that the finding exists; its review run is resolved through the finding’s `review_run_id`.

## Local setup

Prerequisites: Node.js 20+, npm, a Supabase project with the review schema, and optional Gemini credentials for model-assisted reviews.

Install dependencies:

```bash
npm install
```

Create `.env.local` (do not commit it):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY

LLM_POLICY=auto
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.5-flash
VERIFIER_MODEL=gemini-2.5-flash-lite

# Optional OpenRouter fallback (disabled in production):
# OPENROUTER_API_KEY=
# OPENROUTER_MODEL=

# Optional experimental v2 pipeline:
# REVIEW_PIPELINE=v2
# CLOUDFLARE_ACCOUNT_ID=
# CLOUDFLARE_API_TOKEN=
# CLOUDFLARE_MODEL=
# LLM_PROVIDER_ORDER=gemini,openrouter,cloudflare
# LLM_MAX_CALLS=2
# REVIEW_MAX_CHARS=12000
```

Configuration notes:

- Keep `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` server-side; never prefix them with `NEXT_PUBLIC_`.
- `LLM_POLICY` accepts `auto`, `thorough`, or `off`. Set it to `off` for offline-only reviews. The legacy `LLM_MODE=off` switch is also supported.
- The default review route has a 5,000-character limit. `REVIEW_MAX_CHARS` applies only to the v2 pipeline.
- `REVIEW_PIPELINE=v2` opts into the experimental provider pipeline. Apply `supabase/migrations/20261106_llm_cache_and_provider_health.sql` first. Leave it unset to use the default route.
- The router cache and v2 cache both use the migration’s `llm_cache` table.
- Before enabling an external provider, review its data-use policy and disclose the configured provider and model. Use synthetic samples for provider testing.

Apply the Brand Canon and database schema (`rules`, `facts`, `review_runs`, `findings`, `decisions`, and, if using the router cache, `llm_cache`). Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Smoke test

Paste this synthetic sample into the review page:

> Verity is the best AI tool, built with our new Verification Bot! ProofGate Pro costs $19 per user per month and the free trial lasts 30 days. We check images too, all with a proof gate.

With the seeded canon, expect findings for phrases such as `the best`, `Verification Bot`, and `proof gate`; numeric and money claims may be routed for human legal review, and outdated trial claims may be flagged. The legal-review route is deliberately conservative about numbers and money.

The offline engine uses sentence offsets, fact-keyword overlap, quantity normalization, negation checks, a weighted tone lexicon, readability heuristics, and prompt-injection detection. Grade A findings require strong evidence, such as an expired fact, quantity mismatch, or clear injection pattern. Heuristic warnings are grade C and tagged as offline rather than model-verified.

## Run the benchmark

Run benchmarks against a local server only. Do not use customer content or run benchmarks against the live deployment.

```powershell
# Offline-only router
$env:LLM_POLICY="off"
npm run dev
# In a second terminal:
node scripts/benchmark.mjs http://localhost:3000 --tag offline-only

# Stop the dev server, remove the override, and restart in router mode:
Remove-Item Env:LLM_POLICY
npm run dev
# In a second terminal:
node scripts/benchmark.mjs http://localhost:3000 --tag router
node scripts/benchmark.mjs http://localhost:3000 --tag router-rerun
```

The runner waits four seconds between requests to stay under the 20-per-minute limit. Use `--set original` or `--set heldout` to select a subset and `--tag <name>` to name the output file (`benchmark-<name>.json`). Run cache comparisons against the same server and canon.

The plain-LLM baseline makes a direct Gemini call for each sample and can consume quota. It defaults to 10 samples; use `--limit 30` for all held-out samples:

```powershell
node --env-file=.env.local scripts/baseline-plain-llm.mjs --set heldout --tag plain-llm --limit 30
```

## Decision API test

With the local server running, test invalid submissions and a valid-but-unknown finding ID. These rejection cases do not write rows:

```bash
node scripts/test-decision-api.mjs
```

An optional write test needs an existing finding ID and deliberately adds a decision row:

```powershell
$env:FINDING_ID="<existing finding UUID>"
$env:WRITE_TEST="1"
node scripts/test-decision-api.mjs
Remove-Item Env:FINDING_ID
Remove-Item Env:WRITE_TEST
```

## Operational notes

- Check Gemini quota before a public demo and keep a second key ready.
- Pre-run demo samples if their results need to be cached.
- Do not enter real or customer content. History pages are public and display submitted text and decisions.

## Credits

UI components use [shadcn/ui](https://ui.shadcn.com/) and Radix UI primitives, with icons from [lucide-react](https://lucide.dev/).
