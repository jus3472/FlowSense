import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { AttemptFailureCode, AttemptStatus } from '@/lib/attempts/lifecycle'
import type { Database } from '@/lib/types/database'

export type AttemptAdminClient = ReturnType<typeof createAdminClient>

export async function authenticatedAttemptContext(): Promise<{
  userId: string
  admin: AttemptAdminClient
} | null> {
  const authClient = await createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()
  return user ? { userId: user.id, admin: createAdminClient() } : null
}

export function safeDiagnosticCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown'
  for (const key of ['code', 'statusCode', 'name']) {
    const value = key in error ? error[key as keyof typeof error] : undefined
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value
  }
  return 'unknown'
}

export function logAttemptDiagnostic(
  operation: string,
  code: string,
  attemptId: string | null,
  error?: unknown,
): void {
  console.error('[attempts] operation failed', {
    operation,
    code,
    ...(attemptId ? { attemptId } : {}),
    ...(error === undefined ? {} : { diagnostic: safeDiagnosticCode(error) }),
  })
}

export async function transitionOwnedAttempt(
  admin: AttemptAdminClient,
  userId: string,
  attemptId: string,
  expectedStatuses: readonly AttemptStatus[],
  status: AttemptStatus,
  values: Database['public']['Tables']['attempts']['Update'] = {},
): Promise<boolean> {
  const { data, error } = await admin
    .from('attempts')
    .update({ ...values, status })
    .eq('id', attemptId)
    .eq('user_id', userId)
    .in('status', [...expectedStatuses])
    .select('id')
    .maybeSingle()

  if (error) {
    logAttemptDiagnostic('status_transition', 'status_transition_failed', attemptId, error)
    return false
  }
  return data !== null
}

export async function markOwnedAttemptFailure(
  admin: AttemptAdminClient,
  userId: string,
  attemptId: string,
  expectedStatuses: readonly AttemptStatus[],
  status: 'failed' | 'timed_out',
  failureCode: AttemptFailureCode,
  values: Database['public']['Tables']['attempts']['Update'] = {},
): Promise<void> {
  const updated = await transitionOwnedAttempt(admin, userId, attemptId, expectedStatuses, status, {
    ...values,
    failure_code: failureCode,
  })
  if (!updated) {
    logAttemptDiagnostic('mark_failure', failureCode, attemptId)
  }
}
