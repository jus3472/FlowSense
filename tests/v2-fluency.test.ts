import { describe, expect, it } from 'vitest'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import { analysePace } from '@/lib/scoring/pace'
import { evaluateFluency } from '@/lib/scoring/v2/fluency'
import { amplitudeTimeline, wordsFrom } from './helpers/transcript'

function capture(
  durationMs: number,
  amplitude: ReturnType<typeof amplitudeTimeline>,
  sampleIntervalMs = 50,
) {
  return { duration_ms: durationMs, sample_interval_ms: sampleIntervalMs, amplitude }
}

function evaluated(transcript: string, durationMs = 10_000) {
  const words = wordsFrom(transcript)
  return evaluateFluency({
    capture: capture(
      durationMs,
      amplitudeTimeline(durationMs, [{ from_ms: 0, to_ms: durationMs, rms: 0.2 }]),
    ),
    words,
    transcript,
  })
}

describe('v2 fluency evaluator', () => {
  it('returns a bounded, evidence-backed fluency component without points', () => {
    const result = evaluated('I went to the park and explained why I enjoyed it.')

    expect(result).toMatchObject({
      category: 'fluency',
      availability: 'available',
      status: 'scored',
    })
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')
    expect(result.component).toBeGreaterThanOrEqual(0)
    expect(result.component).toBeLessThanOrEqual(1)
    expect(result).not.toHaveProperty('earned_points')
    expect(result.measurements.speaking_ms).toBeGreaterThan(0)
    expect(Number.isFinite(result.measurements.continuity_ratio)).toBe(true)
    expect(result.measurements.continuity_ratio).toBeGreaterThanOrEqual(0)
    expect(result.measurements.continuity_ratio).toBeLessThanOrEqual(1)
    for (const deduction of result.deductions) {
      expect(Number.isFinite(deduction.component)).toBe(true)
      expect(deduction.component).toBeGreaterThanOrEqual(0)
      expect(deduction.component).toBeLessThanOrEqual(1)
    }
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'transcript_and_audio_timeline' }),
      ]),
    )
  })

  it('keeps semantic uses of like out of filler measurements', () => {
    const result = evaluated('I really like walking to the park with my friends today.')
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')

    expect(result.measurements.filler_count).toBe(0)
    expect(
      result.evidence.filter((entry) => entry.detail === 'Filler detected in the transcript.'),
    ).toEqual([])
  })

  it('reports corrections without counting them as fillers or deductions', () => {
    const result = evaluated('I love pizza, oh wait, I mean I love sushi for dinner.')
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')

    expect(result.measurements.backtrack_count).toBe(1)
    expect(result.measurements.filler_count).toBe(0)
    expect(result.warnings.join(' ')).toMatch(/self-corrections were observed/)
    expect(result.deductions.map((deduction) => deduction.id)).not.toContain('restart')
  })

  it('reports restarts as a warning without making them a deduction', () => {
    const result = evaluated('I I went to the park and then I went home.')
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')

    expect(result.measurements.restart_count).toBe(1)
    expect(result.warnings.join(' ')).toMatch(/restart tokens were observed/)
    expect(result.deductions.map((deduction) => deduction.id)).not.toContain('restart')
  })

  it('uses existing filler-aware pause classification for a filler-adjacent gap', () => {
    const transcript = 'I probably, uh, went home today.'
    const words: TranscriptWord[] = [
      { word: 'i', start: 0.5, end: 0.7 },
      { word: 'probably', start: 0.7, end: 1 },
      { word: 'uh', start: 1, end: 1.2 },
      { word: 'went', start: 3.5, end: 3.7 },
      { word: 'home', start: 3.7, end: 3.9 },
      { word: 'today', start: 3.9, end: 4.2 },
    ]
    const result = evaluateFluency({
      capture: capture(
        5_000,
        amplitudeTimeline(5_000, [
          { from_ms: 500, to_ms: 1200, rms: 0.2 },
          { from_ms: 3500, to_ms: 4200, rms: 0.2 },
        ]),
      ),
      words,
      transcript,
    })
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')

    expect(result.measurements.mid_sentence_pause_count).toBe(1)
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'audio_timeline', quote: 'probably' }),
      ]),
    )
  })

  it('reports leading and trailing silence without classifying either as a mid-sentence pause', () => {
    const transcript = 'I went home.'
    const words: TranscriptWord[] = [
      { word: 'i', start: 1, end: 1.2 },
      { word: 'went', start: 1.2, end: 1.5 },
      { word: 'home', start: 1.5, end: 2 },
    ]
    const result = evaluateFluency({
      capture: capture(6_000, amplitudeTimeline(6_000, [{ from_ms: 1000, to_ms: 2000, rms: 0.2 }])),
      words,
      transcript,
    })
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')

    expect(result.measurements.leading_silence_ms).toBeGreaterThan(0)
    expect(result.measurements.trailing_silence_ms).toBeGreaterThan(0)
    expect(result.measurements.mid_sentence_pause_count).toBe(0)
  })

  it('uses speaking time for pace so detected silence is not charged again as slow pace', () => {
    const words = Array.from({ length: 12 }, (_value, index) => ({
      word: 'word',
      start: index * 0.4,
      end: index * 0.4 + 0.35,
    }))
    const transcript = words.map((word) => word.word).join(' ')
    const result = evaluateFluency({
      capture: capture(10_000, amplitudeTimeline(10_000, [{ from_ms: 0, to_ms: 5_000, rms: 0.2 }])),
      words,
      transcript,
    })
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')

    const wallClockPace = analysePace(words.length, 10_000, 0)
    expect(result.measurements.words_per_minute).toBeGreaterThan(wallClockPace.words_per_minute)
    expect(result.measurements.words_per_minute).toBeGreaterThan(140)
  })

  it('is unavailable for empty or invalid capture and transcript input', () => {
    expect(evaluateFluency({ capture: null, words: [], transcript: '' })).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
    expect(
      evaluateFluency({
        capture: capture(2_000, []),
        words: wordsFrom('one two three'),
        transcript: 'one two three',
      }),
    ).toMatchObject({ availability: 'unavailable', status: 'unavailable' })
  })

  it.each([
    [
      'non-finite RMS',
      [
        { t_ms: 0, rms: Number.NaN },
        { t_ms: 5_000, rms: 0.2 },
        { t_ms: 10_000, rms: 0.2 },
      ],
    ],
    [
      'negative RMS',
      [
        { t_ms: 0, rms: -0.1 },
        { t_ms: 5_000, rms: 0.2 },
        { t_ms: 10_000, rms: 0.2 },
      ],
    ],
    [
      'nonmonotonic timestamps',
      [
        { t_ms: 0, rms: 0.2 },
        { t_ms: 7_000, rms: 0.2 },
        { t_ms: 6_000, rms: 0.2 },
      ],
    ],
    [
      'out-of-range timestamps',
      [
        { t_ms: 0, rms: 0.2 },
        { t_ms: 5_000, rms: 0.2 },
        { t_ms: 10_001, rms: 0.2 },
      ],
    ],
  ])('is unavailable for %s amplitude evidence', (_name, amplitude) => {
    const result = evaluateFluency({
      capture: capture(10_000, amplitude),
      words: wordsFrom('one two three four'),
      transcript: 'one two three four',
    })

    expect(result).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
  })

  it('is unavailable when a throttled timeline is too sparse for pause analysis', () => {
    const result = evaluateFluency({
      capture: capture(10_000, [
        { t_ms: 0, rms: 0.2 },
        { t_ms: 1_000, rms: 0.2 },
        { t_ms: 9_000, rms: 0.2 },
      ]),
      words: wordsFrom('one two three four'),
      transcript: 'one two three four',
    })

    expect(result).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
    expect(result.warnings.join(' ')).toMatch(/too sparse/)
  })

  it('is unavailable for an evenly sparse one hertz timeline', () => {
    const result = evaluateFluency({
      capture: capture(
        10_000,
        Array.from({ length: 10 }, (_value, index) => ({ t_ms: index * 1_000, rms: 0.2 })),
        1_000,
      ),
      words: wordsFrom('one two three four'),
      transcript: 'one two three four',
    })

    expect(result).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
    expect(result.warnings.join(' ')).toMatch(/cadence/)
  })

  it.each([
    [
      'head',
      amplitudeTimeline(10_000, [{ from_ms: 0, to_ms: 10_000, rms: 0.2 }]).filter(
        (sample) => sample.t_ms >= 1_000,
      ),
    ],
    [
      'tail',
      amplitudeTimeline(10_000, [{ from_ms: 0, to_ms: 10_000, rms: 0.2 }]).filter(
        (sample) => sample.t_ms < 8_000,
      ),
    ],
  ])('is unavailable with missing %s timeline coverage', (_edge, amplitude) => {
    const result = evaluateFluency({
      capture: capture(10_000, amplitude),
      words: wordsFrom('one two three four'),
      transcript: 'one two three four',
    })

    expect(result).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
  })

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    'is unavailable for an invalid sample interval of %s',
    (sampleIntervalMs) => {
      const result = evaluateFluency({
        capture: capture(
          10_000,
          amplitudeTimeline(10_000, [{ from_ms: 0, to_ms: 10_000, rms: 0.2 }]),
          sampleIntervalMs,
        ),
        words: wordsFrom('one two three four'),
        transcript: 'one two three four',
      })

      expect(result).toMatchObject({
        availability: 'unavailable',
        status: 'unavailable',
        component: null,
      })
    },
  )

  it('is unavailable when timed words fall outside the measured recording', () => {
    const result = evaluateFluency({
      capture: capture(2_000, amplitudeTimeline(2_000, [{ from_ms: 0, to_ms: 2_000, rms: 0.2 }])),
      words: [
        { word: 'one', start: 0, end: 0.3 },
        { word: 'two', start: 0.3, end: 0.6 },
        { word: 'three', start: 2, end: 2.2 },
      ],
      transcript: 'one two three',
    })

    expect(result).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
  })

  it('propagates capture warnings rather than silently scoring around them', () => {
    const words = Array.from({ length: 90 }, (_value, index) => ({
      word: 'word',
      start: index * 0.333,
      end: index * 0.333 + 0.3,
    }))
    const result = evaluateFluency({
      capture: capture(
        30_000,
        amplitudeTimeline(30_000, [{ from_ms: 0, to_ms: 30_000, rms: 0.2 }]),
      ),
      words,
      transcript: words.map((word) => word.word).join(' '),
    })
    if (result.availability === 'unavailable') throw new Error('Expected scoreable fluency.')

    expect(result.warnings.join(' ')).toMatch(/implausible for natural speech/)
  })
})
