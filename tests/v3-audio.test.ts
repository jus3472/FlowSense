import { describe, expect, it } from 'vitest'

import type { TranscriptWord } from '@/lib/deepgram/parse'
import {
  AUDIO_METRIC_IDS,
  AUDIO_THRESHOLDS_BY_MODE,
  articulationComponent,
  energyComponent,
  evaluateAudioMetrics,
  paceComponent,
  pausedTimeComponent,
  validateAudioModeThresholds,
} from '@/lib/scoring/v3/audio'
import type { CaptureMetrics } from '@/lib/types/metrics'
import { amplitudeTimeline, wordsFrom } from './helpers/transcript'

const MODES = ['practice', 'interview', 'presentation', 'conversation'] as const

function withConfidence(
  transcript: string,
  lowIndices: ReadonlySet<number> = new Set(),
): TranscriptWord[] {
  return wordsFrom(transcript, 2, 0.5).map((word, index) => ({
    ...word,
    confidence: lowIndices.has(index) ? 0.4 : 0.96,
  }))
}

function wordSegments(words: readonly TranscriptWord[], rms = 0.12) {
  return words.map((word) => ({
    from_ms: word.start * 1000,
    to_ms: word.end * 1000,
    rms,
  }))
}

function pitchAcrossWords(
  words: readonly TranscriptWord[],
  valueAt: (index: number) => number = (index) => (index % 2 === 0 ? 100 : 140),
) {
  const pitch = []
  let index = 0
  const lastMs = words.at(-1)!.end * 1000
  for (let t = 0; t <= lastMs; t += 50) {
    if (words.some((word) => t >= word.start * 1000 && t <= word.end * 1000)) {
      pitch.push({ t_ms: t, hz: valueAt(index) })
      index += 1
    }
  }
  return pitch
}

function captureFor(
  words: readonly TranscriptWord[],
  overrides: Partial<CaptureMetrics> = {},
): CaptureMetrics {
  const durationMs = overrides.duration_ms ?? Math.ceil(words.at(-1)!.end * 1000 + 1_000)
  return {
    mime_type: 'audio/webm',
    started_at: '2026-01-01T00:00:00.000Z',
    duration_ms: durationMs,
    sample_interval_ms: 50,
    amplitude: amplitudeTimeline(durationMs, wordSegments(words)),
    pitch: pitchAcrossWords(words),
    ...overrides,
  }
}

function evaluation(
  transcript: string,
  words = withConfidence(transcript),
  capture = captureFor(words),
) {
  return evaluateAudioMetrics({ capture, words, transcript, mode: 'practice' })
}

function timedDelivery(
  transcript: string,
  wordMs: number,
  gapMs: number,
  extraGapAfter: Readonly<Record<number, number>> = {},
): TranscriptWord[] {
  let cursorMs = 500
  return wordsFrom(transcript).map((word, index) => {
    const timed = {
      ...word,
      start: cursorMs / 1_000,
      end: (cursorMs + wordMs) / 1_000,
      confidence: 0.96,
    }
    cursorMs += wordMs + gapMs + (extraGapAfter[index] ?? 0)
    return timed
  })
}

function scoredPoints(component: number | null, maximum: number): number | null {
  return component === null ? null : Math.round(component * maximum)
}

