import { describe, expect, it } from 'vitest'
import type { AudioEvaluation } from '@/lib/scoring/v3/audio'
import { assembleV3Score } from '@/lib/scoring/v3/assemble'
import { v3AudioMetrics } from '@/lib/scoring/v3/audio-result'
import {
  V3_CONTENT_AUDIT_VERSION,
  V3_CONTENT_EVALUATOR_VERSION,
  v3ContentAuditResult,
  type V3ContentEvaluation,
  type V3ContentMetricResult,
} from '@/lib/scoring/v3/content/contracts'

const noEvidence = {
  evidence: [],
  deductions: [],
  warnings: [],
} as const

function audioEvaluation(): AudioEvaluation {
  return {
    version: 'v3.audio.4',
    mode: 'practice',
    warnings: [],
    metrics: {
      pace: {
        id: 'pace',
        status: 'scored',
        component: 0.75,
        explanation: 'Measured pace.',
        measurements: {
          words_per_minute: 190,
          word_count: 40,
          pace_duration_ms: 12_632,
          excluded_excessive_pause_ms: 2_368,
        },
        ...noEvidence,
      },
      paused_time: {
        id: 'paused_time',
        status: 'scored',
        component: 0.8,
        explanation: 'Measured paused time.',
        measurements: {
          total_unnatural_pause_ms: 1_800,
          unnatural_pause_count: 2,
          total_interword_silence_ms: 4_000,
          beginning_silence_ms: 1_500,
          beginning_excessive_pause_ms: 400,
          interword_excessive_pause_ms: 1_400,
          natural_boundary_excessive_pause_ms: 500,
          mid_thought_excessive_pause_ms: 900,
          very_long_pause_count: 1,
          transcript_ms: 1_600,
          amplitude_onset_ms: 200,
          anchored_acoustic_onset_ms: 1_500,
          selected_onset_ms: 1_500,
          rms_corroborated: true,
          source: 'anchored_acoustic',
          origin: 'recording_start',
        },
        ...noEvidence,
      },
      articulation: {
        id: 'articulation',
        status: 'scored',
        component: 0.9,
        explanation: 'Measured articulation.',
        measurements: {
          eligible_word_count: 38,
          excluded_discourse_word_count: 2,
          confidence_word_count: 37,
          confidence_coverage: 37 / 38,
          low_confidence_word_count: 2,
          low_confidence_proportion: 2 / 37,
          median_word_confidence: 0.98,
          speech_to_noise_ratio: 8.4,
        },
        ...noEvidence,
      },
      energy: {
        id: 'energy',
        status: 'scored',
        component: 0.7,
        explanation: 'Measured energy.',
        measurements: {
          pitch_range_semitones: 5.2,
          pitch_variation_semitones: 1.8,
          flat_window_proportion: 1 / 3,
          cadence_log_spread: 0.19,
          pitch_range_component: 0.9,
          pitch_variation_component: 0.6,
          non_monotony_component: 0.8,
          rhythm_cadence_component: 0.5,
          voiced_frame_count: 72,
          temporal_bin_count: 4,
          covered_temporal_bin_count: 4,
          monotony_window_count: 6,
          flat_window_count: 2,
          cadence_window_count: 8,
        },
        ...noEvidence,
      },
    },
  }
}

