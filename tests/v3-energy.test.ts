import { describe, expect, it } from 'vitest'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import {
  AUDIO_THRESHOLDS_BY_MODE,
  ENERGY_SUBCOMPONENT_WEIGHTS,
  energyCadenceSignal,
  energyComponent,
  energyMonotonySignal,
  energyPitchSignals,
  pitchRangeComponent,
  pitchVariationComponent,
} from '@/lib/scoring/v3/audio'
import { V3_MODE_CONFIGS } from '@/lib/scoring/v3/config'
import { runV3EnergyCalibration } from '@/lib/scoring/v3/energy-calibration'

function hertzFromSemitones(offsets: readonly number[], repeats = 8): number[] {
  return Array.from({ length: offsets.length * repeats }, (_value, index) => {
    const offset = offsets[index % offsets.length]!
    return 120 * 2 ** (offset / 12)
  })
}

function timedWords(
  durationsMs: readonly number[],
  options: { scale?: number; gapAfter?: Readonly<Record<number, number>> } = {},
): TranscriptWord[] {
  const scale = options.scale ?? 1
  let cursorMs = 0
  return durationsMs.map((duration, index) => {
    const start = cursorMs / 1_000
    const endMs = cursorMs + duration * scale
    cursorMs = endMs + 80 * scale + (options.gapAfter?.[index] ?? 0)
    return {
      word: `word${index}`,
      start,
      end: endMs / 1_000,
      confidence: 0.96,
    }
  })
}

describe('v3 Energy pitch range', () => {
  it('separates narrow, moderate, and wide central pitch ranges', () => {
    const narrow = energyPitchSignals(hertzFromSemitones([-0.2, 0, 0.2]))!
    const moderate = energyPitchSignals(hertzFromSemitones([-2.5, -1, 0, 1, 2.5]))!
    const wide = energyPitchSignals(hertzFromSemitones([-4, -2, 0, 2, 4]))!

    expect(narrow.pitch_range_semitones).toBeLessThan(1)
    expect(moderate.pitch_range_semitones).toBeGreaterThan(3)
    expect(wide.pitch_range_semitones).toBeGreaterThan(moderate.pitch_range_semitones)
    expect(pitchRangeComponent(narrow.pitch_range_semitones, 'practice')).toBe(0)
    expect(pitchRangeComponent(moderate.pitch_range_semitones, 'practice')).toBeGreaterThan(0)
    expect(pitchRangeComponent(wide.pitch_range_semitones, 'practice')).toBe(1)
  })

  it('does not let one extreme detector outlier inflate the percentile range', () => {
    const ordinary = hertzFromSemitones([-1, -0.5, 0, 0.5, 1], 12)
    const withOutlier = [...ordinary]
    withOutlier[Math.floor(withOutlier.length / 2)] = 350

    expect(energyPitchSignals(withOutlier)!.pitch_range_semitones).toBeCloseTo(
      energyPitchSignals(ordinary)!.pitch_range_semitones,
      6,
    )
  })
})

describe('v3 Energy pitch variation', () => {
  it('separates tightly clustered, moderate, and highly varied pitch', () => {
    const tight = energyPitchSignals(hertzFromSemitones([-0.2, 0, 0.2]))!
    const moderate = energyPitchSignals(hertzFromSemitones([-1.5, -0.5, 0.5, 1.5]))!
    const high = energyPitchSignals(hertzFromSemitones([-3, -1.5, 1.5, 3]))!

    expect(tight.pitch_variation_semitones).toBeLessThan(moderate.pitch_variation_semitones)
    expect(moderate.pitch_variation_semitones).toBeLessThan(high.pitch_variation_semitones)
    expect(pitchVariationComponent(tight.pitch_variation_semitones, 'practice')).toBe(0)
    expect(pitchVariationComponent(moderate.pitch_variation_semitones, 'practice')).toBeGreaterThan(
      0,
    )
    expect(pitchVariationComponent(high.pitch_variation_semitones, 'practice')).toBe(1)
  })
})

describe('v3 Energy temporal monotony', () => {
  it('keeps a mostly flat response weak even with one isolated pitch jump', () => {
    const flat = Array.from({ length: 60 }, () => 0)
    const oneJump = [...flat]
    oneJump[30] = 7

    expect(energyMonotonySignal(flat, 'practice')).toMatchObject({
      flat_window_count: 6,
      flat_window_indices: [0, 1, 2, 3, 4, 5],
      flat_window_proportion: 1,
      component: 0,
    })
    expect(energyMonotonySignal(oneJump, 'practice')).toMatchObject({
      flat_window_count: 6,
      flat_window_proportion: 1,
      component: 0,
    })
  })

  it('recognizes consistent local variation across multiple temporal regions', () => {
    const varied = Array.from({ length: 60 }, (_value, index) => [-2, 0, 2][index % 3]!)
    const partlyVaried = [
      ...Array.from({ length: 20 }, (_value, index) => [-2, 0, 2][index % 3]!),
      ...Array.from({ length: 40 }, () => 0),
    ]

    expect(energyMonotonySignal(varied, 'practice')).toMatchObject({
      flat_window_count: 0,
      flat_window_proportion: 0,
      component: 1,
    })
    const partial = energyMonotonySignal(partlyVaried, 'practice')!
    expect(partial.flat_window_count).toBeGreaterThan(0)
    expect(partial.flat_window_count).toBeLessThan(partial.window_count)
    expect(partial.component).toBeGreaterThan(0)
    expect(partial.component).toBeLessThan(1)
  })

  it('detects flat temporal regions even when a single sustained shift makes global pitch broad', () => {
    const steppedHertz = [...hertzFromSemitones([-3], 30), ...hertzFromSemitones([3], 30)]
    const pitch = energyPitchSignals(steppedHertz)!
    const monotony = energyMonotonySignal(pitch.semitone_values, 'practice')!

    expect(pitchRangeComponent(pitch.pitch_range_semitones, 'practice')).toBe(1)
    expect(pitchVariationComponent(pitch.pitch_variation_semitones, 'practice')).toBe(1)
    expect(monotony.component).toBe(0)
  })
})

