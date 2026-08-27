export type AuthOperation = 'sign_out' | 'logout_cleanup'

export interface AuthDiagnostic {
  operation: AuthOperation
  code: string
  status: number | null
}

const SAFE_SIGN_OUT_CODES = new Set([
  'bad_json',
  'bad_jwt',
  'no_authorization',
  'refresh_token_already_used',
  'refresh_token_not_found',
  'request_timeout',
  'session_expired',
  'session_not_found',
  'unexpected_failure',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extracts only bounded auth metadata, never an error message or cause. */
export function boundedAuthDiagnostic(operation: AuthOperation, error: unknown): AuthDiagnostic {
  const code = isRecord(error) ? error.code : undefined
  const status = isRecord(error) ? error.status : undefined
  return {
    operation,
    code: typeof code === 'string' && SAFE_SIGN_OUT_CODES.has(code) ? code : 'unknown',
    status:
      typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : null,
  }
}

export function logAuthDiagnostic(operation: AuthOperation, error: unknown): void {
  console.error('[auth] operation failed', boundedAuthDiagnostic(operation, error))
}
