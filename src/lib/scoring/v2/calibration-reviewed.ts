import rawCorpus from '../../../../fixtures/scoring/phase1-calibration.json'

import type { TranscriptWord } from '@/lib/deepgram/parse'
import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'
import type { PronunciationEvaluation } from '@/lib/pronunciation/contracts'
import { analyseFillers } from '@/lib/scoring/fillers'
import { buildTokens } from '@/lib/scoring/tokens'
import { assembleV2Score, type V2ScorePayload } from '@/lib/scoring/v2/assemble'
import { analyseClarity } from '@/lib/scoring/v2/clarity'
import {
  V2_CONTENT_DETECTOR_VERSION,
  type MechanicallyCountedSpan,
  type V2ContentEvaluation,
  type V2FindingSeverity,
} from '@/lib/scoring/v2/content/contracts'
import { parseV2ContentResponse } from '@/lib/scoring/v2/content/evaluate'
import { evaluateDelivery } from '@/lib/scoring/v2/delivery'
import { evaluateFluency } from '@/lib/scoring/v2/fluency'
import type { CaptureMetrics } from '@/lib/types/metrics'

export const REVIEWED_CALIBRATION_VERSION = 'phase1.reviewed.1' as const
export const EXPECTATION_LEVELS = ['strict', 'broad', 'informational'] as const
export type ExpectationLevel = (typeof EXPECTATION_LEVELS)[number]

export const REVIEWED_SCENARIOS = [
  'strong_response',
  'fluent_poorly_structured',
  'clear_but_vague',
  'grammatically_weak_understandable',
  'filler_heavy_relevant',
  'monotone_well_organized',
  'rushed_complete',
  'concise_underexplained',
  'long_repetitive',
  'off_topic_fluent',
  'second_language_understandable_grammar_variation',
  'simple_vocabulary_precise',
  'slower_clear_structure',
  'intelligible_accent_non_native_phrasing',
  'concise_complete',
] as const
export type ReviewedScenario = (typeof REVIEWED_SCENARIOS)[number]

export const REVIEWED_FIXTURE_KINDS = ['reference', 'weakness', 'fairness'] as const
export type ReviewedFixtureKind = (typeof REVIEWED_FIXTURE_KINDS)[number]

const STRUCTURE_CHECKS = [
  'answered_prompt',
  'main_point',
  'logical_progression',
  'relevant_support',
  'unnecessary_repetition',
  'topic_drift',
  'completion',
] as const
type StructureCheck = (typeof STRUCTURE_CHECKS)[number]

const VOCABULARY_KINDS = [
  'precise_wording',
  'imprecise_wording',
  'repeated_wording',
  'vague_language',
  'appropriateness',
] as const
type VocabularyKind = (typeof VOCABULARY_KINDS)[number]

const TIMING_PROFILES = ['healthy', 'rushed', 'slower'] as const
type TimingProfile = (typeof TIMING_PROFILES)[number]
const PITCH_PROFILES = ['varied', 'flat'] as const
type PitchProfile = (typeof PITCH_PROFILES)[number]
const PRONUNCIATION_PROFILES = ['none', 'intelligible_accent'] as const
type PronunciationProfile = (typeof PRONUNCIATION_PROFILES)[number]

export interface ReviewedScoreRange {
  min: number
  max: number
  level: ExpectationLevel
}

export type ReviewedCategoryExpectations = Record<SkillCategory, ReviewedScoreRange>

interface StructureFailure {
  check: StructureCheck
  severity: V2FindingSeverity
  quote: string | null
  observation: string
  suggestion: string | null
}

interface GrammarFinding {
  kind: 'grammatical_error'
  severity: V2FindingSeverity
  quote: string
  observation: string
  suggestion: string | null
}

interface VocabularyFinding {
  kind: VocabularyKind
  severity: V2FindingSeverity
  quote: string
  observation: string
  suggestion: string | null
}

interface ReviewedContentFixture {
  structureFailures: readonly StructureFailure[]
  grammarFindings: readonly GrammarFinding[]
  vocabularyFindings: readonly VocabularyFinding[]
}

export interface ReviewedCalibrationFixture {
  id: string
  scenario: ReviewedScenario
  kind: ReviewedFixtureKind
  mode: PracticeMode
  prompt: string
  transcript: string
  timing: TimingProfile
  pitch: PitchProfile
  pronunciation: PronunciationProfile
  content: ReviewedContentFixture
  expectations: ReviewedCategoryExpectations
  reviewNote: string
}

