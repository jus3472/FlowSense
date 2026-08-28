import {
  type CurriculumChapterLink,
  type CurriculumChapterSummary,
  type CurriculumChapterDefinition,
  type CurriculumInputError,
  type CurriculumLessonProgress,
  type CurriculumPathProgressOutcome,
  type NeutralLessonAttemptEvidence,
  type PersistedLessonProgress,
  type LessonState,
  type PathSlug,
} from '@/lib/curriculum/contracts'
import { flattenCurriculumPath } from '@/lib/curriculum/navigation'
import {
  PASSING_SCORE,
  isPassingScore,
  parseCurriculumScore,
  starsForScore,
} from '@/lib/curriculum/thresholds'

export interface LessonAttemptCandidate {
  attemptId: string
  score: unknown
  finishedAt: unknown
}

export interface BestLessonAttempt {
  attemptId: string
  score: number
  /** A valid stored date string, or null when the attempt has no usable completion time. */
  finishedAt: string | null
}

export interface LessonStateInput {
  unlocked: boolean
  bestScore: unknown
}

export interface BuildCurriculumPathProgressInput {
  path: unknown
  progress: readonly PersistedLessonProgress[]
  attemptEvidence?: readonly NeutralLessonAttemptEvidence[]
}

function parseFinishedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return Number.isFinite(Date.parse(value)) ? value : null
}

function normalizeAttempt(candidate: LessonAttemptCandidate): BestLessonAttempt | null {
  const score = parseCurriculumScore(candidate.score)
  if (score === null || candidate.attemptId.length === 0) return null
  return {
    attemptId: candidate.attemptId,
    score,
    finishedAt: parseFinishedAt(candidate.finishedAt),
  }
}

function compareAttemptIds(left: string, right: string): number {
  if (left === right) return 0
  return left > right ? 1 : -1
}

/** Positive means left is the preferred best-attempt record. */
function compareAttempts(left: BestLessonAttempt, right: BestLessonAttempt): number {
  if (left.score !== right.score) return left.score - right.score

  const leftTime = left.finishedAt === null ? null : Date.parse(left.finishedAt)
  const rightTime = right.finishedAt === null ? null : Date.parse(right.finishedAt)
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return leftTime - rightTime
  }
  if (leftTime !== null && rightTime === null) return 1
  if (leftTime === null && rightTime !== null) return -1
  return compareAttemptIds(left.attemptId, right.attemptId)
}

/**
 * Selects a monotonic best from any input order. Invalid and neutral scores are ignored.
 * Equal scores prefer the newest valid completion time, followed by attempt id.
 */
export function selectBestAttempt(
  candidates: readonly LessonAttemptCandidate[],
): BestLessonAttempt | null {
  let best: BestLessonAttempt | null = null
  for (const candidate of candidates) {
    const normalized = normalizeAttempt(candidate)
    if (normalized !== null && (best === null || compareAttempts(normalized, best) > 0)) {
      best = normalized
    }
  }
  return best
}

/**
 * Applies one retry without allowing a lower or malformed score to reduce stored progress.
 */
export function mergeBestAttempt(
  current: LessonAttemptCandidate | null,
  retry: LessonAttemptCandidate,
): BestLessonAttempt | null {
  return selectBestAttempt(current === null ? [retry] : [current, retry])
}

export function lessonStateFor({ unlocked, bestScore }: LessonStateInput): LessonState {
  if (!unlocked) return 'locked'
  const score = parseCurriculumScore(bestScore)
  if (score === null) return 'available'
  return isPassingScore(score) ? 'passed' : 'retry_required'
}

type ProgressErrorCode = Extract<CurriculumInputError, { kind: 'invalid_progress' }>['code']
type EvidenceErrorCode = Extract<CurriculumInputError, { kind: 'invalid_attempt_evidence' }>['code']

function invalidProgress(code: ProgressErrorCode, message: string): CurriculumPathProgressOutcome {
  return { ok: false, error: { kind: 'invalid_progress', code, message } }
}

