import { describe, expect, it } from 'vitest'
import {
  v3EvidenceViews,
  v3MetricStatus,
  v3PrimaryMeasurement,
  v3TranscriptSegments,
} from '@/lib/results/v3'
import { v3Snapshot } from './helpers/result-snapshots'

describe('v3 result presentation helpers', () => {
  it('marks only exact transcript evidence for a metric that lost points', () => {
    const transcript = 'I used a vague phrase.'
    const deduction = v3Snapshot({
      component: 0.8,
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
    expect(v3TranscriptSegments(transcript, deduction)).toEqual([
      { type: 'text', text: 'I used a ' },
      {
        type: 'highlight',
        text: 'vague',
        kind: 'word_choice',
        label: 'Word Choice: This word does not identify the choice.',
      },
      { type: 'text', text: ' phrase.' },
    ])

    expect(
      v3TranscriptSegments(
        transcript,
        v3Snapshot({
          component: 1,
          evidenceMetric: 'word_choice',
          evidence: deduction.sections.what_you_said.metrics.word_choice.evidence,
        }),
      ),
    ).toEqual([{ type: 'text', text: transcript }])
    expect(
      v3TranscriptSegments(
        transcript,
        v3Snapshot({
          component: 0.8,
          evidenceMetric: 'word_choice',
          evidence: [
            {
              ...deduction.sections.what_you_said.metrics.word_choice.evidence[0]!,
              quote: 'other',
            },
          ],
        }),
      ),
    ).toEqual([{ type: 'text', text: transcript }])
  })

  it('formats score states, measurements, and stored evidence without inventing values', () => {
    const pace = v3Snapshot({
      evidenceMetric: 'pace',
      measurements: { words_per_minute: 143.4 },
      evidence: [
        {
          source: 'audio',
          start: null,
          end: null,
          coordinate: null,
          quote: null,
          detail: 'The measured pace stayed within the configured range.',
        },
      ],
    }).sections.how_you_sounded.metrics.pace
    expect(v3MetricStatus(pace)).toEqual({ score: '10 / 12', description: null })
    expect(v3PrimaryMeasurement('pace', pace)).toBe('143 WPM')
    expect(v3EvidenceViews(pace).map((item) => item.text)).toContain(
      'The measured pace stayed within the configured range.',
    )

    const unavailable = v3Snapshot({ unavailableMetric: 'energy' }).sections.how_you_sounded.metrics
      .energy
    expect(v3MetricStatus(unavailable)).toEqual({
      score: 'Unavailable / 10',
      description: 'The evidence needed for this metric was unavailable.',
    })
    expect(v3PrimaryMeasurement('energy', unavailable)).toBeNull()
  })
})
