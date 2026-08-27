import { median, medianAbsoluteDeviation, ramp } from '@/lib/scoring/scale'
import type { ScoreEvidence } from '@/lib/scoring/v2/contracts'
import { AUDIO_MILLISECOND_COORDINATE } from '@/lib/scoring/v2/evidence'
import { evaluateDelivery, type DeliveryEvaluation } from '@/lib/scoring/v2/delivery'
import type { CaptureMetrics } from '@/lib/types/metrics'

export const DELIVERY_EVALUATOR_NEXT_VERSION = 'v2.delivery.2' as const

const PITCH_WEIGHT = 0.75
const VOLUME_WEIGHT = 0.25
const MIN_MATCHED_VOLUME_FRAMES = 40
const MIN_MATCHED_VOLUME_RATIO = 0.8
const FULL_VOLUME_STABILITY_MAD = 0.12
const ZERO_VOLUME_STABILITY_MAD = 0.65

export interface DeliveryNextMeasurements {
  pitch_spread_semitones: number | null
  voiced_frames: number
  voiced_amplitude_relative_mad: number | null
  matched_volume_frames: number
  volume_stability_component: number | null
}

export interface DeliveryNextDeduction {
  check: 'pitch_variation' | 'volume_stability'
  component_reduction: number
  detail: string
}

export interface DeliveryNextEvaluation extends Omit<
  DeliveryEvaluation,
  'measurements' | 'deductions'
> {
  evaluator_version: typeof DELIVERY_EVALUATOR_NEXT_VERSION
  measurements: DeliveryNextMeasurements
  deductions: readonly DeliveryNextDeduction[]
}

function measurements(
  base: DeliveryEvaluation,
  matchedVolumeFrames = 0,
  relativeMad: number | null = null,
  volumeComponent: number | null = null,
): DeliveryNextMeasurements {
  return {
    pitch_spread_semitones: base.measurements.pitch_spread_semitones,
    voiced_frames: base.measurements.voiced_frames,
    voiced_amplitude_relative_mad: relativeMad,
    matched_volume_frames: matchedVolumeFrames,
    volume_stability_component: volumeComponent,
  }
}

function unavailableFromBase(base: DeliveryEvaluation): DeliveryNextEvaluation {
  return {
    ...base,
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    measurements: measurements(base),
    deductions: [],
  }
}

function matchedVoicedAmplitude(capture: CaptureMetrics): number[] {
  const tolerance = capture.sample_interval_ms
  const matched: number[] = []
  let amplitudeIndex = 0
  for (const pitch of capture.pitch) {
    while (
      amplitudeIndex + 1 < capture.amplitude.length &&
      Math.abs(capture.amplitude[amplitudeIndex + 1]!.t_ms - pitch.t_ms) <
        Math.abs(capture.amplitude[amplitudeIndex]!.t_ms - pitch.t_ms)
    ) {
      amplitudeIndex += 1
    }
    const sample = capture.amplitude[amplitudeIndex]
    if (
      sample &&
      Math.abs(sample.t_ms - pitch.t_ms) <= tolerance &&
      Number.isFinite(sample.rms) &&
      sample.rms > 0
    ) {
      matched.push(sample.rms)
    }
  }
  return matched
}

/**
 * Opt-in next-version Delivery evaluator. The current evaluateDelivery export
 * remains the historical v2 meaning until a version registry selects this
 * explicit evaluator version.
 */
export function evaluateDeliveryNext(capture: CaptureMetrics): DeliveryNextEvaluation {
  const base = evaluateDelivery(capture)
  if (base.status !== 'scored' || base.component === null) return unavailableFromBase(base)

  const voicedAmplitude = matchedVoicedAmplitude(capture)
  const minimumMatched = Math.max(
    MIN_MATCHED_VOLUME_FRAMES,
    Math.ceil(capture.pitch.length * MIN_MATCHED_VOLUME_RATIO),
  )
  if (voicedAmplitude.length < minimumMatched) {
    return {
      ...base,
      evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
      status: 'not_checked',
      component: null,
      measurements: measurements(base, voicedAmplitude.length),
      evidence: [],
      deductions: [],
      warnings: [
        ...base.warnings,
        'Delivery was not checked because voiced volume evidence was insufficient.',
      ],
    }
  }

  const centre = median(voicedAmplitude)
  if (!Number.isFinite(centre) || centre <= 0) {
    return {
      ...base,
      evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
      status: 'not_checked',
      component: null,
      measurements: measurements(base, voicedAmplitude.length),
      evidence: [],
      deductions: [],
      warnings: [...base.warnings, 'Delivery was not checked because volume evidence was invalid.'],
    }
  }

  const relativeMad = medianAbsoluteDeviation(voicedAmplitude.map((rms) => Math.log(rms / centre)))
  if (!Number.isFinite(relativeMad)) {
    return {
      ...base,
      evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
      status: 'not_checked',
      component: null,
      measurements: measurements(base, voicedAmplitude.length),
      evidence: [],
      deductions: [],
      warnings: [...base.warnings, 'Delivery was not checked because volume evidence was invalid.'],
    }
  }

  const volumeComponent = ramp(relativeMad, FULL_VOLUME_STABILITY_MAD, ZERO_VOLUME_STABILITY_MAD)
  const component = base.component * PITCH_WEIGHT + volumeComponent * VOLUME_WEIGHT
  const evidence: ScoreEvidence[] = [
    ...base.evidence.filter((item) => item.detail.startsWith('Pitch spread was')),
    {
      source: 'audio_timeline',
      start: capture.pitch[0]?.t_ms ?? null,
      end: capture.pitch.at(-1)?.t_ms ?? null,
      coordinate: AUDIO_MILLISECOND_COORDINATE,
      quote: null,
      detail: `Voiced volume variation was ${relativeMad.toFixed(3)} across ${voicedAmplitude.length} matched frames.`,
    },
  ]
  const deductions: DeliveryNextDeduction[] = []
  if (base.component < 1) {
    deductions.push({
      check: 'pitch_variation',
      component_reduction: (1 - base.component) * PITCH_WEIGHT,
      detail: `Pitch variation measured ${(base.measurements.pitch_spread_semitones ?? 0).toFixed(2)} semitones.`,
    })
  }
  if (volumeComponent < 1) {
    deductions.push({
      check: 'volume_stability',
      component_reduction: (1 - volumeComponent) * VOLUME_WEIGHT,
      detail: `Voiced volume variation measured ${relativeMad.toFixed(3)}.`,
    })
  }

  return {
    category: 'delivery',
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    availability: 'available',
    status: 'scored',
    component,
    measurements: measurements(base, voicedAmplitude.length, relativeMad, volumeComponent),
    evidence,
    deductions,
    warnings: base.warnings,
  }
}
