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
  transcriptionTimeout: 'transcription_timeout',
  transcriptionUnavailable: 'transcription_unavailable',
  transcriptionRejected: 'transcription_rejected',
  transcriptionInvalidResponse: 'transcription_invalid_response',
  transcriptionPersistenceFailed: 'transcription_persistence_failed',
  scoringInputInvalid: 'scoring_input_invalid',
  scoringUnexpected: 'scoring_unexpected',
  scoringPersistenceFailed: 'scoring_persistence_failed',
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

export function terminalStatusForTimeout(timedOut: boolean): 'failed' | 'timed_out' {
  return timedOut ? 'timed_out' : 'failed'
}
