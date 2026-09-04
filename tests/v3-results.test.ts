import { describe, expect, it } from 'vitest'
import {
  v3EvidenceViews,
  v3MeasurementDetails,
  v3MetricDetails,
  v3MetricHasDetails,
  v3MetricStatus,
  v3MetricSummary,
  v3PrimaryMeasurement,
  v3TranscriptSegments,
} from '@/lib/results/v3'
import { legacyV3Snapshot, v3Snapshot } from './helpers/result-snapshots'

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

  it('translates unavailable audio gates without exposing internal diagnostics', () => {
    const articulation = {
      ...v3Snapshot({ unavailableMetric: 'articulation' }).sections.how_you_sounded.metrics
        .articulation,
      warnings: ['Recognized speech did not separate reliably from surrounding audio.'],
    }
    expect(v3MetricSummary('articulation', articulation, 'practice')).toBe(
      'This recording did not contain enough clear speech evidence to measure articulation.',
    )
    expect(v3MetricDetails('articulation', articulation, 'practice').warnings).toEqual([])
  })

  it('builds concise summaries and friendly detail rows from stored audio measurements', () => {
    const payload = v3Snapshot({ mode: 'practice', component: 0.8 })
    const pace = {
      ...payload.sections.how_you_sounded.metrics.pace,
      measurements: {
        words_per_minute: 194.2,
        active_speaking_ms: 15_800,
        word_count: 51,
        excluded_silence_ms: 3_000,
      },
    }
    expect(v3MetricSummary('pace', pace, 'practice')).toBe(
      'You spoke faster than the full-credit range.',
    )
    expect(v3MetricDetails('pace', pace, 'practice').measurements).toEqual([
      { label: 'Speaking pace', value: '194 WPM', help: null },
      { label: 'Full-credit range', value: '120 to 175 WPM', help: null },
      { label: 'Active speaking time', value: '15.8 sec', help: null },
      { label: 'Words spoken', value: '51', help: null },
    ])

    const energy = {
      ...payload.sections.how_you_sounded.metrics.energy,
      measurements: {
        pitch_range_semitones: 6,
        pitch_variation_semitones: 1.8,
        flat_window_proportion: 0,
        rhythm_cadence_component: 0.83,
        voiced_frame_count: 72,
        temporal_bin_count: 4,
      },
    }
    const energyDetails = v3MetricDetails('energy', energy, 'practice')
    expect(energyDetails.measurements.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Pitch range', value: '6.0 semitones' },
      { label: 'Pitch variation', value: '1.8 semitones' },
      { label: 'Flat vocal sections', value: '0%' },
      { label: 'Speaking rhythm', value: 'Varied' },
    ])
    expect(JSON.stringify(energyDetails)).not.toMatch(/frame|bin/i)
  })

  it('derives Conciseness counts only from validated findings and groups multi-span examples', () => {
    const base = v3Snapshot({ component: 0.75 }).sections.what_you_said.metrics.conciseness
    const detail = 'These two portions communicate essentially the same idea.'
    const result = {
      ...base,
      measurements: { filler_count: 99 },
      details: [
        {
          kind: 'filler',
          source: 'ai' as const,
          quote: 'Honestly',
          observation: 'This word does not add meaning in this context.',
          suggestion: 'Begin with the main point.',
          evidence: [],
        },
        {
          kind: 'repeated_idea',
          source: 'ai' as const,
          quote: null,
          observation: detail,
          suggestion: 'State the idea once.',
          evidence: [
            {
              source: 'transcript',
              start: 0,
              end: 13,
              coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
              quote: 'I like my car',
              detail,
            },
            {
              source: 'transcript',
              start: 15,
              end: 46,
              coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
              quote: 'I enjoy spending time in my car',
              detail,
            },
          ],
        },
      ],
      evidence: [],
    }
    const details = v3MetricDetails('conciseness', result, 'practice')
    expect(details.counts).toEqual([
      { label: 'Fillers', value: '1', help: null },
      { label: 'Repeated ideas', value: '1', help: null },
    ])
    expect(details.findings[1]?.quotes).toEqual([
      'I like my car',
      'I enjoy spending time in my car',
    ])
    expect(details.evidence).toEqual([])
  })

  it('omits empty disclosures for perfect Word Choice and Grammar but keeps useful positive detail', () => {
    const payload = v3Snapshot({ component: 1 })
    const grammar = payload.sections.what_you_said.metrics.grammar
    const wordChoice = payload.sections.what_you_said.metrics.word_choice
    const specificity = {
      ...payload.sections.what_you_said.metrics.specificity,
      explanation: 'You supported the main idea with two concrete examples.',
    }

    const grammarDetails = v3MetricDetails('grammar', grammar, 'practice')
    const wordChoiceDetails = v3MetricDetails('word_choice', wordChoice, 'practice')
    const specificityDetails = v3MetricDetails('specificity', specificity, 'practice')
    expect(v3MetricHasDetails('grammar', grammar, grammarDetails)).toBe(false)
    expect(v3MetricHasDetails('word_choice', wordChoice, wordChoiceDetails)).toBe(false)
    expect(v3MetricHasDetails('specificity', specificity, specificityDetails)).toBe(true)
  })

  it('keeps first-word corroboration diagnostics out of the user-facing detail list', () => {
    const metric = legacyV3Snapshot({
      evidenceMetric: 'time_to_first_word',
      measurements: {
        seconds: 2.9,
        transcript_ms: 3_200,
        amplitude_onset_ms: 650,
        anchored_acoustic_onset_ms: 2_900,
        selected_onset_ms: 2_900,
        rms_corroborated: true,
        source: 'anchored_acoustic',
        origin: 'recording_start',
      },
    }).sections.how_you_sounded.metrics.time_to_first_word

    expect(v3PrimaryMeasurement('time_to_first_word', metric)).toBe('2.9 sec')
    expect(v3MeasurementDetails(metric)).toEqual(['seconds: 2.90'])
  })

  it('summarizes composite Energy evidence while preserving historical pitch-spread display', () => {
    const current = v3Snapshot({
      evidenceMetric: 'energy',
      measurements: {
        pitch_range_semitones: 5.24,
        pitch_variation_semitones: 2.18,
        flat_window_proportion: 1 / 3,
        cadence_log_spread: 0.19,
        pitch_range_component: 0.93,
        pitch_variation_component: 0.61,
        non_monotony_component: 0.86,
        rhythm_cadence_component: 0.83,
        voiced_frame_count: 72,
        temporal_bin_count: 4,
        covered_temporal_bin_count: 4,
        monotony_window_count: 6,
        flat_window_count: 2,
        cadence_window_count: 8,
      },
    }).sections.how_you_sounded.metrics.energy
    expect(v3PrimaryMeasurement('energy', current)).toBe('67% vocally varied windows')
    expect(v3MeasurementDetails(current)).toEqual([
      'central pitch range: 5.2 semitones',
      'typical pitch variation: 2.2 semitones',
      'flatter vocal windows: 33%',
      'active-speech timing: varied',
    ])

    const historical = v3Snapshot({
      evidenceMetric: 'energy',
      measurements: { pitch_spread_semitones: 1.74 },
    }).sections.how_you_sounded.metrics.energy
    expect(v3PrimaryMeasurement('energy', historical)).toBe('1.7 semitone pitch spread')
    expect(v3MeasurementDetails(historical)).toEqual(['pitch spread semitones: 1.74'])
  })

  it('shows validated AI filler counts and transcript evidence under Conciseness', () => {
    const transcript = 'Um, I led the launch.'
    const payload = v3Snapshot({
      component: 0.82,
      evidenceMetric: 'conciseness',
      measurements: { filler_count: 1 },
      evidence: [
        {
          source: 'transcript',
          start: 0,
          end: 3,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
          quote: 'Um,',
          detail: 'This opening functions as unnecessary filler.',
        },
      ],
    })
    const conciseness = payload.sections.what_you_said.metrics.conciseness

    expect(v3MeasurementDetails(conciseness)).toEqual(['filler count: 1'])
    expect(v3EvidenceViews(conciseness).map((item) => item.text)).toContain(
      '“Um,” This opening functions as unnecessary filler.',
    )
    expect(v3TranscriptSegments(transcript, payload)).toContainEqual({
      type: 'highlight',
      text: 'Um,',
      kind: 'word_choice',
      label: 'Conciseness: This opening functions as unnecessary filler.',
    })
  })

  it('renders each validated span for one noncontiguous Conciseness observation', () => {
    const transcript = 'I like my car. I enjoy spending time in my car.'
    const detail = 'These two spans repeat the same idea.'
    const payload = v3Snapshot({
      component: 0.82,
      evidenceMetric: 'conciseness',
      evidence: [
        {
          source: 'transcript',
          start: 0,
          end: 13,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
          quote: 'I like my car',
          detail,
        },
        {
          source: 'transcript',
          start: 15,
          end: 46,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
          quote: 'I enjoy spending time in my car',
          detail,
        },
      ],
    })

    const conciseness = payload.sections.what_you_said.metrics.conciseness
    const withGroupedFinding = {
      ...conciseness,
      details: [
        {
          kind: 'repeated_idea',
          source: 'ai' as const,
          quote: null,
          observation: detail,
          suggestion: 'State the idea once.',
          evidence: conciseness.evidence,
        },
      ],
    }
    expect(v3EvidenceViews(withGroupedFinding).map((item) => item.text)).toEqual([detail])
    expect(
      v3TranscriptSegments(transcript, payload)
        .filter((segment) => segment.type === 'highlight')
        .map((segment) => segment.text),
    ).toEqual(['I like my car', 'I enjoy spending time in my car'])
  })
})