describe('v3 Energy rhythm and cadence', () => {
  const uniform = [220, 220, 220, 220, 220, 220, 220, 220, 220, 220]
  const natural = [150, 170, 210, 300, 340, 280, 180, 140, 220, 310]

  it('separates mechanically uniform from naturally varied active-speech timing', () => {
    expect(energyCadenceSignal(timedWords(uniform), 'practice')?.component).toBe(0)
    expect(energyCadenceSignal(timedWords(natural), 'practice')?.component).toBeGreaterThan(0.5)
  })

  it('is invariant to uniformly fast or slow speech', () => {
    const fast = energyCadenceSignal(timedWords(natural, { scale: 0.55 }), 'practice')!
    const slow = energyCadenceSignal(timedWords(natural, { scale: 1.8 }), 'practice')!

    expect(fast.cadence_log_spread).toBeCloseTo(slow.cadence_log_spread, 10)
    expect(fast.component).toBeCloseTo(slow.component, 10)
  })

  it('ignores long interword pauses because Paused Time owns silence', () => {
    const ordinary = energyCadenceSignal(timedWords(natural), 'practice')!
    const longPauses = energyCadenceSignal(
      timedWords(natural, { gapAfter: { 2: 4_000, 6: 3_000 } }),
      'practice',
    )!

    expect(longPauses.cadence_log_spread).toBeCloseTo(ordinary.cadence_log_spread, 10)
    expect(longPauses.component).toBeCloseTo(ordinary.component, 10)
  })
})

describe('v3 Energy composite', () => {
  it('uses four centralized weights that sum to one', () => {
    expect(ENERGY_SUBCOMPONENT_WEIGHTS).toEqual({
      pitch_range: 0.2,
      pitch_variation: 0.3,
      non_monotony: 0.3,
      rhythm_cadence: 0.2,
    })
    expect(Object.values(ENERGY_SUBCOMPONENT_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(
      1,
    )
  })

  it('combines weak and strong signal mixes intuitively', () => {
    expect(
      energyComponent({
        pitch_range: 0,
        pitch_variation: 0,
        non_monotony: 0,
        rhythm_cadence: 0,
      }),
    ).toBe(0)
    expect(
      energyComponent({
        pitch_range: 1,
        pitch_variation: 1,
        non_monotony: 1,
        rhythm_cadence: 1,
      }),
    ).toBe(1)
    expect(
      energyComponent({
        pitch_range: 1.1,
        pitch_variation: 1,
        non_monotony: 1,
        rhythm_cadence: 1,
      }),
    ).toBeNull()

    const strongRangePoorMonotony = energyComponent({
      pitch_range: 1,
      pitch_variation: 0.8,
      non_monotony: 0,
      rhythm_cadence: 0.7,
    })!
    const strongVariationWeakCadence = energyComponent({
      pitch_range: 0.8,
      pitch_variation: 1,
      non_monotony: 0.8,
      rhythm_cadence: 0,
    })!
    const strongCadenceFlatPitch = energyComponent({
      pitch_range: 0,
      pitch_variation: 0,
      non_monotony: 0,
      rhythm_cadence: 1,
    })!

    expect(strongRangePoorMonotony).toBeLessThan(0.7)
    expect(strongVariationWeakCadence).toBeLessThan(0.8)
    expect(strongCadenceFlatPitch).toBe(0.2)
  })

  it('keeps Energy points and the How You Sounded total unchanged by mode', () => {
    expect(
      Object.fromEntries(
        Object.entries(V3_MODE_CONFIGS).map(([mode, value]) => [
          mode,
          value.sections.how_you_sounded.energy,
        ]),
      ),
    ).toEqual({
      practice: 10,
      interview: 10,
      presentation: 15,
      conversation: 10,
    })
    for (const config of Object.values(V3_MODE_CONFIGS)) {
      expect(
        Object.values(config.sections.how_you_sounded).reduce((sum, value) => sum + value, 0),
      ).toBe(50)
    }
  })

  it('publishes valid centralized mode thresholds', () => {
    expect(AUDIO_THRESHOLDS_BY_MODE.presentation.energy.pitch_range).not.toEqual(
      AUDIO_THRESHOLDS_BY_MODE.conversation.energy.pitch_range,
    )
  })

  it('keeps the deterministic calibration fixture set within reviewed ranges', () => {
    const calibration = runV3EnergyCalibration()

    expect(calibration.ok, calibration.report).toBe(true)
    expect(calibration.results.map((result) => result.id)).toEqual([
      'monotone_speech',
      'restrained_natural_speech',
      'naturally_expressive_speech',
      'exaggerated_pitch_movement',
      'rhythmically_robotic_speech',
    ])
    const natural = calibration.results.find(
      (result) => result.id === 'naturally_expressive_speech',
    )
    const exaggerated = calibration.results.find(
      (result) => result.id === 'exaggerated_pitch_movement',
    )
    expect(exaggerated?.component).toBe(natural?.component)
  })
})
