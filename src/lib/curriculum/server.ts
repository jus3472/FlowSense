import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySpeakingActivity } from '@/lib/activity/speaking'
import type {
  CurriculumInputError,
  CurriculumPathProgress,
  PathSlug,
} from '@/lib/curriculum/contracts'
import {
  curriculumPromptOutcome,
  decideCurriculumLessonAccess,
  neutralLessonEvidence,
  parseCurriculumLessonRow,
  parseCurriculumPathRows,
  parseLessonProgressRows,
  parsePathSlug,
  type CurriculumLessonSession,
} from '@/lib/curriculum/data'
import { buildCurriculumPathProgress } from '@/lib/curriculum/progression'
import { validateCurriculumPathDefinition } from '@/lib/curriculum/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

const PATH_COLUMNS = 'id, slug, title, mode, position, active'
const CHAPTER_COLUMNS = 'id, path_id, level, title, position, active'
const LESSON_COLUMNS =
  'id, chapter_id, slug, title, skill_focus, position, checkpoint, prompt_id, active'
const PROGRESS_COLUMNS = 'lesson_id, best_score, best_attempt_id'
const NEUTRAL_ATTEMPT_COLUMNS = 'lesson_id, status, duration_ms, transcript, score, section_scores'
const PROMPT_COLUMNS =
  'id, text, active, mode, difficulty, target_duration_seconds, free_practice_visible'

export const CURRICULUM_ATTEMPT_PAGE_SIZE = 100

export type CurriculumLoadOperation =
  | 'authentication'
  | 'path'
  | 'chapters'
  | 'lessons'
  | 'progress'
  | 'attempt_evidence'
  | 'lesson_lookup'
  | 'prompt'

type CurriculumFailureReason =
  'authentication' | 'query' | 'invalid_response' | CurriculumInputError['kind']

export type CurriculumLoadFailure = {
  status: 'failure'
  reason: CurriculumFailureReason
  operation: CurriculumLoadOperation
  code?: CurriculumInputError['code']
}

export type CurriculumPathLoadOutcome =
  | { status: 'ready'; data: CurriculumPathProgress }
  | { status: 'unauthenticated' }
  | { status: 'not_found'; resource: 'path' }
  | CurriculumLoadFailure

export type CurriculumLessonAccessOutcome =
  | {
      status: 'allowed'
      data: {
        session: CurriculumLessonSession
        lesson: CurriculumPathProgress['lessons'][number]
      }
    }
  | { status: 'unauthenticated' }
  | { status: 'not_found'; resource: 'path' | 'lesson' }
  | { status: 'denied'; reason: 'inactive' | 'locked' | 'path_mismatch' }
  | CurriculumLoadFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

function isMissingAuthSession(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.name === 'AuthSessionMissingError' || error.code === 'session_not_found')
  )
}

function logCurriculumFailure(
  operation: CurriculumLoadOperation,
  reason: CurriculumFailureReason,
  error?: unknown,
): void {
  console.error('[curriculum] data load failed', {
    operation,
    reason,
    code: safeErrorCode(error),
  })
}

function queryFailure(operation: CurriculumLoadOperation, error: unknown): CurriculumLoadFailure {
  logCurriculumFailure(operation, 'query', error)
  return { status: 'failure', reason: 'query', operation }
}

function invalidResponse(operation: CurriculumLoadOperation): CurriculumLoadFailure {
  logCurriculumFailure(operation, 'invalid_response')
  return { status: 'failure', reason: 'invalid_response', operation }
}

function inputFailure(error: CurriculumInputError): CurriculumLoadFailure {
  const operation = error.kind === 'invalid_curriculum' ? 'lessons' : 'progress'
  logCurriculumFailure(operation, error.kind)
  return {
    status: 'failure',
    reason: error.kind,
    operation,
    code: error.code,
  }
}

async function loadPathRow(supabase: SupabaseClient<Database>, slug: PathSlug) {
  try {
    const result = await supabase
      .from('practice_paths')
      .select(PATH_COLUMNS)
      .eq('slug', slug)
      .maybeSingle()
    if (result.error) return { ok: false as const, failure: queryFailure('path', result.error) }
    if (result.data === null) return { ok: true as const, data: null }
    if (!isRecord(result.data)) {
      return { ok: false as const, failure: invalidResponse('path') }
    }
    return { ok: true as const, data: result.data }
  } catch (error) {
    return { ok: false as const, failure: queryFailure('path', error) }
  }
}

