import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { PracticeMode, SkillCategory } from '@/lib/practice/contracts'
import type { PronunciationEvaluation } from '@/lib/pronunciation/contracts'
import {
  assembleV2Score,
  V2_SCORE_PAYLOAD_VERSION,
  type V2PersistedCategoryScore,
  type V2ScorePayload,
} from '@/lib/scoring/v2/assemble'
import { analyseClarity } from '@/lib/scoring/v2/clarity'
import {
  V2_CONTENT_DETECTOR_VERSION,
  type V2ContentEvaluation,
} from '@/lib/scoring/v2/content/contracts'
import { parseV2ContentResponse } from '@/lib/scoring/v2/content/evaluate'
import { RUBRIC_VERSION, type ScoreStatus } from '@/lib/scoring/v2/contracts'
import { evaluateDelivery } from '@/lib/scoring/v2/delivery'
import { evaluateFluency } from '@/lib/scoring/v2/fluency'
import type { CaptureMetrics } from '@/lib/types/metrics'

export const CALIBRATION_VERSION = 'v2' as const

export const CALIBRATION_LABELS = [
  'fluent-poorly-structured',
  'structured-filler-heavy',
  'monotone',
  'rushed',
  'slow-long-pauses',
  'grammatical-mistakes',
  'vague-vocabulary',
  'strong-response',
  'unclear-pronunciation',
  'intelligible-second-language-accent',
] as const
export type CalibrationLabel = (typeof CALIBRATION_LABELS)[number]

type ContentKind = 'pass' | 'poor_structure' | 'grammar' | 'vocabulary'
type TimingKind = 'strong' | 'rushed' | 'slow_pause'
type PitchKind = 'varied' | 'flat'
type PronunciationKind = 'none' | 'unclear' | 'accent'

export interface CalibrationFixture {
  id: CalibrationLabel
  transcript: string
  content: ContentKind
  timing: TimingKind
  pitch: PitchKind
  pronunciation: PronunciationKind
}

export type FocusedMeasurements = Record<string, number | string | null>

export interface CalibrationCategorySnapshot {
  status: ScoreStatus
  component: number | null
  earnedPoints: number | null
  maxPoints: number
  measurements: FocusedMeasurements
}

export interface CalibrationSnapshot {
  calibrationVersion: string
  scoreVersion: string
  rubricVersion: string
  mode: PracticeMode
  totalEarnedPoints: number | null
  categories: Record<SkillCategory, CalibrationCategorySnapshot>
}

export interface CalibrationBaselineRegistry {
  [scoreVersion: string]: {
    [rubricVersion: string]: {
      calibrationVersion: string
      cases: Record<string, CalibrationSnapshot>
    }
  }
}

export interface CalibrationFixtureRun {
  fixture: CalibrationFixture
  transcriptWords: readonly TranscriptWord[]
  capture: CaptureMetrics
  pronunciation: PronunciationEvaluation | null
  payload: V2ScorePayload
  snapshot: CalibrationSnapshot
}

export interface CalibrationCorpusResult {
  ok: boolean
  report: string
  differences: readonly string[]
}

const STRONG_TRANSCRIPT =
  'I chose the park because its quiet paths helped me plan my afternoon clearly.'

