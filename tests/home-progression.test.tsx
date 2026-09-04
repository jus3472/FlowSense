// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HomePrimaryPath, HomeSecondaryPaths } from '@/components/home/path-progress'
import { StreakDisplay } from '@/components/home/streak-display'
import {
  PATH_MODES,
  PATH_POSITIONS,
  type CurriculumPathDefinition,
  type CurriculumPathProgress,
  type PathSlug,
  type PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import type { CurriculumOverviewData } from '@/lib/curriculum/overview'
import { buildCurriculumPathProgress } from '@/lib/curriculum/progression'
import { buildHomeCurriculumModel } from '@/lib/home/progression'

vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
const TITLES: Record<PathSlug, string> = {
  'general-speaking': 'General Speaking',
  interviews: 'Interviews',
  presentations: 'Presentations',
  conversations: 'Conversations',
}

function definition(slug: PathSlug): CurriculumPathDefinition {
  const pathId = `${slug}-path`
  return {
    id: pathId,
    slug,
    title: TITLES[slug],
    mode: PATH_MODES[slug],
    position: PATH_POSITIONS[slug],
    active: true,
    chapters: LEVELS.map((level, chapterIndex) => {
      const chapterId = `${slug}-${level}-chapter`
      return {
        id: chapterId,
        pathId,
        level,
        title: `${TITLES[slug]} ${level}`,
        position: chapterIndex + 1,
        active: true,
        lessons: Array.from({ length: 10 }, (_, lessonIndex) => {
          const position = lessonIndex + 1
          const sequence = chapterIndex * 10 + position
          return {
            id: `${slug}-lesson-${sequence}`,
            chapterId,
            slug: `${slug}-${level}-${String(position).padStart(2, '0')}-skill-${sequence}`,
            title: `${TITLES[slug]} lesson ${sequence}`,
            skillFocus: `Skill ${sequence}`,
            position,
            checkpoint: position === 10,
            promptId: `${slug}-prompt-${sequence}`,
            active: true,
          }
        }),
      }
    }),
  }
}

function progress(
  slug: PathSlug,
  options: { passed?: number; retryScore?: number; neutral?: boolean } = {},
): CurriculumPathProgress {
  const path = definition(slug)
  const lessons = path.chapters.flatMap((chapter) => chapter.lessons)
  const passed = options.passed ?? 0
  const stored: PersistedLessonProgress[] = lessons
    .slice(0, passed)
    .map((lesson) => ({ lessonId: lesson.id, bestScore: 90, bestAttemptId: null }))
  if (options.retryScore !== undefined) {
    const current = lessons[passed]
    if (!current) throw new Error('Test progress has no current lesson.')
    stored.push({
      lessonId: current.id,
      bestScore: options.retryScore,
      bestAttemptId: `attempt-${slug}-${passed + 1}`,
    })
  }
  const neutralLesson = options.neutral ? lessons[passed] : undefined
  if (options.neutral && !neutralLesson) throw new Error('Test progress has no neutral lesson.')
  const built = buildCurriculumPathProgress({
    path,
    progress: stored,
    attemptEvidence: neutralLesson ? [{ lessonId: neutralLesson.id }] : [],
  })
  if (!built.ok) throw new Error(`Invalid fixture: ${built.error.code}`)
  return built.value
}

function overview(
  primary: CurriculumPathProgress,
  secondary: readonly CurriculumPathProgress[] = [],
  available: readonly CurriculumPathProgress[] = [],
): CurriculumOverviewData {
  return {
    usedDefaultPreference: false,
    paths: [
      { progress: primary, selection: 'primary', preferenceRank: 0 },
      ...secondary.map((item, index) => ({
        progress: item,
        selection: 'selected' as const,
        preferenceRank: index + 1,
      })),
      ...available.map((item) => ({
        progress: item,
        selection: 'available' as const,
        preferenceRank: null,
      })),
    ],
  }
}

function modelFor(
  primary: CurriculumPathProgress,
  secondary: readonly CurriculumPathProgress[] = [],
  available: readonly CurriculumPathProgress[] = [],
) {
  const model = buildHomeCurriculumModel(overview(primary, secondary, available))
  if (!model) throw new Error('Expected a primary Home path.')
  return model
}

describe('Home curriculum progression', () => {
  it('uses the first authoritative lesson for a fresh user', () => {
    const model = modelFor(progress('interviews'))

    expect(model.primary).toMatchObject({
      heading: 'Continue Interviews',
      chapterLabel: 'Beginner · Lesson 1 of 10',
      lessonTitle: 'Interviews lesson 1',
      lessonStatus: 'Not attempted',
      action: {
        label: 'Continue',
        href: '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1/record',
      },
      passedLessons: 0,
      earnedStars: 0,
    })
  })

  it('continues the current available lesson from shared progress', () => {
    const model = modelFor(progress('interviews', { passed: 6 }))

    expect(model.primary).toMatchObject({
      chapterLabel: 'Beginner · Lesson 7 of 10',
      lessonTitle: 'Interviews lesson 7',
      lessonStatus: 'Not attempted',
      action: { label: 'Continue' },
      passedLessons: 6,
      earnedStars: 18,
    })
  })

  it('shows the authoritative retry state and required score', () => {
    const model = modelFor(progress('interviews', { passed: 5, retryScore: 64 }))

    expect(model.primary).toMatchObject({
      chapterLabel: 'Beginner · Lesson 6 of 10',
      lessonStatus: 'Best: 64 · Need 70 to continue',
      action: { label: 'Try Again' },
    })
  })

  it('marks a chapter transition before the next chapter lesson', () => {
    const model = modelFor(progress('interviews', { passed: 10 }))

    expect(model.primary).toMatchObject({
      heading: 'Interviews',
      transitionLabel: 'Beginner complete',
      chapterLabel: 'Intermediate · Lesson 1 of 10',
      lessonTitle: 'Interviews lesson 11',
      action: { label: 'Continue' },
    })
  })

  it('shows permanent path completion and the path destination', () => {
    const model = modelFor(progress('interviews', { passed: 30 }))

    expect(model.primary).toMatchObject({
      heading: 'Interviews',
      pathComplete: true,
      passedLessons: 30,
      totalLessons: 30,
      earnedStars: 90,
      maximumStars: 90,
      action: { label: 'View Path', href: '/practice/paths/interviews' },
    })
  })

  it('keeps provider-neutral lesson activity available without inventing a score', () => {
    const model = modelFor(progress('general-speaking', { neutral: true }))

    expect(model.primary).toMatchObject({
      lessonStatus: 'No score yet',
      action: { label: 'Continue' },
      passedLessons: 0,
      earnedStars: 0,
    })
  })

  it('shows selected secondary paths in rank order and omits unselected paths', () => {
    const model = modelFor(
      progress('interviews'),
      [progress('presentations', { passed: 3 }), progress('conversations', { passed: 1 })],
      [progress('general-speaking', { passed: 8 })],
    )

    expect(model.secondary.map(({ title, status }) => ({ title, status }))).toEqual([
      { title: 'Presentations', status: 'Beginner · 3 / 10 passed' },
      { title: 'Conversations', status: 'Beginner · 1 / 10 passed' },
    ])

    render(<HomeSecondaryPaths paths={model.secondary} />)
    const section = screen.getByRole('heading', { name: 'Your other paths' }).parentElement
    if (!section) throw new Error('Expected secondary path section.')
    expect(within(section).getByText('Presentations')).toBeInTheDocument()
    expect(within(section).getByText('Conversations')).toBeInTheDocument()
    expect(within(section).queryByText('General Speaking')).not.toBeInTheDocument()
  })

  it('renders the primary action and restrained lesson and star summary', () => {
    const model = modelFor(progress('interviews', { passed: 5, retryScore: 64 }))
    render(<HomePrimaryPath primary={model.primary} />)

    expect(screen.getByRole('heading', { name: 'Continue Interviews' })).toBeInTheDocument()
    expect(screen.queryByText('Interviews lesson 6')).not.toBeInTheDocument()
    expect(screen.getByText('5 / 30 lessons passed')).toBeInTheDocument()
    expect(screen.getByText('15 / 90 stars')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/practice/paths/interviews/lessons/interviews-beginner-06-skill-6/record?retry=attempt-interviews-6',
    )
  })
})

describe('compact header streak presentation', () => {
  it('shows an active streak and complete daily goal, including provider-neutral activity', () => {
    render(
      <StreakDisplay
        summary={{
          current: 12,
          todayActive: true,
          timezone: 'America/New_York',
          today: '2026-08-28',
          dailyGoal: 'complete',
        }}
      />,
    )

    const status = screen.getByRole('img', {
      name: "12 day streak. Today's practice complete.",
    })
    expect(status).toHaveTextContent('12')
    expect(status).toHaveAttribute('data-today-active', 'true')
    expect(status.querySelectorAll('svg')).toHaveLength(2)
  })

  it('keeps yesterday anchored while today remains incomplete', () => {
    render(
      <StreakDisplay
        summary={{
          current: 4,
          todayActive: false,
          timezone: 'UTC',
          today: '2026-08-28',
          dailyGoal: 'incomplete',
        }}
      />,
    )

    const status = screen.getByRole('img', {
      name: "4 day streak. Today's practice not complete.",
    })
    expect(status).toHaveTextContent('4')
    expect(status).toHaveAttribute('data-today-active', 'false')
    expect(status.querySelectorAll('svg')).toHaveLength(1)
  })
})
