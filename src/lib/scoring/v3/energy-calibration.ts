import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { PracticeMode } from '@/lib/practice/contracts'
import {
  energyCadenceSignal,
  energyComponent,
  energyMonotonySignal,
  energyPitchSignals,
  pitchRangeComponent,
  pitchVariationComponent,
  type EnergySubcomponents,
} from '@/lib/scoring/v3/audio'

export interface V3EnergyCalibrationFixture {
  id: string
  mode: PracticeMode
  pitch_semitone_pattern: readonly number[]
  word_duration_pattern_ms: readonly number[]
  expected_component: readonly [minimum: number, maximum: number]
}

export const V3_ENERGY_CALIBRATION_FIXTURES: readonly V3EnergyCalibrationFixture[] = Object.freeze([
  {
    id: 'monotone_speech',
    mode: 'practice',
    pitch_semitone_pattern: [0],
    word_duration_pattern_ms: [220],
    expected_component: [0, 0.05],
  },
  {
    id: 'restrained_natural_speech',
    mode: 'practice',
    pitch_semitone_pattern: [-1.5, -0.5, 0.3, 1.4, -0.2, 0.8],
    word_duration_pattern_ms: [180, 210, 260, 230, 170, 150, 240, 320, 270, 190],
    expected_component: [0.5, 0.65],
  },
  {
    id: 'naturally_expressive_speech',
    mode: 'practice',
    pitch_semitone_pattern: [-3, -1, 1, 3],
    word_duration_pattern_ms: [150, 170, 210, 300, 340, 280, 180, 140, 220, 310],
    expected_component: [0.95, 1],
  },
  {
    id: 'exaggerated_pitch_movement',
    mode: 'practice',
    pitch_semitone_pattern: [-7, -3, 3, 7],
    word_duration_pattern_ms: [150, 170, 210, 300, 340, 280, 180, 140, 220, 310],
    expected_component: [0.95, 1],
  },
  {
    id: 'rhythmically_robotic_speech',
    mode: 'practice',
    pitch_semitone_pattern: [-3, -1, 1, 3],
    word_duration_pattern_ms: [220],
    expected_component: [0.75, 0.8],
  },
])

function calibrationPitch(pattern: readonly number[]): number[] {
  return Array.from({ length: 60 }, (_value, index) => {
    const semitones = pattern[index % pattern.length]!
    return 120 * 2 ** (semitones / 12)
  })
}

function calibrationWords(pattern: readonly number[]): TranscriptWord[] {
  let cursorMs = 0
  return Array.from({ length: 10 }, (_value, index) => {
    const durationMs = pattern[index % pattern.length]!
    const word = {
      word: `word${index}`,
      start: cursorMs / 1_000,
      end: (cursorMs + durationMs) / 1_000,
      confidence: 0.96,
    }
    cursorMs += durationMs + 80
    return word
  })
}

export interface V3EnergyCalibrationResult {
  id: string
  component: number | null
  subcomponents: EnergySubcomponents | null
  expected_component: readonly [minimum: number, maximum: number]
  inside: boolean
}

export function evaluateV3EnergyCalibrationFixture(
  fixture: V3EnergyCalibrationFixture,
): V3EnergyCalibrationResult {
  const pitch = energyPitchSignals(calibrationPitch(fixture.pitch_semitone_pattern))
  const monotony = pitch ? energyMonotonySignal(pitch.semitone_values, fixture.mode) : null
  const cadence = energyCadenceSignal(
    calibrationWords(fixture.word_duration_pattern_ms),
    fixture.mode,
  )
  if (!pitch || !monotony || !cadence) {
    return {
      id: fixture.id,
      component: null,
      subcomponents: null,
      expected_component: fixture.expected_component,
      inside: false,
    }
  }
  const subcomponents: EnergySubcomponents = {
    pitch_range: pitchRangeComponent(pitch.pitch_range_semitones, fixture.mode),
    pitch_variation: pitchVariationComponent(pitch.pitch_variation_semitones, fixture.mode),
    non_monotony: monotony.component,
    rhythm_cadence: cadence.component,
  }
  const component = energyComponent(subcomponents)
  const [minimum, maximum] = fixture.expected_component
  return {
    id: fixture.id,
    component,
    subcomponents,
    expected_component: fixture.expected_component,
    inside: component !== null && component >= minimum && component <= maximum,
  }
}

export function runV3EnergyCalibration(): {
  ok: boolean
  results: readonly V3EnergyCalibrationResult[]
  report: string
} {
  const results = V3_ENERGY_CALIBRATION_FIXTURES.map(evaluateV3EnergyCalibrationFixture)
  return {
    ok: results.every((result) => result.inside),
    results,
    report: results
      .map((result) => {
        const measured = result.component === null ? 'UNAVAILABLE' : result.component.toFixed(3)
        const [minimum, maximum] = result.expected_component
        return `${result.inside ? 'PASS' : 'DRIFT'} ${result.id}: ${measured} expected ${minimum.toFixed(2)}-${maximum.toFixed(2)}`
      })
      .join('\n'),
  }
}
