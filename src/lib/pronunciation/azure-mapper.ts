import {
  parsePronunciationEvaluation,
  type LexicalOutcome,
  type PhonemeEvidence,
  type PronunciationAssessmentRequest,
  type PronunciationEvaluation,
  type PronunciationParseResult,
  type PronunciationWordEvidence,
  type TimedWord,
} from '@/lib/pronunciation/contracts'

const TICKS_PER_MILLISECOND = 10_000
const AZURE_ERROR_TYPES = ['None', 'Insertion', 'Omission', 'Unknown', 'Mispronunciation'] as const

type AzureErrorType = (typeof AZURE_ERROR_TYPES)[number]

interface AzureWord {
  word: string
  errorType: AzureErrorType
  accuracy: number | null
  startMs: number | null
  endMs: number | null
  phonemes: readonly PhonemeEvidence[]
}

interface Alignment {
  outcome: LexicalOutcome
  reference: TimedWord | null
  azure: AzureWord | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function finiteScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value / 100
    : null
}

function finiteTicks(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function malformed(message: string): PronunciationParseResult {
  return {
    ok: false,
    error: { code: 'malformed_response', message, retryable: true },
  }
}

function parseAzureWord(value: unknown, audioDurationMs: number): AzureWord | null {
  if (!isRecord(value) || typeof value.Word !== 'string' || value.Word.trim().length === 0) {
    return null
  }
  const rawErrorType = value.ErrorType
  if (
    typeof rawErrorType !== 'string' ||
    !AZURE_ERROR_TYPES.includes(rawErrorType as AzureErrorType)
  ) {
    return null
  }
  const errorType = rawErrorType as AzureErrorType
  const accuracy = finiteScore(value.AccuracyScore)
  if (accuracy === null) return null

  const offset = finiteTicks(value.Offset)
  const duration = finiteTicks(value.Duration)
  let startMs: number | null = null
  let endMs: number | null = null
  if (errorType !== 'Omission') {
    if (offset === null || duration === null || duration <= 0) return null
    startMs = offset / TICKS_PER_MILLISECOND
    endMs = (offset + duration) / TICKS_PER_MILLISECOND
    if (endMs <= startMs || endMs > audioDurationMs) return null
  } else if (offset !== null || duration !== null) {
    if (offset === null || duration === null || duration < 0) return null
    startMs = offset / TICKS_PER_MILLISECOND
    endMs = (offset + duration) / TICKS_PER_MILLISECOND
    if (endMs < startMs || endMs > audioDurationMs) return null
  }

  const phonemes: PhonemeEvidence[] = []
  const rawPhonemes = Array.isArray(value.Phonemes) ? value.Phonemes : []
  for (const rawPhoneme of rawPhonemes) {
    if (
      !isRecord(rawPhoneme) ||
      typeof rawPhoneme.Phoneme !== 'string' ||
      rawPhoneme.Phoneme.trim().length === 0
    ) {
      return null
    }
    const phonemeAccuracy = finiteScore(rawPhoneme.AccuracyScore)
    if (phonemeAccuracy === null) return null
    phonemes.push({
      expected: rawPhoneme.Phoneme,
      recognized: null,
      accuracy: phonemeAccuracy,
      startMs: null,
      endMs: null,
    })
  }

  return { word: value.Word, errorType, accuracy, startMs, endMs, phonemes }
}

function chooseLowest<T extends { cost: number; priority: number }>(choices: readonly T[]): T {
  return [...choices].sort(
    (left, right) => left.cost - right.cost || left.priority - right.priority,
  )[0] as T
}

/** Deterministic Levenshtein alignment with Azure's explicit miscues pinned. */
export function alignAzureWords(
  references: readonly TimedWord[],
  azureWords: readonly AzureWord[],
): readonly Alignment[] {
  const rows = references.length + 1
  const columns = azureWords.length + 1
  const costs = Array.from({ length: rows }, () => Array<number>(columns).fill(0))
  const steps = Array.from({ length: rows }, () =>
    Array<Alignment['outcome']>(columns).fill('match'),
  )

  for (let row = 1; row < rows; row += 1) {
    costs[row]![0] = row
    steps[row]![0] = 'omission'
  }
  for (let column = 1; column < columns; column += 1) {
    costs[0]![column] = column
    steps[0]![column] = 'insertion'
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const reference = references[row - 1]!
      const azure = azureWords[column - 1]!
      if (azure.errorType === 'Insertion') {
        costs[row]![column] = costs[row]![column - 1]!
        steps[row]![column] = 'insertion'
        continue
      }
      if (azure.errorType === 'Omission') {
        costs[row]![column] =
          normalize(reference.word) === normalize(azure.word)
            ? costs[row - 1]![column - 1]!
            : Number.POSITIVE_INFINITY
        steps[row]![column] = 'omission'
        continue
      }

      const sameWord = normalize(reference.word) === normalize(azure.word)
      const selected = chooseLowest([
        {
          cost: costs[row - 1]![column - 1]! + (sameWord ? 0 : 1),
          priority: 0,
          step: sameWord ? ('match' as const) : ('substitution' as const),
        },
        { cost: costs[row - 1]![column]! + 1, priority: 1, step: 'omission' as const },
        { cost: costs[row]![column - 1]! + 1, priority: 2, step: 'insertion' as const },
      ])
      costs[row]![column] = selected.cost
      steps[row]![column] = selected.step
    }
  }

  const aligned: Alignment[] = []
  let row = references.length
  let column = azureWords.length
  while (row > 0 || column > 0) {
    const step = steps[row]![column]!
    if ((step === 'match' || step === 'substitution') && row > 0 && column > 0) {
      aligned.push({
        outcome: step,
        reference: references[row - 1]!,
        azure: azureWords[column - 1]!,
      })
      row -= 1
      column -= 1
    } else if (step === 'omission' && row > 0) {
      const azure =
        column > 0 && azureWords[column - 1]?.errorType === 'Omission'
          ? azureWords[column - 1]!
          : null
      aligned.push({ outcome: 'omission', reference: references[row - 1]!, azure })
      row -= 1
      if (azure) column -= 1
    } else if (column > 0) {
      aligned.push({ outcome: 'insertion', reference: null, azure: azureWords[column - 1]! })
      column -= 1
    } else {
      aligned.push({ outcome: 'omission', reference: references[row - 1]!, azure: null })
      row -= 1
    }
  }
  return aligned.reverse()
}

