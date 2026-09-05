import pg from 'pg'
import { applyCleanupPlan, buildCleanupPlan } from './lib/obsolete-attempt-cleanup'
import {
  assertDisposableDatabaseUrl,
  databaseClientOptions,
  loadEnvFile,
} from './lib/migrations.mjs'
import {
  legacySectionSnapshot,
  legacyV3Snapshot,
  v3Snapshot,
} from '../tests/helpers/result-snapshots'

const OWNER = 'a1000000-0000-4000-8000-000000000001'
const OTHER = 'a2000000-0000-4000-8000-000000000002'
const LEGACY_ATTEMPT = 'a3000000-0000-4000-8000-000000000003'
const OBSOLETE_BEST = 'a4000000-0000-4000-8000-000000000004'
const CURRENT_ATTEMPT = 'a5000000-0000-4000-8000-000000000005'
const OTHER_ATTEMPT = 'a6000000-0000-4000-8000-000000000006'
const OBSOLETE_ONLY_BEST = 'a7000000-0000-4000-8000-000000000007'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

loadEnvFile('.env.local')
const connectionString = process.env.FLOWSENSE_MIGRATION_TEST_URL
if (!connectionString) {
  console.error('FLOWSENSE_MIGRATION_TEST_URL is required for the cleanup integration test.')
  process.exit(1)
}
assertDisposableDatabaseUrl(connectionString)

const client = new pg.Client(databaseClientOptions(connectionString))

async function insertAttempt(input: {
  id: string
  userId: string
  lessonId: string | null
  promptId: string | null
  promptText: string
  createdAt: string
  rubricVersion: string | null
  score: number
  sectionScores: unknown
  retryOf?: string | null
  audioPath?: string | null
  metrics?: unknown
  contentResult?: unknown
}): Promise<void> {
  await client.query(
    `insert into public.attempts (
       id, user_id, prompt_id, lesson_id, prompt_text, audio_path, transcript, duration_ms,
       score, section_scores, metrics, content_result, created_at, practice_mode,
       prompt_source, prompt_difficulty, rubric_version, retry_of_attempt_id,
       status, status_changed_at, finished_at
     ) values (
       $1, $2, $3, $4, $5, $6, 'A complete disposable response.', 12000,
       $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, 'practice',
       'library', 'beginner', $12, $13, 'done', $11, $11
     )`,
    [
      input.id,
      input.userId,
      input.promptId,
      input.lessonId,
      input.promptText,
      input.audioPath ?? null,
      input.score,
      JSON.stringify(input.sectionScores),
      JSON.stringify(input.metrics ?? {}),
      input.contentResult === undefined ? null : JSON.stringify(input.contentResult),
      input.createdAt,
      input.rubricVersion,
      input.retryOf ?? null,
    ],
  )
}