function invalidEvidence(code: EvidenceErrorCode, message: string): CurriculumPathProgressOutcome {
  return { ok: false, error: { kind: 'invalid_attempt_evidence', code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chapterLink(
  pathSlug: PathSlug,
  chapter: CurriculumChapterDefinition,
): CurriculumChapterLink {
  return {
    id: chapter.id,
    pathSlug,
    level: chapter.level,
    position: chapter.position,
  }
}

/**
 * Builds the one authoritative sequential view of a path. It never derives
 * permanent achievement from attempts and never uses path preferences.
 */
export function buildCurriculumPathProgress({
  path: pathInput,
  progress: progressInput,
  attemptEvidence = [],
}: BuildCurriculumPathProgressInput): CurriculumPathProgressOutcome {
  const flattened = flattenCurriculumPath(pathInput)
  if (!flattened.ok) return flattened
  if (!Array.isArray(progressInput)) {
    return invalidProgress('invalid_progress_row', 'Persisted lesson progress must be a list.')
  }
  if (!Array.isArray(attemptEvidence)) {
    return invalidEvidence('invalid_evidence_row', 'Neutral attempt evidence must be a list.')
  }

  const { path, lessons: ordered } = flattened.value
  const lessonIds = new Set(ordered.map(({ lesson }) => lesson.id))
  const progressByLesson = new Map<string, { bestScore: number; bestAttemptId: string | null }>()

  for (const row of progressInput) {
    if (!isRecord(row)) {
      return invalidProgress(
        'invalid_progress_row',
        'A persisted lesson progress row is malformed.',
      )
    }
    const score = parseCurriculumScore(row.bestScore)
    const bestAttemptId = row.bestAttemptId
    if (
      typeof row.lessonId !== 'string' ||
      row.lessonId.length === 0 ||
      score === null ||
      (bestAttemptId !== null && (typeof bestAttemptId !== 'string' || bestAttemptId.length === 0))
    ) {
      return invalidProgress(
        'invalid_progress_row',
        'A persisted lesson progress row is malformed.',
      )
    }
    if (!lessonIds.has(row.lessonId)) {
      return invalidProgress(
        'unknown_progress_lesson',
        'Persisted lesson progress references a lesson outside this path.',
      )
    }
    if (progressByLesson.has(row.lessonId)) {
      return invalidProgress('duplicate_progress', 'Persisted lesson progress must be unique.')
    }
    progressByLesson.set(row.lessonId, { bestScore: score, bestAttemptId })
  }

  const neutralLessonIds = new Set<string>()
  for (const evidence of attemptEvidence) {
    if (
      !isRecord(evidence) ||
      typeof evidence.lessonId !== 'string' ||
      evidence.lessonId.length === 0
    ) {
      return invalidEvidence('invalid_evidence_row', 'Neutral attempt evidence is malformed.')
    }
    if (!lessonIds.has(evidence.lessonId)) {
      return invalidEvidence(
        'unknown_evidence_lesson',
        'Neutral attempt evidence references a lesson outside this path.',
      )
    }
    if (neutralLessonIds.has(evidence.lessonId)) {
      return invalidEvidence('duplicate_evidence', 'Neutral attempt evidence must be unique.')
    }
    neutralLessonIds.add(evidence.lessonId)
  }

  const lessons: CurriculumLessonProgress[] = []
  for (const [index, item] of ordered.entries()) {
    const stored = progressByLesson.get(item.lesson.id) ?? null
    const unlocked = index === 0 || lessons[index - 1]?.passed === true
    if (!unlocked && (stored !== null || neutralLessonIds.has(item.lesson.id))) {
      return invalidProgress(
        'unreachable_progress',
        'A locked lesson cannot contain structured progress or attempt evidence.',
      )
    }

    const bestScore = stored?.bestScore ?? null
    const attemptStatus =
      stored !== null ? 'scored' : neutralLessonIds.has(item.lesson.id) ? 'neutral' : 'none'
    lessons.push({
      lesson: item.lesson,
      state: lessonStateFor({ unlocked, bestScore }),
      bestScore,
      bestAttemptId: stored?.bestAttemptId ?? null,
      stars: starsForScore(bestScore),
      passed: isPassingScore(bestScore),
      attempted: attemptStatus !== 'none',
      attemptStatus,
      checkpoint: item.lesson.checkpoint,
      previousLesson: index === 0 ? null : (ordered[index - 1]?.link ?? null),
      nextLesson: index === ordered.length - 1 ? null : (ordered[index + 1]?.link ?? null),
    })
  }

  const chapters: CurriculumChapterSummary[] = path.chapters.map((chapter) => {
    const chapterLessons = lessons.filter((lesson) => lesson.lesson.chapterId === chapter.id)
    const checkpoint = chapterLessons[chapterLessons.length - 1]
    const currentLesson = chapterLessons.find((lesson) => !lesson.passed) ?? null
    return {
      chapter,
      totalLessons: chapterLessons.length,
      attemptedLessons: chapterLessons.filter((lesson) => lesson.attempted).length,
      passedLessons: chapterLessons.filter((lesson) => lesson.passed).length,
      masteredLessons: chapterLessons.filter((lesson) => lesson.stars === 3).length,
      earnedStars: chapterLessons.reduce((sum, lesson) => sum + lesson.stars, 0),
      maximumStars: chapterLessons.length * 3,
      checkpointState: checkpoint?.state ?? 'locked',
      chapterUnlocked: chapterLessons[0]?.state !== 'locked',
      chapterComplete: checkpoint?.passed === true,
      currentLesson: currentLesson
        ? (ordered.find(({ lesson }) => lesson.id === currentLesson.lesson.id)?.link ?? null)
        : null,
    }
  })

  const currentLessonIndex = lessons.findIndex((lesson) => !lesson.passed)
  const currentLesson =
    currentLessonIndex === -1 ? null : (ordered[currentLessonIndex]?.link ?? null)
  const currentProgress = currentLessonIndex === -1 ? null : (lessons[currentLessonIndex] ?? null)
  const currentChapter = currentProgress
    ? (chapters.find((chapter) => chapter.chapter.id === currentProgress.lesson.chapterId) ?? null)
    : null
  const pathComplete = lessons.length === 30 && lessons.every((lesson) => lesson.passed)

  return {
    ok: true,
    value: {
      path,
      lessons,
      chapters,
      summary: {
        totalLessons: lessons.length,
        attemptedLessons: lessons.filter((lesson) => lesson.attempted).length,
        passedLessons: lessons.filter((lesson) => lesson.passed).length,
        masteredLessons: lessons.filter((lesson) => lesson.stars === 3).length,
        earnedStars: lessons.reduce((sum, lesson) => sum + lesson.stars, 0),
        maximumStars: lessons.length * 3,
        currentChapter: currentChapter ? chapterLink(path.slug, currentChapter.chapter) : null,
        currentLesson,
        pathComplete,
        nextAction:
          currentLesson === null
            ? { kind: 'complete' }
            : currentProgress?.state === 'retry_required'
              ? { kind: 'retry', lesson: currentLesson, requiredScore: PASSING_SCORE }
              : { kind: 'start', lesson: currentLesson },
      },
    },
  }
}
