import rawCorpus from '../fixtures/scoring/phase1-calibration.json'

import { PRACTICE_MODES, SKILL_CATEGORIES } from '@/lib/practice/contracts'
import {
  EXPECTATION_LEVELS,
  REVIEWED_CALIBRATION_CORPUS,
  REVIEWED_SCENARIOS,
  evaluateReviewedCalibrationCorpus,
  evaluateReviewedRange,
  parseReviewedCalibrationCorpus,
  parseReviewedScoreRange,
  runReviewedCalibrationFixture,
  type ReviewedCalibrationCorpus,
} from '@/lib/scoring/v2/calibration-reviewed'
import { describe, expect, it } from 'vitest'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected mutable test object.')
  }
  return value as Record<string, unknown>
}

function mutableRawCorpus(): Record<string, unknown> {
  return object(structuredClone(rawCorpus))
}

function rawFixtures(corpus: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(corpus.fixtures)) throw new Error('Expected raw fixture array.')
  return corpus.fixtures.map(object)
}

function rawExpectations(fixture: Record<string, unknown>): Record<string, unknown> {
  return object(fixture.expectations)
}

function rawRange(
  fixture: Record<string, unknown>,
  category: (typeof SKILL_CATEGORIES)[number],
): Record<string, unknown> {
  return object(rawExpectations(fixture)[category])
}

function clonedCorpus(): ReviewedCalibrationCorpus {
  return structuredClone(REVIEWED_CALIBRATION_CORPUS)
}

describe('reviewed calibration fixture parsing', () => {
  it('parses the checked-in generated corpus with every required mode and scenario', () => {
    const parsed = parseReviewedCalibrationCorpus(rawCorpus)
    expect(parsed.fixtures).toHaveLength(18)
    expect(new Set(parsed.fixtures.map((fixture) => fixture.mode))).toEqual(new Set(PRACTICE_MODES))
    expect(new Set(parsed.fixtures.map((fixture) => fixture.scenario))).toEqual(
      new Set(REVIEWED_SCENARIOS),
    )
    expect(parsed.fixtures.filter((fixture) => fixture.kind === 'reference')).toHaveLength(4)
    expect(parsed.fixtures.filter((fixture) => fixture.kind === 'weakness')).toHaveLength(9)
    expect(parsed.fixtures.filter((fixture) => fixture.kind === 'fairness')).toHaveLength(5)
    for (const mode of PRACTICE_MODES) {
      expect(
        parsed.fixtures.some(
          (fixture) => fixture.mode === mode && fixture.scenario === 'strong_response',
        ),
      ).toBe(true)
    }
    expect(
      new Set(
        parsed.fixtures.flatMap((fixture) =>
          SKILL_CATEGORIES.map((category) => fixture.expectations[category].level),
        ),
      ),
    ).toEqual(new Set(EXPECTATION_LEVELS))
  })

  it('accepts inclusive finite ranges and rejects malformed range definitions', () => {
    expect(parseReviewedScoreRange({ min: 0, max: 100, level: 'strict' })).toEqual({
      min: 0,
      max: 100,
      level: 'strict',
    })
    expect(() => parseReviewedScoreRange({ min: 80, max: 20, level: 'strict' })).toThrow(
      'minimum cannot exceed maximum',
    )
    expect(() => parseReviewedScoreRange({ min: -1, max: 20, level: 'strict' })).toThrow(
      'finite number from 0 through 100',
    )
    expect(() => parseReviewedScoreRange({ min: 0, max: Number.NaN, level: 'strict' })).toThrow(
      'finite number from 0 through 100',
    )
    expect(() => parseReviewedScoreRange({ min: 0, max: 20, level: 'advisory' })).toThrow(
      'expected one of strict, broad, informational',
    )
  })

  it('rejects duplicate IDs, unknown modes, and incomplete mode coverage', () => {
    const duplicate = mutableRawCorpus()
    const duplicateFixtures = rawFixtures(duplicate)
    duplicateFixtures[1]!.id = duplicateFixtures[0]!.id
    expect(() => parseReviewedCalibrationCorpus(duplicate)).toThrow('duplicate fixture id')

    const unknownMode = mutableRawCorpus()
    rawFixtures(unknownMode)[0]!.mode = 'general'
    expect(() => parseReviewedCalibrationCorpus(unknownMode)).toThrow(
      'expected one of practice, interview, presentation, conversation',
    )

    const missingMode = mutableRawCorpus()
    missingMode.fixtures = rawFixtures(missingMode).filter(
      (fixture) => fixture.mode !== 'conversation',
    )
    expect(() => parseReviewedCalibrationCorpus(missingMode)).toThrow('missing mode conversation')
  })

  it('rejects missing or extra category expectations and invalid bounds', () => {
    const missing = mutableRawCorpus()
    delete rawExpectations(rawFixtures(missing)[0]!).delivery
    expect(() => parseReviewedCalibrationCorpus(missing)).toThrow(
      'expected exactly clarity, delivery, fluency, grammar, structure, vocabulary',
    )

    const extra = mutableRawCorpus()
    rawExpectations(rawFixtures(extra)[0]!).tone = {
      min: 0,
      max: 100,
      level: 'informational',
    }
    expect(() => parseReviewedCalibrationCorpus(extra)).toThrow(
      'expected exactly clarity, delivery, fluency, grammar, structure, vocabulary',
    )

    const outOfBounds = mutableRawCorpus()
    rawRange(rawFixtures(outOfBounds)[0]!, 'fluency').max = 101
    expect(() => parseReviewedCalibrationCorpus(outOfBounds)).toThrow(
      'finite number from 0 through 100',
    )
  })
})

