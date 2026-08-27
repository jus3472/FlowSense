import { describe, expect, it } from 'vitest'
import { buildSegments, collectHighlights, mergeHighlights } from '@/lib/results/highlights'
import {
  dayLabel,
  groupByDay,
  historyContext,
  historyMode,
  matchesMetadataFilter,
  timeLabel,
  type HistoryEntry,
} from '@/lib/results/history'
import {
  deductionLine,
  describeMetric,
  largestDeduction,
  listedSpans,
  summariseAttempt,
} from '@/lib/results/summary'
import { CONTENT_POINTS, type CheckFinding, type CheckName } from '@/lib/scoring/content'
import type { DeliveryMetricName, DeliveryStatistics, MetricResult } from '@/lib/scoring/mechanical'
import type { Pause } from '@/lib/scoring/pauses'
import { wordsFrom } from './helpers/transcript'

const TRANSCRIPT = 'So um, uh, I went to the park and it was really good, you know.'
const pass = (): CheckFinding => ({
  passed: true,
  severity: null,
  quote: null,
  observation: null,
  suggestion: null,
})
const checks = (over: Partial<Record<CheckName, CheckFinding>> = {}) => ({
  answered: pass(),
  explained: pass(),
  word_choice: pass(),
  logical_order: pass(),
  no_repetition: pass(),
  ...over,
})

function input(over: Partial<Parameters<typeof buildSegments>[0]> = {}) {
  return {
    transcript: TRANSCRIPT,
    words: wordsFrom(TRANSCRIPT),
    countedItems: [],
    pauses: [],
    extraSpans: [],
    checks: checks(),
    repeatedPhrases: [],
    timeToFirstWordMs: 500,
    ...over,
  }
}

