import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import { analyseClarity } from '@/lib/scoring/v2/clarity'
import type { CaptureMetrics } from '@/lib/types/metrics'
import { amplitudeTimeline } from './helpers/transcript'

const DURATION_MS = 8_000
const SAMPLE_INTERVAL_MS = 50

function words(confidences: readonly (number | undefined)[]): TranscriptWord[] {
  return confidences.map((confidence, index) => {
    const start = 0.75 + index * 0.75
    return {
      word: `word${index}`,
      start,
      end: start + 0.35,
      ...(confidence === undefined ? {} : { confidence }),
    }
  })
}

function captureFor(
  recognizedWords: readonly TranscriptWord[],
  overrides: Partial<CaptureMetrics> = {},
): CaptureMetrics {
  const amplitude = amplitudeTimeline(
    DURATION_MS,
    recognizedWords.map((word) => ({
      from_ms: word.start * 1000,
      to_ms: word.end * 1000,
      rms: 0.08,
    })),
    0.002,
    SAMPLE_INTERVAL_MS,
  )

  return {
    mime_type: 'audio/webm;codecs=opus',
    started_at: '2026-08-26T12:00:00.000Z',
    duration_ms: DURATION_MS,
    sample_interval_ms: SAMPLE_INTERVAL_MS,
    amplitude,
    pitch: [],
    ...overrides,
  }
}

const HIGH_CONFIDENCE = Array.from({ length: 8 }, () => 0.95)

