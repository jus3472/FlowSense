export const ATTEMPT_STATUSES = [
  'uploading',
  'transcribing',
  'scoring',
  'done',
  'failed',
  'timed_out',
] as const

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number]

export const ATTEMPT_FAILURE_CODES = {
  uploadMissing: 'upload_missing',
  uploadVerificationFailed: 'upload_verification_failed',
  recordingUnavailable: 'recording_unavailable',
  recordingPathInvalid: 'recording_path_invalid',
  transcriptionTimeout: 'transcription_timeout',
  transcriptionUnavailable: 'transcription_unavailable',
  transcriptionRejected: 'transcription_rejected',
  transcriptionInvalidResponse: 'transcription_invalid_response',
  transcriptionPersistenceFailed: 'transcription_persistence_failed',
  scoringInputInvalid: 'scoring_input_invalid',
  scoringUnexpected: 'scoring_unexpected',
  scoringPersistenceFailed: 'scoring_persistence_failed',
  unsupportedRubricVersion: 'unsupported_rubric_version',
  clientUploadAbandoned: 'client_upload_abandoned',
  clientTranscriptionFailed: 'client_transcription_failed',
  clientTranscriptionTimeout: 'client_transcription_timeout',
  clientScoringFailed: 'client_scoring_failed',
  clientScoringTimeout: 'client_scoring_timeout',
  deletionInProgress: 'deletion_in_progress',
} as const

export type AttemptFailureCode = (typeof ATTEMPT_FAILURE_CODES)[keyof typeof ATTEMPT_FAILURE_CODES]

const TRANSITIONS: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  uploading: ['transcribing', 'failed', 'timed_out'],
  transcribing: ['scoring', 'failed', 'timed_out'],
  scoring: ['done', 'failed', 'timed_out'],
  done: [],
  failed: ['transcribing', 'scoring'],
  timed_out: ['transcribing', 'scoring'],
}

export function isAttemptStatus(value: unknown): value is AttemptStatus {
  return typeof value === 'string' && (ATTEMPT_STATUSES as readonly string[]).includes(value)
}

/** Only settled attempts can be used as the immutable parent of a new recording. */
export function isRetryableAttemptStatus(
  value: unknown,
): value is Extract<AttemptStatus, 'done' | 'failed' | 'timed_out'> {
  return value === 'done' || value === 'failed' || value === 'timed_out'
}

export function isActiveAttemptStatus(
  value: unknown,
): value is Extract<AttemptStatus, 'uploading' | 'transcribing' | 'scoring'> {
  return value === 'uploading' || value === 'transcribing' || value === 'scoring'
}

/** Mirrors the database transition constraint for route-level fail-fast checks. */
export function canTransitionAttempt(from: AttemptStatus, to: AttemptStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function canFinalizeAttemptUpload(status: AttemptStatus): boolean {
  return status === 'uploading' || status === 'failed' || status === 'timed_out'
}

export function canRunTranscription(status: AttemptStatus): boolean {
  return status === 'transcribing' || status === 'failed' || status === 'timed_out'
}

export function canRunScoring(status: AttemptStatus): boolean {
  return status === 'scoring' || status === 'failed' || status === 'timed_out'
}

export type AttemptRubricKind = 'v2' | 'legacy' | 'unsupported'

/** Only explicit legacy metadata may use the historical scoring implementation. */
export function classifyAttemptRubric(value: unknown): AttemptRubricKind {
  if (value === 'v2') return 'v2'
  if (value === null || value === 'v1' || value === 'legacy') return 'legacy'
  return 'unsupported'
}

/** A genuine legacy retry overrides contradictory v2 row metadata. */
export function shouldUseV2Assembler(
  rubricKind: AttemptRubricKind,
  hasV2Mode: boolean,
  legacyRecheck: boolean,
): boolean {
  return rubricKind === 'v2' && hasV2Mode && !legacyRecheck
}

export function terminalStatusForTimeout(timedOut: boolean): 'failed' | 'timed_out' {
  return timedOut ? 'timed_out' : 'failed'
}