async function loadNeutralAttemptEvidence(
  supabase: SupabaseClient<Database>,
  userId: string,
  lessonIds: readonly string[],
) {
  const neutralLessonIds = new Set<string>()
  for (let from = 0; ; from += CURRICULUM_ATTEMPT_PAGE_SIZE) {
    try {
      const { data, error } = await supabase
        .from('attempts')
        .select(NEUTRAL_ATTEMPT_COLUMNS)
        .eq('user_id', userId)
        .eq('status', 'done')
        .is('score', null)
        .in('lesson_id', lessonIds)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + CURRICULUM_ATTEMPT_PAGE_SIZE - 1)

      if (error) {
        return {
          ok: false as const,
          failure: queryFailure('attempt_evidence', error),
        }
      }
      if (!Array.isArray(data)) {
        return {
          ok: false as const,
          failure: invalidResponse('attempt_evidence'),
        }
      }

      for (const row of data) {
        if (!isRecord(row) || typeof row.lesson_id !== 'string') {
          return {
            ok: false as const,
            failure: invalidResponse('attempt_evidence'),
          }
        }
        const classification = classifySpeakingActivity({
          status: row.status,
          durationMs: row.duration_ms,
          transcript: row.transcript,
          score: row.score,
          sectionScores: row.section_scores,
        })
        if (classification.kind === 'neutral') neutralLessonIds.add(row.lesson_id)
      }
      if (data.length < CURRICULUM_ATTEMPT_PAGE_SIZE) {
        return { ok: true as const, data: neutralLessonEvidence(neutralLessonIds) }
      }
    } catch (error) {
      return {
        ok: false as const,
        failure: queryFailure('attempt_evidence', error),
      }
    }
  }
}

/** Injectable, explicitly owned loader used by path pages and access checks. */
export async function loadCurriculumPathForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  slug: PathSlug,
): Promise<CurriculumPathLoadOutcome> {
  const pathResult = await loadPathRow(supabase, slug)
  if (!pathResult.ok) return pathResult.failure
  if (pathResult.data === null) return { status: 'not_found', resource: 'path' }

  let chapterRows: unknown
  try {
    const { data, error } = await supabase
      .from('practice_chapters')
      .select(CHAPTER_COLUMNS)
      .eq('path_id', pathResult.data.id)
      .order('position', { ascending: true })
    if (error) return queryFailure('chapters', error)
    chapterRows = data
  } catch (error) {
    return queryFailure('chapters', error)
  }
  if (!Array.isArray(chapterRows)) return invalidResponse('chapters')
  const pathWithoutLessons = parseCurriculumPathRows({
    path: pathResult.data,
    chapters: chapterRows,
    lessons: [],
  })
  if (!pathWithoutLessons) return invalidResponse('chapters')
  if (pathWithoutLessons.chapters.length !== 3) {
    const validated = validateCurriculumPathDefinition(pathWithoutLessons)
    return validated.ok ? invalidResponse('chapters') : inputFailure(validated.error)
  }
  const chapterIds = pathWithoutLessons.chapters.map((chapter) => chapter.id)

  let lessonRows: unknown
  try {
    const { data, error } = await supabase
      .from('practice_lessons')
      .select(LESSON_COLUMNS)
      .in('chapter_id', chapterIds)
      .order('position', { ascending: true })
    if (error) return queryFailure('lessons', error)
    lessonRows = data
  } catch (error) {
    return queryFailure('lessons', error)
  }
  if (!Array.isArray(lessonRows)) return invalidResponse('lessons')

  const path = parseCurriculumPathRows({
    path: pathResult.data,
    chapters: chapterRows,
    lessons: lessonRows,
  })
  if (!path) return invalidResponse('lessons')
  const validatedPath = validateCurriculumPathDefinition(path)
  if (!validatedPath.ok) return inputFailure(validatedPath.error)

  const lessonIds = path.chapters.flatMap((chapter) => chapter.lessons.map((lesson) => lesson.id))

  let progressRows: unknown
  try {
    const { data, error } = await supabase
      .from('lesson_progress')
      .select(PROGRESS_COLUMNS)
      .eq('user_id', userId)
      .in('lesson_id', lessonIds)
    if (error) return queryFailure('progress', error)
    progressRows = data
  } catch (error) {
    return queryFailure('progress', error)
  }
  const progress = parseLessonProgressRows(progressRows)
  if (!progress) return invalidResponse('progress')

  const evidenceResult = await loadNeutralAttemptEvidence(supabase, userId, lessonIds)
  if (!evidenceResult.ok) return evidenceResult.failure

  const built = buildCurriculumPathProgress({
    path,
    progress,
    attemptEvidence: evidenceResult.data,
  })
  return built.ok ? { status: 'ready', data: built.value } : inputFailure(built.error)
}

