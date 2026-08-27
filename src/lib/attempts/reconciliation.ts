import 'server-only'

import { ATTEMPT_FAILURE_CODES, type AttemptStatus } from '@/lib/attempts/lifecycle'
import { logAttemptDiagnostic, type AttemptAdminClient } from '@/lib/attempts/server'
import { createAdminClient } from '@/lib/supabase/admin'

type ActiveAttemptStatus = Extract<AttemptStatus, 'uploading' | 'transcribing' | 'scoring'>
type ReconciledAttemptStatus = Extract<AttemptStatus, 'failed' | 'timed_out'>

/**
 * Uploading remains retryable in the browser and has no heartbeat, so its
 * cutoff is deliberately much longer than the bounded provider stages.
 */
export const STALE_ACTIVE_ATTEMPT_AGE_MS: Readonly<Record<ActiveAttemptStatus, number>> = {
  uploading: 30 * 60 * 1_000,
  transcribing: 5 * 60 * 1_000,
  scoring: 5 * 60 * 1_000,
}

const RECONCILIATION_RULES = [
  {
    stage: 'uploading',
    status: 'failed',
    failureCode: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
  },
  {
    stage: 'transcribing',
    status: 'timed_out',
    failureCode: ATTEMPT_FAILURE_CODES.clientTranscriptionTimeout,
  },
  {
    stage: 'scoring',
    status: 'timed_out',
    failureCode: ATTEMPT_FAILURE_CODES.clientScoringTimeout,
  },
] as const satisfies readonly {
  stage: ActiveAttemptStatus
  status: ReconciledAttemptStatus
  failureCode: string
}[]

export interface ReconciledStaleAttempt {
  id: string
  previousStatus: ActiveAttemptStatus
  status: ReconciledAttemptStatus
  failureCode: string
}

export interface StaleAttemptReconciliationOptions {
  /** Restricts result and retry reads to the attempt already present in the URL. */
  attemptId?: string
  /** Deterministic clock seam for tests. Production callers use server time. */
  now?: Date
}

export interface StaleAttemptReconciliationResult {
  status: 'ready' | 'failure'
  reconciled: readonly ReconciledStaleAttempt[]
}

async function reconcileStage(
  admin: AttemptAdminClient,
  userId: string,
  rule: (typeof RECONCILIATION_RULES)[number],
  options: StaleAttemptReconciliationOptions,
): Promise<StaleAttemptReconciliationResult> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - STALE_ACTIVE_ATTEMPT_AGE_MS[rule.stage]).toISOString()

  try {
    let query = admin
      .from('attempts')
      .update({ status: rule.status, failure_code: rule.failureCode })
      .eq('user_id', userId)
      .eq('status', rule.stage)
      .lt('status_changed_at', cutoff)
      .is('failure_code', null)
    if (options.attemptId) query = query.eq('id', options.attemptId)

    const { data, error } = await query.select('id')
    if (error) {
      logAttemptDiagnostic(
        'reconcile_stale_attempt',
        `stale_${rule.stage}_reconciliation_failed`,
        options.attemptId ?? null,
        error,
      )
      return { status: 'failure', reconciled: [] }
    }

    return {
      status: 'ready',
      reconciled: (data ?? []).map((row) => ({
        id: row.id,
        previousStatus: rule.stage,
        status: rule.status,
        failureCode: rule.failureCode,
      })),
    }
  } catch (error) {
    logAttemptDiagnostic(
      'reconcile_stale_attempt',
      `stale_${rule.stage}_reconciliation_failed`,
      options.attemptId ?? null,
      error,
    )
    return { status: 'failure', reconciled: [] }
  }
}

/**
 * Atomically closes only owner-scoped active rows older than their stage's
 * conservative cutoff. The update preserves audio, transcript, metrics, and
 * result evidence; the database trigger supplies terminal timestamps.
 */
export async function reconcileOwnedStaleAttempts(
  admin: AttemptAdminClient,
  userId: string,
  options: StaleAttemptReconciliationOptions = {},
): Promise<StaleAttemptReconciliationResult> {
  const outcomes = await Promise.all(
    RECONCILIATION_RULES.map((rule) => reconcileStage(admin, userId, rule, options)),
  )
  return {
    status: outcomes.some((outcome) => outcome.status === 'failure') ? 'failure' : 'ready',
    reconciled: outcomes.flatMap((outcome) => outcome.reconciled),
  }
}

/** Request-time wrapper for authenticated pages. Reconciliation is fail-open. */
export async function reconcileCurrentUserStaleAttempts(
  userId: string,
  options: StaleAttemptReconciliationOptions = {},
): Promise<StaleAttemptReconciliationResult> {
  try {
    return await reconcileOwnedStaleAttempts(createAdminClient(), userId, options)
  } catch (error) {
    logAttemptDiagnostic(
      'reconcile_stale_attempt',
      'stale_attempt_client_failed',
      options.attemptId ?? null,
      error,
    )
    return { status: 'failure', reconciled: [] }
  }
}