export interface ReviewedCalibrationCorpus {
  version: typeof REVIEWED_CALIBRATION_VERSION
  fixtures: readonly ReviewedCalibrationFixture[]
}

export class ReviewedCalibrationParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewedCalibrationParseError'
  }
}

function fail(path: string, message: string): never {
  throw new ReviewedCalibrationParseError(`${path}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(path, 'expected an object')
}

function text(value: unknown, path: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fail(path, 'expected a nonempty string')
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path)
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  path: string,
): T[number] {
  return typeof value === 'string' && choices.includes(value)
    ? (value as T[number])
    : fail(path, `expected one of ${choices.join(', ')}`)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(path, `expected exactly ${expected.join(', ')}`)
  }
}

export function parseReviewedScoreRange(value: unknown, path = 'range'): ReviewedScoreRange {
  const item = record(value, path)
  exactKeys(item, ['level', 'max', 'min'], path)
  const min = item.min
  const max = item.max
  if (typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > 100) {
    fail(`${path}.min`, 'expected a finite number from 0 through 100')
  }
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 0 || max > 100) {
    fail(`${path}.max`, 'expected a finite number from 0 through 100')
  }
  if (min > max) fail(path, 'minimum cannot exceed maximum')
  return {
    min,
    max,
    level: oneOf(item.level, EXPECTATION_LEVELS, `${path}.level`),
  }
}

function parseExpectations(value: unknown, path: string): ReviewedCategoryExpectations {
  const item = record(value, path)
  exactKeys(item, SKILL_CATEGORIES, path)
  return {
    fluency: parseReviewedScoreRange(item.fluency, `${path}.fluency`),
    clarity: parseReviewedScoreRange(item.clarity, `${path}.clarity`),
    vocabulary: parseReviewedScoreRange(item.vocabulary, `${path}.vocabulary`),
    grammar: parseReviewedScoreRange(item.grammar, `${path}.grammar`),
    structure: parseReviewedScoreRange(item.structure, `${path}.structure`),
    delivery: parseReviewedScoreRange(item.delivery, `${path}.delivery`),
  }
}

function parseSeverity(value: unknown, path: string): V2FindingSeverity {
  return oneOf(value, ['minor', 'clear'] as const, path)
}

function parseStructureFailure(value: unknown, transcript: string, path: string): StructureFailure {
  const item = record(value, path)
  exactKeys(item, ['check', 'observation', 'quote', 'severity', 'suggestion'], path)
  const quote = nullableText(item.quote, `${path}.quote`)
  if (quote !== null && !transcript.includes(quote)) {
    fail(`${path}.quote`, 'quote was not found in the synthetic transcript')
  }
  return {
    check: oneOf(item.check, STRUCTURE_CHECKS, `${path}.check`),
    severity: parseSeverity(item.severity, `${path}.severity`),
    quote,
    observation: text(item.observation, `${path}.observation`),
    suggestion: nullableText(item.suggestion, `${path}.suggestion`),
  }
}

function parseGrammarFinding(value: unknown, transcript: string, path: string): GrammarFinding {
  const item = record(value, path)
  exactKeys(item, ['kind', 'observation', 'quote', 'severity', 'suggestion'], path)
  if (item.kind !== 'grammatical_error') {
    fail(`${path}.kind`, 'expected grammatical_error')
  }
  const quote = text(item.quote, `${path}.quote`)
  if (!transcript.includes(quote)) {
    fail(`${path}.quote`, 'quote was not found in the synthetic transcript')
  }
  return {
    kind: 'grammatical_error',
    severity: parseSeverity(item.severity, `${path}.severity`),
    quote,
    observation: text(item.observation, `${path}.observation`),
    suggestion: nullableText(item.suggestion, `${path}.suggestion`),
  }
}

function parseVocabularyFinding(
  value: unknown,
  transcript: string,
  path: string,
): VocabularyFinding {
  const item = record(value, path)
  exactKeys(item, ['kind', 'observation', 'quote', 'severity', 'suggestion'], path)
  const quote = text(item.quote, `${path}.quote`)
  if (!transcript.includes(quote)) {
    fail(`${path}.quote`, 'quote was not found in the synthetic transcript')
  }
  return {
    kind: oneOf(item.kind, VOCABULARY_KINDS, `${path}.kind`),
    severity: parseSeverity(item.severity, `${path}.severity`),
    quote,
    observation: text(item.observation, `${path}.observation`),
    suggestion: nullableText(item.suggestion, `${path}.suggestion`),
  }
}

function parseArray<T>(
  value: unknown,
  path: string,
  parseItem: (entry: unknown, path: string) => T,
): readonly T[] {
  if (!Array.isArray(value)) fail(path, 'expected an array')
  return value.map((entry, index) => parseItem(entry, `${path}[${index}]`))
}

function parseContent(value: unknown, transcript: string, path: string): ReviewedContentFixture {
  const item = record(value, path)
  exactKeys(item, ['grammar_findings', 'structure_failures', 'vocabulary_findings'], path)
  const structureFailures = parseArray(
    item.structure_failures,
    `${path}.structure_failures`,
    (entry, entryPath) => parseStructureFailure(entry, transcript, entryPath),
  )
  const duplicateChecks = structureFailures
    .map((failure) => failure.check)
    .filter((check, index, checks) => checks.indexOf(check) !== index)
  if (duplicateChecks.length > 0) {
    fail(`${path}.structure_failures`, `duplicate check ${duplicateChecks[0]}`)
  }
  return {
    structureFailures,
    grammarFindings: parseArray(
      item.grammar_findings,
      `${path}.grammar_findings`,
      (entry, entryPath) => parseGrammarFinding(entry, transcript, entryPath),
    ),
    vocabularyFindings: parseArray(
      item.vocabulary_findings,
      `${path}.vocabulary_findings`,
      (entry, entryPath) => parseVocabularyFinding(entry, transcript, entryPath),
    ),
  }
}

function parseFixture(value: unknown, index: number): ReviewedCalibrationFixture {
  const path = `fixtures[${index}]`
  const item = record(value, path)
  exactKeys(
    item,
    [
      'content',
      'expectations',
      'id',
      'kind',
      'mode',
      'pitch',
      'prompt',
      'pronunciation',
      'review_note',
      'scenario',
      'timing',
      'transcript',
    ],
    path,
  )
  const id = text(item.id, `${path}.id`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    fail(`${path}.id`, 'expected a lowercase kebab-case identifier')
  }
  const transcript = text(item.transcript, `${path}.transcript`)
  return {
    id,
    scenario: oneOf(item.scenario, REVIEWED_SCENARIOS, `${path}.scenario`),
    kind: oneOf(item.kind, REVIEWED_FIXTURE_KINDS, `${path}.kind`),
    mode: oneOf(item.mode, PRACTICE_MODES, `${path}.mode`),
    prompt: text(item.prompt, `${path}.prompt`),
    transcript,
    timing: oneOf(item.timing, TIMING_PROFILES, `${path}.timing`),
    pitch: oneOf(item.pitch, PITCH_PROFILES, `${path}.pitch`),
    pronunciation: oneOf(item.pronunciation, PRONUNCIATION_PROFILES, `${path}.pronunciation`),
    content: parseContent(item.content, transcript, `${path}.content`),
    expectations: parseExpectations(item.expectations, `${path}.expectations`),
    reviewNote: text(item.review_note, `${path}.review_note`),
  }
}

export function parseReviewedCalibrationCorpus(value: unknown): ReviewedCalibrationCorpus {
  const item = record(value, 'corpus')
  exactKeys(item, ['fixtures', 'version'], 'corpus')
  if (item.version !== REVIEWED_CALIBRATION_VERSION) {
    fail('corpus.version', `expected ${REVIEWED_CALIBRATION_VERSION}`)
  }
  if (!Array.isArray(item.fixtures) || item.fixtures.length === 0) {
    fail('corpus.fixtures', 'expected a nonempty array')
  }
  const fixtures = item.fixtures.map(parseFixture)
  const ids = fixtures.map((fixture) => fixture.id)
  const duplicateId = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicateId) fail('corpus.fixtures', `duplicate fixture id ${duplicateId}`)

  for (const mode of PRACTICE_MODES) {
    if (!fixtures.some((fixture) => fixture.mode === mode)) {
      fail('corpus.fixtures', `missing mode ${mode}`)
    }
    if (
      !fixtures.some((fixture) => fixture.mode === mode && fixture.scenario === 'strong_response')
    ) {
      fail('corpus.fixtures', `missing strong_response anchor for mode ${mode}`)
    }
  }
  for (const scenario of REVIEWED_SCENARIOS) {
    if (!fixtures.some((fixture) => fixture.scenario === scenario)) {
      fail('corpus.fixtures', `missing scenario ${scenario}`)
    }
  }
  return { version: REVIEWED_CALIBRATION_VERSION, fixtures }
}

export const REVIEWED_CALIBRATION_CORPUS = parseReviewedCalibrationCorpus(rawCorpus)

function transcriptSurfaces(transcript: string): string[] {
  return transcript.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
}

function generatedWords(fixture: ReviewedCalibrationFixture): TranscriptWord[] {
  const profiles: Record<TimingProfile, { interval: number; duration: number }> = {
    healthy: { interval: 0.44, duration: 0.3 },
    rushed: { interval: 0.17, duration: 0.119 },
    slower: { interval: 0.7, duration: 0.55 },
  }
  const profile = profiles[fixture.timing]
  return transcriptSurfaces(fixture.transcript).map((word, index) => {
    const start = 0.4 + index * profile.interval
    return { word, start, end: start + profile.duration, confidence: 0.95 }
  })
}

function generatedCapture(
  words: readonly TranscriptWord[],
  pitchProfile: PitchProfile,
): CaptureMetrics {
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
    hz: pitchProfile === 'flat' ? 180 : variedPitch[index % variedPitch.length]!,
  }))
  return {
    mime_type: 'audio/webm;codecs=opus',
    started_at: '2026-08-28T12:00:00.000Z',
    duration_ms: durationMs,
    sample_interval_ms: 50,
    amplitude,
    pitch,
  }
}

function generatedPronunciationEvidence(
  profile: PronunciationProfile,
  words: readonly TranscriptWord[],
): PronunciationEvaluation | null {
  if (profile === 'none') return null
  const matched = words[0]
  if (!matched) return null
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
        pronunciationAccuracy: 0.82,
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
    warnings: ['Generated evidence only. Accent evidence is not eligible for deductions.'],
    error: null,
    eligibleForDeductions: false,
  }
}

function mechanicallyCountedSpans(
  words: readonly TranscriptWord[],
  transcript: string,
): MechanicallyCountedSpan[] {
  const tokens = buildTokens(words, transcript)
  const fillers = analyseFillers(tokens, tokens.length)
  return fillers.hits.flatMap((hit) => {
    const involved = hit.token_indices.map((index) => tokens[index]).filter(Boolean)
    const first = involved[0]
    const last = involved.at(-1)
    return first && last
      ? [
          {
            start: first.charStart,
            end: last.charEnd,
            text: transcript.slice(first.charStart, last.charEnd),
            category: hit.category,
          },
        ]
      : []
  })
}

function quoteCoordinates(transcript: string, quote: string): { start: number; end: number } {
  const start = transcript.indexOf(quote)
  if (start < 0) throw new Error('Synthetic content quote was not found after corpus validation.')
  return { start, end: start + quote.length }
}

function contentResponse(fixture: ReviewedCalibrationFixture): Record<string, unknown> {
  const structure: Record<string, Record<string, unknown>> = Object.fromEntries(
    STRUCTURE_CHECKS.map((check) => [
      check,
      {
        passed: true,
        severity: null,
        quote: null,
        start: null,
        end: null,
        observation: null,
        suggestion: null,
      },
    ]),
  )
  for (const failure of fixture.content.structureFailures) {
    const coordinates = failure.quote
      ? quoteCoordinates(fixture.transcript, failure.quote)
      : { start: null, end: null }
    structure[failure.check] = {
      passed: false,
      severity: failure.severity,
      quote: failure.quote,
      ...coordinates,
      observation: failure.observation,
      suggestion: failure.suggestion,
    }
  }
  const finding = (value: GrammarFinding | VocabularyFinding) => ({
    ...value,
    ...quoteCoordinates(fixture.transcript, value.quote),
  })
  return {
    version: V2_CONTENT_DETECTOR_VERSION,
    structure: { checks: structure },
    grammar: { findings: fixture.content.grammarFindings.map(finding) },
    vocabulary: { findings: fixture.content.vocabularyFindings.map(finding) },
  }
}

export interface ReviewedFixtureRun {
  fixture: ReviewedCalibrationFixture
  words: readonly TranscriptWord[]
  capture: CaptureMetrics
  mechanicallyCounted: readonly MechanicallyCountedSpan[]
  pronunciation: PronunciationEvaluation | null
  payload: V2ScorePayload
}

export function runReviewedCalibrationFixture(
  fixture: ReviewedCalibrationFixture,
): ReviewedFixtureRun {
  const words = generatedWords(fixture)
  const capture = generatedCapture(words, fixture.pitch)
  const mechanicallyCounted = mechanicallyCountedSpans(words, fixture.transcript)
  const pronunciation = generatedPronunciationEvidence(fixture.pronunciation, words)
  const parsedContent = parseV2ContentResponse(JSON.stringify(contentResponse(fixture)), {
    transcript: fixture.transcript,
    mechanicallyCounted,
  }) as Omit<V2ContentEvaluation, 'provider' | 'calls'>
  const payload = assembleV2Score({
    mode: fixture.mode,
    fluency: evaluateFluency({ capture, words, transcript: fixture.transcript }),
    clarity: analyseClarity(words, capture, pronunciation ?? undefined, fixture.transcript),
    delivery: evaluateDelivery(capture),
    content: { ...parsedContent, provider: 'generated-fixture', calls: 0 },
  })
  return { fixture, words, capture, mechanicallyCounted, pronunciation, payload }
}

export type RangePosition = 'inside' | 'above' | 'below' | 'unavailable'

export interface ReviewedRangeAssessment {
  fixtureId: string
  mode: PracticeMode
  category: SkillCategory
  level: ExpectationLevel
  min: number
  max: number
  actual: number | null
  earnedPoints: number | null
  maxPoints: number
  position: RangePosition
  blocks: boolean
}

export function evaluateReviewedRange(
  input: Pick<ReviewedRangeAssessment, 'fixtureId' | 'mode' | 'category'> & {
    component: number | null
    earnedPoints: number | null
    maxPoints: number
    expectation: ReviewedScoreRange
  },
): ReviewedRangeAssessment {
  const unroundedPercent =
    input.component !== null &&
    Number.isFinite(input.component) &&
    input.component >= 0 &&
    input.component <= 1
      ? input.component * 100
      : null
  const actual = unroundedPercent === null ? null : Number(unroundedPercent.toFixed(6))
  const position: RangePosition =
    unroundedPercent === null
      ? 'unavailable'
      : unroundedPercent < input.expectation.min
        ? 'below'
        : unroundedPercent > input.expectation.max
          ? 'above'
          : 'inside'
  return {
    fixtureId: input.fixtureId,
    mode: input.mode,
    category: input.category,
    level: input.expectation.level,
    min: input.expectation.min,
    max: input.expectation.max,
    actual,
    earnedPoints: input.earnedPoints,
    maxPoints: input.maxPoints,
    position,
    blocks: input.expectation.level === 'strict' && position !== 'inside',
  }
}

function assessmentToken(assessment: ReviewedRangeAssessment): string {
  const actual = assessment.actual === null ? 'unavailable' : assessment.actual
  const points =
    assessment.earnedPoints === null
      ? 'unavailable'
      : `${assessment.earnedPoints}/${assessment.maxPoints}`
  return `${assessment.category}=${assessment.position.toUpperCase()}:${actual}[${assessment.min}..${assessment.max},${assessment.level};${points}]`
}

export interface ReviewedCalibrationResult {
  ok: boolean
  report: string
  runs: readonly ReviewedFixtureRun[]
  assessments: readonly ReviewedRangeAssessment[]
  strictFailures: readonly ReviewedRangeAssessment[]
  observations: readonly ReviewedRangeAssessment[]
}

export function evaluateReviewedCalibrationCorpus(
  corpus: ReviewedCalibrationCorpus,
): ReviewedCalibrationResult {
  const runs = corpus.fixtures.map(runReviewedCalibrationFixture)
  const assessments = runs.flatMap((run) =>
    SKILL_CATEGORIES.map((category) => {
      const result = run.payload.categories[category]
      return evaluateReviewedRange({
        fixtureId: run.fixture.id,
        mode: run.fixture.mode,
        category,
        component: result.status === 'scored' ? result.component : null,
        earnedPoints: result.earned_points,
        maxPoints: result.max_points,
        expectation: run.fixture.expectations[category],
      })
    }),
  )
  const strictFailures = assessments.filter((assessment) => assessment.blocks)
  const observations = assessments.filter(
    (assessment) => assessment.position !== 'inside' && !assessment.blocks,
  )
  const lines = runs.map((run) => {
    const fixtureAssessments = assessments.filter(
      (assessment) => assessment.fixtureId === run.fixture.id,
    )
    const hasStrictFailure = fixtureAssessments.some((assessment) => assessment.blocks)
    const hasObservation = fixtureAssessments.some(
      (assessment) => assessment.position !== 'inside' && !assessment.blocks,
    )
    const label = hasStrictFailure ? 'STRICT_FAIL' : hasObservation ? 'OBSERVE' : 'RANGE_PASS'
    return `${label} ${run.fixture.id} mode=${run.fixture.mode} overall=${run.payload.total_earned_points ?? 'unavailable'} ${fixtureAssessments.map(assessmentToken).join(' ')}`
  })
  return {
    ok: strictFailures.length === 0,
    report: lines.join('\n'),
    runs,
    assessments,
    strictFailures,
    observations,
  }
}
