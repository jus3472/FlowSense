export const PATH_SLUGS = [
  'general-speaking',
  'interviews',
  'presentations',
  'conversations',
] as const
export type PathSlug = (typeof PATH_SLUGS)[number]

export const CHAPTER_LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export type ChapterLevel = (typeof CHAPTER_LEVELS)[number]

export const LESSON_KINDS = ['lesson', 'checkpoint'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]

export const LESSON_STATES = ['locked', 'available', 'retry_required', 'passed'] as const
export type LessonState = (typeof LESSON_STATES)[number]

export type Stars = 0 | 1 | 2 | 3
