import {
  CALIBRATION_BASELINES,
  CALIBRATION_FIXTURES,
  CALIBRATION_LABELS,
  CALIBRATION_VERSION,
  compareCalibrationSnapshots,
  recursiveSnapshotDiff,
  runCalibrationCorpus,
  runCalibrationFixture,
  type CalibrationBaselineRegistry,
  type CalibrationFixtureRun,
  type CalibrationLabel,
  type CalibrationSnapshot,
} from '@/lib/scoring/v2/calibration'
import { V2_SCORE_PAYLOAD_VERSION } from '@/lib/scoring/v2/assemble'
import { RUBRIC_VERSION } from '@/lib/scoring/v2/contracts'
import { describe, expect, it } from 'vitest'

function runById(id: CalibrationLabel): CalibrationFixtureRun {
  const fixture = CALIBRATION_FIXTURES.find((candidate) => candidate.id === id)
  if (!fixture) throw new Error(`Missing fixture ${id}`)
  return runCalibrationFixture(fixture)
}

function measurement(run: CalibrationFixtureRun, category: string, key: string): number {
  const result =
    run.snapshot.categories[category as keyof typeof run.snapshot.categories].measurements[key]
  if (typeof result !== 'number') throw new Error(`Missing numeric ${category}.${key}`)
  return result
}

function checkedBaseline(id: CalibrationLabel): CalibrationSnapshot {
  const snapshot = CALIBRATION_BASELINES[V2_SCORE_PAYLOAD_VERSION]?.[RUBRIC_VERSION]?.cases[id]
  if (!snapshot) throw new Error(`Missing checked baseline ${id}`)
  return structuredClone(snapshot)
}

function clonedBaselines(): CalibrationBaselineRegistry {
  return structuredClone(CALIBRATION_BASELINES)
}

