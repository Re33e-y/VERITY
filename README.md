# Verity

Verity audits draft brand content against a versioned Brand Canon. It combines
deterministic rule checks with a Gemini judge and independent verification,
and falls back to a deterministic offline engine when Gemini is disabled or
unavailable.

## Setup

1. Apply the Brand Canon and review schema migration from the supplied setup
   manual in the Supabase SQL editor. This application expects the `rules`,
   `facts`, `review_runs`, `findings`, and `decisions` columns defined there.
2. Configure local environment variables in `.env.local` and add the
   corresponding production variables in Vercel:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
   LLM_MODE=on
   GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   GEMINI_MODEL=gemini-2.5-flash
   # Optional:
   VERIFIER_MODEL=gemini-2.5-flash-lite
   ```

   `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` must remain server-only.
   Never prefix these secrets with `NEXT_PUBLIC_` or expose them in client-side
   code.
   The server Supabase client requires `SUPABASE_SERVICE_ROLE_KEY`; it does not
   fall back to a publishable or anon key.
   Set `LLM_MODE=off` to skip Gemini calls and use the offline engine. It needs
   a `keywords text[]` column on `facts`, populated with reviewed keywords in
   Supabase:

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

   Run this migration yourself in the Supabase SQL editor before enabling the
   offline engine. Review keywords against your canon; matching is only as good
   as the approved fact data.
3. Restart the Next.js server after changing environment variables.
4. Start the app:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

Gemini requests retry HTTP 429 and 5xx responses up to three attempts with
backoff. If Gemini is disabled, missing, invalid, or over quota, the offline
engine analyzes claims, quantities, approved facts, tone, readability, and
prompt-injection patterns without LLM API calls. The API reports
`engine: "offline"` and `ai.status: "failed"`; it keeps `status: "partial"` and
withholds the score because LLM-assisted tone and messaging judgment did not
run.

## Application routes

- `/` — submit draft content, inspect highlighted findings, and record a
  decision with a required reason.
- `/canon` — read-only view of the rules and facts currently stored in Supabase.
- `POST /api/review` — run an audit and persist a review snapshot and findings.
- `GET /api/canon` — retrieve the rules and facts for the canon page.
- `POST /api/decisions` — append an accepted, dismissed, or overridden decision.

Review results report persistence separately from audit status. A successful
audit is not necessarily saved; check `persistence.status` and `persistence.reason`.

## Manual review smoke test

After applying the schema and configuring reachable Supabase and Gemini
credentials, submit the following draft from the UI:

> Verity is the best AI tool, built with our new Verification Bot! ProofGate Pro
> costs $19 per user per month and the free trial lasts 30 days. We check images
> too, all with a proof gate.

Expected behavior with the seed canon from the setup manual:

- Deterministic findings flag `the best`, `Verification Bot`, and `proof gate`.
- Numeric and money claims are routed to human legal review.
- The expired trial fact is identified as outdated by the offline engine.
- In offline mode, the image-review claim is compared with the approved fact
  using lexical overlap and negation.
- The review page highlights findings and allows a decision with a reason.
- The review response reports whether the run and findings were saved.

The legal-review expression intentionally routes numeric and financial spans to
a human. It can therefore be more cautious than a full legal assessment.

The offline engine uses sentence offsets, TF-IDF and approved fact keywords,
quantity normalization, negation, a weighted tone lexicon, readability checks,
and prompt-injection detection. It gives grade A only for hard evidence such as
an expired fact, a quantity mismatch, or an injection pattern; heuristic
findings are grade C and tagged as offline, not model-verified. It may miss
claims without matching facts or keywords and can over-flag wording. Nuanced
tone and messaging are better assessed by the Gemini-assisted path.

## Benchmark

The first offline benchmark run on 12 synthetic samples is pending. The
benchmark script covers labeled violations, clean samples, and prompt-injection attempts.
It reports per-sample misses and errors along with recall, precision,
false-positive rate on clean samples, citation validity, hidden grade-D
findings, and prompt-injection leaks. Citation validity checks each finding's
quoted span against its exact offsets in the submitted text.

Run against the local app or a deployed URL:

```bash
node scripts/benchmark.mjs http://localhost:3000
node scripts/benchmark.mjs https://YOUR_DEPLOYMENT_URL
```

The script sends 12 review requests, waits four seconds between them to remain
under the configured rate cap, and writes or replaces `benchmark-results.json`
in the project root. Use a test environment: requests persist reviews and AI
calls may consume quota. Record the actual missed expectations and request
errors with the reported summary; no benchmark figures are claimed until a run
has completed.

## Important deployment note

The demo review and decision endpoints use server-side Supabase credentials and
do not implement user authentication. The review endpoint has a global database-
backed cap of 20 reviews per minute and a 5,000-character content limit. Add
authentication and rate limiting for decision submissions before exposing them
to untrusted users.
