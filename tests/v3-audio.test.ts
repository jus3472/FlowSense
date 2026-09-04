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
  timeToFirstWordComponent,
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

describe('v3 audio threshold policy', () => {
  it('publishes valid, mode-specific threshold sets and bounded component functions', () => {
    for (const mode of MODES) {
      expect(validateAudioModeThresholds(AUDIO_THRESHOLDS_BY_MODE[mode])).toBe(true)
      for (const component of [
        paceComponent(155, mode),
        timeToFirstWordComponent(2_000, mode),
        pausedTimeComponent(2_000, mode),
        articulationComponent(0.2, mode),
        energyComponent(2, mode),
      ]) {
        expect(component).toBeGreaterThanOrEqual(0)
        expect(component).toBeLessThanOrEqual(1)
      }
    }
    expect(AUDIO_THRESHOLDS_BY_MODE.practice).not.toEqual(AUDIO_THRESHOLDS_BY_MODE.conversation)
    expect(paceComponent(110, 'practice')).not.toBe(paceComponent(110, 'presentation'))
    expect(timeToFirstWordComponent(2_000, 'practice')).not.toBe(
      timeToFirstWordComponent(2_000, 'conversation'),
    )
    expect(pausedTimeComponent(-1, 'practice')).toBe(0)
    expect(energyComponent(Number.NaN, 'practice')).toBe(0)
  })

  it('gives time to first word a natural full-score plateau', () => {
    expect(timeToFirstWordComponent(0, 'practice')).toBe(1)
    expect(timeToFirstWordComponent(2_500, 'practice')).toBe(1)
    expect(timeToFirstWordComponent(7_250, 'practice')).toBeCloseTo(0.5)
    expect(timeToFirstWordComponent(12_000, 'practice')).toBe(0)
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

  it('returns five explicit, independently scored metric records', () => {
    const result = evaluation(transcript)

    expect(result.version).toBe('v3.audio.1')
    expect(Object.keys(result.metrics)).toEqual(AUDIO_METRIC_IDS)
    for (const metric of Object.values(result.metrics)) {
      expect(metric.status).toBe('scored')
      expect(metric.component).not.toBeNull()
      expect(metric.component!).toBeGreaterThanOrEqual(0)
      expect(metric.component!).toBeLessThanOrEqual(1)
      expect(metric.explanation.length).toBeGreaterThan(0)
    }
  })

  it('computes pace from RMS-active speech and excludes every silent frame', () => {
    const words = withConfidence(transcript)
    const capture = captureFor(words)
    const metric = evaluation(transcript, words, capture).metrics.pace
    const expectedActiveMs = words.length * 400

    expect(metric.status).toBe('scored')
    expect(metric.measurements.active_speaking_ms).toBe(expectedActiveMs)
    expect(metric.measurements.excluded_silence_ms).toBe(capture.duration_ms - expectedActiveMs)
    expect(metric.measurements.words_per_minute).toBeCloseTo(
      (words.length / expectedActiveMs) * 60_000,
    )
  })

  it('anchors first word to recorder time and uses RMS only as corroboration', () => {
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
    const metric = evaluation(transcript, words, capture).metrics.time_to_first_word

    expect(metric.status).toBe('scored')
    expect(metric.measurements.transcript_ms).toBe(2_000)
    expect(metric.measurements.seconds).toBe(2)
    expect(metric.measurements.amplitude_onset_ms).toBe(500)
    expect(metric.measurements.rms_corroborated).toBe(false)
    expect(metric.warnings).toHaveLength(1)
  })

  it('counts only unnatural interword pause duration and excludes edge silence', () => {
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
    expect(natural.measurements.total_unnatural_pause_ms).toBe(0)
    expect(natural.measurements.total_interword_silence_ms).toBe(1_600)
    expect(unnatural.status).toBe('scored')
    expect(unnatural.measurements.total_unnatural_pause_ms).toBe(1_600)
    expect(unnatural.measurements.unnatural_pause_count).toBe(1)
    expect(unnatural.measurements.total_unnatural_pause_ms).toBeLessThan(8_000 - 1_600)
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
    expect(metric.measurements.pitch_spread_semitones).toBe(0)
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
    expect(varying.measurements.pitch_spread_semitones).toBe(
      steady.measurements.pitch_spread_semitones,
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
