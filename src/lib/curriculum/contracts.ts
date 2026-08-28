export const PATH_SLUGS = [
  'general-speaking',
  'interviews',
  'presentations',
  'conversations',
] as const
export type PathSlug = (typeof PATH_SLUGS)[number]

export const PATH_MODES = {
  'general-speaking': 'practice',
  interviews: 'interview',
  presentations: 'presentation',
  conversations: 'conversation',
} as const

export const PATH_POSITIONS = {
  'general-speaking': 1,
  interviews: 2,
  presentations: 3,
  conversations: 4,
} as const

export const CHAPTER_LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export type ChapterLevel = (typeof CHAPTER_LEVELS)[number]

export const LESSON_KINDS = ['lesson', 'checkpoint'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]

export const LESSON_STATES = ['locked', 'available', 'retry_required', 'passed'] as const
export type LessonState = (typeof LESSON_STATES)[number]

export const CURRICULUM_ATTEMPT_STATUSES = ['none', 'neutral', 'scored'] as const
export type CurriculumAttemptStatus = (typeof CURRICULUM_ATTEMPT_STATUSES)[number]

export type Stars = 0 | 1 | 2 | 3

export interface CurriculumLessonDefinition {
  id: string
  chapterId: string
  slug: string
  title: string
  skillFocus: string
  position: number
  checkpoint: boolean
  promptId: string
  active: boolean
}

export interface CurriculumChapterDefinition {
  id: string
  pathId: string
  level: ChapterLevel
  title: string
  position: number
  active: boolean
  lessons: readonly CurriculumLessonDefinition[]
}

export interface CurriculumPathDefinition {
  id: string
  slug: PathSlug
  title: string
  mode: (typeof PATH_MODES)[PathSlug]
  position: number
  active: boolean
  chapters: readonly CurriculumChapterDefinition[]
}

/** Durable achievement loaded only from lesson_progress. */
export interface PersistedLessonProgress {
  lessonId: string
  bestScore: unknown
  /** Null is valid after the source attempt has been deleted. */
  bestAttemptId: unknown
}

/** Attempt evidence that is deliberately separate from permanent achievement. */
export interface NeutralLessonAttemptEvidence {
  lessonId: string
}

export interface CurriculumLessonLink {
  id: string
  slug: string
  pathSlug: PathSlug
  level: ChapterLevel
  position: number
}

export interface CurriculumChapterLink {
  id: string
  pathSlug: PathSlug
  level: ChapterLevel
  position: number
}

export interface CurriculumLessonProgress {
  lesson: CurriculumLessonDefinition
  state: LessonState
  bestScore: number | null
  bestAttemptId: string | null
  stars: Stars
  passed: boolean
  attempted: boolean
  attemptStatus: CurriculumAttemptStatus
  checkpoint: boolean
  previousLesson: CurriculumLessonLink | null
  nextLesson: CurriculumLessonLink | null
}

export interface CurriculumChapterSummary {
  chapter: CurriculumChapterDefinition
  totalLessons: number
  attemptedLessons: number
  passedLessons: number
  masteredLessons: number
  earnedStars: number
  maximumStars: number
  checkpointState: LessonState
  chapterUnlocked: boolean
  chapterComplete: boolean
  currentLesson: CurriculumLessonLink | null
}

export type CurriculumNextAction =
  | { kind: 'start'; lesson: CurriculumLessonLink }
  | { kind: 'retry'; lesson: CurriculumLessonLink; requiredScore: number }
  | { kind: 'complete' }

export interface CurriculumPathSummary {
  totalLessons: number
  attemptedLessons: number
  passedLessons: number
  masteredLessons: number
  earnedStars: number
  maximumStars: number
  currentChapter: CurriculumChapterLink | null
  currentLesson: CurriculumLessonLink | null
  pathComplete: boolean
  nextAction: CurriculumNextAction
}

export interface CurriculumPathProgress {
  path: CurriculumPathDefinition
  lessons: readonly CurriculumLessonProgress[]
  chapters: readonly CurriculumChapterSummary[]
  summary: CurriculumPathSummary
}

export type CurriculumInputError =
  | {
      kind: 'invalid_curriculum'
      code:
        | 'invalid_path'
        | 'invalid_path_identity'
        | 'invalid_chapter_count'
        | 'invalid_chapter_identity'
        | 'invalid_lesson_count'
        | 'invalid_lesson_identity'
        | 'invalid_checkpoint'
        | 'duplicate_identifier'
      message: string
    }
  | {
      kind: 'invalid_progress'
      code:
        | 'invalid_progress_row'
        | 'duplicate_progress'
        | 'unknown_progress_lesson'
        | 'unreachable_progress'
      message: string
    }
  | {
      kind: 'invalid_attempt_evidence'
      code: 'invalid_evidence_row' | 'duplicate_evidence' | 'unknown_evidence_lesson'
      message: string
    }

export type CurriculumPathProgressOutcome =
  { ok: true; value: CurriculumPathProgress } | { ok: false; error: CurriculumInputError }
