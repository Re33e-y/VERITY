# Verity review pipeline v2: integration guide

New code only. It does not modify or replace `lib/engine/router.ts`, `offline.ts`
or `app/api/review/route.ts`, so you can add it, test it, and switch over when ready.

## Files

| Path | Purpose |
| --- | --- |
| `lib/llm/types.ts`, `http.ts`, `util.ts` | Provider interface, typed errors, timeout-safe POST |
| `lib/llm/providers/gemini.ts`, `openrouter.ts`, `cloudflare.ts` | Provider adapters |
| `lib/llm/gateway.ts` | Timeouts, bounded retries, one fallback, circuit breaker |
| `lib/review/injection.ts` | Input normalization and prompt-injection detection |
| `lib/review/claims.ts` | Offline claim extraction and fact coverage |
| `lib/review/local.ts` | Built-in local engine (swap in your own with the same signature) |
| `lib/review/risk.ts` | Risk-based router and call budget |
| `lib/review/judge.ts`, `verifier.ts` | Prompts and strict output parsing |
| `lib/review/validator.ts` | ProofGate: citation, span, expiry, duplicate checks |
| `lib/review/cache-key.ts`, `cache.ts` | Cache keys and memory/Supabase cache |
| `lib/review/health.ts` | Provider health logging |
| `lib/review/orchestrator.ts` | The pipeline |
| `lib/review/env.ts` | Builds everything from environment variables |
| `lib/review/adapter.ts` | Maps outcomes to the UI and `review_runs.snapshot` |
| `supabase/migrations/20261106_*.sql` | `llm_cache` and `provider_health` tables |
| `scripts/engine-selftest.ts` | 47 offline tests, no API keys needed |

## Install and verify (do this first)

1. Copy the `lib/`, `scripts/` and `supabase/` folders into your project root.
2. Run the SQL migration in the Supabase SQL editor.
3. Type-check and test:

```powershell
npx tsc --noEmit
npx tsx scripts/engine-selftest.ts
```

You want a clean type-check and `47 passed, 0 failed`. Do not wire it into the
API route until both are true.

## Environment variables

Existing ones keep working (`GEMINI_API_KEY`, `GEMINI_MODEL`, `LLM_POLICY`, and
the legacy `LLM_MODE=off`). New, all optional:

| Variable | Meaning |
| --- | --- |
| `VERIFIER_MODEL` | Separate Gemini model for the verifier, e.g. `gemini-2.5-flash-lite` |
| `LLM_PROVIDER_ORDER` | Default `gemini,openrouter,cloudflare` |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Both required to enable OpenRouter. No default model on purpose |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_MODEL` | Enable Cloudflare Workers AI |
| `LLM_MAX_CALLS` | 1 or 2 (default 2, never more) |
| `REVIEW_MAX_CHARS` | Default 12000 |

Providers without keys are skipped silently, so Gemini-only still works.

## Wiring into `app/api/review/route.ts`

Add the engine call next to your existing logic. Load your rules and facts from
Supabase as you do now, map them to `BrandRule[]` and `BrandFact[]`, then:

```ts
import { createReviewEngine } from "@/lib/review"
import { toApiResponse, toSnapshot } from "@/lib/review/adapter"
import { supabase } from "@/lib/supabase"

const { engine, health } = createReviewEngine({ env: process.env, supabase })

// inside POST, after trimming content and loading canon rows:
const outcome = await engine.review({
  content,                       // the exact string the UI highlights
  context: { brandId: "proofgate", brandTerms: ["ProofGate", "Verity"] },
  rules, facts,                  // mapped from your canon tables
  rulesVersion: canonVersion,
  factsVersion: canonVersion,
})
await health.flush()             // write provider health before responding

// save toSnapshot(outcome) in review_runs.snapshot, and return:
return NextResponse.json({ ...yourExistingFields, ...toApiResponse(outcome, canonVersion) })
```

Create the engine once at module level (as above) so warm instances reuse the
in-memory cache and circuit breaker.

## What you must adapt

- **Mapping canon rows to `BrandRule` / `BrandFact`.** I have not seen your table
  columns. Banned terms, preferred terms and fact status (`current` or
  `outdated`) need to come from somewhere; the S02/S03/S04 behaviour depends on it.
- **Your existing local engine.** Pass it as `localEngine` to reuse it. It must
  return `CandidateFinding[]`. Otherwise the built-in one handles banned terms,
  numeric conflicts, outdated facts, legal-review wording and injections.
- **Scores.** Weights live in `scoring.ts` and will not match your old scores
  exactly. Re-run your benchmark and re-baseline.

## Behaviour to know

- Injected content is never sent to a model. It is flagged and escalated.
- The verifier runs only when the judge returns a material finding, and prefers a
  different provider from the judge.
- A failed or unparseable model call degrades to local findings and withholds the
  score (`score: null`, `route: "degraded"`).
- Cache keys include content, brand, rule and fact versions, a digest of the rule
  text, the prompt version and the model, so editing a rule invalidates answers.
- The circuit breaker is per serverless instance. `provider_health` is the
  shared record.

## Not done

- Not run against real Gemini, OpenRouter or Cloudflare: only against fakes.
- Not wired into your route, and not benchmarked against your 12 samples.
- Free-tier limits and model names change; verify them in each provider console.
