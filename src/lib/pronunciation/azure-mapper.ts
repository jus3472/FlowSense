import type {
  LexicalOutcome,
  PronunciationAssessmentRequest,
  PronunciationEvaluation,
  PronunciationParseResult,
  PronunciationWordEvidence,
} from '@/lib/pronunciation/contracts'

const TICKS_PER_MILLISECOND = 10_000

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteUnit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value / 100
    : null
}

function finiteTicks(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function error(message: string): PronunciationParseResult {
  return {
    ok: false,
    error: { code: 'malformed_response', message, retryable: true },
  }
}

function outcome(reference: string | null, recognized: string | null): LexicalOutcome {
  if (!reference && recognized) return 'insertion'
  if (reference && !recognized) return 'omission'
  if (reference && recognized && normalize(reference) === normalize(recognized)) return 'match'
  if (reference && recognized) return 'substitution'
  return 'unsupported'
}

function emptyStress() {
  return {
    availability: 'not_checked' as const,
    stressAccuracy: null,
    prosodyAccuracy: null,
    detail: null,
  }
}

function mapWord(
  value: unknown,
  reference: string | null,
  recognized: string | null,
  durationMs: number,
): PronunciationWordEvidence | null {
  if (!record(value) || typeof value.Word !== 'string' || value.Word.trim().length === 0) {
    return null
  }
  const offset = finiteTicks(value.Offset)
  const duration = finiteTicks(value.Duration)
  if (offset === null || duration === null || duration <= 0) return null
  const startMs = offset / TICKS_PER_MILLISECOND
  const endMs = (offset + duration) / TICKS_PER_MILLISECOND
  if (endMs > durationMs || endMs <= startMs) return null

  const assessment = record(value.PronunciationAssessment) ? value.PronunciationAssessment : null
  const accuracy = assessment ? finiteUnit(assessment.AccuracyScore) : null
  if (assessment && 'AccuracyScore' in assessment && accuracy === null) return null
  const providerErrorType =
    assessment && typeof assessment.ErrorType === 'string' ? assessment.ErrorType : 'None'
  if (!['None', 'Insertion', 'Omission', 'Unknown', 'Mispronunciation'].includes(providerErrorType)) {
    return null
  }
  const unsupported =
    providerErrorType === 'Unknown' &&
    reference !== null &&
    recognized !== null &&
    normalize(reference) === normalize(recognized)
  const alignedReference = providerErrorType === 'Insertion' ? null : reference
  const lexicalOutcome = unsupported ? 'unsupported' : outcome(alignedReference, recognized)
  const phonemes: Array<PronunciationWordEvidence['phonemes'][number]> = []
  const rawPhonemes = Array.isArray(value.Phonemes) ? value.Phonemes : []
  for (const raw of rawPhonemes) {
    if (!record(raw) || typeof raw.Phoneme !== 'string' || raw.Phoneme.trim().length === 0) {
      return null
    }
    const phonemeAssessment = record(raw.PronunciationAssessment)
      ? raw.PronunciationAssessment
      : null
    const phonemeAccuracy = phonemeAssessment ? finiteUnit(phonemeAssessment.AccuracyScore) : null
    if (phonemeAssessment && 'AccuracyScore' in phonemeAssessment && phonemeAccuracy === null) {
      return null
    }
    if (phonemeAccuracy === null) return null
    phonemes.push({
      expected: raw.Phoneme,
      recognized: raw.Phoneme,
      accuracy: phonemeAccuracy,
      startMs: null,
      endMs: null,
    })
  }

  return {
    referenceWord: alignedReference,
    recognizedWord: recognized,
    startMs,
    endMs,
    lexicalOutcome,
    pronunciationAccuracy: unsupported ? null : accuracy,
    pronunciationAvailability: unsupported
      ? 'unsupported'
      : accuracy === null
        ? 'not_checked'
        : 'available',
    phonemeAvailability: unsupported
      ? 'unsupported'
      : phonemes.length > 0
        ? 'available'
        : 'unsupported',
    phonemes: unsupported ? [] : phonemes,
    stressProsody: emptyStress(),
    warning:
      providerErrorType !== 'None'
        ? 'Azure reported a word-level assessment caveat.'
        : accuracy === null
          ? 'Azure did not provide word-level accuracy.'
          : null,
  }
}

/** Maps only Azure word/phoneme evidence. Aggregate dimensions are ignored. */
export function mapAzurePronunciationResponse(
  payload: unknown,
  request: PronunciationAssessmentRequest,
): PronunciationParseResult {
  let previousRequestEnd = 0
  for (const word of request.recognizedWords) {
    if (
      typeof word.word !== 'string' ||
      word.word.trim().length === 0 ||
      !Number.isFinite(word.startMs) ||
      !Number.isFinite(word.endMs) ||
      word.startMs < previousRequestEnd ||
      word.endMs <= word.startMs ||
      word.endMs > request.audio.durationMs
    ) {
      return error('The reference word timings were invalid.')
    }
    previousRequestEnd = word.endMs
  }
  if (!record(payload) || !Array.isArray(payload.NBest) || payload.NBest.length === 0) {
    return error('Azure response did not contain a result.')
  }
  const best = payload.NBest[0]
  if (!record(best) || !Array.isArray(best.Words))
    return error('Azure response words were invalid.')
  if (best.Words.length === 0 && request.recognizedWords.length > 0) {
    return error('Azure response did not contain word evidence.')
  }

  const mapped: PronunciationWordEvidence[] = []
  let previousEnd = 0
  for (let index = 0; index < best.Words.length; index += 1) {
    const raw = best.Words[index]
    const recognized = record(raw) && typeof raw.Word === 'string' ? raw.Word : null
    const reference = request.recognizedWords[index]?.word ?? null
    const word = mapWord(raw, reference, recognized, request.audio.durationMs)
    if (!word || (word.startMs !== null && word.startMs < previousEnd)) {
      return error('Azure response contained contradictory word timings.')
    }
    previousEnd = word.endMs ?? previousEnd
    mapped.push(word)
  }

  const evaluation: PronunciationEvaluation = {
    contractVersion: 'v1',
    provider: {
      id: 'azure-speech',
      model: request.provider.model,
      version: request.provider.version,
      locale: request.locale,
    },
    status: mapped.some((word) => word.pronunciationAvailability === 'available')
      ? 'completed'
      : 'not_checked',
    words: mapped,
    unsupportedWords: mapped
      .filter((word) => word.lexicalOutcome === 'unsupported')
      .map((word) => word.referenceWord ?? ''),
    warnings: mapped.filter((word) => word.warning).map((word) => word.warning as string),
    error: null,
    eligibleForDeductions: false,
  }
  return { ok: true, value: evaluation }
}
