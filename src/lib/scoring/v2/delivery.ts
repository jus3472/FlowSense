import { analyseEnergy, MIN_VOICED_FRAMES } from '@/lib/scoring/energy'
import { median, medianAbsoluteDeviation } from '@/lib/scoring/scale'
import type { ScoreEvidence, ScoreStatus } from '@/lib/scoring/v2/contracts'
import type { AmplitudeSample, CaptureMetrics, PitchSample } from '@/lib/types/metrics'

const MIN_AMPLITUDE_FRAMES = 40
const MAX_CAPTURE_GAP_MS = 300

export interface DeliveryMeasurements {
  pitch_spread_semitones: number | null
  voiced_frames: number
  amplitude_relative_mad: number | null
  amplitude_frames: number
}

export interface DeliveryDeduction {
  check: 'pitch_variation'
  component_reduction: number
  detail: string
}

/**
 * A local v2 category result. It intentionally has no weighted points: the
 * eventual v2 assembler owns category weights and stored result shaping.
 */
export interface DeliveryEvaluation {
  category: 'delivery'
  availability: 'available' | 'unavailable'
  status: ScoreStatus
  component: number | null
  measurements: DeliveryMeasurements
  evidence: readonly ScoreEvidence[]
  deductions: readonly DeliveryDeduction[]
  warnings: readonly string[]
}

function emptyMeasurements(): DeliveryMeasurements {
  return {
    pitch_spread_semitones: null,
    voiced_frames: 0,
    amplitude_relative_mad: null,
    amplitude_frames: 0,
  }
}

function notChecked(warning: string, measurements = emptyMeasurements()): DeliveryEvaluation {
  return {
    category: 'delivery',
    availability: 'available',
    status: 'not_checked',
    component: null,
    measurements,
    evidence: [],
    deductions: [],
    warnings: [warning],
  }
}

function validTimeline<T extends { t_ms: number }>(
  samples: readonly T[],
  durationMs: number,
): boolean {
  let previous = -1
  for (const sample of samples) {
    if (!Number.isFinite(sample.t_ms) || sample.t_ms < 0 || sample.t_ms > durationMs) return false
    if (sample.t_ms <= previous) return false
    previous = sample.t_ms
  }
  return true
}

function hasSamplingGap(samples: readonly AmplitudeSample[]): boolean {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    if (previous && current && current.t_ms - previous.t_ms > MAX_CAPTURE_GAP_MS) return true
  }
  return false
}

function validAmplitude(samples: readonly AmplitudeSample[], durationMs: number): boolean {
  return (
    validTimeline(samples, durationMs) &&
    samples.every((sample) => Number.isFinite(sample.rms) && sample.rms >= 0)
  )
}

function validPitch(samples: readonly PitchSample[], durationMs: number): boolean {
  return (
    validTimeline(samples, durationMs) &&
    samples.every((sample) => Number.isFinite(sample.hz) && sample.hz > 0)
  )
}

/**
 * Evaluates only recorded vocal evidence. Filler, pause, onset, and speaking
 * rate are deliberately absent so this category cannot charge them twice.
 */
export function evaluateDelivery(capture: CaptureMetrics): DeliveryEvaluation {
  const amplitudeFrames = capture.amplitude.length
  const voicedFrames = capture.pitch.length
  const measurements: DeliveryMeasurements = {
    ...emptyMeasurements(),
    voiced_frames: voicedFrames,
    amplitude_frames: amplitudeFrames,
  }

  if (!Number.isFinite(capture.duration_ms) || capture.duration_ms <= 0) {
    return notChecked(
      'Delivery was not checked because the recording duration was invalid.',
      measurements,
    )
  }
  if (
    !validAmplitude(capture.amplitude, capture.duration_ms) ||
    !validPitch(capture.pitch, capture.duration_ms)
  ) {
    return notChecked(
      'Delivery was not checked because the capture timeline was invalid.',
      measurements,
    )
  }
  if (amplitudeFrames < MIN_AMPLITUDE_FRAMES || voicedFrames < MIN_VOICED_FRAMES) {
    return notChecked(
      'Delivery was not checked because there were too few captured voiced frames.',
      measurements,
    )
  }
  if (hasSamplingGap(capture.amplitude)) {
    return notChecked(
      'Delivery was not checked because capture sampling was interrupted.',
      measurements,
    )
  }

  // The legacy helper supplies octave correction and robust MAD. Unlike legacy
  // scoring, its insufficient-audio fallback is never treated as a perfect result.
  const pitch = analyseEnergy(capture.pitch)
  if (!pitch.enough_audio) {
    return notChecked(
      'Delivery was not checked because there were too few voiced frames.',
      measurements,
    )
  }

  const activeAmplitude = capture.amplitude.map((sample) => sample.rms).filter((rms) => rms > 0)
  const amplitudeRelativeMad =
    activeAmplitude.length >= MIN_AMPLITUDE_FRAMES
      ? medianAbsoluteDeviation(
          activeAmplitude.map((rms) => Math.log(rms / median(activeAmplitude))),
        )
      : null
  measurements.pitch_spread_semitones = pitch.semitones
  measurements.amplitude_relative_mad = amplitudeRelativeMad

  const evidence: ScoreEvidence[] = [
    {
      source: 'audio_timeline',
      start: capture.pitch[0]?.t_ms ?? null,
      end: capture.pitch.at(-1)?.t_ms ?? null,
      quote: null,
      detail: `Pitch spread was ${pitch.semitones.toFixed(2)} semitones across ${pitch.voiced_frames} voiced frames.`,
    },
  ]
  const warnings: string[] = []
  if (amplitudeRelativeMad === null) {
    warnings.push(
      'Volume stability was not checked because too few active amplitude frames were captured.',
    )
  } else {
    evidence.push({
      source: 'audio_timeline',
      start: capture.amplitude[0]?.t_ms ?? null,
      end: capture.amplitude.at(-1)?.t_ms ?? null,
      quote: null,
      detail: `Relative volume variation was ${amplitudeRelativeMad.toFixed(3)} across active frames.`,
    })
  }

  const deductions: DeliveryDeduction[] =
    pitch.component < 1
      ? [
          {
            check: 'pitch_variation',
            component_reduction: 1 - pitch.component,
            detail: `Pitch variation measured ${pitch.semitones.toFixed(2)} semitones.`,
          },
        ]
      : []

  return {
    category: 'delivery',
    availability: 'available',
    status: 'scored',
    component: pitch.component,
    measurements,
    evidence,
    deductions,
    warnings,
  }
}