describe('v2 scoring calibration corpus', () => {
  it('covers all ten required generated behavior labels', () => {
    expect(CALIBRATION_FIXTURES.map((fixture) => fixture.id)).toEqual(CALIBRATION_LABELS)
    expect(CALIBRATION_LABELS).toHaveLength(10)
  })

  it('creates deterministic structured snapshots and matches every checked baseline', () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      const first = runCalibrationFixture(fixture).snapshot
      const second = runCalibrationFixture(fixture).snapshot
      expect(first).toEqual(second)
      expect(first).toEqual(checkedBaseline(fixture.id))
      expect(Object.keys(first.categories).sort()).toEqual(
        ['clarity', 'delivery', 'fluency', 'grammar', 'structure', 'vocabulary'].sort(),
      )
    }
  })

  it('exercises the intended mechanical measurements relative to strong', () => {
    const strong = runById('strong-response')
    const filler = runById('structured-filler-heavy')
    const rushed = runById('rushed')
    const slow = runById('slow-long-pauses')
    const monotone = runById('monotone')

    expect(measurement(filler, 'fluency', 'filler_count')).toBeGreaterThan(
      measurement(strong, 'fluency', 'filler_count'),
    )
    expect(measurement(filler, 'fluency', 'filler_rate_per_100_words')).toBeGreaterThan(
      measurement(strong, 'fluency', 'filler_rate_per_100_words'),
    )
    expect(filler.snapshot.categories.fluency.component).toBeLessThan(
      strong.snapshot.categories.fluency.component!,
    )

    expect(measurement(rushed, 'fluency', 'words_per_minute')).toBeGreaterThan(
      measurement(strong, 'fluency', 'words_per_minute'),
    )
    expect(rushed.snapshot.categories.fluency.component).toBeLessThan(
      strong.snapshot.categories.fluency.component!,
    )

    expect(measurement(slow, 'fluency', 'mid_sentence_pause_count')).toBeGreaterThanOrEqual(1)
    expect(measurement(slow, 'fluency', 'pause_burden_per_minute')).toBeGreaterThan(0)
    expect(measurement(slow, 'fluency', 'words_per_minute')).toBeLessThan(
      measurement(strong, 'fluency', 'words_per_minute'),
    )
    expect(slow.snapshot.categories.fluency.component).toBeLessThan(
      strong.snapshot.categories.fluency.component!,
    )
    expect(slow.snapshot.categories.fluency.earnedPoints).toBeLessThan(
      strong.snapshot.categories.fluency.earnedPoints!,
    )

    expect(measurement(monotone, 'delivery', 'pitch_spread_semitones')).toBeLessThan(
      measurement(strong, 'delivery', 'pitch_spread_semitones'),
    )
    expect(monotone.snapshot.categories.delivery.component).toBeLessThan(
      strong.snapshot.categories.delivery.component!,
    )
    expect(strong.snapshot.categories.delivery.component).toBe(1)
  })

  it('isolates structure, grammar, and vocabulary behaviors from healthy mechanics', () => {
    const strong = runById('strong-response')
    const structure = runById('fluent-poorly-structured')
    const grammar = runById('grammatical-mistakes')
    const vocabulary = runById('vague-vocabulary')

    expect(structure.snapshot.categories.fluency).toEqual(strong.snapshot.categories.fluency)
    expect(structure.snapshot.categories.clarity).toEqual(strong.snapshot.categories.clarity)
    expect(structure.snapshot.categories.delivery).toEqual(strong.snapshot.categories.delivery)
    expect(structure.snapshot.categories.structure.component).toBeLessThan(
      strong.snapshot.categories.structure.component!,
    )

    for (const run of [grammar, vocabulary]) {
      expect(run.snapshot.categories.fluency).toEqual(strong.snapshot.categories.fluency)
      expect(run.snapshot.categories.clarity).toEqual(strong.snapshot.categories.clarity)
      expect(run.snapshot.categories.delivery).toEqual(strong.snapshot.categories.delivery)
    }
    expect(grammar.snapshot.categories.grammar.component).toBeLessThan(
      strong.snapshot.categories.grammar.component!,
    )
    expect(vocabulary.snapshot.categories.vocabulary.component).toBeLessThan(
      strong.snapshot.categories.vocabulary.component!,
    )
  })

  it('scores Clarity for every healthy non-unclear generated case', () => {
    for (const fixture of CALIBRATION_FIXTURES.filter(
      (candidate) => candidate.id !== 'unclear-pronunciation',
    )) {
      const run = runCalibrationFixture(fixture)
      expect(run.snapshot.categories.clarity.status, fixture.id).toBe('scored')
      expect(measurement(run, 'clarity', 'speech_to_noise_ratio')).toBeGreaterThan(0)
    }
  })

  it('keeps every content deduction quote mechanically anchored to the transcript', () => {
    const contentCategories = ['structure', 'grammar', 'vocabulary'] as const
    for (const fixture of CALIBRATION_FIXTURES) {
      const run = runCalibrationFixture(fixture)
      for (const category of contentCategories) {
        for (const evidence of run.payload.categories[category].evidence) {
          if (evidence.quote === null || evidence.start === null || evidence.end === null) continue
          expect(run.fixture.transcript.slice(evidence.start, evidence.end), fixture.id).toBe(
            evidence.quote,
          )
        }
      }
    }
  })

  it('uses a matched transcript word and timing for evidence-only pronunciation fixtures', () => {
    for (const id of ['unclear-pronunciation', 'intelligible-second-language-accent'] as const) {
      const run = runById(id)
      const pronunciationWord = run.pronunciation?.words[0]
      const transcriptWord = run.transcriptWords.find(
        (word) => word.word === pronunciationWord?.referenceWord,
      )
      expect(run.pronunciation?.eligibleForDeductions).toBe(false)
      expect(pronunciationWord).toBeDefined()
      expect(transcriptWord).toBeDefined()
      expect(pronunciationWord?.startMs).toBe(Math.round(transcriptWord!.start * 1000))
      expect(pronunciationWord?.endMs).toBe(Math.round(transcriptWord!.end * 1000))
    }
  })

  it('keeps intelligible accent evidence informational and score-equivalent to strong', () => {
    const strong = runById('strong-response')
    const accent = runById('intelligible-second-language-accent')

    expect(accent.snapshot.totalEarnedPoints).toBe(strong.snapshot.totalEarnedPoints)
    for (const category of Object.keys(strong.payload.categories) as Array<
      keyof typeof strong.payload.categories
    >) {
      const strongCategory = strong.payload.categories[category]
      const accentCategory = accent.payload.categories[category]
      expect(
        {
          status: accentCategory.status,
          component: accentCategory.component,
          earnedPoints: accentCategory.earned_points,
          maxPoints: accentCategory.max_points,
          deductions: accentCategory.deductions,
        },
        category,
      ).toEqual({
        status: strongCategory.status,
        component: strongCategory.component,
        earnedPoints: strongCategory.earned_points,
        maxPoints: strongCategory.max_points,
        deductions: strongCategory.deductions,
      })
    }
    expect(accent.snapshot.categories.clarity.measurements).toMatchObject({
      pronunciation_status: 'completed',
      pronunciation_assessed_word_count: 1,
    })
  })

  it('keeps unclear pronunciation evidence non-deductible while low-confidence words are measured', () => {
    const unclear = runById('unclear-pronunciation')
    expect(unclear.pronunciation?.eligibleForDeductions).toBe(false)
    expect(measurement(unclear, 'clarity', 'low_confidence_count')).toBeGreaterThan(0)
    expect(unclear.payload.categories.clarity.deductions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'recognition_uncertainty' })]),
    )
    expect(unclear.payload.categories.clarity.deductions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining('pronunciation') }),
      ]),
    )
  })
})