async function main(): Promise<void> {
  await client.connect()
  const fixtureUsers = [OWNER, OTHER]
  const fixtureAttempts = [
    LEGACY_ATTEMPT,
    OBSOLETE_BEST,
    CURRENT_ATTEMPT,
    OTHER_ATTEMPT,
    OBSOLETE_ONLY_BEST,
  ]
  try {
    await client.query('delete from storage.objects where name like $1', [`${OWNER}/%`])
    await client.query('delete from auth.users where id = any($1::uuid[])', [fixtureUsers])
    await client.query(
      `insert into auth.users (id, raw_user_meta_data)
       select user_id, '{}'::jsonb from unnest($1::uuid[]) as users(user_id)`,
      [fixtureUsers],
    )
    const lessonResult = await client.query(
      `select lesson.id::text as lesson_id, lesson.prompt_id::text, prompt.text
       from public.practice_lessons as lesson
       join public.prompts as prompt on prompt.id = lesson.prompt_id
       join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
       join public.practice_paths as path on path.id = chapter.path_id
       where path.mode = 'practice'
       order by chapter.position, lesson.position
       limit 2`,
    )
    const lesson = lessonResult.rows[0]
    const obsoleteOnlyLesson = lessonResult.rows[1]
    assert(lesson && obsoleteOnlyLesson, 'Two disposable curriculum lessons are required.')

    const legacyPath = `${OWNER}/${LEGACY_ATTEMPT}.webm`
    const legacyContent = {
      status: 'checked',
      checks: { answered: { passed: false, quote: 'A complete disposable response.' } },
      extra_spans: [],
    }
    await insertAttempt({
      id: LEGACY_ATTEMPT,
      userId: OWNER,
      lessonId: null,
      promptId: null,
      promptText: 'Legacy prompt',
      createdAt: '2035-01-01T12:00:00Z',
      rubricVersion: null,
      score: 100,
      sectionScores: legacySectionSnapshot,
      audioPath: legacyPath,
      metrics: { capture: { mime_type: 'audio/webm' } },
      contentResult: legacyContent,
    })
    await client.query(
      `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
       values ($1, $2, 'answered', 'A complete disposable response.')`,
      [OWNER, LEGACY_ATTEMPT],
    )
    await client.query(`insert into storage.objects (bucket_id, name) values ('recordings', $1)`, [
      legacyPath,
    ])
    await client.query(
      `insert into public.practice_activity_days (user_id, local_date, timezone)
       values ($1, '2035-01-01', 'UTC'), ($1, '2035-01-02', 'UTC')`,
      [OWNER],
    )

    const obsolete = legacyV3Snapshot({ component: 0.9 })
    await insertAttempt({
      id: OBSOLETE_BEST,
      userId: OWNER,
      lessonId: lesson.lesson_id,
      promptId: lesson.prompt_id,
      promptText: lesson.text,
      createdAt: '2035-01-02T12:00:00Z',
      rubricVersion: 'v3',
      score: obsolete.total_earned_points ?? 0,
      sectionScores: obsolete,
    })
    const current = v3Snapshot({ component: 0.6 })
    await insertAttempt({
      id: CURRENT_ATTEMPT,
      userId: OWNER,
      lessonId: lesson.lesson_id,
      promptId: lesson.prompt_id,
      promptText: lesson.text,
      createdAt: '2035-01-02T12:01:00Z',
      rubricVersion: 'v3',
      score: current.total_earned_points ?? 0,
      sectionScores: current,
      retryOf: OBSOLETE_BEST,
    })
    await insertAttempt({
      id: OBSOLETE_ONLY_BEST,
      userId: OWNER,
      lessonId: obsoleteOnlyLesson.lesson_id,
      promptId: obsoleteOnlyLesson.prompt_id,
      promptText: obsoleteOnlyLesson.text,
      createdAt: '2035-01-02T12:02:00Z',
      rubricVersion: 'v3',
      score: obsolete.total_earned_points ?? 0,
      sectionScores: obsolete,
    })
    await insertAttempt({
      id: OTHER_ATTEMPT,
      userId: OTHER,
      lessonId: null,
      promptId: null,
      promptText: 'Other user prompt',
      createdAt: '2035-01-03T12:00:00Z',
      rubricVersion: 'v3',
      score: obsolete.total_earned_points ?? 0,
      sectionScores: obsolete,
    })

    const plan = await buildCleanupPlan(client, OWNER, ['legacy', 'v3.score.1'])
    assert(plan.attempts.length === 3, 'Dry run did not select the owned obsolete attempts.')
    assert(plan.dependencies.durableBestReferences === 2, 'Dry run missed durable progress.')
    assert(
      plan.dependencies.recomputedBestReferences === 1,
      'Dry run missed current replacement progress.',
    )
    assert(plan.dependencies.currentRetryChildren === 1, 'Dry run missed the current retry child.')
    assert(plan.dependencies.existingAudioObjects === 1, 'Dry run missed owned Storage audio.')
    const beforeApply = await client.query(
      'select count(*)::integer as count from public.attempts where id = any($1::uuid[])',
      [fixtureAttempts],
    )
    assert(beforeApply.rows[0]?.count === 5, 'Dry run mutated attempts.')

    const result = await applyCleanupPlan(client, plan)
    assert(result.deletedAttempts === 3, 'Apply did not delete every obsolete attempt.')
    assert(result.deletedNoteFeedbackRows === 1, 'Apply did not account for cascaded feedback.')
    assert(result.clearedRetryReferences === 1, 'Apply did not clear the retry parent.')
    assert(result.rebuiltProgressRows === 1, 'Apply did not rebuild progress.')
    assert(result.deletedProgressRows === 2, 'Apply did not replace the affected progress rows.')
    assert(result.deletedActivityDays === 1, 'Apply did not remove obsolete-only activity.')
    assert(result.audioPathsToDelete.length === 1, 'Apply selected an unexpected audio set.')

    const currentAfter = await client.query(
      'select retry_of_attempt_id from public.attempts where id = $1',
      [CURRENT_ATTEMPT],
    )
    assert(currentAfter.rows[0]?.retry_of_attempt_id === null, 'Retry parent still dangles.')
    const otherAfter = await client.query(
      'select count(*)::integer as count from public.attempts where id = $1',
      [OTHER_ATTEMPT],
    )
    assert(otherAfter.rows[0]?.count === 1, 'Another user was touched.')
    const progressAfter = await client.query(
      `select best_score, best_attempt_id::text from public.lesson_progress
       where user_id = $1 and lesson_id = $2`,
      [OWNER, lesson.lesson_id],
    )
    assert(
      progressAfter.rows[0]?.best_score === current.total_earned_points &&
        progressAfter.rows[0]?.best_attempt_id === CURRENT_ATTEMPT,
      'Progress was not repointed to the best surviving current attempt.',
    )
    const removedProgress = await client.query(
      `select count(*)::integer as count from public.lesson_progress
       where user_id = $1 and lesson_id = $2`,
      [OWNER, obsoleteOnlyLesson.lesson_id],
    )
    assert(
      removedProgress.rows[0]?.count === 0,
      'Progress without a surviving current attempt was fabricated.',
    )
    const activityAfter = await client.query(
      'select local_date::text from public.practice_activity_days where user_id = $1 order by local_date',
      [OWNER],
    )
    assert(
      JSON.stringify(activityAfter.rows.map((row) => row.local_date)) ===
        JSON.stringify(['2035-01-02']),
      'Activity days were not rebuilt from surviving current attempts.',
    )
    const noteAfter = await client.query(
      'select count(*)::integer as count from public.note_feedback where attempt_id = $1',
      [LEGACY_ATTEMPT],
    )
    assert(noteAfter.rows[0]?.count === 0, 'Dependent feedback still exists.')
    const storageAfter = await client.query(
      `select count(*)::integer as count from storage.objects
       where bucket_id = 'recordings' and name = $1`,
      [legacyPath],
    )
    assert(storageAfter.rows[0]?.count === 1, 'Database apply unexpectedly deleted Storage.')
    console.log('Obsolete-attempt cleanup integration test passed.')
  } finally {
    await client
      .query('delete from storage.objects where name like $1', [`${OWNER}/%`])
      .catch(() => undefined)
    await client
      .query('delete from auth.users where id = any($1::uuid[])', [fixtureUsers])
      .catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  console.error(
    `Obsolete-attempt cleanup integration test failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  )
  process.exitCode = 1
})
