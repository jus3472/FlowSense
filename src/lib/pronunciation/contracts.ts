/**
 * Provider-neutral pronunciation evidence. This is intentionally not a score:
 * FlowSense must not infer accent, native similarity, or a deduction from it.
 */
export const PRONUNCIATION_CONTRACT_VERSION = 'v1' as const

export type LexicalOutcome = 'match' | 'substitution' | 'insertion' | 'omission' | 'unsupported'

export type EvidenceAvailability = 'available' | 'not_checked' | 'unsupported'

export interface TimedWord {
  word: string
  startMs: number
  endMs: number
}

export interface PronunciationAssessmentRequest {
  contractVersion: typeof PRONUNCIATION_CONTRACT_VERSION
  provider: { id: string; model: string; version: string }
  locale: string
  scenario: 'scripted' | 'unscripted'
  audio: { contentType: string; durationMs: number }
  referenceText: string | null
  recognizedWords: readonly TimedWord[]
}

export interface PhonemeEvidence {
  expected: string | null
  recognized: string | null
  accuracy: number | null
  startMs: number | null
  endMs: number | null
}

export interface StressProsodyEvidence {
  availability: EvidenceAvailability
  stressAccuracy: number | null
  prosodyAccuracy: number | null
  detail: string | null
}

export interface PronunciationWordEvidence {
  referenceWord: string | null
  recognizedWord: string | null
  startMs: number | null
  endMs: number | null
  lexicalOutcome: LexicalOutcome
  /** Separate from Deepgram's probability that a transcript word is correct. */
  pronunciationAccuracy: number | null
  pronunciationAvailability: EvidenceAvailability
  phonemes: readonly PhonemeEvidence[]
  stressProsody: StressProsodyEvidence
  /** No provider result can infer this by accent or native similarity. */
  intelligibility: 'not_assessed' | 'intelligible' | 'uncertain'
  warning: string | null
}

export interface PronunciationProviderError {
  code: 'outage' | 'timeout' | 'malformed_response' | 'unsupported_locale' | 'unknown_word'
  message: string
  retryable: boolean
}

export interface PronunciationEvaluation {
  contractVersion: typeof PRONUNCIATION_CONTRACT_VERSION
  provider: { id: string; model: string; version: string; locale: string }
  status: 'completed' | 'not_checked' | 'failed'
  words: readonly PronunciationWordEvidence[]
  unsupportedWords: readonly string[]
  warnings: readonly string[]
  error: PronunciationProviderError | null
  /** Deliberately false for this spike and until paired-audio validation passes. */
  eligibleForDeductions: false
}

export type PronunciationParseResult =
  { ok: true; value: PronunciationEvaluation } | { ok: false; error: PronunciationProviderError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value)
}

function nullableUnit(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
  )
}