/** Every fixture is generated text and generated timeline data. */
export const CALIBRATION_FIXTURES: readonly CalibrationFixture[] = [
  {
    id: 'fluent-poorly-structured',
    transcript: STRONG_TRANSCRIPT,
    content: 'poor_structure',
    timing: 'strong',
    pitch: 'varied',
    pronunciation: 'none',
  },
  {
    id: 'structured-filler-heavy',
    transcript: 'Um, um, um, I chose the park because its quiet paths helped my plan.',
    content: 'pass',
    timing: 'strong',
    pitch: 'varied',
    pronunciation: 'none',
  },
  {
    id: 'monotone',
    transcript: STRONG_TRANSCRIPT,
    content: 'pass',
    timing: 'strong',
    pitch: 'flat',
    pronunciation: 'none',
  },
  {
    id: 'rushed',
    transcript: STRONG_TRANSCRIPT,
    content: 'pass',
    timing: 'rushed',
    pitch: 'varied',
    pronunciation: 'none',
  },
  {
    id: 'slow-long-pauses',
    transcript: STRONG_TRANSCRIPT,
    content: 'pass',
    timing: 'slow_pause',
    pitch: 'varied',
    pronunciation: 'none',
  },
  {
    id: 'grammatical-mistakes',
    transcript: 'I goes the park because its quiet paths helped me plan my afternoon clearly.',
    content: 'grammar',
    timing: 'strong',
    pitch: 'varied',
    pronunciation: 'none',
  },
  {
    id: 'vague-vocabulary',
    transcript: 'I chose the things because its quiet paths helped me plan my afternoon clearly.',
    content: 'vocabulary',
    timing: 'strong',
    pitch: 'varied',
    pronunciation: 'none',
  },
  {
    id: 'strong-response',
    transcript: STRONG_TRANSCRIPT,
    content: 'pass',
    timing: 'strong',
    pitch: 'varied',
    pronunciation: 'none',
  },
  {
    id: 'unclear-pronunciation',
    transcript: STRONG_TRANSCRIPT,
    content: 'pass',
    timing: 'strong',
    pitch: 'varied',
    pronunciation: 'unclear',
  },
  {
    id: 'intelligible-second-language-accent',
    transcript: STRONG_TRANSCRIPT,
    content: 'pass',
    timing: 'strong',
    pitch: 'varied',
    pronunciation: 'accent',
  },
]

const STRUCTURE_CHECKS = [
  'answered_prompt',
  'main_point',
  'logical_progression',
  'relevant_support',
  'unnecessary_repetition',
  'topic_drift',
  'completion',
] as const

function contentResponse(kind: ContentKind): Record<string, unknown> {
  const structure: Record<string, Record<string, unknown>> = Object.fromEntries(
    STRUCTURE_CHECKS.map((check) => [
      check,
      { passed: true, severity: null, quote: null, observation: null, suggestion: null },
    ]),
  )
  if (kind === 'poor_structure')
    structure.logical_progression = {
      passed: false,
      severity: 'clear',
      quote: null,
      observation: 'The ideas do not follow a clear order.',
      suggestion: 'State the main point first.',
    }
  return {
    version: V2_CONTENT_DETECTOR_VERSION,
    structure: { checks: structure },
    grammar: {
      findings:
        kind === 'grammar'
          ? [
              {
                kind: 'grammatical_error',
                severity: 'clear',
                quote: 'I goes',
                observation: 'The verb does not agree with the subject.',
                suggestion: 'Use I go.',
              },
            ]
          : [],
    },
    vocabulary: {
      findings:
        kind === 'vocabulary'
          ? [
              {
                kind: 'vague_language',
                severity: 'minor',
                quote: 'things',
                observation: 'This word does not name the place.',
                suggestion: 'Name the place.',
              },
            ]
          : [],
    },
  }
}

function surfaces(transcript: string): string[] {
  return transcript.replaceAll(',', '').replaceAll('.', '').split(/\s+/).filter(Boolean)
}

function wordTimeline(fixture: CalibrationFixture): TranscriptWord[] {
  const tokens = surfaces(fixture.transcript)
  const interval = fixture.timing === 'rushed' ? 0.17 : fixture.timing === 'slow_pause' ? 0.8 : 0.44
  const wordDuration = fixture.timing === 'slow_pause' ? 0.65 : Math.min(0.3, interval * 0.7)
  let offset = 0
  return tokens.map((word, index) => {
    if (fixture.timing === 'slow_pause' && index === 6) offset += 3.2
    const start = 0.4 + index * interval + offset
    const confidence = fixture.pronunciation === 'unclear' && index < 2 ? 0.45 : 0.95
    return { word, start, end: start + wordDuration, confidence }
  })
}

