# FlowSense

FlowSense is a speaking trainer for effective spoken communication. Users practice one response at
a time in General Practice, Interviews, Presentations, or Conversations. A prompt comes from the
built-in library or is custom, the user answers aloud for up to 60 seconds, and the result measures
that response out of 100.

New attempts use one scoring system with a transparent 50/50 split. What You Said measures Answered the Prompt,
Specificity, Structure, Conciseness, Word Choice, and Grammar. How You Sounded measures Pace,
Paused Time, Articulation, and Energy. Modes change the points assigned to those same 10 metrics,
not the scoring ontology. Results describe the response, never a permanent rating of the
person. Feedback is concrete and measurement-first, and a speech span can cost points under only one
check or metric.

Grammar and vocabulary feedback is supported when it identifies a concrete, response-level choice
that affects clarity or effectiveness. It is not vocabulary training, a vocabulary-level assessment,
or a status judgment. FlowSense never judges accent. Any future pronunciation feedback must measure
intelligibility or phoneme accuracy, never whether someone sounds native.

Every scored attempt stores rubric `v3` and payload `v3.score.2`. Other stored score formats fail
closed as unsupported and are never silently reinterpreted. Resultless terminal attempts retain
their prompt, transcript, capture data, recording playback, and fresh-retry path.

## Documentation

- [PROJECT.md](PROJECT.md) covers product context, architecture, scoring, data, and operational
  risks.
- [AGENTS.md](AGENTS.md) contains instructions for coding agents working in this repository.
- [docs/RELEASE.md](docs/RELEASE.md) is the staged Production release and rollback runbook.
- [docs/AUTH.md](docs/AUTH.md) covers password and Google OAuth setup and security boundaries.

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

The Deepgram key must have Member permission or higher so the server can mint the short-lived token
used for words that appear during recording. Pre-recorded transcription can work with a more limited
key even when live transcription cannot.

Articulation uses final Deepgram word confidence, guarded by
stored audio signal and evidence-coverage checks, and never measures accent conformity.

`SUPABASE_DB_URL` is local-only and required only for database migrations and inspection scripts.

## Commands

| Command                               | Purpose                                     |
| ------------------------------------- | ------------------------------------------- |
| `npm run dev`                         | Start the local development server          |
| `npm run build`                       | Create a production build                   |
| `npm run lint`                        | Run ESLint                                  |
| `npm run typecheck`                   | Run strict TypeScript checking              |
| `npm run test`                        | Run the Vitest suite                        |
| `npm run test:e2e`                    | Run deterministic Chromium critical flows   |
| `npm run verify`                      | Run typecheck, lint, and tests              |
| `npm run db:push`                     | Apply migrations in `supabase/migrations`   |
| `npm run db:preflight`                | Compare migrations with the database ledger |
| `npm run test:migrations`             | Test migrations on a disposable database    |
| `npm run inspect:attempts`            | Inspect stored capture timelines            |
| `npm run inspect:scores`              | Inspect scored attempt breakdowns           |
| `npm run inspect:content-reliability` | Inspect aggregate content-provider health   |
| `npm run check:scoring-calibration`   | Run local scoring calibration corpora       |

`npm run inspect:content-reliability -- --limit 100` runs a read-only aggregate over recent
completed attempts. Add `--since <ISO-8601>` to inspect a deployment window. It never selects or
prints prompt text, transcript text, private context, audio paths, user identifiers, secrets, or raw
provider responses. Stored attempts do not currently persist exact provider failure codes, so the
report labels those detailed causes unavailable instead of treating them as zero.

## Browser tests

Install Chromium once with `npm run test:e2e:install`, then run `npm run test:e2e`. The suite starts
the real Next app and a loopback-only fake Supabase service. It blocks unexpected external browser
traffic and uses fake media, fake tokens, and deterministic provider responses. Failure traces,
screenshots, videos, and the HTML report are written to ignored Playwright output directories.

## Scoring calibration

`npm run check:scoring-calibration` runs deterministic current-v3 Energy fixtures for monotone,
restrained-natural, naturally expressive, exaggerated-pitch,
and rhythmically robotic signal patterns. They validate reviewed composite ranges without reading
recordings or making provider calls.

## Database and deployment

The primary user-facing Production domain is `https://flowsense-web.vercel.app`.

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
Set the Supabase Auth Site URL to the primary Production domain and include that origin in the
Redirect URL allowlist. Add Preview origins only when their authentication flow needs them. The three
secret variables are read only in `src/lib/env/server.ts`; do not expose them to client components.

## Validation

Run `npm run verify` before merging behavior changes. The suite enforces strict types, scoring edge
cases, user-facing copy rules, semantic design tokens, contrast, and literal score-bar behavior.
