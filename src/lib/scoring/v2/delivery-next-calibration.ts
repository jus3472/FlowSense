import {
  DELIVERY_EVALUATOR_NEXT_VERSION,
  evaluateDeliveryNext,
} from '@/lib/scoring/v2/delivery-next'
import type { CaptureMetrics } from '@/lib/types/metrics'

export const DELIVERY_NEXT_CALIBRATION_VERSION = 'v2.delivery.2.calibration.1' as const

export const DELIVERY_NEXT_CALIBRATION_LABELS = [
  'varied-stable',
  'flat-stable',
  'varied-unstable',
  'octave-artifact',
  'quiet',
  'throttled',
] as const
export type DeliveryNextCalibrationLabel = (typeof DELIVERY_NEXT_CALIBRATION_LABELS)[number]

export interface DeliveryNextCalibrationSnapshot {
  calibration_version: typeof DELIVERY_NEXT_CALIBRATION_VERSION
  evaluator_version: typeof DELIVERY_EVALUATOR_NEXT_VERSION
  status: 'scored' | 'not_checked' | 'unavailable'
  component: number | null
  pitch_spread_semitones: number | null
  voiced_amplitude_relative_mad: number | null
  matched_volume_frames: number
}

function capture(label: DeliveryNextCalibrationLabel): CaptureMetrics {
  const interval = 50
  const frameCount = 80
  const flatPitch = Array.from({ length: frameCount }, () => 120)
  const variedPitch = Array.from({ length: frameCount }, (_value, index) =>
    index % 2 === 0 ? 100 : 145,
  )
  const pitch = label === 'flat-stable' || label === 'octave-artifact' ? flatPitch : variedPitch
  if (label === 'octave-artifact') {
    for (let index = 0; index < pitch.length; index += 8) pitch[index] = 240
  }
  let amplitude = Array.from({ length: frameCount }, (_value, index) => ({
    t_ms: index * interval,
    rms:
      label === 'quiet' ? 0 : label === 'varied-unstable' ? (index % 2 === 0 ? 0.02 : 0.3) : 0.12,
  }))
  if (label === 'throttled') {
    amplitude = amplitude.filter((sample) => sample.t_ms < 1_000 || sample.t_ms > 1_500)
  }
  return {
    mime_type: 'audio/webm;codecs=opus',
    started_at: '2026-08-26T12:00:00.000Z',
    duration_ms: 4_000,
    sample_interval_ms: interval,
    amplitude,
    pitch: pitch.map((hz, index) => ({ t_ms: index * interval, hz })),
  }
}

function finite(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(6))
}

export function runDeliveryNextCalibrationCase(
  label: DeliveryNextCalibrationLabel,
): DeliveryNextCalibrationSnapshot {
  const result = evaluateDeliveryNext(capture(label))
  return {
    calibration_version: DELIVERY_NEXT_CALIBRATION_VERSION,
    evaluator_version: result.evaluator_version,
    status: result.status,
    component: finite(result.component),
    pitch_spread_semitones: finite(result.measurements.pitch_spread_semitones),
    voiced_amplitude_relative_mad: finite(result.measurements.voiced_amplitude_relative_mad),
    matched_volume_frames: result.measurements.matched_volume_frames,
  }
}

export const DELIVERY_NEXT_CALIBRATION_BASELINES: Readonly<
  Record<DeliveryNextCalibrationLabel, DeliveryNextCalibrationSnapshot>
> = {
  'varied-stable': {
    calibration_version: DELIVERY_NEXT_CALIBRATION_VERSION,
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    status: 'scored',
    component: 1,
    pitch_spread_semitones: 4.768512,
    voiced_amplitude_relative_mad: 0,
    matched_volume_frames: 80,
  },
  'flat-stable': {
    calibration_version: DELIVERY_NEXT_CALIBRATION_VERSION,
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    status: 'scored',
    component: 0.25,
    pitch_spread_semitones: 0,
    voiced_amplitude_relative_mad: 0,
    matched_volume_frames: 80,
  },
  'varied-unstable': {
    calibration_version: DELIVERY_NEXT_CALIBRATION_VERSION,
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    status: 'scored',
    component: 0.75,
    pitch_spread_semitones: 4.768512,
    voiced_amplitude_relative_mad: 2.007478,
    matched_volume_frames: 80,
  },
  'octave-artifact': {
    calibration_version: DELIVERY_NEXT_CALIBRATION_VERSION,
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    status: 'scored',
    component: 0.25,
    pitch_spread_semitones: 0,
    voiced_amplitude_relative_mad: 0,
    matched_volume_frames: 80,
  },
  quiet: {
    calibration_version: DELIVERY_NEXT_CALIBRATION_VERSION,
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    status: 'not_checked',
    component: null,
    pitch_spread_semitones: 4.768512,
    voiced_amplitude_relative_mad: null,
    matched_volume_frames: 0,
  },
  throttled: {
    calibration_version: DELIVERY_NEXT_CALIBRATION_VERSION,
    evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
    status: 'not_checked',
    component: null,
    pitch_spread_semitones: null,
    voiced_amplitude_relative_mad: null,
    matched_volume_frames: 0,
  },
}

export function runDeliveryNextCalibration(): {
  ok: boolean
  report: string
  differences: readonly string[]
} {
  const differences: string[] = []
  const lines = DELIVERY_NEXT_CALIBRATION_LABELS.map((label) => {
    const actual = runDeliveryNextCalibrationCase(label)
    const expected = DELIVERY_NEXT_CALIBRATION_BASELINES[label]
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      differences.push(
        `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      )
    }
    return `${differences.at(-1)?.startsWith(`${label}:`) ? 'DRIFT' : 'PASS'} ${label} component=${actual.component ?? 'unavailable'}`
  })
  return { ok: differences.length === 0, report: lines.join('\n'), differences }
}
