import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePathSlug } from '@/lib/curriculum/data'
import {
  buildStructuredLessonResult,
  type StructuredLessonResultModel,
} from '@/lib/curriculum/result'
import { loadCurriculumPathForUser, type CurriculumPathLoader } from '@/lib/curriculum/server'
import type { Database } from '@/lib/types/database'

const LESSON_IDENTITY_COLUMNS = 'id, chapter_id'
const CHAPTER_IDENTITY_COLUMNS = 'id, path_id'
const PATH_IDENTITY_COLUMNS = 'id, slug'

type IdentityOperation = 'lesson' | 'chapter' | 'path' | 'topology'

export type StructuredLessonResultLoadOutcome =
  | { status: 'ready'; data: StructuredLessonResultModel }
  | { status: 'not_found' }
  | { status: 'failure'; operation: IdentityOperation }

type StructuredLessonResultLoadFailure = Extract<
  StructuredLessonResultLoadOutcome,
  { status: 'failure' }
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

function failure(operation: IdentityOperation, error?: unknown): StructuredLessonResultLoadFailure {
  console.error('[curriculum] result context load failed', {
    operation,
    code: safeErrorCode(error),
  })
  return { status: 'failure', operation }
}

async function loadIdentity(
  supabase: SupabaseClient<Database>,
  table: 'practice_lessons' | 'practice_chapters' | 'practice_paths',
  columns: string,
  id: string,
  operation: Exclude<IdentityOperation, 'topology'>,
): Promise<
  | { status: 'ready'; data: Record<string, unknown> }
  | { status: 'not_found' }
  | { status: 'failure'; operation: IdentityOperation }
> {
  try {
    const { data, error } = await supabase.from(table).select(columns).eq('id', id).maybeSingle()
    if (error) return failure(operation, error)
    if (data === null) return { status: 'not_found' }
    return isRecord(data) ? { status: 'ready', data } : failure(operation)
  } catch (error) {
    return failure(operation, error)
  }
}

/**
 * Resolves an attempt's lesson_id through immutable lesson, chapter, and path
 * identities before loading owner-scoped lesson_progress and path topology.
 */
export async function loadStructuredLessonResultForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: {
    lessonId: string
    attemptId: string
    promptId: unknown
    practiceMode: unknown
    rubricVersion: unknown
    currentScore: unknown
    snapshotMode: unknown
    snapshotRubricVersion: unknown
    snapshotScore: unknown
  },
  pathLoader: CurriculumPathLoader = loadCurriculumPathForUser,
): Promise<StructuredLessonResultLoadOutcome> {
  const lesson = await loadIdentity(
    supabase,
    'practice_lessons',
    LESSON_IDENTITY_COLUMNS,
    input.lessonId,
    'lesson',
  )
  if (lesson.status !== 'ready') return lesson
  if (lesson.data.id !== input.lessonId || typeof lesson.data.chapter_id !== 'string') {
    return failure('lesson')
  }

  const chapter = await loadIdentity(
    supabase,
    'practice_chapters',
    CHAPTER_IDENTITY_COLUMNS,
    lesson.data.chapter_id,
    'chapter',
  )
  if (chapter.status !== 'ready') return chapter
  if (chapter.data.id !== lesson.data.chapter_id || typeof chapter.data.path_id !== 'string') {
    return failure('chapter')
  }

  const pathIdentity = await loadIdentity(
    supabase,
    'practice_paths',
    PATH_IDENTITY_COLUMNS,
    chapter.data.path_id,
    'path',
  )
  if (pathIdentity.status !== 'ready') return pathIdentity
  const pathSlug = parsePathSlug(pathIdentity.data.slug)
  if (pathIdentity.data.id !== chapter.data.path_id || pathSlug === null) return failure('path')

  const topology = await pathLoader(supabase, userId, pathSlug)
  if (topology.status === 'not_found') return { status: 'not_found' }
  if (topology.status !== 'ready') return failure('topology')
  if (topology.data.path.id !== pathIdentity.data.id) return failure('topology')

  const lessonProgress = topology.data.lessons.find(
    (candidate) => candidate.lesson.id === input.lessonId,
  )
  if (!lessonProgress) return failure('topology')
  const scoringIdentityMatches =
    input.rubricVersion === 'v2' &&
    input.snapshotRubricVersion === 'v2' &&
    input.practiceMode === input.snapshotMode &&
    input.practiceMode === topology.data.path.mode &&
    input.promptId === lessonProgress.lesson.promptId

  const model = buildStructuredLessonResult({
    path: topology.data,
    lessonId: input.lessonId,
    attemptId: input.attemptId,
    currentScore: scoringIdentityMatches ? input.currentScore : null,
    snapshotScore: scoringIdentityMatches ? input.snapshotScore : null,
  })
  return model ? { status: 'ready', data: model } : failure('topology')
}