function nullableTime(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function parseError(value: unknown): PronunciationProviderError | null {
  if (
    !isRecord(value) ||
    !text(value.code) ||
    !text(value.message) ||
    typeof value.retryable !== 'boolean'
  ) {
    return null
  }
  return ['outage', 'timeout', 'malformed_response', 'unsupported_locale', 'unknown_word'].includes(
    value.code,
  )
    ? {
        code: value.code as PronunciationProviderError['code'],
        message: value.message,
        retryable: value.retryable,
      }
    : null
}

function parsePhoneme(value: unknown): PhonemeEvidence | null {
  if (!isRecord(value)) return null
  if (
    !nullableText(value.expected) ||
    !nullableText(value.recognized) ||
    !nullableUnit(value.accuracy) ||
    !nullableTime(value.startMs) ||
    !nullableTime(value.endMs)
  ) {
    return null
  }
  if (value.startMs !== null && value.endMs !== null && value.endMs < value.startMs) return null
  return {
    expected: value.expected,
    recognized: value.recognized,
    accuracy: value.accuracy,
    startMs: value.startMs,
    endMs: value.endMs,
  }
}

function parseStressProsody(value: unknown): StressProsodyEvidence | null {
  if (!isRecord(value)) return null
  if (
    !['available', 'not_checked', 'unsupported'].includes(String(value.availability)) ||
    !nullableUnit(value.stressAccuracy) ||
    !nullableUnit(value.prosodyAccuracy) ||
    !nullableText(value.detail)
  ) {
    return null
  }
  return {
    availability: value.availability as EvidenceAvailability,
    stressAccuracy: value.stressAccuracy,
    prosodyAccuracy: value.prosodyAccuracy,
    detail: value.detail,
  }
}

function parseWord(value: unknown): PronunciationWordEvidence | null {
  if (!isRecord(value) || !Array.isArray(value.phonemes)) return null
  if (
    !nullableText(value.referenceWord) ||
    !nullableText(value.recognizedWord) ||
    !nullableTime(value.startMs) ||
    !nullableTime(value.endMs) ||
    !['match', 'substitution', 'insertion', 'omission', 'unsupported'].includes(
      String(value.lexicalOutcome),
    ) ||
    !nullableUnit(value.pronunciationAccuracy) ||
    !['available', 'not_checked', 'unsupported'].includes(
      String(value.pronunciationAvailability),
    ) ||
    !['not_assessed', 'intelligible', 'uncertain'].includes(String(value.intelligibility)) ||
    !nullableText(value.warning)
  ) {
    return null
  }
  if (value.startMs !== null && value.endMs !== null && value.endMs < value.startMs) return null
  const phonemes = value.phonemes.map(parsePhoneme)
  const stressProsody = parseStressProsody(value.stressProsody)
  if (phonemes.some((phoneme) => phoneme === null) || !stressProsody) return null
  if (value.pronunciationAvailability !== 'available' && value.pronunciationAccuracy !== null)
    return null
  return {
    referenceWord: value.referenceWord,
    recognizedWord: value.recognizedWord,
    startMs: value.startMs,
    endMs: value.endMs,
    lexicalOutcome: value.lexicalOutcome as LexicalOutcome,
    pronunciationAccuracy: value.pronunciationAccuracy,
    pronunciationAvailability: value.pronunciationAvailability as EvidenceAvailability,
    phonemes: phonemes as PhonemeEvidence[],
    stressProsody,
    intelligibility: value.intelligibility as PronunciationWordEvidence['intelligibility'],
    warning: value.warning,
  }
}

/** Validates stored/provider-normalized JSON without issuing network calls. */
export function parsePronunciationEvaluation(value: unknown): PronunciationParseResult {
  if (!isRecord(value) || !isRecord(value.provider) || !Array.isArray(value.words)) {
    return {
      ok: false,
      error: {
        code: 'malformed_response',
        message: 'Response shape was invalid.',
        retryable: true,
      },
    }
  }
  const provider = value.provider
  if (
    value.contractVersion !== PRONUNCIATION_CONTRACT_VERSION ||
    !text(provider.id) ||
    !text(provider.model) ||
    !text(provider.version) ||
    !text(provider.locale) ||
    !['completed', 'not_checked', 'failed'].includes(String(value.status)) ||
    !Array.isArray(value.unsupportedWords) ||
    !value.unsupportedWords.every(text) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(text) ||
    value.eligibleForDeductions !== false
  ) {
    return {
      ok: false,
      error: {
        code: 'malformed_response',
        message: 'Response metadata was invalid.',
        retryable: true,
      },
    }
  }
  const words = value.words.map(parseWord)
  const error = value.error === null ? null : parseError(value.error)
  if (words.some((word) => word === null) || (value.error !== null && !error)) {
    return {
      ok: false,
      error: {
        code: 'malformed_response',
        message: 'Response evidence was invalid.',
        retryable: true,
      },
    }
  }
  if (value.status === 'failed' && !error) {
    return {
      ok: false,
      error: {
        code: 'malformed_response',
        message: 'Failed response lacked an error.',
        retryable: true,
      },
    }
  }
  return {
    ok: true,
    value: {
      contractVersion: PRONUNCIATION_CONTRACT_VERSION,
      provider: {
        id: provider.id,
        model: provider.model,
        version: provider.version,
        locale: provider.locale,
      },
      status: value.status as PronunciationEvaluation['status'],
      words: words as PronunciationWordEvidence[],
      unsupportedWords: value.unsupportedWords,
      warnings: value.warnings,
      error,
      eligibleForDeductions: false,
    },
  }
}