describe('v3 persistence projection', () => {
  it('keeps every score component while omitting successful-run debug measurements', () => {
    const audio = audioEvaluation()
    const persisted = v3AudioMetrics(audio)

    expect(
      Object.fromEntries(Object.entries(persisted).map(([id, value]) => [id, value.component])),
    ).toEqual({ pace: 0.75, paused_time: 0.8, articulation: 0.9, energy: 0.7 })
    expect(persisted.pace.measurements).toEqual({
      words_per_minute: 190,
      word_count: 40,
      pace_duration_ms: 12_632,
      excluded_excessive_pause_ms: 2_368,
    })
    expect(persisted.paused_time.measurements).toEqual({
      total_unnatural_pause_ms: 1_800,
      beginning_excessive_pause_ms: 400,
      natural_boundary_excessive_pause_ms: 500,
      mid_thought_excessive_pause_ms: 900,
    })
    expect(persisted.articulation.measurements).toEqual({
      eligible_word_count: 38,
      confidence_word_count: 37,
      low_confidence_word_count: 2,
      low_confidence_proportion: 2 / 37,
    })
    expect(persisted.energy.measurements).toEqual({
      pitch_range_semitones: 5.2,
      pitch_variation_semitones: 1.8,
      flat_window_proportion: 1 / 3,
      cadence_log_spread: 0.19,
      pitch_range_component: 0.9,
      pitch_variation_component: 0.6,
      non_monotony_component: 0.8,
      rhythm_cadence_component: 0.5,
    })
  })

  it('leaves all ten metric and section scores unchanged', () => {
    const audio = audioEvaluation()
    const cleanedSounded = v3AudioMetrics(audio)
    const priorSounded: typeof cleanedSounded = {
      pace: { ...cleanedSounded.pace, measurements: { ...audio.metrics.pace.measurements } },
      paused_time: {
        ...cleanedSounded.paused_time,
        measurements: { ...audio.metrics.paused_time.measurements },
      },
      articulation: {
        ...cleanedSounded.articulation,
        measurements: { ...audio.metrics.articulation.measurements },
      },
      energy: { ...cleanedSounded.energy, measurements: { ...audio.metrics.energy.measurements } },
    }
    const contentMetric = (
      metric: V3ContentMetricResult['metric'],
      component: number,
    ): V3ContentMetricResult => ({
      metric,
      status: 'scored',
      component,
      explanation: `Measured ${metric}.`,
      measurements: {},
      evidence: [],
      details: [],
      warnings: [],
    })
    const contentMetrics: V3ContentEvaluation['metrics'] = {
      answered_prompt: contentMetric('answered_prompt', 1),
      specificity: contentMetric('specificity', 0.95),
      structure: contentMetric('structure', 0.9),
      conciseness: contentMetric('conciseness', 0.85),
      word_choice: contentMetric('word_choice', 0.8),
      grammar: contentMetric('grammar', 0.75),
    }
    const cleanedContent: V3ContentEvaluation = {
      version: V3_CONTENT_EVALUATOR_VERSION,
      provider: 'deepseek-v4-flash',
      status: 'checked',
      metrics: contentMetrics,
      warnings: [],
      calls: 1,
    }
    const priorContent: V3ContentEvaluation = {
      ...cleanedContent,
      metrics: {
        ...cleanedContent.metrics,
        conciseness: {
          ...cleanedContent.metrics.conciseness,
          measurements: { filler_count: 2, false_start_count: 1 },
        },
      },
    }

    const before = assembleV3Score({
      mode: 'practice',
      content: priorContent,
      sounded: priorSounded,
    })
    const after = assembleV3Score({
      mode: 'practice',
      content: cleanedContent,
      sounded: cleanedSounded,
    })
    const scoreShape = (score: typeof before) => ({
      total: score.total_earned_points,
      what: score.sections.what_you_said.earned_points,
      sounded: score.sections.how_you_sounded.earned_points,
      metrics: Object.fromEntries(
        Object.entries({
          ...score.sections.what_you_said.metrics,
          ...score.sections.how_you_sounded.metrics,
        }).map(([id, result]) => [id, result.earned_points]),
      ),
    })

    expect(scoreShape(after)).toEqual(scoreShape(before))
  })

  it('stores provider audit metadata without duplicating content metric payloads', () => {
    const evaluation = {
      version: V3_CONTENT_EVALUATOR_VERSION,
      provider: 'deepseek-v4-flash',
      status: 'checked',
      metrics: {},
      warnings: [],
      calls: 1,
    } as unknown as V3ContentEvaluation

    const persisted = v3ContentAuditResult(evaluation, 'deepseek-v4-flash')
    expect(persisted).toEqual({
      version: V3_CONTENT_AUDIT_VERSION,
      evaluator_version: V3_CONTENT_EVALUATOR_VERSION,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      status: 'checked',
      calls: 1,
    })
    expect(persisted).not.toHaveProperty('metrics')
    expect(persisted).not.toHaveProperty('warnings')
  })
})