describe('transcript highlights', () => {
  it('marks nothing when nothing cost points', () => {
    expect(collectHighlights(input())).toEqual([])
    expect(buildSegments(input()).every((segment) => segment.type === 'text')).toBe(true)
  })

  /** A verdict on the whole response has no span to point at. */
  it('never highlights answered or logical order', () => {
    const failing = {
      passed: false,
      severity: 'clear' as const,
      quote: 'I went to the park',
      observation: 'x',
      suggestion: null,
    }
    const highlights = collectHighlights(
      input({ checks: checks({ answered: failing, logical_order: failing }) }),
    )
    expect(highlights).toEqual([])
  })

  it('highlights a word choice span and names the category', () => {
    const highlights = collectHighlights(
      input({ extraSpans: [{ text: 'really good', category: 'imprecise' }] }),
    )
    expect(highlights).toHaveLength(1)
    expect(highlights[0]?.label).toBe('Word choice, imprecise')
    expect(TRANSCRIPT.slice(highlights[0]!.from, highlights[0]!.to)).toBe('really good')
  })

  it('highlights the quoted claim from explained your reasoning', () => {
    const highlights = collectHighlights(
      input({
        checks: checks({
          explained: {
            passed: false,
            severity: 'minor',
            quote: 'really good',
            observation: 'No detail follows.',
            suggestion: 'say what you did there',
          },
        }),
      }),
    )
    expect(highlights[0]?.label).toBe('Explained your reasoning')
  })

  it('allocates one deterministic occurrence for one repeated quoted finding', () => {
    const transcript = 'Clear first, then clear again.'
    const highlights = collectHighlights(
      input({
        transcript,
        words: wordsFrom(transcript),
        extraSpans: [{ text: 'clear', category: 'imprecise' }],
      }),
    )

    expect(highlights).toEqual([
      { from: 0, to: 5, kind: 'word_choice', label: 'Word choice, imprecise' },
    ])
  })

  it('allocates two independent findings to two distinct repeated occurrences', () => {
    const transcript = 'Clear first, then clear again.'
    const highlights = collectHighlights(
      input({
        transcript,
        words: wordsFrom(transcript),
        extraSpans: [{ text: 'clear', category: 'imprecise' }],
        checks: checks({
          explained: {
            passed: false,
            severity: 'minor',
            quote: 'clear',
            observation: 'The reason was not included.',
            suggestion: null,
          },
        }),
      }),
    )

    expect(highlights.map(({ from, to, label }) => ({ from, to, label }))).toEqual([
      { from: 0, to: 5, label: 'Word choice, imprecise' },
      { from: 18, to: 23, label: 'Explained your reasoning' },
    ])
  })

  it('deduplicates repeated stored word-choice findings and rejects overlaps', () => {
    const transcript = 'Clear first, then clear again.'
    const highlights = collectHighlights(
      input({
        transcript,
        words: wordsFrom(transcript),
        extraSpans: [
          { text: 'clear', category: 'imprecise' },
          { text: 'Clear', category: 'padding' },
          { text: 'clear first', category: 'padding' },
        ],
        checks: checks({
          word_choice: {
            passed: false,
            severity: 'minor',
            quote: 'clear',
            observation: 'Use a specific description.',
            suggestion: null,
          },
        }),
      }),
    )

    expect(highlights).toEqual([
      { from: 0, to: 5, kind: 'word_choice', label: 'Word choice, imprecise' },
    ])
  })

  it('caps repetition marks at the occurrences stored in mechanical evidence', () => {
    const transcript = 'Make it clear, then make it clear, and make it clear.'
    const highlights = collectHighlights(
      input({
        transcript,
        words: wordsFrom(transcript),
        checks: checks({
          no_repetition: {
            passed: false,
            severity: 'clear',
            quote: 'make it clear',
            observation: 'The phrase repeated.',
            suggestion: null,
          },
        }),
        repeatedPhrases: [{ phrase: 'make it clear', count: 2 }],
      }),
    )

    expect(highlights).toHaveLength(2)
    expect(highlights.map(({ from, to }) => transcript.slice(from, to))).toEqual([
      'Make it clear',
      'make it clear',
    ])
  })

  it('uses stored repetition evidence when the provider finding has no quote', () => {
    const transcript = 'Make it clear, then make it clear, and make it clear.'
    const highlights = collectHighlights(
      input({
        transcript,
        words: wordsFrom(transcript),
        checks: checks({
          no_repetition: {
            passed: false,
            severity: 'clear',
            quote: null,
            observation: 'The phrase repeated.',
            suggestion: null,
          },
        }),
        repeatedPhrases: [{ phrase: 'make it clear', count: 2 }],
      }),
    )

    expect(highlights).toHaveLength(2)
    expect(highlights.map(({ from, to }) => transcript.slice(from, to))).toEqual([
      'Make it clear',
      'make it clear',
    ])
  })

  it('merges touching spans with the same label into one continuous highlight', () => {
    // "abc um, uh, def": the two filler tokens sit either side of one space.
    const merged = mergeHighlights(
      [
        { from: 4, to: 7, kind: 'filler', label: 'Filler' },
        { from: 8, to: 11, kind: 'filler', label: 'Filler' },
      ],
      'abc um, uh, def',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ from: 4, to: 11 })
  })

  /** Two counted fillers side by side must read as one mark, not two boxes. */
  it('merges real adjacent filler tokens end to end', () => {
    const segments = buildSegments(
      input({
        countedItems: [
          {
            category: 'filler',
            subtype: 'um',
            text: 'um,',
            token_indices: [1],
            start: 0.3,
            end: 0.6,
          },
          {
            category: 'filler',
            subtype: 'uh',
            text: 'uh,',
            token_indices: [2],
            start: 0.6,
            end: 0.9,
          },
        ],
      }),
    )
    const highlights = segments.filter((segment) => segment.type === 'highlight')
    expect(highlights).toHaveLength(1)
    expect(highlights[0]?.text).toBe('um, uh,')
  })

  it('does not merge across different labels', () => {
    const merged = mergeHighlights(
      [
        { from: 4, to: 7, kind: 'filler', label: 'Filler' },
        { from: 8, to: 11, kind: 'word_choice', label: 'Word choice, padding' },
      ],
      'abc um, uh, def',
    )
    expect(merged).toHaveLength(2)
  })

  it('does not merge spans separated by real words', () => {
    const merged = mergeHighlights(
      [
        { from: 0, to: 2, kind: 'filler', label: 'Filler' },
        { from: 10, to: 12, kind: 'filler', label: 'Filler' },
      ],
      'um and then uh',
    )
    expect(merged).toHaveLength(2)
  })

  it('does not expand an earlier mark with overlapping later evidence', () => {
    expect(
      mergeHighlights(
        [
          { from: 0, to: 5, kind: 'word_choice', label: 'Word choice' },
          { from: 3, to: 11, kind: 'explained', label: 'Explained your reasoning' },
        ],
        'clear first',
      ),
    ).toEqual([{ from: 0, to: 5, kind: 'word_choice', label: 'Word choice' }])
  })

  it('marks only pauses that cost points', () => {
    const pauses = [
      {
        start_ms: 1000,
        end_ms: 1500,
        duration_ms: 500,
        kind: 'mid_sentence' as const,
        preceding_word: 'so',
        after_filler: false,
      },
      {
        start_ms: 2000,
        end_ms: 4300,
        duration_ms: 2300,
        kind: 'mid_sentence' as const,
        preceding_word: 'the',
        after_filler: false,
      },
      {
        start_ms: 5000,
        end_ms: 7000,
        duration_ms: 2000,
        kind: 'clean' as const,
        preceding_word: 'park',
        after_filler: false,
      },
    ]
    const markers = buildSegments(input({ pauses })).filter((segment) => segment.type === 'marker')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ text: '·2.3s·', label: 'Mid-sentence pause, 2.3s' })
  })

  /** Inside the free zone there is nothing to explain, so nothing is drawn. */
  it('marks leading silence only when time to first word cost points', () => {
    const free = buildSegments(input({ timeToFirstWordMs: 1200 }))
    expect(free.some((segment) => segment.type === 'marker')).toBe(false)

    const charged = buildSegments(input({ timeToFirstWordMs: 4100 }))
    const marker = charged.find((segment) => segment.type === 'marker')
    expect(marker?.text).toBe('·4.1s·')
  })

  it('keeps every check name out of the transcript text itself', () => {
    const segments = buildSegments(
      input({ extraSpans: [{ text: 'really good', category: 'imprecise' }] }),
    )
    const rendered = segments.map((segment) => segment.text).join('')
    expect(rendered).not.toMatch(/Word choice|Filler|No repetition/)
    // The label travels on the popover instead.
    expect(segments.some((segment) => segment.type === 'highlight')).toBe(true)
  })

  it('reproduces the transcript exactly when the markers are removed', () => {
    const segments = buildSegments(
      input({ extraSpans: [{ text: 'really good', category: 'imprecise' }] }),
    )
    const rebuilt = segments
      .filter((segment) => segment.type !== 'marker')
      .map((segment) => segment.text)
      .join('')
    expect(rebuilt).toBe(TRANSCRIPT)
  })
})