function normalizedWord(alignment: Alignment): PronunciationWordEvidence {
  const { outcome, reference, azure } = alignment
  const sameWord = Boolean(
    reference && azure && normalize(reference.word) === normalize(azure.word),
  )
  const unsupported = outcome === 'match' && azure?.errorType === 'Unknown' && sameWord
  const assessmentAvailable = outcome === 'match' && !unsupported && azure?.accuracy !== null
  const phonemes = assessmentAvailable ? (azure?.phonemes ?? []) : []
  return {
    referenceWord: reference?.word ?? null,
    recognizedWord: outcome === 'omission' ? null : (azure?.word ?? null),
    startMs: outcome === 'omission' ? null : (azure?.startMs ?? null),
    endMs: outcome === 'omission' ? null : (azure?.endMs ?? null),
    lexicalOutcome: unsupported ? 'unsupported' : outcome,
    pronunciationAccuracy: assessmentAvailable ? (azure?.accuracy ?? null) : null,
    pronunciationAvailability: unsupported
      ? 'unsupported'
      : assessmentAvailable
        ? 'available'
        : 'not_checked',
    phonemeAvailability: unsupported
      ? 'unsupported'
      : phonemes.length > 0
        ? 'available'
        : 'unsupported',
    phonemes,
    stressProsody: {
      availability: 'not_checked',
      stressAccuracy: null,
      prosodyAccuracy: null,
      detail: null,
    },
    warning:
      azure?.errorType && azure.errorType !== 'None'
        ? 'Azure reported a word-level assessment caveat.'
        : null,
  }
}

function requestWordsAreValid(request: PronunciationAssessmentRequest): boolean {
  let previousEnd = 0
  return request.recognizedWords.every((word) => {
    const valid =
      word.word.trim().length > 0 &&
      Number.isFinite(word.startMs) &&
      Number.isFinite(word.endMs) &&
      word.startMs >= previousEnd &&
      word.endMs > word.startMs &&
      word.endMs <= request.audio.durationMs
    previousEnd = word.endMs
    return valid
  })
}

/** Maps only Azure word and sound evidence. Aggregate dimensions are ignored. */
export function mapAzurePronunciationResponse(
  payload: unknown,
  request: PronunciationAssessmentRequest,
): PronunciationParseResult {
  if (!requestWordsAreValid(request)) return malformed('The reference word timings were invalid.')
  if (!isRecord(payload) || payload.RecognitionStatus !== 'Success') {
    return malformed('Azure recognition did not succeed.')
  }
  if (!Array.isArray(payload.NBest) || payload.NBest.length === 0) {
    return malformed('Azure response did not contain a result.')
  }
  const best = payload.NBest[0]
  if (!isRecord(best) || !Array.isArray(best.Words)) {
    return malformed('Azure response words were invalid.')
  }
  const azureWords = best.Words.map((word) => parseAzureWord(word, request.audio.durationMs))
  if (azureWords.some((word) => word === null)) {
    return malformed('Azure response contained invalid word evidence.')
  }
  let previousAzureEnd = 0
  for (const word of azureWords as AzureWord[]) {
    if (word.errorType === 'Omission') continue
    if (word.startMs === null || word.endMs === null || word.startMs < previousAzureEnd) {
      return malformed('Azure response contained contradictory word timings.')
    }
    previousAzureEnd = word.endMs
  }
  const words = alignAzureWords(request.recognizedWords, azureWords as AzureWord[]).map(
    normalizedWord,
  )
  const unsupportedWords = [
    ...new Set(
      words
        .filter((word) => word.lexicalOutcome === 'unsupported')
        .flatMap((word) => [word.referenceWord, word.recognizedWord])
        .filter((word): word is string => word !== null),
    ),
  ]
  const evaluation: PronunciationEvaluation = {
    contractVersion: 'v1',
    provider: {
      id: 'azure-speech',
      model: request.provider.model,
      version: request.provider.version,
      locale: request.locale,
    },
    status: words.some((word) => word.pronunciationAvailability === 'available')
      ? 'completed'
      : 'not_checked',
    words,
    unsupportedWords,
    warnings: words.flatMap((word) => (word.warning ? [word.warning] : [])),
    error: null,
    eligibleForDeductions: false,
  }
  return parsePronunciationEvaluation(evaluation)
}
