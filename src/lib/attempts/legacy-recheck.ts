import { readAttemptResult, type StoredAttemptResultInput } from '@/lib/results/attempt-result'

export interface LegacyRecheckSnapshotInput extends StoredAttemptResultInput {
  status: unknown
  rubricVersion: unknown
}

/**
 * The stored result discriminator is authoritative for the explicit legacy
 * provider retry. Row rubric metadata is accepted here only as context and
 * cannot turn malformed or unsupported JSON into a legacy snapshot.
 */
export function isLegacyRecheckSnapshot(input: LegacyRecheckSnapshotInput): boolean {
  if (input.status !== 'done') return false
  const result = readAttemptResult(input)
  return result.kind === 'legacy' && result.attempt.content.status === 'not_checked'
}