describe('largest deduction', () => {
  const metric = (points: number, max: number): MetricResult => ({
    points,
    max_points: max,
    raw: 0,
    component: 0,
    label: null,
  })
  const metrics = {
    fillers: metric(5, 18),
    mid_sentence_pauses: metric(14, 14),
    energy: metric(8, 8),
    pace: metric(6, 6),
    time_to_first_word: metric(4, 4),
  } as Record<DeliveryMetricName, MetricResult>

  it('names the biggest single loss', () => {
    expect(largestDeduction(metrics, null, CONTENT_POINTS)?.label).toBe('Filler words')
  })

  it('considers the content checks too', () => {
    const points = {
      answered: 0,
      explained: 12,
      word_choice: 12,
      logical_order: 7,
      no_repetition: 5,
    }
    expect(largestDeduction(metrics, points, CONTENT_POINTS)?.label).toBe('Answered the question')
  })

  it('returns nothing for a response that lost no points', () => {
    const perfect = {
      ...metrics,
      fillers: metric(18, 18),
    } as Record<DeliveryMetricName, MetricResult>
    expect(largestDeduction(perfect, null, CONTENT_POINTS)).toBeNull()
    expect(deductionLine(null)).toBe('Nothing cost points')
  })

  it('reads as a plain sentence', () => {
    expect(summariseAttempt(59, { label: 'Filler words', lost: 13 })).toBe(
      'Your last response scored 59. Filler words cost the most.',
    )
  })
})

