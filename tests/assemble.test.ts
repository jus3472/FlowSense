import { describe, expect, it } from 'vitest'
import { CONTENT_MAX, DELIVERY_MAX, assembleScore, recomputeScore } from '@/lib/scoring/assemble'
import { notCheckedContent, parseContentResponse } from '@/lib/scoring/content'
import { computeMechanical } from '@/lib/scoring/mechanical'
import { amplitudeTimeline, pitchTimeline, wordsFrom } from './helpers/transcript'
import type { CaptureMetrics } from '@/lib/types/metrics'

const TRANSCRIPT =
  'I went to the park yesterday and it was quiet. The trees had just turned and the light was low.'

function capture(durationMs = 20_000): CaptureMetrics {
  return {
    mime_type: 'audio/webm;codecs=opus',
    started_at: new Date().toISOString(),
    duration_ms: durationMs,
    sample_interval_ms: 50,
    amplitude: amplitudeTimeline(durationMs, [{ from_ms: 800, to_ms: durationMs, rms: 0.1 }]),
    pitch: pitchTimeline(Array.from({ length: 200 }, (_v, i) => (i % 2 === 0 ? 115 : 128))),
  }
}

describe('score assembly', () => {
  const mechanical = computeMechanical(capture(), wordsFrom(TRANSCRIPT, 3, 0.8), TRANSCRIPT)

  it('splits 100 points evenly between the two halves', () => {
    expect(CONTENT_MAX).toBe(50)
    expect(DELIVERY_MAX).toBe(50)
  })

  it('makes the section subtotals sum exactly to the stored score', () => {
    const assembled = assembleScore(mechanical, notCheckedContent(), {
      status: 'not_checked',
      model: null,
      error: 'offline',
      disputes: [],
    })
    const { content, delivery } = assembled.section_scores
    expect(content.earned + delivery.earned).toBe(assembled.score)
  })

  it('makes each section subtotal sum from its own parts', () => {
    const assembled = assembleScore(mechanical, notCheckedContent(), {
      status: 'not_checked',
      model: null,
      error: null,
      disputes: [],
    })
    const { content, delivery } = assembled.section_scores
    const checkSum = Object.values(content.checks).reduce((sum, value) => sum + value, 0)
    const metricSum = Object.values(delivery.metrics).reduce((sum, value) => sum + value, 0)
    expect(checkSum).toBe(content.earned)
    expect(metricSum).toBe(delivery.earned)
  })

  it('never exceeds 100 or drops below 0', () => {
    const assembled = assembleScore(mechanical, notCheckedContent(), {
      status: 'checked',
      model: 'fake',
      error: null,
      disputes: [],
    })
    expect(assembled.score).toBeGreaterThanOrEqual(0)
    expect(assembled.score).toBeLessThanOrEqual(100)
  })

  /** A model outage must never cost a user points. */
  it('awards all 50 content points when the model did not run', () => {
    const assembled = assembleScore(mechanical, notCheckedContent(), {
      status: 'not_checked',
      model: null,
      error: 'DeepSeek did not answer',
      disputes: [],
    })
    expect(assembled.section_scores.content.earned).toBe(50)
    expect(assembled.content_result.status).toBe('not_checked')
    expect(assembled.content_result.error).toBe('DeepSeek did not answer')
  })

  it('keeps the delivery half unchanged when a finding is disputed', () => {
    const failing = parseContentResponse(
      JSON.stringify({
        checks: {
          answered: { passed: false, severity: 'clear', quote: 'the park', observation: 'x' },
          explained: { passed: true },
          logical_order: { passed: true },
          no_repetition: { passed: true },
          word_choice: { passed: true },
        },
        extra_spans: [],
        tightened: null,
      }),
      TRANSCRIPT,
    )

    const original = assembleScore(mechanical, failing, {
      status: 'checked',
      model: 'fake',
      error: null,
      disputes: [],
    })
    const rescored = recomputeScore(
      original.content_result,
      original.section_scores.delivery.metrics,
      [{ note_type: 'answered', quote: 'the park' }],
    )

    expect(rescored.section_scores.delivery.earned).toBe(original.section_scores.delivery.earned)
    expect(rescored.section_scores.content.earned).toBe(original.section_scores.content.earned + 14)
    expect(rescored.score).toBe(original.score + 14)
    expect(rescored.section_scores.content.earned + rescored.section_scores.delivery.earned).toBe(
      rescored.score,
    )
  })
})

describe('mechanical end to end', () => {
  const result = computeMechanical(capture(), wordsFrom(TRANSCRIPT, 3, 0.8), TRANSCRIPT)

  it('produces a metric for each of the five delivery measures', () => {
    expect(Object.keys(result.metrics).sort()).toEqual(
      ['energy', 'fillers', 'mid_sentence_pauses', 'pace', 'time_to_first_word'].sort(),
    )
  })

  it('caps each metric at its own maximum', () => {
    for (const metric of Object.values(result.metrics)) {
      expect(metric.points).toBeGreaterThanOrEqual(0)
      expect(metric.points).toBeLessThanOrEqual(metric.max_points)
      expect(metric.component).toBeGreaterThanOrEqual(0)
      expect(metric.component).toBeLessThanOrEqual(1)
    }
  })

  it('itemizes every token it charged for', () => {
    const charged = result.statistics.counted_items.reduce(
      (sum, item) => sum + item.token_indices.length,
      0,
    )
    const fromLabel = Number(result.metrics.fillers.label?.split(' ')[0] ?? '0')
    expect(charged).toBe(fromLabel)
  })

  it('reports statistics without scoring them', () => {
    expect(result.statistics.word_count).toBeGreaterThan(0)
    expect(result.statistics.recording_ms).toBe(20_000)
    expect(result.statistics.silence_ratio).toBeGreaterThanOrEqual(0)
    expect(result.statistics.silence_ratio).toBeLessThanOrEqual(1)
    expect(result.statistics.backtrack_count).toBe(0)
    expect(result.statistics.backtrack_note).toBeNull()
  })

  it('excludes leading silence from the scored pauses but keeps it in the total', () => {
    expect(result.statistics.leading_silence_ms).toBeGreaterThan(0)
    expect(
      result.pauses.every((pause) => pause.kind !== 'mid_sentence' || pause.preceding_word),
    ).toBe(true)
    expect(result.statistics.total_silence_ms).toBeGreaterThanOrEqual(
      result.statistics.leading_silence_ms,
    )
  })
})
