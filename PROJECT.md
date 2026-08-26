# FlowSense Project Context

## Product

FlowSense is a speaking trainer for effective spoken communication. A built-in or custom prompt
appears, a countdown runs, and the user answers aloud for up to 60 seconds. The result measures one
response out of 100, never a permanent rating of the person.

The primary modes are General Practice (`practice`), Interviews (`interview`), Presentations
(`presentation`), and Conversations (`conversation`). They share the same top-level skill
categories: fluency, clarity, vocabulary, grammar, structure, and delivery. A mode can alter the
weights and add mode-specific feedback or checks, but it cannot become an unrelated scoring system.

It is for people who can write clearly but stall, pad, or circle when speaking. The interface must
not assume a professional setting, a native speaker, or a particular age. It never judges accent or
confidence. Grammar and vocabulary feedback is allowed only when it names a concrete,
response-level choice that affects clarity or effectiveness. It is not vocabulary training, a
vocabulary-level assessment, or a status judgment. Any future pronunciation feedback must measure
intelligibility or phoneme accuracy, never whether someone sounds native.

Two rules govern product and implementation work:

1. The app measures, it does not judge. Detection should be concrete and explainable. Do not add quality ratings, praise, scolding, benchmarks, or comparisons to other users.
2. Nothing is counted twice. A spoken span can cost points under exactly one check or metric. When a language-model rule is repeatedly violated, enforce it in code instead of strengthening the prompt again.

## Application Architecture

The stack is Next.js App Router, strict TypeScript, Tailwind CSS, Supabase, Vercel, and Vitest. Deepgram provides transcription. DeepSeek provides content checks behind a provider interface.

```text
src/app/                 Routes and route handlers
src/actions/             Server actions
src/components/          Screen-oriented components and shared ui/
src/lib/env/             The only modules that read environment variables
src/lib/supabase/        Browser, server, admin, and session clients
src/lib/recording/       Capture, sampling, processing, storage, and playback
src/lib/scoring/         Framework-free scoring and rewrite enforcement
src/lib/deepgram/        Transcription request and parsing
src/lib/deepseek/        Content model interface, provider, and prompts
src/lib/results/         Result shaping and transcript highlights
supabase/migrations/     Schema, RLS, storage, and seeded prompts
tests/                   Unit and component coverage
scripts/                 Database migration and inspection utilities
```

Routes should stay focused on routing and request orchestration. Keep scoring and recording logic in `src/lib/` so it remains directly testable. There is no global state library: authentication uses Supabase cookies through `src/proxy.ts`, theme is a `data-theme` attribute, and forms use server actions.

## Capture and Scoring Flow

The attempt lifecycle is `uploading -> transcribing -> scoring -> done | failed | timed_out`. Audio is saved before transcription. Each network boundary has its own timeout, terminal failure state, and retry path. Retrying uses the existing attempt and reads stored audio server-side.

A single `getUserMedia` stream feeds `MediaRecorder`, RMS amplitude sampling every 50ms, and pitch sampling every 50ms. Preserve the recorder and StrictMode guards: duplicate chunks can produce malformed audio and duplicate audio playback.

Transcription uses Deepgram `nova-2` with punctuation and filler words enabled. Do not turn on smart formatting because the application needs the original disfluencies. `nova-3` must not replace it without checking filler behavior on real recordings.

The score is 100 points:

| Section | Check or metric | Points |
| --- | --- | ---: |
| What you said | Answered the question | 14 |
| What you said | Explained your reasoning | 12 |
| What you said | Word choice | 12 |
| What you said | Logical order | 7 |
| What you said | No repetition | 5 |
| How you sounded | Filler words | 18 |
| How you sounded | Mid-sentence pauses | 14 |
| How you sounded | Energy | 8 |
| How you sounded | Pace | 6 |
| How you sounded | Time to first word | 4 |

Mechanical scores are pure functions over the stored capture timelines and Deepgram word array. Points use `round(max_points * component_score)`. Pace uses speaking time, not wall-clock duration, so silence is not charged under both Pace and Mid-sentence pauses. Energy uses median absolute deviation after octave correction. Time to first word remains unclamped so broken capture data is visible rather than hidden.