describe('history grouping', () => {
  const now = new Date(2026, 7, 24, 10)
  const entry = (id: string, daysAgo: number, score: number): HistoryEntry => ({
    id,
    createdAt: new Date(2026, 7, 24 - daysAgo, 9).toISOString(),
    promptText: 'Describe your ideal weekend.',
    score,
  })

  it('labels today and yesterday by name and older days by date', () => {
    expect(dayLabel(entry('a', 0, 80).createdAt, now)).toBe('Today')
    expect(dayLabel(entry('b', 1, 80).createdAt, now)).toBe('Yesterday')
    expect(dayLabel(entry('c', 5, 80).createdAt, now)).toMatch(/August/)
  })

  it('formats the row time without seconds', () => {
    expect(timeLabel(entry('a', 0, 80).createdAt).replace(/\s/g, ' ')).toBe('9:00 AM')
  })

  it('groups newest first', () => {
    const groups = groupByDay([entry('a', 2, 70), entry('b', 0, 90), entry('c', 0, 60)], now)
    expect(groups[0]?.label).toBe('Today')
    expect(groups[0]?.entries).toHaveLength(2)
    expect(groups[1]?.entries).toHaveLength(1)
  })

  it('classifies legacy metadata as General and keeps stored mode labels', () => {
    const legacy = entry('legacy', 0, 80)
    const interview = { ...entry('interview', 0, 70), practiceMode: 'interview' as const }
    expect(historyMode(legacy)).toBe('general')
    expect(historyContext(legacy)).toEqual(['General'])
    expect(historyContext(interview)).toEqual(['Interview'])
  })

  it('identifies custom prompts and retries from stored metadata', () => {
    const customRetry = {
      ...entry('custom-retry', 0, 80),
      practiceMode: 'conversation' as const,
      promptSource: 'custom' as const,
      retryOfAttemptId: 'prior-attempt',
    }
    expect(historyContext(customRetry)).toEqual(['Conversation', 'Custom prompt', 'Retry'])
    expect(matchesMetadataFilter(customRetry, 'custom')).toBe(true)
    expect(matchesMetadataFilter(customRetry, 'retry')).toBe(true)
  })
})