describe('v2 clarity intelligibility evaluator', () => {
  it('scores a sufficiently supported high-confidence transcript', () => {
    const recognizedWords = words(HIGH_CONFIDENCE)
    const result = analyseClarity(recognizedWords, captureFor(recognizedWords))

    expect(result).toMatchObject({
      category: 'clarity',
      availability: 'available',
      status: 'scored',
      component: 1,
    })
    expect(result.deductions).toEqual([])
    expect(result.measurements).toMatchObject({
      word_count: 8,
      confidence_word_count: 8,
      confidence_coverage: 1,
      low_confidence_count: 0,
    })
    expect(result.measurements.speech_to_noise_ratio).toBeGreaterThan(2.5)
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'deepgram_word_confidence',
          quote: null,
          detail: 'Most of the response was transcribed clearly.',
        }),
        expect.objectContaining({ source: 'audio_timeline' }),
      ]),
    )
  })

  it('scores scattered uncertainty with exact bounded word evidence', () => {
    const recognizedWords = words([0.42, ...HIGH_CONFIDENCE.slice(1)])
    const result = analyseClarity(recognizedWords, captureFor(recognizedWords))

    expect(result).toMatchObject({ status: 'scored', component: 0.875 })
    expect(result.measurements.low_confidence_proportion).toBe(0.125)
    expect(result.deductions).toEqual([
      expect.objectContaining({
        id: 'recognition_uncertainty',
        component_reduction: 0.125,
      }),
    ])
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        {
          source: 'deepgram_word_confidence',
          start: recognizedWords[0]?.start,
          end: recognizedWords[0]?.end,
          quote: 'word0',
          detail: 'Recognition confidence for this word was 0.42.',
        },
      ]),
    )
  })

  it('does not assign a component when recognition is globally uncertain', () => {
    const recognizedWords = words([0.2, 0.3, 0.4, 0.25, 0.35, 0.95, 0.95, 0.95])
    const result = analyseClarity(recognizedWords, captureFor(recognizedWords))

    expect(result).toMatchObject({
      availability: 'available',
      status: 'not_checked',
      component: null,
    })
    expect(result.measurements.low_confidence_proportion).toBe(0.625)
    expect(result.deductions).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/globally uncertain/)
  })

  it('does not check an empty or near-empty response', () => {
    const emptyCapture = captureFor([])
    expect(analyseClarity([], emptyCapture)).toMatchObject({
      status: 'not_checked',
      component: null,
    })

    const shortWords = words(HIGH_CONFIDENCE.slice(0, 7))
    expect(analyseClarity(shortWords, captureFor(shortWords))).toMatchObject({
      status: 'not_checked',
      component: null,
    })
  })

  it('does not invent a score for legacy or partial word confidence', () => {
    const legacyWords = words(Array.from({ length: 8 }, () => undefined))
    expect(analyseClarity(legacyWords, captureFor(legacyWords))).toMatchObject({
      status: 'not_checked',
      component: null,
    })

    const partialWords = words([0.95, 0.95, 0.95, 0.95, 0.95, 0.95, undefined, undefined])
    const partial = analyseClarity(partialWords, captureFor(partialWords))
    expect(partial).toMatchObject({ status: 'not_checked', component: null })
    expect(partial.measurements.confidence_coverage).toBe(0.75)
  })

  it('ignores malformed direct confidence values when measuring coverage', () => {
    const recognizedWords = words([0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 2, Number.NaN])
    const result = analyseClarity(recognizedWords, captureFor(recognizedWords))

    expect(result).toMatchObject({ status: 'not_checked', component: null })
    expect(result.measurements.confidence_word_count).toBe(6)
    expect(result.measurements.confidence_coverage).toBe(0.75)
  })

  it('rejects recognized word timings outside the measured recording', () => {
    const recognizedWords = words(HIGH_CONFIDENCE)
    recognizedWords[7] = { ...recognizedWords[7]!, start: 8.1, end: 8.4 }

    expect(analyseClarity(recognizedWords, captureFor(recognizedWords))).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
  })

  it.each([
    [
      'invalid sampling interval',
      (capture: CaptureMetrics) => ({ ...capture, sample_interval_ms: 0 }),
    ],
    [
      'nonmonotonic timestamps',
      (capture: CaptureMetrics) => {
        const amplitude = [...capture.amplitude]
        amplitude[20] = { ...amplitude[20]!, t_ms: amplitude[19]!.t_ms }
        return { ...capture, amplitude }
      },
    ],
    [
      'out-of-range timestamps',
      (capture: CaptureMetrics) => {
        const amplitude = [...capture.amplitude]
        amplitude[amplitude.length - 1] = {
          ...amplitude.at(-1)!,
          t_ms: capture.duration_ms + 1,
        }
        return { ...capture, amplitude }
      },
    ],
    [
      'negative RMS',
      (capture: CaptureMetrics) => {
        const amplitude = [...capture.amplitude]
        amplitude[20] = { ...amplitude[20]!, rms: -0.1 }
        return { ...capture, amplitude }
      },
    ],
  ])('marks %s capture evidence unavailable', (_label, change) => {
    const recognizedWords = words(HIGH_CONFIDENCE)
    const result = analyseClarity(recognizedWords, change(captureFor(recognizedWords)))

    expect(result).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
    expect(result.deductions).toEqual([])
  })

  it.each([
    [
      'sparse',
      (capture: CaptureMetrics) => ({
        ...capture,
        amplitude: capture.amplitude.filter((_sample, index) => index % 10 === 0),
      }),
    ],
    [
      'missing head',
      (capture: CaptureMetrics) => ({
        ...capture,
        amplitude: capture.amplitude.filter((sample) => sample.t_ms >= 1_000),
      }),
    ],
    [
      'missing tail',
      (capture: CaptureMetrics) => ({
        ...capture,
        amplitude: capture.amplitude.filter((sample) => sample.t_ms < 7_000),
      }),
    ],
  ])('does not score a %s amplitude timeline', (_label, change) => {
    const recognizedWords = words(HIGH_CONFIDENCE)
    const result = analyseClarity(recognizedWords, change(captureFor(recognizedWords)))

    expect(result).toMatchObject({
      availability: 'unavailable',
      status: 'unavailable',
      component: null,
    })
    expect(result.warnings.join(' ')).toMatch(/incomplete|interrupted/)
  })

  it('does not score room tone without recognized-speech separation', () => {
    const recognizedWords = words(HIGH_CONFIDENCE)
    const flatAmplitude = amplitudeTimeline(
      DURATION_MS,
      [{ from_ms: 0, to_ms: DURATION_MS, rms: 0.01 }],
      0.01,
      SAMPLE_INTERVAL_MS,
    )
    const result = analyseClarity(
      recognizedWords,
      captureFor(recognizedWords, { amplitude: flatAmplitude }),
    )

    expect(result).toMatchObject({
      availability: 'available',
      status: 'not_checked',
      component: null,
    })
    expect(result.warnings.join(' ')).toMatch(/did not separate/)
    expect(result.deductions).toEqual([])
  })

  it('keeps evaluator copy about observable recognition evidence', () => {
    const source = readFileSync('src/lib/scoring/v2/clarity.ts', 'utf8')
    expect(source).not.toMatch(/mispronounc|accent|sound(?:ing)? native/i)

    const recognizedWords = words([0.42, ...HIGH_CONFIDENCE.slice(1)])
    const result = analyseClarity(recognizedWords, captureFor(recognizedWords))
    const copy = [
      ...result.evidence.map((item) => item.detail),
      ...result.deductions.map((item) => item.detail),
      ...result.warnings,
    ].join(' ')
    expect(copy).not.toMatch(/personality|you lack confidence|not confident/i)
  })
})
