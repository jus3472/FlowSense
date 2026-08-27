import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { PronunciationEvaluation } from '@/lib/pronunciation/contracts'
import {
  assembleV2Score,
  V2_SCORE_PAYLOAD_VERSION,
  type V2ScorePayload,
} from '@/lib/scoring/v2/assemble'
import { analyseClarity } from '@/lib/scoring/v2/clarity'
import {
  V2_CONTENT_DETECTOR_VERSION,
  type V2ContentEvaluation,
} from '@/lib/scoring/v2/content/contracts'
import { parseV2ContentResponse } from '@/lib/scoring/v2/content/evaluate'
import { evaluateDelivery } from '@/lib/scoring/v2/delivery'
import { evaluateFluency } from '@/lib/scoring/v2/fluency'
import { RUBRIC_VERSION } from '@/lib/scoring/v2/contracts'
import type { CaptureMetrics } from '@/lib/types/metrics'

export const CALIBRATION_VERSION = 'v1' as const

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

export interface CalibrationFixture {
  id: CalibrationLabel
  transcript: string
  content: Record<string, unknown>
  confidence?: number
  pitch?: number
  interval?: number
  durationMs?: number
  pronunciation?: PronunciationEvaluation
}
export interface CalibrationBaseline {
  calibrationVersion: typeof CALIBRATION_VERSION
  scoreVersion: typeof V2_SCORE_PAYLOAD_VERSION
  rubricVersion: typeof RUBRIC_VERSION
  categories: readonly string[]
}