describe('reviewed calibration range evaluation', () => {
  const input = {
    fixtureId: 'fixture',
    mode: 'practice' as const,
    category: 'fluency' as const,
    earnedPoints: 11,
    maxPoints: 22,
  }

  it('treats both range boundaries as inside and reports values above and below', () => {
    const expectation = { min: 40, max: 60, level: 'broad' as const }
    expect(evaluateReviewedRange({ ...input, component: 0.4, expectation }).position).toBe('inside')
    expect(evaluateReviewedRange({ ...input, component: 0.6, expectation }).position).toBe('inside')
    expect(evaluateReviewedRange({ ...input, component: 0.61, expectation }).position).toBe('above')
    expect(evaluateReviewedRange({ ...input, component: 0.39, expectation }).position).toBe('below')
  })

  it('compares unrounded values and treats invalid components as unavailable', () => {
    const expectation = { min: 90, max: 100, level: 'strict' as const }
    expect(evaluateReviewedRange({ ...input, component: 0.899_999, expectation })).toMatchObject({
      actual: 89.9999,
      position: 'below',
      blocks: true,
    })
    for (const component of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(evaluateReviewedRange({ ...input, component, expectation })).toMatchObject({
        actual: null,
        position: 'unavailable',
        blocks: true,
      })
    }
  })

  it('blocks only strict misses or unavailable strict results', () => {
    expect(
      evaluateReviewedRange({
        ...input,
        component: 0.8,
        expectation: { min: 40, max: 60, level: 'strict' },
      }),
    ).toMatchObject({ position: 'above', blocks: true })
    expect(
      evaluateReviewedRange({
        ...input,
        component: null,
        expectation: { min: 40, max: 60, level: 'strict' },
      }),
    ).toMatchObject({ position: 'unavailable', blocks: true })
    for (const level of ['broad', 'informational'] as const) {
      expect(
        evaluateReviewedRange({
          ...input,
          component: 0.8,
          expectation: { min: 40, max: 60, level },
        }),
      ).toMatchObject({ position: 'above', blocks: false })
    }
  })

  it('keeps broad and informational observations nonblocking at corpus level', () => {
    const corpus = clonedCorpus()
    corpus.fixtures[0]!.expectations.fluency = {
      min: 0,
      max: 0,
      level: 'broad',
    }
    const result = evaluateReviewedCalibrationCorpus(corpus)
    expect(result.ok).toBe(true)
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fixtureId: corpus.fixtures[0]!.id,
          category: 'fluency',
          position: 'above',
          blocks: false,
        }),
      ]),
    )
  })

  it('makes a strict corpus miss blocking', () => {
    const corpus = clonedCorpus()
    corpus.fixtures[0]!.expectations.fluency = {
      min: 0,
      max: 0,
      level: 'strict',
    }
    const result = evaluateReviewedCalibrationCorpus(corpus)
    expect(result.ok).toBe(false)
    expect(result.strictFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fixtureId: corpus.fixtures[0]!.id, category: 'fluency' }),
      ]),
    )
  })
})

describe('reviewed generated calibration corpus', () => {
  it('runs deterministically in each declared mode with all strict expectations passing', () => {
    const first = evaluateReviewedCalibrationCorpus(REVIEWED_CALIBRATION_CORPUS)
    const second = evaluateReviewedCalibrationCorpus(REVIEWED_CALIBRATION_CORPUS)
    expect(first.ok).toBe(true)
    expect(first.strictFailures).toEqual([])
    expect(first.report).toBe(second.report)
    expect(first.runs).toHaveLength(REVIEWED_CALIBRATION_CORPUS.fixtures.length)
    for (const run of first.runs) {
      expect(run.payload.mode).toBe(run.fixture.mode)
      expect(run.payload.rubric_version).toBe('v2')
      expect(run.payload.version).toBe('v2.score.1')
      expect(run.payload.total_max_points).toBe(100)
    }
  })

  it('keeps generated provider evidence anchored and mechanical filler spans out of Vocabulary', () => {
    for (const fixture of REVIEWED_CALIBRATION_CORPUS.fixtures) {
      const run = runReviewedCalibrationFixture(fixture)
      for (const category of ['structure', 'grammar', 'vocabulary'] as const) {
        for (const evidence of run.payload.categories[category].evidence) {
          if (evidence.quote === null || evidence.start === null || evidence.end === null) continue
          expect(fixture.transcript.slice(evidence.start, evidence.end), fixture.id).toBe(
            evidence.quote,
          )
        }
      }
    }
    const filler = REVIEWED_CALIBRATION_CORPUS.fixtures.find(
      (fixture) => fixture.scenario === 'filler_heavy_relevant',
    )!
    const run = runReviewedCalibrationFixture(filler)
    expect(run.mechanicallyCounted.length).toBeGreaterThan(0)
    expect(run.payload.categories.vocabulary).toMatchObject({
      status: 'scored',
      component: 1,
      deductions: [],
    })
  })

  it('reports range positions without printing synthetic prompt or transcript content', () => {
    const result = evaluateReviewedCalibrationCorpus(REVIEWED_CALIBRATION_CORPUS)
    expect(result.report).toMatch(/(?:RANGE_PASS|OBSERVE) practice-strong mode=practice/)
    expect(result.report).toContain('INSIDE:')
    expect(result.report).toMatch(/(?:ABOVE|BELOW|UNAVAILABLE):/)
    for (const fixture of REVIEWED_CALIBRATION_CORPUS.fixtures) {
      expect(result.report).not.toContain(fixture.prompt)
      expect(result.report).not.toContain(fixture.transcript)
    }
  })
})
