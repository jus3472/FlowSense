// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Route } from 'next'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { V3ResultsView } from '@/components/results/v3-results-view'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import { V3_METRIC_IDS, V3_METRIC_LABELS } from '@/lib/scoring/v3/contracts'
import { legacyV3Snapshot, v3Snapshot } from './helpers/result-snapshots'

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

const props = {
  attemptId: 'attempt-1',
  promptText: 'Describe a recent choice.',
  additionalContext: null,
  transcript: 'I used a vague phrase.',
  durationMs: 12_000,
  audioUrl: 'https://example.test/audio',
}

const curriculumResult: StructuredLessonResultModel = {
  attemptId: 'attempt-1',
  state: 'passed',
  currentScore: 80,
  currentStars: 2,
  bestScore: 80,
  bestStars: 2,
  bestAttemptId: 'attempt-1',
  personalBest: true,
  path: { slug: 'general-speaking', title: 'General Speaking' },
  chapter: { level: 'beginner', title: 'Beginner' },
  lesson: {
    id: 'lesson-1',
    slug: 'general-speaking-beginner-01-start',
    title: 'Start clearly',
    position: 1,
    checkpoint: false,
  },
  nextLesson: { level: 'beginner', position: 2 },
  pathComplete: false,
  primaryAction: {
    label: 'Continue',
    href: '/practice/paths/general-speaking/lessons/next' as Route,
  },
  secondaryAction: null,
}

