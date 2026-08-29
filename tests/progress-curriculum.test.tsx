// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CurriculumProgress } from '@/components/progress/curriculum-progress'
import { ProgressDashboard } from '@/components/progress/progress-dashboard'
import {
  CHAPTER_LEVELS,
  PATH_MODES,
  PATH_POSITIONS,
  type CurriculumPathDefinition,
  type CurriculumPathProgress,
  type PathSlug,
  type PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import { buildCurriculumOverview, type CurriculumOverviewData } from '@/lib/curriculum/overview'
import { buildCurriculumPathProgress } from '@/lib/curriculum/progression'
import { aggregateV2Progress } from '@/lib/progress/aggregation'
import type { ProgressDashboardData } from '@/lib/progress/server'

vi.mock('next/link', () => ({
  default: ({ href, ...props }: ComponentProps<'a'>) => <a href={String(href)} {...props} />,
}))
vi.mock('@/components/system/retry-button', () => ({
  RetryButton: () => <button type="button">Try again</button>,
}))

const TITLES: Record<PathSlug, string> = {
  'general-speaking': 'General Speaking',
  interviews: 'Interviews',
  presentations: 'Presentations',
  conversations: 'Conversations',
}

function makePath(slug: PathSlug): CurriculumPathDefinition {
  const pathId = `path-${slug}`
  return {
    id: pathId,
    slug,
    title: TITLES[slug],
    mode: PATH_MODES[slug],
    position: PATH_POSITIONS[slug],
    active: true,
    chapters: CHAPTER_LEVELS.map((level, chapterIndex) => {
      const chapterId = `${pathId}-${level}`
      const chapterTitle = `${level[0]?.toUpperCase()}${level.slice(1)}`
      return {
        id: chapterId,
        pathId,
        level,
        title: chapterTitle,
        position: chapterIndex + 1,
        active: true,
        lessons: Array.from({ length: 10 }, (_, lessonIndex) => {
          const position = lessonIndex + 1
          return {
            id: `${slug}-${level}-${position}`,
            chapterId,
            slug: `${slug}-${level}-${String(position).padStart(2, '0')}-skill-${position}`,
            title: `${chapterTitle} lesson ${position}`,
            skillFocus: `Skill ${position}`,
            position,
            checkpoint: position === 10,
            promptId: `prompt-${slug}-${level}-${position}`,
            active: true,
          }
        }),
      }
    }),
  }
}

function progressRow(
  path: CurriculumPathDefinition,
  index: number,
  score: number,
): PersistedLessonProgress {
  const lesson = path.chapters[Math.floor(index / 10)]?.lessons[index % 10]
  if (!lesson) throw new Error('Missing curriculum fixture lesson.')
  return { lessonId: lesson.id, bestScore: score, bestAttemptId: `attempt-${index}` }
}

function progress(slug: PathSlug, scores: readonly number[] = []): CurriculumPathProgress {
  const path = makePath(slug)
  const outcome = buildCurriculumPathProgress({
    path,
    progress: scores.map((score, index) => progressRow(path, index, score)),
  })
  if (!outcome.ok) throw new Error(`${outcome.error.kind}: ${outcome.error.code}`)
  return outcome.value
}

function overview(
  scores: Partial<Record<PathSlug, readonly number[]>> = {},
  selected: readonly PathSlug[] = ['general-speaking'],
): CurriculumOverviewData {
  const paths = (Object.keys(TITLES) as PathSlug[]).map((slug) =>
    progress(slug, scores[slug] ?? []),
  )
  const preferences = selected.map((slug, rank) => ({ pathId: `path-${slug}`, rank }))
  const outcome = buildCurriculumOverview(paths, preferences)
  if (!outcome.ok) throw new Error(outcome.error.code)
  return outcome.value
}

function speakingDashboard(): ProgressDashboardData {
  return {
    progress: aggregateV2Progress([], { now: new Date('2026-08-28T12:00:00.000Z') }),
    retryComparisons: [],
    coverage: { completedAttemptLimit: 200, truncated: false },
  }
}

describe('curriculum progress display', () => {
  it('shows a new primary path without inventing achievement', () => {
    render(<CurriculumProgress overview={overview()} />)

    expect(screen.getByText('Primary path')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'General Speaking' })).toBeInTheDocument()
    expect(screen.getByText('Beginner lesson 1')).toBeInTheDocument()
    expect(screen.getByText('Pass with 70 to continue.')).toBeInTheDocument()
    expect(screen.getAllByText('0 / 30')[0]).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'General Speaking chapter progress' }),
    ).toHaveTextContent('BeginnerCurrent0 / 10 passed0 / 30 stars0 masteredIntermediateLocked')
  })

  it('shows partial lesson totals, earned stars, mastery, and a retry target', () => {
    render(
      <CurriculumProgress overview={overview({ 'general-speaking': [90, 80, 70, 90, 80, 64] })} />,
    )

    expect(screen.getByText('5 / 30')).toBeInTheDocument()
    expect(screen.getByText('11 / 90')).toBeInTheDocument()
    expect(screen.getByText('2 / 30')).toBeInTheDocument()
    expect(screen.getByText('Beginner lesson 6')).toBeInTheDocument()
    expect(screen.getByText('Best 64 · Need 70')).toBeInTheDocument()
  })

  it('keeps the next chapter locked while its checkpoint needs a retry', () => {
    render(
      <CurriculumProgress
        overview={overview({ 'general-speaking': [...Array<number>(9).fill(70), 69] })}
      />,
    )

    expect(screen.getByText('Current checkpoint')).toBeInTheDocument()
    expect(screen.getByText('Beginner lesson 10')).toBeInTheDocument()
    expect(screen.getByText('Best 69 · Need 70')).toBeInTheDocument()
    const chapters = screen.getByRole('list', { name: 'General Speaking chapter progress' })
    expect(within(chapters).getByText('Beginner').parentElement).toHaveTextContent('Current')
    expect(within(chapters).getByText('Intermediate').parentElement).toHaveTextContent('Locked')
  })

  it.each([
    [10, 'Beginner', 'Complete', 'Intermediate', 'Current', 'Advanced', 'Locked'],
    [20, 'Intermediate', 'Complete', 'Advanced', 'Current', 'Beginner', 'Complete'],
  ] as const)(
    'shows chapter unlock state after %i passed lessons',
    (
      passed,
      completeChapter,
      completeState,
      currentChapter,
      currentState,
      otherChapter,
      otherState,
    ) => {
      render(
        <CurriculumProgress
          overview={overview({ 'general-speaking': Array<number>(passed).fill(70) })}
        />,
      )

      const chapters = screen.getByRole('list', { name: 'General Speaking chapter progress' })
      expect(within(chapters).getByText(completeChapter).parentElement).toHaveTextContent(
        completeState,
      )
      expect(within(chapters).getByText(currentChapter).parentElement).toHaveTextContent(
        currentState,
      )
      expect(within(chapters).getByText(otherChapter).parentElement).toHaveTextContent(otherState)
    },
  )

  it('shows complete path totals and permanent achievement', () => {
    render(
      <CurriculumProgress
        overview={overview({ 'general-speaking': Array<number>(30).fill(90) })}
      />,
    )

    expect(screen.getAllByText('Complete')).toHaveLength(4)
    expect(screen.getAllByText('30 / 30')).toHaveLength(2)
    expect(screen.getByText('90 / 90')).toBeInTheDocument()
    expect(screen.getByText('All lessons are passed.')).toBeInTheDocument()
  })

  it('orders the primary and secondary paths before unselected paths', () => {
    const { container } = render(
      <CurriculumProgress overview={overview({}, ['presentations', 'general-speaking'])} />,
    )
    const text = container.textContent ?? ''

    expect(text.indexOf('Presentations')).toBeLessThan(text.indexOf('General Speaking'))
    expect(text.indexOf('General Speaking')).toBeLessThan(text.indexOf('Other paths'))
    expect(text.indexOf('Other paths')).toBeLessThan(text.indexOf('Interviews'))
    expect(screen.getByText('Primary path').parentElement).toHaveTextContent('Presentations')
    expect(screen.getByText('Selected path').parentElement).toHaveTextContent('General Speaking')
    expect(screen.getAllByText('Not selected')).toHaveLength(2)
  })

  it('keeps valid curriculum visible when speaking trends fail, and vice versa', () => {
    const { rerender } = render(<ProgressDashboard dashboard={null} curriculum={overview()} />)

    expect(screen.getByRole('heading', { name: 'Path progress' })).toBeInTheDocument()
    expect(screen.getByText('Speaking skill progress is unavailable')).toBeInTheDocument()

    rerender(
      <ProgressDashboard dashboard={speakingDashboard()} curriculum={null} curriculumUnavailable />,
    )
    expect(screen.getByText('Path progress is unavailable')).toBeInTheDocument()
    expect(screen.getByText('No practice results yet')).toBeInTheDocument()
  })
})