const checks = [
  'answered_prompt',
  'main_point',
  'logical_progression',
  'relevant_support',
  'unnecessary_repetition',
  'topic_drift',
  'completion',
]
const passed = Object.fromEntries(
  checks.map((id) => [
    id,
    { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  ]),
)
const content = (changes: Record<string, unknown> = {}) => ({
  version: V2_CONTENT_DETECTOR_VERSION,
  structure: { checks: { ...passed, ...changes } },
  grammar: { findings: [] },
  vocabulary: { findings: [] },
})
const grammar = {
  kind: 'grammatical_error',
  severity: 'clear',
  quote: 'I goes',
  observation: 'The verb does not agree with the subject.',
  suggestion: 'Use I go.',
}
const vague = {
  kind: 'vague_language',
  severity: 'minor',
  quote: 'things',
  observation: 'This word does not name the result.',
  suggestion: 'Name the result.',
}

/** Generated, safe synthetic text only. Accent is never a score input. */
export const CALIBRATION_FIXTURES: readonly CalibrationFixture[] = [
  {
    id: 'fluent-poorly-structured',
    transcript: 'I chose the park because it was close and calm today.',
    content: content({
      logical_progression: {
        passed: false,
        severity: 'clear',
        quote: null,
        observation: 'The ideas do not follow a clear order.',
        suggestion: 'State the main point first.',
      },
    }),
    interval: 0.55,
  },
  {
    id: 'structured-filler-heavy',
    transcript: 'Um, um, I chose the park because it was calm and close.',
    content: content(),
    interval: 0.4,
  },
  {
    id: 'monotone',
    transcript: 'I chose the park because it was calm and close today.',
    content: content(),
    pitch: 120,
    interval: 0.55,
  },
  {
    id: 'rushed',
    transcript: 'I chose the park because it was calm and close today.',
    content: content(),
    interval: 0.1,
    durationMs: 3_000,
  },
  {
    id: 'slow-long-pauses',
    transcript: 'I chose the park because it was calm and close today.',
    content: content(),
    interval: 1.4,
    durationMs: 18_000,
  },
  {
    id: 'grammatical-mistakes',
    transcript: 'I goes to the park because it was calm and close.',
    content: { ...content(), grammar: { findings: [grammar] } },
  },
  {
    id: 'vague-vocabulary',
    transcript: 'I chose things because things were good today.',
    content: { ...content(), vocabulary: { findings: [vague] } },
  },
  {
    id: 'strong-response',
    transcript: 'I chose the park because its quiet paths helped me plan my afternoon.',
    content: content(),
  },
  {
    id: 'unclear-pronunciation',
    transcript: 'I chose the park because it was calm and close today.',
    content: content(),
    confidence: 0.45,
    pronunciation: pronunciation('chose', 400),
  },
  {
    id: 'intelligible-second-language-accent',
    transcript: 'I chose the park because it was calm and close today.',
    content: content(),
    pronunciation: pronunciation('chose', 400),
  },
]

function pronunciation(word: string, startMs: number): PronunciationEvaluation {
  return {
    contractVersion: 'v1',
    provider: { id: 'fixture', model: 'generated', version: 'v1', locale: 'en-US' },
    status: 'completed',
    words: [
      {
        referenceWord: word,
        recognizedWord: word,
        startMs,
        endMs: startMs + 350,
        lexicalOutcome: 'match',
        pronunciationAccuracy: 0.5,
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
    warnings: ['Generated evidence only.'],
    error: null,
    eligibleForDeductions: false,
  }
}
function words(text: string, confidence = 0.95, interval = 0.55): TranscriptWord[] {
  return text
    .replaceAll(',', '')
    .replaceAll('.', '')
    .split(' ')
    .map((word, index) => ({
      word,
      start: 0.4 + index * interval,
      end: 0.4 + index * interval + Math.min(0.35, interval * 0.7),
      confidence,
    }))
}
function capture(
  items: readonly TranscriptWord[],
  pitch = 180,
  duration_ms = 9_000,
): CaptureMetrics {
  return {
    mime_type: 'audio/webm;codecs=opus',
    started_at: '2026-01-01T00:00:00.000Z',
    duration_ms,
    sample_interval_ms: 50,
    amplitude: Array.from({ length: duration_ms / 50 + 1 }, (_, i) => ({
      t_ms: i * 50,
      rms: items.some((word) => i * 50 >= word.start * 1000 && i * 50 <= word.end * 1000)
        ? 0.08
        : 0.002,
    })),
    pitch: Array.from({ length: duration_ms / 50 + 1 }, (_, i) => ({
      t_ms: i * 50,
      hz: pitch === 120 ? pitch : pitch + (i % 5) * 12,
    })),
  }
}

export function runCalibrationFixture(fixture: CalibrationFixture): V2ScorePayload {
  const transcriptWords = words(fixture.transcript, fixture.confidence, fixture.interval)
  const recording = capture(transcriptWords, fixture.pitch, fixture.durationMs)
  const contentResult = parseV2ContentResponse(JSON.stringify(fixture.content), {
    transcript: fixture.transcript,
  }) as Omit<V2ContentEvaluation, 'provider' | 'calls'>
  return assembleV2Score({
    mode: 'practice',
    fluency: evaluateFluency({
      capture: recording,
      words: transcriptWords,
      transcript: fixture.transcript,
    }),
    delivery: evaluateDelivery(recording),
    clarity: analyseClarity(transcriptWords, recording, fixture.pronunciation),
    content: { ...contentResult, provider: 'fixture', calls: 0 },
  })
}

export function calibrationSummary(payload: V2ScorePayload): string[] {
  return Object.values(payload.categories).map(
    (category) => `${category.category}:${category.status}:${category.earned_points ?? 'none'}`,
  )
}
const standard = [
  'fluency:scored:21',
  'clarity:scored:20',
  'vocabulary:scored:12',
  'grammar:scored:12',
  'structure:scored:18',
  'delivery:scored:4',
]
const baseline = (categories: readonly string[]): CalibrationBaseline => ({
  calibrationVersion: CALIBRATION_VERSION,
  scoreVersion: V2_SCORE_PAYLOAD_VERSION,
  rubricVersion: RUBRIC_VERSION,
  categories,
})
/** Intentionally checked-in expectations. The harness never updates these. */
export const CALIBRATION_BASELINES: Readonly<Record<CalibrationLabel, CalibrationBaseline>> = {
  'fluent-poorly-structured': baseline([
    ...standard.slice(0, 4),
    'structure:scored:14',
    'delivery:scored:4',
  ]),
  'structured-filler-heavy': baseline(['fluency:scored:17', ...standard.slice(1)]),
  monotone: baseline([...standard.slice(0, 5), 'delivery:scored:0']),
  rushed: baseline(['fluency:scored:18', ...standard.slice(1)]),
  'slow-long-pauses': baseline(['fluency:scored:22', ...standard.slice(1)]),
  'grammatical-mistakes': baseline([
    'fluency:scored:21',
    'clarity:scored:20',
    'vocabulary:scored:12',
    'grammar:scored:9',
    'structure:scored:18',
    'delivery:scored:4',
  ]),
  'vague-vocabulary': baseline([
    'fluency:scored:21',
    'clarity:scored:20',
    'vocabulary:scored:11',
    'grammar:scored:12',
    'structure:scored:18',
    'delivery:scored:4',
  ]),
  'strong-response': baseline(standard),
  'unclear-pronunciation': baseline([
    'fluency:scored:21',
    'clarity:not_checked:none',
    'vocabulary:scored:12',
    'grammar:scored:12',
    'structure:scored:18',
    'delivery:scored:4',
  ]),
  'intelligible-second-language-accent': baseline(standard),
}

export function compareCalibration(
  fixture: CalibrationFixture,
  baseline: CalibrationBaseline | undefined,
): string[] {
  if (!baseline) return [`${fixture.id}: missing baseline`]
  if (
    baseline.calibrationVersion !== CALIBRATION_VERSION ||
    baseline.scoreVersion !== V2_SCORE_PAYLOAD_VERSION ||
    baseline.rubricVersion !== RUBRIC_VERSION
  )
    return [
      `${fixture.id}: incompatible baseline ${baseline.scoreVersion}/${baseline.rubricVersion}`,
    ]
  const actual = calibrationSummary(runCalibrationFixture(fixture))
  return actual.flatMap((line, index) =>
    line === baseline.categories[index]
      ? []
      : [`${fixture.id}: ${baseline.categories[index] ?? 'missing'} -> ${line}`],
  )
}
