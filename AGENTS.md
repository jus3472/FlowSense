<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FlowSense Agent Instructions

Read [README.md](README.md) and [PROJECT.md](PROJECT.md) before making product or architecture changes. Follow the existing local patterns and keep work narrowly scoped. The project uses Codex, but these instructions are intentionally tool-neutral so any coding agent can follow them.

## Working Rules

- Inspect the relevant implementation and tests before editing. Treat unusual scoring constants and exclusions as evidence of a previously observed failure.
- Keep routes focused on routing and orchestration. Put reusable recording, scoring, provider, and result logic in the existing `src/lib/` areas so it remains directly testable.
- Use strict TypeScript. Do not introduce `any`, bypass server environment boundaries, or add a state library where existing cookies, server actions, and local component state cover the need.
- Preserve the two product invariants: the app measures rather than judges, and a speech span can cost points under only one check or metric. A model instruction is not sufficient enforcement when the behavior affects scores.
- FlowSense measures one response, never a permanent rating of the person. Its shared categories are fluency, clarity, vocabulary, grammar, structure, and delivery across General Practice (`practice`), Interviews (`interview`), Presentations (`presentation`), and Conversations (`conversation`). Prompts can come from the built-in library or be custom. Modes may change weights and add relevant checks, but must remain one scoring system.
- Grammar and vocabulary feedback must identify a concrete response-level choice that affects clarity or effectiveness. Do not turn either category into vocabulary training, a level assessment, or a status judgment. Never assess accent. Future pronunciation work must measure intelligibility or phoneme accuracy, never whether someone sounds native.
- Keep changes compatible with historical `attempts` data. Preserve stored prompt, transcript, capture, scoring-result, and result-snapshot data. Every attempt stores a rubric and score version so later changes do not overwrite or silently reinterpret past attempts. Metrics and content results are JSONB on purpose, and disputes are reapplied on read rather than written into the original result.

## Scoring and Capture

- Mechanical scoring is deliberately framework-free and pure over stored timelines and transcript words. Add or update focused tests with every scoring behavior change.
- Deepgram `nova-2` with fillers and punctuation is intentional. Do not enable smart formatting or replace the model without real-speech verification of filler transcription.
- Content provider failures must not cost points: return `not_checked` content with full content points, and preserve the UI's non-passing state.
- Validate model outputs in code. Quotes must be real transcript substrings, mechanically counted speech cannot also be a content span, and tightened rewrites must remove every counted filler or flagged Word choice span after retry and mechanical fallback.
- Preserve capture guards that ensure exactly one stream and recorder per attempt. Preserve measured `duration_ms` as the source of truth for playback and scoring.

## Interface and Copy

- Use semantic tokens from `src/app/globals.css`, never component hex values or Tailwind color-scale classes. Follow the existing spacing scale and responsive constraints.
- Maintain the minimal single-column FlowSense interface. The score bar is a literal proportion of 100, not a gauge. Amber transcript marks mean a deduction, never a generic warning.
- User-facing copy uses short, second-person, present-tense statements. Do not use em dashes, exclamation marks, praise, scolding, or prohibited product terminology.
- Do not add comparisons, benchmarks, professional-only assumptions, or features that turn the product into vocabulary training, an accent judgment, or a free-form rewriting tool.

## Validation and Operations

- Run `npm run verify` for changes that affect application behavior, types, styling, copy, or tests. Run focused tests during iteration when appropriate.
- Do not run `npm run db:push` against a database without explicit user approval. Migrations and RLS changes need a careful review.
- `npm run inspect:attempts` and `npm run inspect:scores` inspect stored data. `npm run inspect:rewrites -- --write` mutates attempts and can make provider calls, so run it only when the task requires that effect.
- Keep `.env.local` private. Only `src/lib/env/server.ts` reads server-only keys; use its helpers instead of reading `process.env` elsewhere.