describe('metric descriptions', () => {
  const statistics = (over: Partial<DeliveryStatistics> = {}): DeliveryStatistics => ({
    word_count: 84,
    recording_ms: 60_000,
    speaking_ms: 50_000,
    clean_pause_count: 0,
    mid_sentence_pause_count: 0,
    total_silence_ms: 0,
    leading_silence_ms: 0,
    trailing_silence_ms: 0,
    silence_ratio: 0,
    longest_pause_ms: 0,
    pace_variance: 0,
    backtrack_count: 0,
    backtrack_note: null,
    counted_items: [],
    repeated_phrases: [],
    noise_floor: 0,
    speech_level: 0,
    speech_threshold: 0,
    ...over,
  })

  const measure = (raw: number, points: number, maxPoints: number): MetricResult => ({
    points,
    max_points: maxPoints,
    raw,
    component: 1,
    label: null,
  })

  const pause = (durationMs: number, kind: Pause['kind'] = 'mid_sentence'): Pause => ({
    start_ms: 0,
    end_ms: durationMs,
    duration_ms: durationMs,
    kind,
    preceding_word: 'the',
    after_filler: false,
  })

  const counted = (tokens: number) => [
    {
      category: 'filler' as const,
      subtype: 'um',
      text: 'um,',
      token_indices: Array.from({ length: tokens }, (_value, index) => index),
      start: 0,
      end: 0.3,
    },
  ]

  /**
   * "4 mid-sentence" beside 14 / 14 was correct and read as a bug. The label has
   * to carry the reason the count cost nothing.
   */
  it('says so plainly when every pause fell under the threshold', () => {
    const metric = measure(0, 14, 14)
    const pauses = [pause(600), pause(700), pause(500), pause(900)]
    expect(describeMetric('mid_sentence_pauses', metric, statistics(), pauses)).toBe(
      '4 mid-sentence, all under 1s',
    )
    expect(describeMetric('mid_sentence_pauses', metric, statistics(), [pause(600)])).toBe(
      '1 mid-sentence, under 1s',
    )
  })

  it('names the pauses that cost points rather than the total', () => {
    const pauses = [pause(600), pause(1400), pause(2200), pause(800)]
    expect(describeMetric('mid_sentence_pauses', measure(0.9, 9, 14), statistics(), pauses)).toBe(
      '2 mid-sentence over 1s',
    )
  })

  /** A long pause can still be too small a burden to move the points. */
  it('says a charged count cost nothing when it earned every point', () => {
    const pauses = [pause(1200)]
    expect(describeMetric('mid_sentence_pauses', measure(0.13, 14, 14), statistics(), pauses)).toBe(
      '1 mid-sentence over 1s, no points lost',
    )
  })

  it('reads plainly when there were none at all', () => {
    expect(describeMetric('mid_sentence_pauses', measure(0, 14, 14), statistics(), [])).toBe(
      'No mid-sentence pauses',
    )
    expect(
      describeMetric('mid_sentence_pauses', measure(0, 14, 14), statistics(), [
        pause(900, 'clean'),
      ]),
    ).toBe('No mid-sentence pauses')
  })

  it('says so when a filler count cost nothing', () => {
    expect(
      describeMetric(
        'fillers',
        measure(1.2, 15, 18),
        statistics({ counted_items: counted(1) }),
        [],
      ),
    ).toBe('1 per 84 words')
    expect(
      describeMetric(
        'fillers',
        measure(0.9, 18, 18),
        statistics({ counted_items: counted(1) }),
        [],
      ),
    ).toBe('1 per 84 words, no points lost')
    expect(describeMetric('fillers', measure(0, 18, 18), statistics(), [])).toBe('None in 84 words')
  })

  it('explains a silence that fell inside the free window', () => {
    expect(describeMetric('time_to_first_word', measure(1.2, 4, 4), statistics(), [])).toBe(
      '1.2s of silence first, under 2.5s',
    )
    expect(describeMetric('time_to_first_word', measure(3.2, 4, 4), statistics(), [])).toBe(
      '3.2s of silence first, no points lost',
    )
    expect(describeMetric('time_to_first_word', measure(4.1, 3, 4), statistics(), [])).toBe(
      '4.1s of silence first',
    )
  })

  /** The rule in one line: full points never reads as a fault. */
  it('never shows a bare count beside full points', () => {
    const rows = [
      describeMetric(
        'fillers',
        measure(0.9, 18, 18),
        statistics({ counted_items: counted(3) }),
        [],
      ),
      describeMetric('mid_sentence_pauses', measure(0, 14, 14), statistics(), [pause(600)]),
      describeMetric('time_to_first_word', measure(2.1, 4, 4), statistics(), []),
    ]
    for (const row of rows) expect(row).toMatch(/under|no points lost/)
  })
})

describe('the span list', () => {
  const span = (text: string) => ({ text, category: 'padding' as const })
  const quoting = (quote: string): CheckFinding => ({
    passed: false,
    severity: 'clear',
    quote,
    observation: 'x',
    suggestion: null,
  })

  /** One span, one place on screen, one way to dispute it. */
  it('drops a span already shown as the quoted finding', () => {
    const spans = [span('probably just'), span('I feel like')]
    expect(listedSpans(spans, quoting('probably just')).map((entry) => entry.text)).toEqual([
      'I feel like',
    ])
  })

  it('matches the quote through punctuation and case', () => {
    expect(listedSpans([span('probably just')], quoting('Probably just,'))).toEqual([])
  })

  it('lists every span when the check itself passed', () => {
    expect(listedSpans([span('I feel like')], pass())).toHaveLength(1)
  })

  it('lists nothing at all when the only span is the quote', () => {
    expect(listedSpans([span('probably just')], quoting('probably just'))).toEqual([])
  })
})