describe('calibration snapshot comparison', () => {
  it('detects changed values with stable paths', () => {
    const expected = checkedBaseline('strong-response')
    const actual = structuredClone(expected)
    actual.categories.fluency.component = 0.5
    expect(compareCalibrationSnapshots(expected, actual)).toEqual([
      '$.categories.fluency.component: expected 1, received 0.5',
    ])
  })

  it('detects missing keys and categories', () => {
    const expected = checkedBaseline('strong-response')
    const missingKey = structuredClone(expected)
    delete (missingKey.categories.fluency.measurements as Record<string, unknown>).words_per_minute
    expect(recursiveSnapshotDiff(expected, missingKey)).toContain(
      '$.categories.fluency.measurements.words_per_minute: missing',
    )

    const missingCategory = structuredClone(expected)
    delete (missingCategory.categories as Partial<typeof missingCategory.categories>).delivery
    expect(recursiveSnapshotDiff(expected, missingCategory)).toContain(
      '$.categories.delivery: missing',
    )
  })

  it('detects unexpected keys and categories symmetrically', () => {
    const expected = checkedBaseline('strong-response')
    const extraKey = structuredClone(expected)
    ;(extraKey.categories.fluency.measurements as Record<string, unknown>).unexpected = 1
    expect(recursiveSnapshotDiff(expected, extraKey)).toContain(
      '$.categories.fluency.measurements.unexpected: unexpected 1',
    )

    const extraCategory = structuredClone(expected)
    ;(extraCategory.categories as Record<string, unknown>).unexpected = { status: 'scored' }
    expect(recursiveSnapshotDiff(expected, extraCategory)).toContain(
      '$.categories.unexpected: unexpected {"status":"scored"}',
    )

    const extraBaseline = structuredClone(expected)
    ;(extraBaseline.categories.fluency.measurements as Record<string, unknown>).obsolete = 1
    expect(recursiveSnapshotDiff(extraBaseline, expected)).toContain(
      '$.categories.fluency.measurements.obsolete: missing',
    )
  })

  it.each(['calibrationVersion', 'scoreVersion', 'rubricVersion'] as const)(
    'reports incompatible %s without comparing normalized values',
    (key) => {
      const expected = checkedBaseline('strong-response')
      const actual = structuredClone(expected)
      ;(actual as unknown as Record<string, unknown>)[key] = 'future'
      const differences = compareCalibrationSnapshots(expected, actual)
      expect(differences).toHaveLength(1)
      expect(differences[0]).toContain(`$.${key}: incompatible`)
    },
  )
})

