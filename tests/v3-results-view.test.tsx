// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Route } from 'next'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { V3ResultsView } from '@/components/results/v3-results-view'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import { V3_METRIC_IDS, V3_METRIC_LABELS } from '@/lib/scoring/v3/contracts'
import { v3Snapshot } from './helpers/result-snapshots'

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
  retryHref: '/record?retry=attempt-1' as Route,
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
    label: 'Next Lesson',
    href: '/practice/paths/general-speaking/lessons/next' as Route,
  },
  secondaryAction: {
    label: 'Try Again',
    href: '/practice/paths/general-speaking/lessons/current/record?retry=attempt-1' as Route,
  },
  tertiaryAction: {
    label: 'Back to Track',
    href: '/practice/paths/general-speaking' as Route,
  },
}

describe('V3ResultsView', () => {
  it('keeps equal review cards near the top and stacks result actions below sound scores', () => {
    const { container } = render(
      <V3ResultsView
        {...props}
        payload={v3Snapshot()}
        curriculumResult={curriculumResult}
        deleteControl={<button type="button">Delete response</button>}
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
    const action = screen.getByRole('link', { name: 'Next Lesson' })
    const retry = screen.getByRole('link', { name: 'Try Again' })
    const back = screen.getByRole('link', { name: 'Back to Track' })
    const remove = screen.getByRole('button', { name: 'Delete response' })
    const actions = screen.getByRole('group', { name: 'Result actions' })
    expect(link).toHaveAttribute('href', '/attempts/attempt-0')
    expect(screen.queryByText('Start clearly')).not.toBeInTheDocument()
    expect(history.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(action).toHaveClass('bg-accent', 'min-h-14')
    for (const secondary of [retry, back]) {
      expect(secondary).toHaveClass('border', 'bg-surface', 'hover:bg-surface-sunken', 'min-h-14')
      expect(secondary).not.toHaveClass('bg-accent')
    }

    const root = container.querySelector('[data-result-layout="responsive"]')
    const summary = screen.getByRole('region', { name: 'Result summary' })
    const historyRegion = screen.getByRole('region', { name: 'Previous attempts' })
    const scoreSections = container.querySelector('[data-result-layout="score-sections"]')
    const recommendation = screen.getByRole('region', { name: 'Recommendation' })
    const transcript = container.querySelector('[data-result-region="transcript"]')
    const review = screen.getByRole('region', { name: 'Response review' })
    const recording = screen.getByRole('heading', { name: 'Recording' }).parentElement

    expect(root).toHaveClass('grid-cols-1', 'lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]')
    expect(summary).toHaveClass('lg:col-start-1', 'lg:row-start-1', 'lg:self-stretch')
    expect(historyRegion).toHaveClass('lg:col-start-2', 'lg:row-start-1', 'lg:self-stretch')
    const previousHeading = screen.getByRole('heading', { name: 'Previous attempts' })
    const lessonHeading = screen.getByRole('heading', { name: 'Lesson passed' })
    const recordingHeading = screen.getByRole('heading', { name: 'Recording' })
    for (const heading of [previousHeading, lessonHeading, recordingHeading]) {
      expect(heading).toHaveClass('text-lg', 'font-semibold')
      expect(heading).not.toHaveClass('prompt-display', 'text-xl', 'sm:text-xl')
    }
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('text-xl', 'text-foreground')
    expect(review).toHaveClass('items-stretch', 'lg:col-span-2', 'lg:row-start-2', 'lg:grid-cols-2')
    expect(recommendation).toHaveClass('lg:col-span-2', 'lg:row-start-3')
    expect(transcript).toHaveClass('lg:col-span-2', 'lg:row-start-4')
    expect(scoreSections).toHaveClass('grid-cols-1', 'lg:grid-cols-2', 'items-stretch')
    expect(recording).toBe(review.lastElementChild)
    expect(screen.queryByRole('heading', { name: 'Next steps' })).not.toBeInTheDocument()
    expect(actions).toHaveClass('flex', 'flex-col')
    const soundedSection = screen
      .getByRole('heading', { name: 'How You Sounded' })
      .closest('section')
    expect(soundedSection).toHaveClass('h-full')
    expect(soundedSection?.querySelector('.rounded-card')).toHaveClass('flex-1')
    expect(soundedSection).toContainElement(actions)
    expect(actions).toBe(soundedSection?.lastElementChild)
    expect(actions).toContainElement(remove)
    expect(within(recording as HTMLElement).queryByRole('link')).not.toBeInTheDocument()
    expect(
      recommendation.compareDocumentPosition(transcript as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps retry comparison content out of the recording card', () => {
    render(<V3ResultsView {...props} payload={v3Snapshot()} />)

    expect(screen.queryByText('Previous response')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Previous response comparison')).not.toBeInTheDocument()
  })

  it('uses only a validated fallback retry route when curriculum context is unavailable', () => {
    const { rerender } = render(
      <V3ResultsView
        {...props}
        payload={v3Snapshot()}
        retryHref={
          '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1/record?retry=attempt-1' as Route
        }
      />,
    )

    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1/record?retry=attempt-1',
    )

    rerender(<V3ResultsView {...props} payload={v3Snapshot()} retryHref={null} />)
    expect(screen.queryByRole('link', { name: 'Try Again' })).not.toBeInTheDocument()
  })

  it('renders the required result sections and all ten current metrics in exact order', () => {
    const payload = v3Snapshot()
    const { container } = render(<V3ResultsView {...props} payload={payload} />)
    const headings = Array.from(container.querySelectorAll('h1, h2')).map((heading) =>
      heading.textContent?.trim(),
    )
    expect(headings).toEqual([
      props.promptText,
      'Recording',
      'Transcript',
      'What You Said',
      'How You Sounded',
    ])
    expect(screen.getAllByText('What You Said')).toHaveLength(1)
    expect(screen.getAllByText('How You Sounded')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: props.promptText, level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('Your prompt')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overall score' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recommendation' })).not.toBeInTheDocument()
    expect(screen.queryByText(/for What You Said/)).not.toBeInTheDocument()
    expect(screen.queryByText(/for How You Sounded/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recommendation' })).toHaveTextContent(
      'You have visible answered_prompt evidence.',
    )
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
    expect(overallProgress.firstElementChild).toHaveClass(
      'from-score-fill-start',
      'to-score-fill-end',
      'bg-linear-to-r',
    )
    for (const [section, tone] of [
      ['What You Said', 'content'],
      ['How You Sounded', 'delivery'],
    ]) {
      const region = screen.getByRole('region', { name: section })
      for (const bar of within(region).getAllByRole('progressbar')) {
        expect(bar.firstElementChild).toHaveClass(
          'bg-linear-to-r',
          tone === 'content' ? 'from-score-content' : 'from-score-overall',
          tone === 'content' ? 'to-score-overall' : 'to-score-delivery',
        )
      }
    }
  })

  it('keeps collapsed rows concise and opens labeled checks inside the metric', () => {
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
    expect(trigger).toHaveTextContent("your answer doesn't explain what happened next")
    expect(
      within(trigger).queryByText(
        'You included useful detail, but part of your response needed more support.',
      ),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Add the result of having space to think.')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const close = screen.getByRole('button', { name: 'Hide Specificity details' })
    expect(close).toHaveAttribute('aria-expanded', 'true')
    const region = screen.getByRole('region', { name: 'Specificity details' })
    expect(document.getElementById(close.getAttribute('aria-controls')!)).toContainElement(region)
    expect(
      within(region)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Details and examples', 'Support and reasons', 'Outcomes'])
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

  it('shows the same labeled checks for perfect scores and deductions without numeric sub-scores', () => {
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
      within(screen.getByRole('region', { name: 'Answered the Prompt details' })).getByText(
        'You cover the requested parts of the prompt.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Structure details' }))
    expect(
      within(screen.getByRole('region', { name: 'Structure details' })).getByText(
        'The final reason would be easier to follow beside the related example.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Conciseness details' }))
    const repeated = screen.getByRole('heading', { name: 'Repeated ideas' }).closest('section')
    expect(repeated).toHaveTextContent('“I like my car” · “I enjoy spending time in my car”')
    expect(repeated).not.toHaveTextContent(/\d/)
    expect(
      within(screen.getByRole('region', { name: 'Conciseness details' })).getAllByText(
        'These two portions communicate essentially the same idea.',
      ),
    ).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Show Word Choice details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show Grammar details' }))
    expect(screen.getByRole('heading', { name: 'Precision' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Context fit' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sentence clarity' })).toBeInTheDocument()
    expect(screen.getByText('Your wording makes your meaning clear.')).toBeInTheDocument()
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
      'Try: the two delayed tasks',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Grammar details' }))
    expect(screen.getByText('“find it very fun”')).toBeInTheDocument()
    expect(screen.getByText(/I find it very fun/)).toHaveTextContent('Try: I find it very fun')
  })

  it('marks a less-clear word at full points and shows its neutral check symbol and matching tooltip', () => {
    const payload = v3Snapshot({
      component: 1,
      evidenceMetric: 'articulation',
      measurements: {
        eligible_word_count: 46,
        low_confidence_word_count: 1,
        low_confidence_proportion: 1 / 46,
      },
      evidence: [
        {
          source: 'deepgram_word_confidence',
          start: 8,
          end: 10,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
          quote: 'at',
          detail: 'Lower recognition confidence.',
        },
      ],
    })
    render(<V3ResultsView {...props} transcript="I start at ten." payload={payload} />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: /^at\. Articulation: Word clarity/ }))
    expect(screen.getByRole('tooltip')).toHaveTextContent("It doesn't lower your score.")
    fireEvent.click(screen.getByRole('button', { name: 'Show Articulation details' }))
    const details = within(screen.getByRole('region', { name: 'Articulation details' }))
    expect(details.getByRole('heading', { name: 'Word clarity' })).toBeInTheDocument()
    expect(details.getByRole('img', { name: 'Issue found, no points lost' })).toBeInTheDocument()
    expect(details.getByText(/Less clear words:/).closest('p')).toHaveTextContent('“at”')
  })

  it('connects audio evidence to its scoring reason instead of showing a statistics table', () => {
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
    expect(
      screen.getByText(
        "At 194 words per minute, you're above the 120 to 175 range used for this practice.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Measurements')).not.toBeInTheDocument()
    expect(screen.queryByText('Measured response time')).not.toBeInTheDocument()
    expect(screen.queryByText('Words spoken')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Paused Time details' }))
    expect(screen.getByRole('button', { name: 'Hide Paused Time details' })).toHaveTextContent(
      'Longer pauses add 2.3 seconds',
    )
    expect(
      within(screen.getByRole('region', { name: 'Paused Time details' })).queryByText(
        /totals|full credit|Longer pauses add/,
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('You pause longer within your ideas, adding 2.1 sec of extra pause time.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Articulation details' }))
    expect(
      screen.getByText(/Speech recognition is less sure about one word in your answer/),
    ).toBeInTheDocument()
    expect(screen.getByText('“I”')).toHaveTextContent('Less clear words: “I”')

    fireEvent.click(screen.getByRole('button', { name: 'Show Energy details' }))
    const energy = screen.getByRole('region', { name: 'Energy details' })
    expect(
      within(energy)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Pitch range', 'Pitch variation', 'Sustained expression', 'Speaking rhythm'])
    expect(
      within(energy).getByText('Your pitch stays fairly even as you speak.'),
    ).toBeInTheDocument()
    expect(within(energy).getByText(/Let your voice change/)).toHaveTextContent(
      'Try: Let your voice change',
    )
    expect(energy).not.toHaveTextContent(/\d/)
    expect(
      screen.queryByText(
        /excluded silence|speech to noise|voiced frame|temporal bin|active-speech timing|configured range/i,
      ),
    ).not.toBeInTheDocument()
  })

  it('shows partial score states without a fabricated overall or recommendation', () => {
    render(
      <V3ResultsView
        {...props}
        audioUrl={null}
        payload={v3Snapshot({ notCheckedMetric: 'grammar', unavailableMetric: 'energy' })}
      />,
    )
    expect(screen.getByText('Result unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(
        "We couldn't complete every check, so this response could not be evaluated. Try again in a moment.",
      ),
    ).toBeInTheDocument()
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

  it('distinguishes missing transcript and insufficient speech evidence from service issues', () => {
    const { rerender } = render(
      <V3ResultsView
        {...props}
        transcript=""
        payload={v3Snapshot({ unavailableMetric: 'pace' })}
      />,
    )
    expect(screen.getByText(/couldn't produce a usable transcript/)).toBeInTheDocument()

    rerender(<V3ResultsView {...props} payload={v3Snapshot({ unavailableMetric: 'energy' })} />)
    expect(screen.getByText('More speech needed')).toBeInTheDocument()
    expect(screen.getByText(/Try again with two complete sentences/)).toBeInTheDocument()
    expect(screen.queryByText(/couldn't complete every check.*moment/)).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Lesson passed' })).toBeInTheDocument()
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 80')
    expect(screen.queryByText('Start clearly')).not.toBeInTheDocument()
    expect(screen.queryByText('Lesson 2 is available.')).not.toBeInTheDocument()
    const mark = screen.getByRole('button', { name: /vague\. Word Choice/ })
    fireEvent.click(mark)
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText('Word Choice')).toBeVisible()
    expect(within(tooltip).getByText("This word doesn't identify the choice.")).toBeVisible()
    expect(container.querySelectorAll('mark')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Next Lesson' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try Again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Track' })).toBeInTheDocument()
  })

  it('makes a scored result below 70 clearly retryable without unlocking the next lesson', () => {
    render(
      <V3ResultsView
        {...props}
        payload={v3Snapshot({ component: 0.6 })}
        curriculumResult={{
          ...curriculumResult,
          state: 'not_passed',
          currentScore: 60,
          currentStars: 0,
          bestScore: 60,
          bestStars: 0,
          primaryAction: {
            label: 'Try Again',
            href: '/record?retry=attempt-1' as Route,
          },
          secondaryAction: {
            label: 'Back to Track',
            href: '/practice/paths/general-speaking' as Route,
          },
          tertiaryAction: null,
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Not passed yet' })).toBeInTheDocument()
    expect(screen.getByText(/need 70 to pass/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try Again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Track' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Next Lesson' })).not.toBeInTheDocument()
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

    const mark = screen.getByRole('button', { name: /vague\. Word Choice/ })
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
          secondaryAction: {
            label: 'Back to Track',
            href: '/practice/paths/general-speaking' as Route,
          },
          tertiaryAction: null,
        }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Result unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 64')
    expect(screen.getByText(/does not pass or fail the lesson/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try Again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Track' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Next Lesson' })).not.toBeInTheDocument()
  })
})
