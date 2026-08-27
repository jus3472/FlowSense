# FlowSense

FlowSense is a speaking trainer for effective spoken communication. Users practice one response at
a time in General Practice, Interviews, Presentations, or Conversations. A prompt comes from the
built-in library or is custom, the user answers aloud for up to 60 seconds, and the result measures
that response out of 100.

Each mode uses the same top-level skill categories: fluency, clarity, vocabulary, grammar,
structure, and delivery. Modes can adjust weights and add mode-specific feedback or checks, but
they remain one measurement system rather than unrelated scoring systems. Results describe the
response, never a permanent rating of the person. Feedback is concrete and measurement-first, and a
speech span can cost points under only one check or metric.

Grammar and vocabulary feedback is supported when it identifies a concrete, response-level choice
that affects clarity or effectiveness. It is not vocabulary training, a vocabulary-level assessment,
or a status judgment. FlowSense never judges accent. Any future pronunciation feedback must measure
intelligibility or phoneme accuracy, never whether someone sounds native.

Every new v2-scored attempt must store a rubric and score version. Legacy attempts may have null or
legacy metadata; their stored snapshots remain authoritative, including the prompt, transcript,
capture data, and scoring results, and must not be rewritten by later rubric changes.

## Documentation

- [PROJECT.md](PROJECT.md) covers product context, architecture, scoring, data, and operational
  risks.
- [AGENTS.md](AGENTS.md) contains instructions for coding agents working in this repository.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set the required values in `.env.local`. The app runs at `http://localhost:3000`.

Required application variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `DEEPGRAM_API_KEY`
- `DEEPSEEK_API_KEY`

Optional server-only pronunciation evidence uses `AZURE_SPEECH_ENDPOINT`,
`AZURE_SPEECH_KEY`, and `AZURE_SPEECH_LOCALE`. The guarded adapter accepts only Azure's
documented 16 kHz PCM WAV and OGG Opus short-audio inputs up to 30 seconds; other recordings
remain not checked and no pronunciation deductions are applied.

`SUPABASE_DB_URL` is local-only and required only for database migrations and inspection scripts.
`DEEPGRAM_DEBUG=true` logs raw transcription responses for debugging and should remain disabled by
default.

## Commands

| Command                             | Purpose                                     |
| ----------------------------------- | ------------------------------------------- |
| `npm run dev`                       | Start the local development server          |
| `npm run build`                     | Create a production build                   |
| `npm run lint`                      | Run ESLint                                  |
| `npm run typecheck`                 | Run strict TypeScript checking              |
| `npm run test`                      | Run the Vitest suite                        |
| `npm run test:e2e`                  | Run deterministic Chromium critical flows   |
| `npm run verify`                    | Run typecheck, lint, and tests              |
| `npm run db:push`                   | Apply migrations in `supabase/migrations`   |
| `npm run db:preflight`              | Compare migrations with the database ledger |
| `npm run test:migrations`           | Test migrations on a disposable database    |
| `npm run inspect:attempts`          | Inspect stored capture timelines            |
| `npm run inspect:scores`            | Inspect scored attempt breakdowns           |
| `npm run inspect:rewrites`          | Audit stored tightened rewrites             |
| `npm run check:scoring-calibration` | Run generated v2 scoring calibration corpus |

`npm run inspect:rewrites -- --write` updates stored rewrites and can call the content provider
when a retry is necessary. Run it deliberately.

## Browser tests

Install Chromium once with `npm run test:e2e:install`, then run `npm run test:e2e`. The suite starts
the real Next app and a loopback-only fake Supabase service. It blocks unexpected external browser
traffic and uses fake media, fake tokens, and deterministic provider responses. Failure traces,
screenshots, videos, and the HTML report are written to ignored Playwright output directories.

## Scoring calibration

`npm run check:scoring-calibration` runs generated, local-only evaluator fixtures against checked-in
v2 baselines. It prints each case's overall and category result, lists stable-path differences, and
exits nonzero on drift. It makes no provider or network calls and never rewrites baselines. After
reviewing an intentional rubric or evaluator change, update the versioned expectations manually in
`src/lib/scoring/v2/calibration.ts` in the same review as the scoring change.
The unclear-pronunciation and intelligible second-language-accent fixtures carry normalized
evidence only, with `eligibleForDeductions=false`. They do not assess native similarity or deduct
for an intelligible accent.

## Database and deployment

Migrations in `supabase/migrations` run in filename order. `npm run db:push` reads
`SUPABASE_DB_URL` from the environment or `.env.local`; the application does not read that value.
FlowSense records full migration filename stems in `supabase_migrations.schema_migrations` and also
recognizes timestamp-only versions written by the Supabase CLI. Run `npm run db:preflight` before a
deployment to report missing or unexpected ledger entries without applying anything.

Loopback database connections always disable TLS. A remote database URL without an explicit TLS
setting uses an encrypted connection with certificate verification disabled for compatibility with
the configured Supabase certificate chain. This does not provide CA or hostname verification. To
require strict verification, add `sslmode=verify-full` to `SUPABASE_DB_URL` and provide
`sslrootcert` when the signing CA is not already trusted by Node. Explicit connection-string TLS
settings are passed to `pg` unchanged.

`npm run test:migrations` is destructive only to the database named by
`FLOWSENSE_MIGRATION_TEST_URL`. It refuses ordinary database names, refuses `SUPABASE_DB_URL`, and
allows remote hosts only with the explicit confirmation documented by the command's error message.
Use a disposable database whose name includes `test`, `testing`, `scratch`, or `disposable`.

For Vercel, set the five required application variables for Production, Preview, and Development.
Add each deployment URL to Supabase Authentication URL Configuration. The three secret variables are
read only in `src/lib/env/server.ts`; do not expose them to client components.

## Validation

Run `npm run verify` before merging behavior changes. The suite enforces strict types, scoring edge
cases, user-facing copy rules, semantic design tokens, contrast, and literal score-bar behavior.