async function lessonExistsOutsidePath(
  supabase: SupabaseClient<Database>,
  lessonSlug: string,
): Promise<{ status: 'exists' | 'missing' } | CurriculumLoadFailure> {
  try {
    const { data, error } = await supabase
      .from('practice_lessons')
      .select(LESSON_COLUMNS)
      .eq('slug', lessonSlug)
      .maybeSingle()
    if (error) return queryFailure('lesson_lookup', error)
    if (data === null) return { status: 'missing' }
    const lesson = parseCurriculumLessonRow(data)
    if (!lesson || lesson.slug !== lessonSlug) return invalidResponse('lesson_lookup')
    return { status: 'exists' }
  } catch (error) {
    return queryFailure('lesson_lookup', error)
  }
}

/** Reusable server authorization boundary for a structured lesson session. */
export async function loadCurriculumLessonAccessForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  pathSlug: PathSlug,
  lessonSlug: string,
): Promise<CurriculumLessonAccessOutcome> {
  const pathResult = await loadCurriculumPathForUser(supabase, userId, pathSlug)
  if (pathResult.status !== 'ready') return pathResult

  if (!pathResult.data.path.active) return { status: 'denied', reason: 'inactive' }
  const decision = decideCurriculumLessonAccess(pathResult.data, lessonSlug)
  if (decision.status === 'denied') return decision
  if (decision.status === 'not_found') {
    const lookup = await lessonExistsOutsidePath(supabase, lessonSlug)
    if ('status' in lookup && lookup.status === 'failure') return lookup
    return lookup.status === 'exists'
      ? { status: 'denied', reason: 'path_mismatch' }
      : { status: 'not_found', resource: 'lesson' }
  }

  let promptRow: unknown
  try {
    const { data, error } = await supabase
      .from('prompts')
      .select(PROMPT_COLUMNS)
      .eq('id', decision.lesson.lesson.promptId)
      .maybeSingle()
    if (error) return queryFailure('prompt', error)
    if (data === null) return invalidResponse('prompt')
    promptRow = data
  } catch (error) {
    return queryFailure('prompt', error)
  }

  const prompt = curriculumPromptOutcome(promptRow, {
    lessonId: decision.lesson.lesson.id,
    promptId: decision.lesson.lesson.promptId,
    mode: pathResult.data.path.mode,
    difficulty: decision.chapter.level,
  })
  if (prompt.status === 'denied') return prompt
  if (prompt.status === 'invalid_response') return invalidResponse('prompt')
  return {
    status: 'allowed',
    data: { session: prompt.data, lesson: decision.lesson },
  }
}

type AuthOutcome =
  | { status: 'ready'; client: SupabaseClient<Database>; userId: string }
  | { status: 'unauthenticated' }
  | CurriculumLoadFailure

async function authenticatedCurriculumClient(): Promise<AuthOutcome> {
  try {
    const client = await createClient()
    const { data, error } = await client.auth.getUser()
    if (isMissingAuthSession(error)) return { status: 'unauthenticated' }
    if (error) {
      logCurriculumFailure('authentication', 'authentication', error)
      return { status: 'failure', reason: 'authentication', operation: 'authentication' }
    }
    if (!data.user) return { status: 'unauthenticated' }
    return { status: 'ready', client, userId: data.user.id }
  } catch (error) {
    logCurriculumFailure('authentication', 'authentication', error)
    return { status: 'failure', reason: 'authentication', operation: 'authentication' }
  }
}

export async function loadAuthenticatedCurriculumPath(
  requestedSlug: string,
): Promise<CurriculumPathLoadOutcome> {
  const slug = parsePathSlug(requestedSlug)
  if (!slug) return { status: 'not_found', resource: 'path' }
  const auth = await authenticatedCurriculumClient()
  if (auth.status !== 'ready') return auth
  return loadCurriculumPathForUser(auth.client, auth.userId, slug)
}

export async function loadAuthenticatedCurriculumLessonAccess(
  requestedPathSlug: string,
  lessonSlug: string,
): Promise<CurriculumLessonAccessOutcome> {
  const pathSlug = parsePathSlug(requestedPathSlug)
  if (!pathSlug) return { status: 'not_found', resource: 'path' }
  const auth = await authenticatedCurriculumClient()
  if (auth.status !== 'ready') return auth
  return loadCurriculumLessonAccessForUser(auth.client, auth.userId, pathSlug, lessonSlug)
}