describe('calibration corpus runner', () => {
  it('returns a readable successful report with one line per case', () => {
    const result = runCalibrationCorpus(CALIBRATION_FIXTURES, CALIBRATION_BASELINES)
    expect(result.ok).toBe(true)
    expect(result.differences).toEqual([])
    for (const id of CALIBRATION_LABELS) expect(result.report).toContain(`PASS ${id} overall=`)
    expect(result.report).toContain('fluency=')
    expect(result.report).toContain('delivery=')
  })

  it('returns non-success and detailed paths for injected drift without provider calls', () => {
    const baselines = clonedBaselines()
    const strong = baselines[V2_SCORE_PAYLOAD_VERSION]![RUBRIC_VERSION]!.cases['strong-response']!
    strong.categories.delivery.earnedPoints = 15
    const result = runCalibrationCorpus(CALIBRATION_FIXTURES, baselines)
    expect(result.ok).toBe(false)
    expect(result.report).toContain('DRIFT strong-response overall=')
    expect(result.report).toContain(
      'strong-response $.categories.delivery.earnedPoints: expected 15, received 16',
    )
  })

  it('fails clearly for a missing case or versioned baseline', () => {
    const missingCase = clonedBaselines()
    delete missingCase[V2_SCORE_PAYLOAD_VERSION]![RUBRIC_VERSION]!.cases['strong-response']
    expect(runCalibrationCorpus(CALIBRATION_FIXTURES, missingCase).differences).toContain(
      'strong-response: missing baseline',
    )
    expect(runCalibrationCorpus(CALIBRATION_FIXTURES, {}).differences[0]).toContain(
      `missing baseline for ${V2_SCORE_PAYLOAD_VERSION}/${RUBRIC_VERSION}`,
    )
  })

  it('flags unexpected baseline cases instead of ignoring extra data', () => {
    const baselines = clonedBaselines()
    const cases = baselines[V2_SCORE_PAYLOAD_VERSION]![RUBRIC_VERSION]!.cases
    cases['obsolete-case'] = checkedBaseline('strong-response')
    const result = runCalibrationCorpus(CALIBRATION_FIXTURES, baselines)
    expect(result.ok).toBe(false)
    expect(result.differences).toContain('obsolete-case: unexpected baseline case')
    expect(result.report).toContain('DRIFT obsolete-case unexpected baseline case')
  })

  it('reports incompatible score and rubric baseline registries explicitly', () => {
    const scoreMismatch = {
      future: CALIBRATION_BASELINES[V2_SCORE_PAYLOAD_VERSION],
    } as CalibrationBaselineRegistry
    expect(runCalibrationCorpus(CALIBRATION_FIXTURES, scoreMismatch).differences[0]).toContain(
      `incompatible scoreVersion expected ${V2_SCORE_PAYLOAD_VERSION}, available future`,
    )

    const rubricMismatch = {
      [V2_SCORE_PAYLOAD_VERSION]: {
        future: CALIBRATION_BASELINES[V2_SCORE_PAYLOAD_VERSION]![RUBRIC_VERSION]!,
      },
    } as CalibrationBaselineRegistry
    expect(runCalibrationCorpus(CALIBRATION_FIXTURES, rubricMismatch).differences[0]).toContain(
      `incompatible rubricVersion expected ${RUBRIC_VERSION}, available future`,
    )
  })

  it('validates the registry calibration version before case comparison', () => {
    const baselines = clonedBaselines()
    baselines[V2_SCORE_PAYLOAD_VERSION]![RUBRIC_VERSION]!.calibrationVersion = 'future'
    const result = runCalibrationCorpus(CALIBRATION_FIXTURES, baselines)
    expect(result.ok).toBe(false)
    expect(result.differences[0]).toContain(
      `incompatible calibrationVersion expected future, received ${CALIBRATION_VERSION}`,
    )
  })
})