describe('v3 audio threshold policy', () => {
  it('publishes valid, mode-specific threshold sets and bounded component functions', () => {
    for (const mode of MODES) {
      expect(validateAudioModeThresholds(AUDIO_THRESHOLDS_BY_MODE[mode])).toBe(true)
      for (const component of [
        paceComponent(155, mode),
        pausedTimeComponent(2_000, mode),
        articulationComponent(0.2, mode),
        energyComponent({
          pitch_range: 0.5,
          pitch_variation: 0.5,
          non_monotony: 0.5,
          rhythm_cadence: 0.5,
        }),
      ]) {
        expect(component).not.toBeNull()
        expect(component).toBeGreaterThanOrEqual(0)
        expect(component).toBeLessThanOrEqual(1)
      }
    }
    expect(AUDIO_THRESHOLDS_BY_MODE.practice).not.toEqual(AUDIO_THRESHOLDS_BY_MODE.conversation)
    expect(paceComponent(110, 'practice')).not.toBe(paceComponent(110, 'presentation'))
    expect(pausedTimeComponent(2_000, 'practice')).not.toBe(
      pausedTimeComponent(2_000, 'conversation'),
    )
    expect(pausedTimeComponent(-1, 'practice')).toBe(0)
    expect(
      energyComponent({
        pitch_range: Number.NaN,
        pitch_variation: 0.5,
        non_monotony: 0.5,
        rhythm_cadence: 0.5,
      }),
    ).toBeNull()
  })

  it('gives excessive paused time a natural full-score plateau', () => {
    expect(pausedTimeComponent(0, 'practice')).toBe(1)
    expect(pausedTimeComponent(750, 'practice')).toBe(1)
    expect(pausedTimeComponent(4_375, 'practice')).toBeCloseTo(0.5)
    expect(pausedTimeComponent(8_000, 'practice')).toBe(0)
  })

  it('makes paused-time score depend on total duration and not event count', () => {
    const oneSevenSecondPause = pausedTimeComponent(7_000, 'practice')
    const sevenOneSecondPauses = pausedTimeComponent(
      Array.from({ length: 7 }, () => 1_000).reduce((total, duration) => total + duration, 0),
      'practice',
    )

    expect(oneSevenSecondPause).toBe(sevenOneSecondPauses)
  })
})

