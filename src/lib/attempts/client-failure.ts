import {
  ATTEMPT_FAILURE_CODES,
  type AttemptFailureCode,
  type AttemptStatus,
} from '@/lib/attempts/lifecycle'

export const CLIENT_FAILURE_STAGES = ['transcribing', 'scoring'] as const
export const CLIENT_FAILURE_OUTCOMES = ['failed', 'timed_out'] as const

export type ClientFailureStage = (typeof CLIENT_FAILURE_STAGES)[number]
export type ClientFailureOutcome = (typeof CLIENT_FAILURE_OUTCOMES)[number]

export interface ClientFailureReport {
  expectedStage: ClientFailureStage
  outcome: ClientFailureOutcome
}

export interface ClientFailureTransition {
  expectedStatuses: readonly [ClientFailureStage]
  status: Extract<AttemptStatus, 'failed' | 'timed_out'>
  failureCode: AttemptFailureCode
}

const FAILURE_CODE: Readonly<
  Record<ClientFailureStage, Readonly<Record<ClientFailureOutcome, AttemptFailureCode>>>
> = {
  transcribing: {
    failed: ATTEMPT_FAILURE_CODES.clientTranscriptionFailed,
    timed_out: ATTEMPT_FAILURE_CODES.clientTranscriptionTimeout,
  },
  scoring: {
    failed: ATTEMPT_FAILURE_CODES.clientScoringFailed,
    timed_out: ATTEMPT_FAILURE_CODES.clientScoringTimeout,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accepts only the bounded stage and outcome the browser is allowed to report. */
export function parseClientFailureReport(value: unknown): ClientFailureReport | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== 'expectedStage' || keys[1] !== 'outcome') return null

  const expectedStage = value.expectedStage
  const outcome = value.outcome
  if (
    typeof expectedStage !== 'string' ||
    !(CLIENT_FAILURE_STAGES as readonly string[]).includes(expectedStage) ||
    typeof outcome !== 'string' ||
    !(CLIENT_FAILURE_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    return null
  }

  return {
    expectedStage: expectedStage as ClientFailureStage,
    outcome: outcome as ClientFailureOutcome,
  }
}

/** Maps browser facts to the server-owned lifecycle status and diagnostic code. */
export function clientFailureTransition(report: ClientFailureReport): ClientFailureTransition {
  return {
    expectedStatuses: [report.expectedStage],
    status: report.outcome,
    failureCode: FAILURE_CODE[report.expectedStage][report.outcome],
  }
}