describe('V3ResultsView', () => {
  it('shows structured previous attempts near the actions and omits lesson titles', () => {
    render(
      <V3ResultsView
        {...props}
        payload={v3Snapshot()}
        curriculumResult={curriculumResult}
        previousAttempts={[
          {
            attemptId: 'attempt-0',
            score: 72,
            finishedAt: '2026-09-03T18:15:00.000Z',
          },
        ]}
      />,
    )

    const history = screen.getByRole('heading', { name: 'Previous attempts' })
    const link = screen.getByRole('link', { name: /View attempt scored 72 out of 100/ })
    const action = screen.getByRole('link', { name: 'Continue' })
    expect(link).toHaveAttribute('href', '/attempts/attempt-0')
    expect(screen.queryByText('Start clearly')).not.toBeInTheDocument()
    expect(history.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the required result sections and all ten current metrics in exact order', () => {
    const payload = v3Snapshot()
    const { container } = render(<V3ResultsView {...props} payload={payload} />)
    const headings = Array.from(container.querySelectorAll('h1, h2')).map((heading) =>
      heading.textContent?.trim(),
    )
    expect(headings).toEqual([
      props.promptText,
      'Transcript',
      'What You Said',
      'How You Sounded',
      'Recording',
    ])
    expect(screen.getAllByText('What You Said')).toHaveLength(1)
    expect(screen.getAllByText('How You Sounded')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: props.promptText, level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('Your prompt')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overall score' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recommendation' })).not.toBeInTheDocument()
    expect(screen.queryByText(/for What You Said/)).not.toBeInTheDocument()
    expect(screen.queryByText(/for How You Sounded/)).not.toBeInTheDocument()
    expect(screen.getByText(/^You did well at .+ To improve/)).toBeInTheDocument()
    expect(screen.queryByText(/^Based on /)).not.toBeInTheDocument()
    for (const metric of V3_METRIC_IDS) {
      const label = V3_METRIC_LABELS[metric]
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('heading', { name: 'Time to First Word' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Play Your answer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/record?retry=attempt-1',
    )
    expect(screen.queryByText('Review evidence')).not.toBeInTheDocument()

    const overallProgress = screen.getByRole('progressbar', { name: 'Overall score' })
    expect(overallProgress).toHaveAttribute('aria-valuemin', '0')
    expect(overallProgress).toHaveAttribute('aria-valuemax', '100')
    expect(overallProgress).toHaveAttribute('aria-valuenow', String(payload.total_earned_points))
    expect(overallProgress.firstElementChild).toHaveStyle({
      width: `${((payload.total_earned_points ?? 0) / payload.total_max_points) * 100}%`,
    })

    const whatYouSaid = payload.sections.what_you_said
    expect(screen.getByRole('progressbar', { name: 'What You Said score' })).toHaveAttribute(
      'aria-valuenow',
      String(whatYouSaid.earned_points),
    )
    const answered = whatYouSaid.metrics.answered_prompt
    const answeredProgress = screen.getByRole('progressbar', {
      name: 'Answered the Prompt score',
    })
    expect(answeredProgress).toHaveAttribute('aria-valuemax', String(answered.max_points))
    expect(answeredProgress).toHaveAttribute('aria-valuenow', String(answered.earned_points))
    expect(answeredProgress.firstElementChild).toHaveStyle({
      width: `${((answered.earned_points ?? 0) / answered.max_points) * 100}%`,
    })
    expect(screen.getAllByRole('progressbar')).toHaveLength(13)
  })

  it('shows a useful collapsed summary and an accessible disclosure that opens and closes', () => {
    const payload = v3Snapshot({ component: 1 })
    Object.assign(payload.sections.what_you_said.metrics.specificity, {
      component: 0.78,
      earned_points: 7,
      explanation: 'You gave one concrete reason, but the outcome remained unclear.',
      details: [
        {
          kind: 'missing_outcome',
          source: 'ai' as const,
          quote: 'a quiet place where I could think',
          observation: 'This is concrete, but the response does not explain what happened next.',
          suggestion: 'Add the result of having space to think.',
          evidence: [],
        },
      ],
    })

    render(<V3ResultsView {...props} payload={payload} />)

    const trigger = screen.getByRole('button', { name: 'Show Specificity details' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(within(trigger).getByText('Specificity')).toBeInTheDocument()
    expect(within(trigger).getByText('7 / 9')).toBeInTheDocument()
    expect(
      within(trigger).getByText(
        'You included useful detail, but part of your response needed more support.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Add the result of having space to think.')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const close = screen.getByRole('button', { name: 'Hide Specificity details' })
    expect(close).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('“a quiet place where I could think”')).toBeInTheDocument()
    expect(screen.getByText(/Add the result of having space to think/)).toHaveTextContent(
      'Try: Add the result of having space to think.',
    )

    fireEvent.click(close)
    expect(screen.getByRole('button', { name: 'Show Specificity details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('renders validated content findings without forcing empty perfect-score disclosures', () => {
    const payload = v3Snapshot({ component: 1 })
    Object.assign(payload.sections.what_you_said.metrics.answered_prompt, {
      explanation: 'You named the place and included both requested details.',
    })
    Object.assign(payload.sections.what_you_said.metrics.structure, {
      component: 0.78,
      earned_points: 7,
      explanation: 'Your opening and development were clear, but the final idea arrived abruptly.',
      details: [
        {
          kind: 'misplaced_information',
          source: 'ai' as const,
          quote: null,
          observation: 'The final reason would be easier to follow beside the related example.',
          suggestion: 'Group the final reason with that example.',
          evidence: [],
        },
      ],
    })
    Object.assign(payload.sections.what_you_said.metrics.conciseness, {
      component: 0.75,
      earned_points: 6,
      explanation: 'Two parts of the response communicate the same idea.',
      details: [
        {
          kind: 'repeated_idea',
          source: 'ai' as const,
          quote: null,
          observation: 'These two portions communicate essentially the same idea.',
          suggestion: 'State the idea once.',
          evidence: [
            {
              source: 'transcript',
              start: 0,
              end: 13,
              coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
              quote: 'I like my car',
              detail: 'These two portions communicate essentially the same idea.',
            },
            {
              source: 'transcript',
              start: 15,
              end: 46,
              coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
              quote: 'I enjoy spending time in my car',
              detail: 'These two portions communicate essentially the same idea.',
            },
          ],
        },
      ],
      evidence: [],
    })

    render(<V3ResultsView {...props} payload={payload} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show Answered the Prompt details' }))
    expect(
      screen.getByText('You named the place and included both requested details.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Structure details' }))
    expect(
      screen.getByText('The final reason would be easier to follow beside the related example.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Conciseness details' }))
    const count = screen.getAllByText('Repeated ideas')[0]?.closest('div')
    expect(count).not.toBeNull()
    expect(count).toHaveTextContent('1')
    expect(screen.getByText('“I like my car”')).toBeInTheDocument()
    expect(screen.getByText('“I enjoy spending time in my car”')).toBeInTheDocument()
    expect(
      screen.getAllByText('These two portions communicate essentially the same idea.'),
    ).toHaveLength(1)

    expect(
      screen.queryByRole('button', { name: 'Show Word Choice details' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show Grammar details' })).not.toBeInTheDocument()
    expect(screen.getByText('Your wording was clear and precise.')).toBeInTheDocument()
    expect(
      screen.getByText('Your spoken grammar was clear and easy to understand.'),
    ).toBeInTheDocument()
  })

  it('shows concrete Word Choice and spoken Grammar findings with tailored suggestions', () => {
    const payload = v3Snapshot({ component: 0.8 })
    Object.assign(payload.sections.what_you_said.metrics.word_choice, {
      details: [
        {
          kind: 'vague_wording',
          source: 'ai' as const,
          quote: 'some stuff',
          observation: 'This phrase is vague about what actually happened.',
          suggestion: 'the two delayed tasks',
          evidence: [],
        },
      ],
    })
    Object.assign(payload.sections.what_you_said.metrics.grammar, {
      details: [
        {
          kind: 'missing_subject',
          source: 'ai' as const,
          quote: 'find it very fun',
          observation: 'This construction is missing a clear subject before “find.”',
          suggestion: 'I find it very fun',
          evidence: [],
        },
      ],
    })

    render(<V3ResultsView {...props} payload={payload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show Word Choice details' }))
    expect(screen.getByText('“some stuff”')).toBeInTheDocument()
    expect(screen.getByText(/the two delayed tasks/)).toHaveTextContent(
      'More precise: the two delayed tasks',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Grammar details' }))
    expect(screen.getByText('“find it very fun”')).toBeInTheDocument()
    expect(screen.getByText(/I find it very fun/)).toHaveTextContent(
      'Clearer form: I find it very fun',
    )
  })

  it('renders user-friendly audio measurements and omits implementation diagnostics', () => {
    const payload = v3Snapshot({ component: 0.8 })
    Object.assign(payload.sections.how_you_sounded.metrics.pace, {
      measurements: {
        words_per_minute: 194.2,
        pace_duration_ms: 15_800,
        word_count: 51,
        excluded_excessive_pause_ms: 1_200,
      },
    })
    Object.assign(payload.sections.how_you_sounded.metrics.paused_time, {
      measurements: {
        total_unnatural_pause_ms: 2_300,
        beginning_excessive_pause_ms: 0,
        mid_thought_excessive_pause_ms: 2_100,
        natural_boundary_excessive_pause_ms: 200,
        very_long_pause_count: 1,
      },
      evidence: [
        {
          source: 'audio_timeline',
          start: 2_000,
          end: 4_100,
          coordinate: { space: 'audio_timeline', unit: 'millisecond' } as const,
          quote: 'fun',
          detail: 'This mid-thought pause had 2.1 seconds beyond the natural allowance.',
        },
      ],
    })
    Object.assign(payload.sections.how_you_sounded.metrics.articulation, {
      measurements: {
        low_confidence_word_count: 1,
        eligible_word_count: 49,
        low_confidence_proportion: 1 / 49,
        confidence_coverage: 1,
        speech_to_noise_ratio: 8.4,
      },
      evidence: [
        {
          source: 'deepgram_word_confidence',
          start: 0,
          end: 1,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
          quote: 'I',
          detail: 'This word had lower recognition confidence.',
        },
      ],
    })
    Object.assign(payload.sections.how_you_sounded.metrics.energy, {
      measurements: {
        pitch_range_semitones: 6,
        pitch_variation_semitones: 1.8,
        flat_window_proportion: 0,
        rhythm_cadence_component: 1,
        pitch_range_component: 1,
        pitch_variation_component: 0.35,
        non_monotony_component: 1,
        voiced_frame_count: 72,
        temporal_bin_count: 4,
      },
      details: [
        {
          kind: 'energy',
          source: 'audio' as const,
          quote: null,
          observation: 'Pitch and active-speech timing were less varied than the configured range.',
          suggestion: null,
          evidence: [],
        },
      ],
    })

    render(<V3ResultsView {...props} payload={payload} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show Pace details' }))
    expect(screen.getByText('194 WPM')).toBeInTheDocument()
    expect(screen.getByText('120 to 175 WPM')).toBeInTheDocument()
    expect(screen.getByText('15.8 sec')).toBeInTheDocument()
    expect(screen.getByText('1.2 sec')).toBeInTheDocument()
    expect(screen.getByText('51')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Paused Time details' }))
    expect(screen.getByText('2.3 sec')).toBeInTheDocument()
    expect(screen.getByText(/“fun” This mid-thought pause had 2.1 seconds/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Articulation details' }))
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2%')).toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    expect(screen.getByText(/“I” This word had lower recognition confidence/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Energy details' }))
    expect(screen.getByText('6.0 semitones')).toBeInTheDocument()
    expect(screen.getByText('1.8 semitones')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('Varied')).toBeInTheDocument()
    expect(
      screen.getByText('Your pitch could vary a little more throughout the response.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        /excluded silence|speech to noise|voiced frame|temporal bin|active-speech timing|configured range/i,
      ),
    ).not.toBeInTheDocument()
  })

  it('renders a stored v3.score.1 snapshot with its historical first-word metric', () => {
    render(<V3ResultsView {...props} payload={legacyV3Snapshot()} />)

    expect(screen.getByRole('heading', { name: 'Time to First Word' })).toBeInTheDocument()
    expect(screen.getByText(/^Based on /)).toBeInTheDocument()
  })

  it('shows partial score states without a fabricated overall or recommendation', () => {
    render(
      <V3ResultsView
        {...props}
        audioUrl={null}
        payload={v3Snapshot({ notCheckedMetric: 'grammar', unavailableMetric: 'energy' })}
      />,
    )
    expect(screen.getByText('Overall unavailable')).toBeInTheDocument()
    expect(screen.getByText('Not checked / 7')).toBeInTheDocument()
    expect(screen.getByText('Unavailable / 10')).toBeInTheDocument()
    expect(
      screen.getByText('A recommendation is unavailable because some metrics were not scored.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Audio playback is unavailable for this response.',
    )

    for (const [label, emptyText] of [
      ['Overall score', 'Unavailable'],
      ['What You Said score', 'Not checked'],
      ['How You Sounded score', 'Unavailable'],
      ['Grammar score', 'Not checked'],
      ['Energy score', 'Unavailable'],
    ] as const) {
      const progress = screen.getByRole('progressbar', { name: label })
      expect(progress).toHaveAttribute('aria-valuetext', emptyText)
      expect(progress).not.toHaveAttribute('aria-valuenow')
      expect(progress).toBeEmptyDOMElement()
    }
  })

  it('keeps deduction evidence clickable and uses the cleaned structured result hierarchy', () => {
    const payload = v3Snapshot({
      evidenceMetric: 'word_choice',
      evidence: [
        {
          source: 'transcript',
          start: 9,
          end: 14,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
          quote: 'vague',
          detail: 'This word does not identify the choice.',
        },
      ],
    })
    const { container } = render(
      <V3ResultsView {...props} payload={payload} curriculumResult={curriculumResult} />,
    )
    const prompt = screen.getByText(props.promptText)
    const score = screen.getByRole('region', { name: 'Result summary' }).querySelector('.numeric')
    if (!score) throw new Error('Missing visible score.')
    expect(prompt.compareDocumentPosition(score)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('heading', { name: 'Lesson complete' })).toBeInTheDocument()
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 80')
    expect(screen.queryByText('Start clearly')).not.toBeInTheDocument()
    expect(screen.queryByText('Lesson 2 is available.')).not.toBeInTheDocument()
    const mark = screen.getByRole('button', { name: /vague\. Word Choice:/ })
    fireEvent.click(mark)
    const tooltip = screen.getByRole('tooltip')
    expect(
      within(tooltip).getByText('Word Choice: wording that could be more precise'),
    ).toBeVisible()
    expect(within(tooltip).getByText('This word does not identify the choice.')).toBeVisible()
    expect(container.querySelectorAll('mark')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Try Again' })).not.toBeInTheDocument()
  })

  it('makes transcript evidence keyboard reachable and dismissible', () => {
    const payload = v3Snapshot({
      component: 0.5,
      evidenceMetric: 'word_choice',
      evidence: [
        {
          source: 'transcript',
          start: 9,
          end: 14,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
          quote: 'vague',
          detail: 'This word does not identify the choice.',
        },
      ],
    })
    render(<V3ResultsView {...props} payload={payload} />)

    const mark = screen.getByRole('button', { name: /vague\. Word Choice:/ })
    expect(mark).toHaveAttribute('tabindex', '0')
    expect(mark).toHaveAttribute('aria-expanded', 'false')
    fireEvent.focus(mark)
    expect(mark).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tooltip')).toBeVisible()
    fireEvent.keyDown(mark, { key: 'Escape' })
    expect(mark).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(mark, { key: ' ' })
    expect(mark).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps neutral lesson progress explicit without showing a fabricated score', () => {
    render(
      <V3ResultsView
        {...props}
        payload={v3Snapshot({ notCheckedMetric: 'grammar' })}
        curriculumResult={{
          ...curriculumResult,
          state: 'neutral',
          currentScore: null,
          currentStars: 0,
          bestScore: 64,
          bestStars: 0,
          bestAttemptId: 'attempt-0',
          personalBest: false,
          primaryAction: {
            label: 'Try Again',
            href: '/record?retry=attempt-1' as Route,
          },
          secondaryAction: null,
        }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Result unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 64')
    expect(
      screen.getByText(
        'Some checks could not be completed, so this attempt does not affect your lesson progress.',
      ),
    ).toBeInTheDocument()
  })
})