The content route sends the prompt, punctuated transcript, word count, duration, and repeated phrases to DeepSeek. The model is a detector, not a critic. Failures award full content points and set content status to `not_checked`; the UI renders dashes for those checks.

Every model quote is validated against the transcript. Content spans overlapping mechanically counted speech are dropped before scoring. Tightened rewrites receive the filler surfaces that must be deleted. The application then validates the rewrite, retries once with exact violations, and finally strips remaining counted fillers or Word choice spans with punctuation repair. False starts are not part of the rewrite deletion list because the ordinary word must remain once.

## Data and Security

Supabase owns authentication, Postgres, and private recording storage. The main tables are:

- `profiles`: user name and focus areas. A signup trigger creates each row.
- `prompts`: active built-in prompts, publicly readable. An attempt can instead retain custom prompt text.
- `attempts`: prompt snapshot, audio path, transcript, duration, score, sections, metrics, and content result. `prompt_text` is intentionally denormalized so later edits do not rewrite history.
- `note_feedback`: disputes against content findings. Disputes are reapplied when results are read; they do not overwrite the stored model result.

Scoring metrics and content results are JSONB by design. Every scored attempt records its rubric and
score version alongside its stored result snapshots. Later rubric, model, or mode changes must read
historical attempts through their stored version and snapshots; they must not overwrite or silently
reinterpret a past result. New shapes must remain compatible with historical `attempts` data. RLS
applies to every user table and the private `recordings` bucket. Add explicit insert policies when
adding a table or storage path.

Only `src/lib/env/server.ts` may read `SUPABASE_SECRET_KEY`, `DEEPGRAM_API_KEY`, or `DEEPSEEK_API_KEY`. The lint configuration and tests enforce this boundary. Never add secrets to a client component, a public environment variable, documentation examples, or committed local files.

## Results and Interface

The results page order is score, transcript, What you said, How you sounded, collapsed tighter version, collapsed statistics, player, and one primary action. The score bar is a literal proportion of 100, not a gauge or target.

Amber transcript marks mean exactly one thing: the marked speech cost points. Whole-response checks such as Answered the question and Logical order do not create transcript marks. Each content finding is shown once: a quoted finding must not repeat in its grouped span list. The statistics count shown to users must visibly match the units in the displayed list.

The active visual system is token-based in `src/app/globals.css`: a restrained water-toned light and dark palette, white or dark surfaces, cyan accent, warm amber highlight, Inter body text, Sora display text, and JetBrains Mono for measurements. Content uses a centered 600px column with generous vertical spacing. Components use semantic Tailwind tokens only. The tests reject component hex values, Tailwind color scales, invalid spacing, insufficient contrast, and nonliteral score-bar behavior.

User-facing copy is brief, second person, and present tense. It contains no em dashes, exclamation marks, praise, scolding, or prohibited product terminology.

## Operations

Use `npm run verify` for the normal local validation gate. The other important commands are:

```bash
npm run dev
npm run build
npm run db:push
npm run inspect:attempts
npm run inspect:scores
npm run inspect:rewrites
```

Inspection scripts need the local database connection. `npm run inspect:rewrites` is read-only by default, but `npm run inspect:rewrites -- --write` persists enforced rewrites and may make provider requests during retries.

## Known Risks

- A prior public repository committed an environment file. Treat those keys as compromised and rotate them.
- Content calibration needs broader real-recording coverage across deliberately varied responses.
- Pace thresholds were set on native conversational English and can be less representative for some second-language speakers.
- Browser backgrounding can throttle capture sampling. Timeline timestamps preserve the evidence, but an AudioWorklet would remove the issue.
- Browser-reported audio duration is unreliable for recorded blobs. Use measured `duration_ms` for playback and score calculations.

## Decisions Not to Reopen Casually

Do not add vocabulary training, vocabulary-level or status judgments, accent judgments,
self-correction penalties, clause-level abandonment detection, relative personal baselines,
weighted-average scoring, free-form rewrites, user comparisons, benchmarks, gauge-style score bars,
pricing, plans, or usage limits. These directions conflict with the product's measurement-first
model or were previously rejected after testing.
