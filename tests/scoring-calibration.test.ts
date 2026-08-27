import {
  CALIBRATION_BASELINES,
  CALIBRATION_FIXTURES,
  CALIBRATION_LABELS,
  compareCalibration,
  runCalibrationFixture,
} from '@/lib/scoring/v2/calibration'
import { describe, expect, it } from 'vitest'

describe('v2 scoring calibration corpus', () => {
  it('covers all required generated behavior labels', () =>
    expect(CALIBRATION_FIXTURES.map((item) => item.id)).toEqual(CALIBRATION_LABELS))
  it('is deterministic and matches its versioned baselines', () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      expect(compareCalibration(fixture, CALIBRATION_BASELINES[fixture.id])).toEqual([])
      expect(runCalibrationFixture(fixture)).toEqual(runCalibrationFixture(fixture))
    }
  })
  it('reports mutations and missing or incompatible baselines clearly', () => {
    const fixture = CALIBRATION_FIXTURES[0]!
    expect(
      compareCalibration(fixture, { ...CALIBRATION_BASELINES[fixture.id]!, categories: [] })[0],
    ).toContain('->')
    expect(compareCalibration(fixture, undefined)[0]).toContain('missing baseline')
    expect(
      compareCalibration(fixture, {
        ...CALIBRATION_BASELINES[fixture.id]!,
        scoreVersion: 'other' as never,
      })[0],
    ).toContain('incompatible baseline')
  })
  it('keeps unclear pronunciation and intelligible accents non-deductible', () => {
    for (const id of ['unclear-pronunciation', 'intelligible-second-language-accent'] as const)
      expect(
        CALIBRATION_FIXTURES.find((item) => item.id === id)?.pronunciation?.eligibleForDeductions,
      ).toBe(false)
  })
})