describe('evaluateAudioMetrics', () => {
  const transcript =
    'I explained the project timeline and described the expected result for everyone today.'

  it('returns four explicit, independently scored metric records', () => {
    const result = evaluation(transcript)

    expect(result.version).toBe('v3.audio.4')
    expect(Object.keys(result.metrics)).toEqual(AUDIO_METRIC_IDS)
    for (const metric of Object.values(result.metrics)) {
      expect(metric.status).toBe('scored')
      expect(metric.component).not.toBeNull()
      expect(metric.component!).toBeGreaterThanOrEqual(0)
      expect(metric.component!).toBeLessThanOrEqual(1)
      expect(metric.explanation.length).toBeGreaterThan(0)
    }
    expect(result.metrics.energy.measurements).toMatchObject({
      pitch_range_component: expect.any(Number),
      pitch_variation_component: expect.any(Number),
      non_monotony_component: expect.any(Number),
      rhythm_cadence_component: expect.any(Number),
    })
    expect(result.metrics.energy.explanation).not.toMatch(
      /MAD|percentile|voiced frame|autocorrelation|temporal bin/i,
    )
  })

  it('uses plain Energy coaching copy and exposes only genuinely flat local windows', () => {
    const words = withConfidence(transcript)
    const monotoneCapture = captureFor(words, {
      pitch: pitchAcrossWords(words, () => 120),
    })
    const monotone = evaluation(transcript, words, monotoneCapture).metrics.energy
    const variedCapture = captureFor(words, {
      pitch: pitchAcrossWords(words, (index) => [100, 120, 140][index % 3]!),
    })
    const varied = evaluation(transcript, words, variedCapture).metrics.energy

    expect(monotone.status).toBe('scored')
    expect(monotone.deductions[0]?.detail).toBe(
      'Try adding a little more natural variation in your voice and rhythm.',
    )
    expect(JSON.stringify(monotone)).not.toMatch(/active-speech timing|configured range/i)
    expect(monotone.evidence.filter((item) => item.source === 'energy_flat_window')).toHaveLength(6)
    expect(
      monotone.evidence
        .filter((item) => item.source === 'energy_flat_window')
        .every((item) => item.end > item.start),
    ).toBe(true)

    expect(varied.status).toBe('scored')
    expect(varied.measurements.non_monotony_component).toBe(1)
    expect(varied.evidence.some((item) => item.source === 'energy_flat_window')).toBe(false)
    expect(varied.deductions[0]?.detail).toBe(
      'Your speaking rhythm stayed a little too even in parts.',
    )
  })

  it('keeps natural spacing in Pace while excluding only excessive hesitation', () => {
    const words = withConfidence(transcript)
    const capture = captureFor(words)
    const metric = evaluation(transcript, words, capture).metrics.pace
    const expectedDurationMs = words.at(-1)!.end * 1_000 - words[0]!.start * 1_000

    expect(metric.status).toBe('scored')
    expect(metric.measurements.pace_duration_ms).toBeCloseTo(expectedDurationMs)
    expect(metric.measurements.excluded_excessive_pause_ms).toBe(0)
    expect(metric.measurements.words_per_minute).toBeCloseTo(
      (words.length / expectedDurationMs) * 60_000,
    )
  })

  it('does not inflate WPM when quiet consonant frames occur inside timed words', () => {
    const words = withConfidence(transcript)
    const steadyCapture = captureFor(words)
    const durationMs = steadyCapture.duration_ms
    const quietWithinWords = wordSegments(words).map((segment) => ({
      ...segment,
      to_ms: segment.from_ms + 200,
    }))
    const quietCapture = captureFor(words, {
      amplitude: amplitudeTimeline(durationMs, quietWithinWords),
    })

    const steady = evaluation(transcript, words, steadyCapture).metrics.pace
    const quiet = evaluation(transcript, words, quietCapture).metrics.pace

    expect(steady.status).toBe('scored')
    expect(quiet.status).toBe('scored')
    expect(quiet.measurements.pace_duration_ms).toBe(steady.measurements.pace_duration_ms)
    expect(quiet.measurements.words_per_minute).toBe(steady.measurements.words_per_minute)
  })

  it('ignores an early click and anchors first word to nearby voiced speech', () => {
    const words = withConfidence(transcript).map((word) => ({
      ...word,
      start: word.start + 1.5,
      end: word.end + 1.5,
    }))
    const durationMs = 9_000
    const capture = captureFor(words, {
      duration_ms: durationMs,
      amplitude: amplitudeTimeline(durationMs, [
        { from_ms: 500, to_ms: 900, rms: 0.12 },
        ...wordSegments(words),
      ]),
      pitch: pitchAcrossWords(words),
    })
    const metric = evaluation(transcript, words, capture).metrics.paused_time

    expect(metric.status).toBe('scored')
    expect(metric.measurements.transcript_ms).toBe(2_000)
    expect(metric.measurements.amplitude_onset_ms).toBe(500)
    expect(metric.measurements.anchored_acoustic_onset_ms).toBe(2_000)
    expect(metric.measurements.selected_onset_ms).toBe(2_000)
    expect(metric.measurements.source).toBe('anchored_acoustic')
    expect(metric.measurements.rms_corroborated).toBe(true)
    expect(metric.measurements.beginning_silence_ms).toBe(2_000)
    expect(metric.measurements.beginning_excessive_pause_ms).toBe(900)
    expect(metric.warnings).toEqual([])
  })

  it.each([
    { label: 'immediate speech', shiftSeconds: 0, expectedMs: 500 },
    { label: 'a natural delay', shiftSeconds: 2, expectedMs: 2_500 },
    { label: 'a long hesitation', shiftSeconds: 7, expectedMs: 7_500 },
  ])('measures $label from recording start', ({ shiftSeconds, expectedMs }) => {
    const words = withConfidence(transcript).map((word) => ({
      ...word,
      start: word.start + shiftSeconds,
      end: word.end + shiftSeconds,
    }))
    const metric = evaluation(transcript, words, captureFor(words)).metrics.paused_time

    expect(metric.status).toBe('scored')
    expect(metric.measurements.selected_onset_ms).toBe(expectedMs)
    expect(metric.measurements.beginning_silence_ms).toBe(expectedMs)
    expect(metric.measurements.beginning_excessive_pause_ms).toBe(Math.max(0, expectedMs - 1_100))
    expect(metric.measurements.total_unnatural_pause_ms).toBe(Math.max(0, expectedMs - 1_100))
    if (expectedMs <= 1_100) expect(metric.component).toBe(1)
  })

  it('labels a very long beginning hesitation while charging only excess duration', () => {
    const words = withConfidence(transcript).map((word) => ({
      ...word,
      start: word.start + 4,
      end: word.end + 4,
    }))
    const metric = evaluation(transcript, words, captureFor(words)).metrics.paused_time

    expect(metric.status).toBe('scored')
    expect(metric.measurements.beginning_silence_ms).toBe(4_500)
    expect(metric.measurements.beginning_excessive_pause_ms).toBe(3_400)
    expect(metric.measurements.very_long_pause_count).toBe(1)
    expect(metric.component).toBeLessThan(1)
    expect(metric.evidence[0]?.detail).toContain('very long excessive beginning hesitation')
  })

  it('requires voiced evidence at acoustic onset instead of treating a breath as speech', () => {
    const words = withConfidence(transcript).map((word) => ({
      ...word,
      start: word.start + 1.5,
      end: word.end + 1.5,
    }))
    const durationMs = 9_000
    const capture = captureFor(words, {
      duration_ms: durationMs,
      amplitude: amplitudeTimeline(durationMs, [
        { from_ms: 1_700, to_ms: 1_950, rms: 0.12 },
        ...wordSegments(words),
      ]),
      pitch: pitchAcrossWords(words),
    })
    const metric = evaluation(transcript, words, capture).metrics.paused_time

    expect(metric.status).toBe('scored')
    expect(metric.measurements.amplitude_onset_ms).toBe(1_700)
    expect(metric.measurements.anchored_acoustic_onset_ms).toBeNull()
    expect(metric.measurements.selected_onset_ms).toBe(2_000)
    expect(metric.measurements.source).toBe('transcript')
  })

  it('sharpens the transcript boundary when sustained voiced onset closely agrees', () => {
    const words = withConfidence(transcript).map((word) => ({
      ...word,
      start: word.start + 1.5,
      end: word.end + 1.5,
    }))
    const durationMs = 9_000
    const pitch = [
      { t_ms: 1_850, hz: 120 },
      { t_ms: 1_900, hz: 122 },
      { t_ms: 1_950, hz: 121 },
      ...pitchAcrossWords(words),
    ]
    const capture = captureFor(words, {
      duration_ms: durationMs,
      amplitude: amplitudeTimeline(durationMs, [
        { from_ms: 1_850, to_ms: 2_100, rms: 0.12 },
        ...wordSegments(words),
      ]),
      pitch,
    })
    const metric = evaluation(transcript, words, capture).metrics.paused_time

    expect(metric.status).toBe('scored')
    expect(metric.measurements.transcript_ms).toBe(2_000)
    expect(metric.measurements.anchored_acoustic_onset_ms).toBe(1_850)
    expect(metric.measurements.selected_onset_ms).toBe(1_850)
    expect(metric.measurements.source).toBe('anchored_acoustic')
  })

  it('falls back to the transcript anchor when voiced audio disagrees substantially', () => {
    const words = withConfidence(transcript).map((word) => ({
      ...word,
      start: word.start + 1.5,
      end: word.end + 1.5,
    }))
    const durationMs = 9_000
    const backgroundPitch = Array.from({ length: 7 }, (_value, index) => ({
      t_ms: 1_100 + index * 50,
      hz: 115 + (index % 2),
    }))
    const capture = captureFor(words, {
      duration_ms: durationMs,
      amplitude: amplitudeTimeline(durationMs, [{ from_ms: 1_100, to_ms: 1_400, rms: 0.12 }]),
      pitch: backgroundPitch,
    })
    const metric = evaluation(transcript, words, capture).metrics.paused_time

    expect(metric.status).toBe('scored')
    expect(metric.measurements.amplitude_onset_ms).toBe(1_100)
    expect(metric.measurements.selected_onset_ms).toBe(2_000)
    expect(metric.measurements.source).toBe('transcript')
  })

  it('uses the same robust onset for beginning hesitation and pace on the real-attempt shape', () => {
    const words = withConfidence(transcript).map((word) => ({
      ...word,
      start: word.start + 2.7,
      end: word.end + 2.7,
    }))
    const durationMs = Math.ceil(words.at(-1)!.end * 1_000 + 1_000)
    const amplitude = amplitudeTimeline(durationMs, [
      { from_ms: 650, to_ms: 700, rms: 0.12 },
      { from_ms: 1_100, to_ms: 1_450, rms: 0.12 },
      { from_ms: 2_900, to_ms: words[0]!.end * 1_000, rms: 0.12 },
      ...wordSegments(words),
    ])
    const earlyPitch = Array.from({ length: 8 }, (_value, index) => ({
      t_ms: 1_100 + index * 50,
      hz: 118 + (index % 2),
    }))
    const onsetPitch = Array.from({ length: 6 }, (_value, index) => ({
      t_ms: 2_900 + index * 50,
      hz: 120 + (index % 2),
    }))
    const capture = captureFor(words, {
      duration_ms: durationMs,
      amplitude,
      pitch: [...earlyPitch, ...onsetPitch, ...pitchAcrossWords(words)],
    })
    const result = evaluation(transcript, words, capture)
    const paused = result.metrics.paused_time
    const pace = result.metrics.pace

    expect(paused.status).toBe('scored')
    expect(paused.measurements.transcript_ms).toBeCloseTo(3_200)
    expect(paused.measurements.amplitude_onset_ms).toBe(650)
    expect(paused.measurements.selected_onset_ms).toBe(2_900)
    expect(paused.measurements.beginning_silence_ms).toBe(2_900)
    expect(paused.measurements.beginning_excessive_pause_ms).toBe(1_800)
    expect(pace.status).toBe('scored')
    const expectedDurationMs = words.at(-1)!.end * 1_000 - 2_900
    expect(pace.measurements.excluded_excessive_pause_ms).toBe(0)
    expect(pace.measurements.pace_duration_ms).toBeCloseTo(expectedDurationMs)
  })

  it('counts only excess beyond contextual allowances and excludes trailing silence', () => {
    const naturalTranscript = 'We finished. Then continued.'
    const unnaturalTranscript = 'We finished and continued.'
    const timings = [
      [0.5, 0.9],
      [1, 1.4],
      [3, 3.4],
      [3.5, 3.9],
    ] as const
    const makeWords = (text: string) =>
      wordsFrom(text).map((word, index) => ({
        ...word,
        start: timings[index]![0],
        end: timings[index]![1],
        confidence: 0.96,
      }))
    const naturalWords = makeWords(naturalTranscript)
    const unnaturalWords = makeWords(unnaturalTranscript)
    const natural = evaluation(
      naturalTranscript,
      naturalWords,
      captureFor(naturalWords, { duration_ms: 8_000 }),
    ).metrics.paused_time
    const unnatural = evaluation(
      unnaturalTranscript,
      unnaturalWords,
      captureFor(unnaturalWords, { duration_ms: 8_000 }),
    ).metrics.paused_time

    expect(natural.status).toBe('scored')
    expect(natural.measurements.total_unnatural_pause_ms).toBe(500)
    expect(natural.measurements.natural_boundary_excessive_pause_ms).toBe(500)
    expect(natural.measurements.mid_thought_excessive_pause_ms).toBe(0)
    expect(natural.measurements.total_interword_silence_ms).toBe(1_600)
    expect(unnatural.status).toBe('scored')
    expect(unnatural.measurements.total_unnatural_pause_ms).toBe(950)
    expect(unnatural.measurements.natural_boundary_excessive_pause_ms).toBe(0)
    expect(unnatural.measurements.mid_thought_excessive_pause_ms).toBe(950)
    expect(unnatural.measurements.unnatural_pause_count).toBe(1)
    expect(unnatural.measurements.total_unnatural_pause_ms).toBeLessThan(8_000 - 1_600)
  })

  it('does not add silence after the final word to Paused Time', () => {
    const words = withConfidence(transcript)
    const shortTail = evaluation(
      transcript,
      words,
      captureFor(words, { duration_ms: Math.ceil(words.at(-1)!.end * 1_000 + 500) }),
    ).metrics.paused_time
    const longTail = evaluation(
      transcript,
      words,
      captureFor(words, { duration_ms: Math.ceil(words.at(-1)!.end * 1_000 + 5_000) }),
    ).metrics.paused_time

    expect(shortTail.status).toBe('scored')
    expect(longTail.status).toBe('scored')
    expect(longTail.measurements.total_unnatural_pause_ms).toBe(
      shortTail.measurements.total_unnatural_pause_ms,
    )
    expect(longTail.component).toBe(shortTail.component)
  })

  it('keeps a long interword pause owned by Paused Time instead of Energy', () => {
    const ordinaryWords = withConfidence(transcript)
    const delayedWords = ordinaryWords.map((word, index) =>
      index < 6 ? word : { ...word, start: word.start + 4, end: word.end + 4 },
    )
    const ordinary = evaluation(transcript, ordinaryWords, captureFor(ordinaryWords))
    const delayed = evaluation(transcript, delayedWords, captureFor(delayedWords))

    expect(delayed.metrics.paused_time.component).toBeLessThan(
      ordinary.metrics.paused_time.component!,
    )
    expect(delayed.metrics.energy.status).toBe('scored')
    expect(delayed.metrics.energy.component).toBeCloseTo(ordinary.metrics.energy.component!, 10)
    expect(delayed.metrics.energy.measurements.cadence_log_spread).toBeCloseTo(
      ordinary.metrics.energy.measurements.cadence_log_spread!,
      10,
    )
  })

  it.each([
    { label: 'clearly slow', wordMs: 550, gapMs: 200, expectedBand: [75, 90], maximum: 5 },
    { label: 'moderate natural', wordMs: 300, gapMs: 100, expectedBand: [145, 160], minimum: 12 },
    { label: 'moderately fast', wordMs: 230, gapMs: 80, expectedBand: [190, 200], maximum: 11 },
    { label: 'genuinely rushed', wordMs: 160, gapMs: 40, expectedBand: [285, 315], maximum: 1 },
  ])(
    'keeps a $label delivery in a defensible Pace band',
    ({ wordMs, gapMs, expectedBand, minimum, maximum }) => {
      const fixtureTranscript =
        'These twenty words make a stable timing fixture for comparing clearly different delivery speeds across the same spoken response each time today.'
      const words = timedDelivery(fixtureTranscript, wordMs, gapMs)
      const pace = evaluation(fixtureTranscript, words, captureFor(words)).metrics.pace
      const wpm = pace.measurements.words_per_minute
      const points = scoredPoints(pace.component, 12)

      expect(pace.status).toBe('scored')
      expect(wpm).not.toBeNull()
      expect(wpm!).toBeGreaterThanOrEqual(expectedBand[0]!)
      expect(wpm!).toBeLessThanOrEqual(expectedBand[1]!)
      if (minimum !== undefined) expect(points).toBeGreaterThanOrEqual(minimum)
      if (maximum !== undefined) expect(points).toBeLessThanOrEqual(maximum)
    },
  )

  it('includes normal sentence spacing instead of treating it as compressed active speech', () => {
    const fixtureTranscript =
      'I introduced the first idea with enough detail. Then I connected it to a second example. Finally I explained what changed afterward.'
    const words = timedDelivery(fixtureTranscript, 300, 100, { 7: 700, 15: 500 })
    const pace = evaluation(fixtureTranscript, words, captureFor(words)).metrics.pace

    expect(pace.status).toBe('scored')
    expect(pace.measurements.excluded_excessive_pause_ms).toBe(0)
    expect(pace.measurements.words_per_minute).toBeGreaterThan(120)
    expect(pace.measurements.words_per_minute).toBeLessThan(150)
    expect(scoredPoints(pace.component, 12)).toBe(12)
  })

  it('keeps one long hesitation primarily owned by Paused Time', () => {
    const fixtureTranscript =
      'This response uses the same words and active delivery so one added hesitation has a single clear owner in the final result.'
    const ordinaryWords = timedDelivery(fixtureTranscript, 300, 100)
    const delayedWords = timedDelivery(fixtureTranscript, 300, 100, { 9: 4_000 })
    const ordinary = evaluation(fixtureTranscript, ordinaryWords, captureFor(ordinaryWords)).metrics
    const delayed = evaluation(fixtureTranscript, delayedWords, captureFor(delayedWords)).metrics

    expect(delayed.paused_time.component).toBeLessThan(ordinary.paused_time.component!)
    expect(delayed.pace.measurements.excluded_excessive_pause_ms).toBeGreaterThan(3_000)
    expect(scoredPoints(delayed.pace.component, 12)).toBe(scoredPoints(ordinary.pace.component, 12))
    expect(
      Math.abs(
        delayed.pace.measurements.words_per_minute! - ordinary.pace.measurements.words_per_minute!,
      ),
    ).toBeLessThan(10)
  })

  it('excludes filler, false-start, and closer token spans from articulation', () => {
    const discourseTranscript =
      'Um, I I clearly explained the detailed project schedule and final outcome, you know.'
    const excluded = new Set([0, 1, 12, 13])
    const words = withConfidence(discourseTranscript, excluded)
    const metric = evaluation(discourseTranscript, words).metrics.articulation

    expect(metric.status).toBe('scored')
    expect(metric.component).toBe(1)
    expect(metric.measurements.excluded_discourse_word_count).toBe(4)
    expect(metric.measurements.eligible_word_count).toBe(10)
    expect(metric.measurements.low_confidence_word_count).toBe(0)
  })

  it('scores eligible low-confidence words only when RMS and SNR are valid', () => {
    const words = withConfidence(transcript, new Set([3, 4]))
    const valid = evaluation(transcript, words).metrics.articulation
    const durationMs = captureFor(words).duration_ms
    const noisyCapture = captureFor(words, {
      amplitude: amplitudeTimeline(durationMs, wordSegments(words, 0.1), 0.06),
    })
    const noisy = evaluation(transcript, words, noisyCapture).metrics.articulation

    expect(valid.status).toBe('scored')
    expect(valid.component).toBeLessThan(1)
    expect(valid.measurements.low_confidence_word_count).toBe(2)
    expect(noisy.status).toBe('unavailable')
    expect(noisy.component).toBeNull()
    expect(noisy.deductions).toEqual([])
  })

  it('uses pitch only inside recognized-word windows and corrects octave errors', () => {
    const words = withConfidence(transcript)
    const durationMs = captureFor(words).duration_ms
    let insideIndex = 0
    const pitch = []
    for (let t = 0; t < durationMs; t += 50) {
      const inside = words.some((word) => t >= word.start * 1000 && t <= word.end * 1000)
      pitch.push({
        t_ms: t,
        hz: inside ? (insideIndex++ % 11 === 0 ? 240 : 120) : t % 100 === 0 ? 70 : 350,
      })
    }
    const metric = evaluation(transcript, words, captureFor(words, { pitch })).metrics.energy

    expect(metric.status).toBe('scored')
    expect(metric.measurements.pitch_range_semitones).toBe(0)
    expect(metric.measurements.pitch_variation_semitones).toBe(0)
    expect(metric.component).toBe(0)
  })

  it('does not let volume consistency change the energy component', () => {
    const words = withConfidence(transcript)
    const pitch = pitchAcrossWords(words)
    const durationMs = captureFor(words).duration_ms
    const steadyVolume = captureFor(words, {
      pitch,
      amplitude: amplitudeTimeline(durationMs, wordSegments(words, 0.12)),
    })
    const varyingVolume = captureFor(words, {
      pitch,
      amplitude: amplitudeTimeline(
        durationMs,
        wordSegments(words).map((segment, index) => ({
          ...segment,
          rms: index % 2 === 0 ? 0.04 : 0.3,
        })),
      ),
    })

    const steady = evaluation(transcript, words, steadyVolume).metrics.energy
    const varying = evaluation(transcript, words, varyingVolume).metrics.energy
    expect(steady.status).toBe('scored')
    expect(varying.status).toBe('scored')
    expect(varying.component).toBe(steady.component)
    expect(varying.measurements.pitch_range_semitones).toBe(
      steady.measurements.pitch_range_semitones,
    )
    expect(varying.measurements.pitch_variation_semitones).toBe(
      steady.measurements.pitch_variation_semitones,
    )
  })

  it('requires voiced pitch evidence across the response timeline', () => {
    const words = withConfidence(transcript)
    const concentratedPitch = Array.from({ length: 60 }, (_value, index) => ({
      t_ms: 500 + index * 5,
      hz: index % 2 === 0 ? 100 : 140,
    }))
    const metric = evaluation(transcript, words, captureFor(words, { pitch: concentratedPitch }))
      .metrics.energy

    expect(metric.status).toBe('unavailable')
    expect(metric.measurements.voiced_frame_count).toBe(60)
    expect(metric.measurements.covered_temporal_bin_count).toBe(1)
    expect(metric.component).toBeNull()
  })

  it('requires enough timed words for cadence rather than fabricating a subcomponent', () => {
    const shortTranscript = 'I explained one clear choice today.'
    const words = withConfidence(shortTranscript)
    const metric = evaluation(shortTranscript, words, captureFor(words)).metrics.energy

    expect(words).toHaveLength(6)
    expect(metric.status).toBe('unavailable')
    expect(metric.component).toBeNull()
    expect(metric.warnings).toContain('At least 8 timed words are required.')
  })

  it('fails closed when persisted capture timelines are incomplete', () => {
    const words = withConfidence(transcript)
    const capture = captureFor(words, { amplitude: [{ t_ms: 0, rms: 0.1 }], pitch: [] })
    const result = evaluation(transcript, words, capture)

    for (const id of ['pace', 'paused_time', 'articulation'] as const) {
      expect(result.metrics[id].status).toBe('unavailable')
      expect(result.metrics[id].component).toBeNull()
      expect(result.metrics[id].evidence).toEqual([])
      expect(result.metrics[id].deductions).toEqual([])
    }
    expect(result.metrics.energy.status).toBe('unavailable')
    expect(result.metrics.energy.component).toBeNull()
  })
})
