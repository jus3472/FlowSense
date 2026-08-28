import { describe, expect, it } from 'vitest'
import {
  matchesStructuredPracticeSession,
  matchesStructuredRetryParent,
  structuredPracticeSession,
} from '@/lib/curriculum/recording'
import type { CurriculumLessonSession } from '@/lib/curriculum/data'

const LESSON: CurriculumLessonSession = {
  lessonId: '10000000-0000-4000-8000-000000000001',
  pathSlug: 'interviews',
  chapterLevel: 'beginner',
  lessonSlug: 'interviews-beginner-01-answer-directly',
  lessonPosition: 1,
  checkpoint: false,
  promptId: '20000000-0000-4000-8000-000000000002',
  promptText: 'Describe a choice you made recently.',
  mode: 'interview',
  difficulty: 'beginner',
  targetDurationSeconds: 60,
}
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000003'

function parent(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    lesson_id: LESSON.lessonId,
    prompt_id: LESSON.promptId,
    prompt_text: LESSON.promptText,
    practice_mode: LESSON.mode,
    prompt_source: 'library',
    prompt_difficulty: LESSON.difficulty,
    metrics: { practice: { target_duration_seconds: LESSON.targetDurationSeconds } },
    status: 'done',
    ...overrides,
  }
}

describe('structured lesson recording contract', () => {
  it('builds one recorder session from the authoritative lesson snapshot', () => {
    expect(structuredPracticeSession(LESSON, null)).toEqual({
      promptId: LESSON.promptId,
      promptText: LESSON.promptText,
      mode: LESSON.mode,
      difficulty: LESSON.difficulty,
      source: 'library',
      targetDurationSeconds: LESSON.targetDurationSeconds,
      retryOfAttemptId: null,
      curriculum: {
        lessonId: LESSON.lessonId,
        pathSlug: LESSON.pathSlug,
        chapterLevel: LESSON.chapterLevel,
        lessonSlug: LESSON.lessonSlug,
        lessonPosition: LESSON.lessonPosition,
        checkpoint: LESSON.checkpoint,
      },
    })
  })

  it('rejects browser changes to any authoritative curriculum identity', () => {
    const session = structuredPracticeSession(LESSON, null)
    expect(session).not.toBeNull()
    if (!session?.curriculum) return

    expect(matchesStructuredPracticeSession(session, LESSON)).toBe(true)
    expect(
      matchesStructuredPracticeSession(
        { ...session, promptText: 'A different prompt.' },
        LESSON,
      ),
    ).toBe(false)
    expect(
      matchesStructuredPracticeSession(
        { ...session, curriculum: { ...session.curriculum, pathSlug: 'conversations' } },
        LESSON,
      ),
    ).toBe(false)
    expect(
      matchesStructuredPracticeSession(
        { ...session, curriculum: { ...session.curriculum, lessonPosition: 2 } },
        LESSON,
      ),
    ).toBe(false)
  })

  it('allows only a settled parent from the same immutable lesson snapshot', () => {
    expect(matchesStructuredRetryParent(parent(), LESSON, ATTEMPT_ID)).toBe(true)
    expect(
      matchesStructuredRetryParent(
        parent({ lesson_id: '40000000-0000-4000-8000-000000000004' }),
        LESSON,
        ATTEMPT_ID,
      ),
    ).toBe(false)
    expect(
      matchesStructuredRetryParent(parent({ status: 'scoring' }), LESSON, ATTEMPT_ID),
    ).toBe(false)
    expect(
      matchesStructuredRetryParent(parent({ prompt_text: 'Changed.' }), LESSON, ATTEMPT_ID),
    ).toBe(false)
  })
})
