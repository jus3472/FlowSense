# FlowSense

A speaking trainer for people who sound sharper on paper than they do out loud. A prompt appears,
you answer out loud, and FlowSense shows you where your point landed and where it went soft.

This repository is the foundation: landing page, auth, onboarding, and an empty home screen.
Recording, transcription, and scoring arrive in later prompts.

## Running locally

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in the Supabase and provider keys, then:

```bash
npm run dev
```

The app runs at http://localhost:3000.

Other commands:

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run build`     | Production build                                     |
| `npm run test`      | Vitest suite                                         |
| `npm run lint`      | ESLint                                               |
| `npm run typecheck` | TypeScript in strict mode                            |
| `npm run verify`    | Typecheck, lint, and tests together                  |
| `npm run db:push`   | Applies `supabase/migrations` to the hosted database |

## Database

Schema lives in `supabase/migrations` and is applied in filename order. To apply it, set a
connection string that is only used for migrations and never read by the app:

```bash
SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres' npm run db:push
```

The connection string is in the Supabase dashboard under Project Settings, Database, Connection
string, URI. You can also paste each migration file into the dashboard SQL editor in filename
order, which needs no connection string at all.

Applied versions are recorded in `supabase_migrations.schema_migrations`, the same table the
Supabase CLI uses, so `supabase db push` and this script can be mixed.

## Deploying to Vercel

Import the repository, keep the default Next.js settings, and set these environment variables for
Production, Preview, and Development:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `DEEPGRAM_API_KEY`
- `DEEPSEEK_API_KEY`

The last three are server only. `src/lib/env/server.ts` is the one module allowed to read them, it
imports `server-only` so a client component that reaches it fails the build, and an ESLint rule
plus a unit test block every other access path.

Add the deployment URL to the Supabase dashboard under Authentication, URL Configuration.

## Design system

Every color, size, radius, and motion value is declared in `src/app/globals.css`. Tailwind's own
palettes and scales are cleared there, so a class like `bg-blue-500` or `rounded-md` does not
exist. Components consume semantic tokens only, and changing one variable repaints both themes.

The theme is applied through `data-theme` on `<html>`, set by an inline script in the document head
before first paint, and stored in `localStorage`. The system preference is consulted only on a
first visit.

`tests/design-system.test.ts`, `tests/contrast.test.ts`, and `tests/copy.test.ts` enforce these
rules, including a 4.5:1 contrast floor on every text and surface pair in both themes.