function generatedCapture(words: readonly TranscriptWord[], pitchKind: PitchKind): CaptureMetrics {
  const durationMs = Math.ceil(((words.at(-1)?.end ?? 0) + 0.5) * 1000)
  const frameCount = Math.floor(durationMs / 50) + 1
  const amplitude = Array.from({ length: frameCount }, (_, index) => {
    const t_ms = index * 50
    const insideWord = words.some((word) => t_ms >= word.start * 1000 && t_ms <= word.end * 1000)
    return { t_ms, rms: insideWord ? [0.06, 0.09, 0.12][index % 3]! : 0.002 }
  })
  const variedPitch = [140, 160, 180, 200, 220]
  const pitch = Array.from({ length: frameCount }, (_, index) => ({
    t_ms: index * 50,
    hz: pitchKind === 'flat' ? 180 : variedPitch[index % variedPitch.length]!,
  }))
  return {
    mime_type: 'audio/webm;codecs=opus',
    started_at: '2026-08-26T12:00:00.000Z',
    duration_ms: durationMs,
    sample_interval_ms: 50,
    amplitude,
    pitch,
  }
}

function pronunciationEvidence(
  kind: Exclude<PronunciationKind, 'none'>,
  words: readonly TranscriptWord[],
): PronunciationEvaluation {
  const matched = words.find((word) => word.word.toLowerCase() === 'chose')!
  return {
    contractVersion: 'v1',
    provider: { id: 'fixture', model: 'generated', version: 'v1', locale: 'en-US' },
    status: 'completed',
    words: [
      {
        referenceWord: matched.word,
        recognizedWord: matched.word,
        startMs: Math.round(matched.start * 1000),
        endMs: Math.round(matched.end * 1000),
        lexicalOutcome: 'match',
        pronunciationAccuracy: kind === 'unclear' ? 0.42 : 0.82,
        pronunciationAvailability: 'available',
        phonemeAvailability: 'not_checked',
        phonemes: [],
        stressProsody: {
          availability: 'not_checked',
          stressAccuracy: null,
          prosodyAccuracy: null,
          detail: null,
        },
        warning: null,
      },
    ],
    unsupportedWords: [],
    warnings: ['Generated evidence only. Pronunciation evidence is not calibrated for deductions.'],
    error: null,
    eligibleForDeductions: false,
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(6)) : null
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function focusedMeasurements(
  category: SkillCategory,
  result: V2PersistedCategoryScore,
): FocusedMeasurements {
  const measurements = record(result.measurements)
  if (category === 'fluency')
    return {
      filler_count: finite(measurements.filler_count),
      filler_rate_per_100_words: finite(measurements.filler_rate_per_100_words),
      mid_sentence_pause_count: finite(measurements.mid_sentence_pause_count),
      pause_burden_per_minute: finite(measurements.pause_burden_per_minute),
      words_per_minute: finite(measurements.words_per_minute),
      continuity_ratio: finite(measurements.continuity_ratio),
      time_to_first_word_seconds: finite(measurements.time_to_first_word_seconds),
    }
  if (category === 'clarity')
    return {
      low_confidence_count: finite(measurements.low_confidence_count),
      low_confidence_proportion: finite(measurements.low_confidence_proportion),
      speech_to_noise_ratio: finite(measurements.speech_to_noise_ratio),
      pronunciation_status:
        typeof measurements.pronunciation_status === 'string'
          ? measurements.pronunciation_status
          : 'missing',
      pronunciation_assessed_word_count: finite(measurements.pronunciation_assessed_word_count),
    }
  if (category === 'delivery')
    return {
      pitch_spread_semitones: finite(measurements.pitch_spread_semitones),
      amplitude_relative_mad: finite(measurements.amplitude_relative_mad),
      voiced_frames: finite(measurements.voiced_frames),
      amplitude_frames: finite(measurements.amplitude_frames),
    }
  return category === 'structure'
    ? { checks_reviewed: finite(measurements.checks_reviewed) }
    : { findings_reviewed: finite(measurements.findings_reviewed) }
}

export function snapshotCalibration(payload: V2ScorePayload): CalibrationSnapshot {
  const category = (name: SkillCategory): CalibrationCategorySnapshot => {
    const result = payload.categories[name]
    return {
      status: result.status,
      component: finite(result.component),
      earnedPoints: result.earned_points,
      maxPoints: result.max_points,
      measurements: focusedMeasurements(name, result),
    }
  }
  return {
    calibrationVersion: CALIBRATION_VERSION,
    scoreVersion: payload.version,
    rubricVersion: payload.rubric_version,
    mode: payload.mode,
    totalEarnedPoints: payload.total_earned_points,
    categories: {
      fluency: category('fluency'),
      clarity: category('clarity'),
      vocabulary: category('vocabulary'),
      grammar: category('grammar'),
      structure: category('structure'),
      delivery: category('delivery'),
    },
  }
}

export function runCalibrationFixture(fixture: CalibrationFixture): CalibrationFixtureRun {
  const transcriptWords = wordTimeline(fixture)
  const capture = generatedCapture(transcriptWords, fixture.pitch)
  const pronunciation =
    fixture.pronunciation === 'none'
      ? null
      : pronunciationEvidence(fixture.pronunciation, transcriptWords)
  const parsedContent = parseV2ContentResponse(JSON.stringify(contentResponse(fixture.content)), {
    transcript: fixture.transcript,
  }) as Omit<V2ContentEvaluation, 'provider' | 'calls'>
  const payload = assembleV2Score({
    mode: 'practice',
    fluency: evaluateFluency({ capture, words: transcriptWords, transcript: fixture.transcript }),
    delivery: evaluateDelivery(capture),
    clarity: analyseClarity(transcriptWords, capture, pronunciation ?? undefined),
    content: { ...parsedContent, provider: 'fixture', calls: 0 },
  })
  return {
    fixture,
    transcriptWords,
    capture,
    pronunciation,
    payload,
    snapshot: snapshotCalibration(payload),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function recursiveSnapshotDiff(expected: unknown, actual: unknown, path = '$'): string[] {
  if (Object.is(expected, actual)) return []
  if (isObject(expected) && isObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    return keys.flatMap((key) =>
      !(key in expected)
        ? [`${path}.${key}: unexpected ${JSON.stringify(actual[key])}`]
        : !(key in actual)
          ? [`${path}.${key}: missing`]
          : recursiveSnapshotDiff(expected[key], actual[key], `${path}.${key}`),
    )
  }
  return [`${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`]
}

export function compareCalibrationSnapshots(
  expected: CalibrationSnapshot,
  actual: CalibrationSnapshot,
): string[] {
  const incompatible = (['calibrationVersion', 'scoreVersion', 'rubricVersion'] as const).flatMap(
    (key) =>
      expected[key] === actual[key]
        ? []
        : [
            `$.${key}: incompatible expected ${JSON.stringify(expected[key])}, received ${JSON.stringify(actual[key])}`,
          ],
  )
  return incompatible.length > 0 ? incompatible : recursiveSnapshotDiff(expected, actual)
}

function points(category: CalibrationCategorySnapshot): string {
  return category.status === 'scored'
    ? `${category.earnedPoints}/${category.maxPoints}`
    : category.status
}

export function runCalibrationCorpus(
  fixtures: readonly CalibrationFixture[],
  baselines: CalibrationBaselineRegistry,
): CalibrationCorpusResult {
  const scoreBaselines = baselines[V2_SCORE_PAYLOAD_VERSION]
  const versioned = scoreBaselines?.[RUBRIC_VERSION]
  const availableScoreVersions = Object.keys(baselines).sort()
  const availableRubricVersions = Object.keys(scoreBaselines ?? {}).sort()
  const differences: string[] = []
  const lines: string[] = []
  for (const fixture of fixtures) {
    const run = runCalibrationFixture(fixture)
    const expected = versioned?.cases[fixture.id]
    const drift = !scoreBaselines
      ? availableScoreVersions.length > 0
        ? [
            `${fixture.id}: incompatible scoreVersion expected ${V2_SCORE_PAYLOAD_VERSION}, available ${availableScoreVersions.join(', ')}`,
          ]
        : [`${fixture.id}: missing baseline for ${V2_SCORE_PAYLOAD_VERSION}/${RUBRIC_VERSION}`]
      : !versioned
        ? availableRubricVersions.length > 0
          ? [
              `${fixture.id}: incompatible rubricVersion expected ${RUBRIC_VERSION}, available ${availableRubricVersions.join(', ')}`,
            ]
          : [`${fixture.id}: missing baseline for ${V2_SCORE_PAYLOAD_VERSION}/${RUBRIC_VERSION}`]
        : versioned.calibrationVersion !== CALIBRATION_VERSION
          ? [
              `${fixture.id}: incompatible calibrationVersion expected ${versioned.calibrationVersion}, received ${CALIBRATION_VERSION}`,
            ]
          : !expected
            ? [`${fixture.id}: missing baseline`]
            : compareCalibrationSnapshots(expected, run.snapshot).map(
                (difference) => `${fixture.id} ${difference}`,
              )
    differences.push(...drift)
    const categories = Object.entries(run.snapshot.categories)
      .map(([name, category]) => `${name}=${points(category)}`)
      .join(' ')
    lines.push(
      `${drift.length === 0 ? 'PASS' : 'DRIFT'} ${fixture.id} overall=${run.snapshot.totalEarnedPoints ?? 'unavailable'} ${categories}`,
    )
    lines.push(...drift.map((difference) => `  ${difference}`))
  }
  if (versioned?.calibrationVersion === CALIBRATION_VERSION) {
    const fixtureIds = new Set(fixtures.map((fixture) => fixture.id))
    for (const caseId of Object.keys(versioned.cases).sort()) {
      if (fixtureIds.has(caseId as CalibrationLabel)) continue
      const difference = `${caseId}: unexpected baseline case`
      differences.push(difference)
      lines.push(`DRIFT ${caseId} unexpected baseline case`, `  ${difference}`)
    }
  }
  return { ok: differences.length === 0, report: lines.join('\n'), differences }
}

const scored = (
  component: number,
  earnedPoints: number,
  maxPoints: number,
  measurements: FocusedMeasurements,
): CalibrationCategorySnapshot => ({
  status: 'scored',
  component,
  earnedPoints,
  maxPoints,
  measurements,
})

const FLUENCY_STRONG = scored(1, 22, 22, {
  filler_count: 0,
  filler_rate_per_100_words: 0,
  mid_sentence_pause_count: 0,
  pause_burden_per_minute: 0,
  words_per_minute: 139.534884,
  continuity_ratio: 0.869942,
  time_to_first_word_seconds: 0.4,
})
const CLARITY_STRONG = scored(1, 20, 20, {
  low_confidence_count: 0,
  low_confidence_proportion: 0,
  speech_to_noise_ratio: 45,
  pronunciation_status: 'missing',
  pronunciation_assessed_word_count: 0,
})
const VOCABULARY_STRONG = scored(1, 12, 12, { findings_reviewed: 0 })
const GRAMMAR_STRONG = scored(1, 12, 12, { findings_reviewed: 0 })
const STRUCTURE_STRONG = scored(1, 18, 18, { checks_reviewed: 7 })
const DELIVERY_STRONG = scored(1, 16, 16, {
  pitch_spread_semitones: 3.02317,
  amplitude_relative_mad: 1.02766,
  voiced_frames: 139,
  amplitude_frames: 139,
})

function baselineSnapshot(
  totalEarnedPoints: number,
  overrides: Partial<Record<SkillCategory, CalibrationCategorySnapshot>> = {},
): CalibrationSnapshot {
  return {
    calibrationVersion: CALIBRATION_VERSION,
    scoreVersion: V2_SCORE_PAYLOAD_VERSION,
    rubricVersion: RUBRIC_VERSION,
    mode: 'practice',
    totalEarnedPoints,
    categories: {
      fluency: overrides.fluency ?? FLUENCY_STRONG,
      clarity: overrides.clarity ?? CLARITY_STRONG,
      vocabulary: overrides.vocabulary ?? VOCABULARY_STRONG,
      grammar: overrides.grammar ?? GRAMMAR_STRONG,
      structure: overrides.structure ?? STRUCTURE_STRONG,
      delivery: overrides.delivery ?? DELIVERY_STRONG,
    },
  }
}

/** Checked-in structured expectations. The corpus command never rewrites these. */
export const CALIBRATION_BASELINES: CalibrationBaselineRegistry = {
  [V2_SCORE_PAYLOAD_VERSION]: {
    [RUBRIC_VERSION]: {
      calibrationVersion: CALIBRATION_VERSION,
      cases: {
        'fluent-poorly-structured': baselineSnapshot(96, {
          structure: scored(0.75, 14, 18, { checks_reviewed: 7 }),
        }),
        'structured-filler-heavy': baselineSnapshot(95, {
          fluency: scored(0.75, 17, 22, {
            filler_count: 3,
            filler_rate_per_100_words: 21.428571,
            mid_sentence_pause_count: 0,
            pause_burden_per_minute: 0,
            words_per_minute: 139.534884,
            continuity_ratio: 0.869942,
            time_to_first_word_seconds: 0.4,
          }),
        }),
        monotone: baselineSnapshot(84, {
          delivery: scored(0, 0, 16, {
            pitch_spread_semitones: 0,
            amplitude_relative_mad: 1.02766,
            voiced_frames: 139,
            amplitude_frames: 139,
          }),
        }),
        rushed: baselineSnapshot(96, {
          fluency: scored(0.8375, 18, 22, {
            filler_count: 0,
            filler_rate_per_100_words: 0,
            mid_sentence_pause_count: 0,
            pause_burden_per_minute: 0,
            words_per_minute: 360.669815,
            continuity_ratio: 0.721276,
            time_to_first_word_seconds: 0.4,
          }),
          delivery: scored(1, 16, 16, {
            pitch_spread_semitones: 3.02317,
            amplitude_relative_mad: 1.02766,
            voiced_frames: 65,
            amplitude_frames: 65,
          }),
        }),
        'slow-long-pauses': baselineSnapshot(90, {
          fluency: scored(0.5625, 12, 22, {
            filler_count: 0,
            filler_rate_per_100_words: 0,
            mid_sentence_pause_count: 1,
            pause_burden_per_minute: 3.960396,
            words_per_minute: 77.06422,
            continuity_ratio: 0.719472,
            time_to_first_word_seconds: 0.4,
          }),
          delivery: scored(1, 16, 16, {
            pitch_spread_semitones: 3.02317,
            amplitude_relative_mad: 1.02766,
            voiced_frames: 304,
            amplitude_frames: 304,
          }),
        }),
        'grammatical-mistakes': baselineSnapshot(97, {
          grammar: scored(0.75, 9, 12, { findings_reviewed: 1 }),
        }),
        'vague-vocabulary': baselineSnapshot(99, {
          vocabulary: scored(0.9, 11, 12, { findings_reviewed: 1 }),
        }),
        'strong-response': baselineSnapshot(100),
        'unclear-pronunciation': baselineSnapshot(97, {
          clarity: scored(0.857143, 17, 20, {
            low_confidence_count: 2,
            low_confidence_proportion: 0.142857,
            speech_to_noise_ratio: 45,
            pronunciation_status: 'completed',
            pronunciation_assessed_word_count: 1,
          }),
        }),
        'intelligible-second-language-accent': baselineSnapshot(100, {
          clarity: scored(1, 20, 20, {
            low_confidence_count: 0,
            low_confidence_proportion: 0,
            speech_to_noise_ratio: 45,
            pronunciation_status: 'completed',
            pronunciation_assessed_word_count: 1,
          }),
        }),
      },
    },
  },
}
