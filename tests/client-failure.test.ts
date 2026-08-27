import { describe, expect, it } from 'vitest'
import {
  clientFailureTransition,
  parseClientFailureReport,
  type ClientFailureOutcome,
  type ClientFailureStage,
} from '@/lib/attempts/client-failure'
import { ATTEMPT_FAILURE_CODES } from '@/lib/attempts/lifecycle'

describe('client failure reports', () => {
  it.each([
    ['transcribing', 'failed', ATTEMPT_FAILURE_CODES.clientTranscriptionFailed],
    ['transcribing', 'timed_out', ATTEMPT_FAILURE_CODES.clientTranscriptionTimeout],
    ['scoring', 'failed', ATTEMPT_FAILURE_CODES.clientScoringFailed],
    ['scoring', 'timed_out', ATTEMPT_FAILURE_CODES.clientScoringTimeout],
  ] as const)(
    'maps %s %s to a server-owned lifecycle transition',
    (expectedStage, outcome, failureCode) => {
      const report = parseClientFailureReport({ expectedStage, outcome })

      expect(report).toEqual({ expectedStage, outcome })
      expect(
        clientFailureTransition(
          report as {
            expectedStage: ClientFailureStage
            outcome: ClientFailureOutcome
          },
        ),
      ).toEqual({ expectedStatuses: [expectedStage], status: outcome, failureCode })
    },
  )

  it.each([
    null,
    [],
    { expectedStage: 'uploading', outcome: 'failed' },
    { expectedStage: 'done', outcome: 'failed' },
    { expectedStage: 'scoring', outcome: 'done' },
    { expectedStage: 'scoring', outcome: 'failed', failureCode: 'forged' },
    { expectedStage: 'scoring', outcome: 'failed', status: 'done' },
  ])('rejects an unbounded report %#', (value) => {
    expect(parseClientFailureReport(value)).toBeNull()
  })
})
