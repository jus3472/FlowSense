import { fetchWithTimeout, RequestTimeoutError } from '@/lib/net/fetch-with-timeout'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-v4-flash'
export const DEEPSEEK_CONTENT_MAX_TOKENS = 4_096
export const CONTENT_PROVIDER_UNAVAILABLE_MESSAGE = 'The content provider was unavailable.'

export type ContentProviderFailureCode =
  | 'authentication_error'
  | 'configuration_error'
  | 'empty_response'
  | 'malformed_json'
  | 'network_failure'
  | 'rate_limit'
  | 'schema_invalid'
  | 'server_error'
  | 'timeout'
  | 'truncated_response'
  | 'unknown_provider_failure'

export interface ContentProviderFailureDiagnostic {
  provider: 'deepseek'
  model: string
  code: ContentProviderFailureCode
  status: number | null
}

const SAFE_MODEL_PATTERN = /^[a-zA-Z0-9._:-]{1,80}$/

function safeModelName(model: string): string {
  const candidate = model.trim()
  return SAFE_MODEL_PATTERN.test(candidate) ? candidate : 'unknown'
}

function safeHttpStatus(status: number | undefined): number | null {
  return Number.isInteger(status) && status !== undefined && status >= 100 && status <= 599
    ? status
    : null
}

export class ContentProviderFailure extends Error {
  readonly diagnostic: Readonly<ContentProviderFailureDiagnostic>

  constructor(code: ContentProviderFailureCode, model: string, status?: number) {
    super(CONTENT_PROVIDER_UNAVAILABLE_MESSAGE)
    this.name = 'ContentProviderFailure'
    // Do not attach the source error as a cause. Transport and configuration
    // errors can echo request data or credentials when they are serialized.
    this.diagnostic = Object.freeze({
      provider: 'deepseek',
      model: safeModelName(model),
      code,
      status: safeHttpStatus(status),
    })
  }
}

const reportedFailures = new WeakSet<ContentProviderFailure>()

/** Logs the bounded diagnostic once, even when multiple failure boundaries see the same error. */
export function reportContentProviderFailure(
  error: unknown,
  model: string,
  fallbackCode: ContentProviderFailureCode = 'unknown_provider_failure',
): ContentProviderFailure {
  const failure =
    error instanceof ContentProviderFailure
      ? error
      : new ContentProviderFailure(
          error instanceof RequestTimeoutError ? 'timeout' : fallbackCode,
          model,
        )

  if (!reportedFailures.has(failure)) {
    reportedFailures.add(failure)
    console.warn(failure.diagnostic)
  }
  return failure
}

const RETRYABLE_FAILURE_CODES = new Set<ContentProviderFailureCode>([
  'empty_response',
  'malformed_json',
  'network_failure',
  'rate_limit',
  'schema_invalid',
  'server_error',
  'timeout',
  'truncated_response',
])

/** Keeps retry policy bounded to explicit, sanitized failure classes. */
export function isRetryableContentProviderFailure(error: unknown): boolean {
  return (
    error instanceof ContentProviderFailure && RETRYABLE_FAILURE_CODES.has(error.diagnostic.code)
  )
}

export interface ContentModelRequest {
  system: string
  user: string
  timeoutMs?: number
}

/**
 * The seam that keeps the provider swappable. Everything above this returns
 * plain JSON text, so changing model or vendor is a config change.
 */
export interface ContentModel {
  readonly name: string
  complete(request: ContentModelRequest): Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function httpFailureCode(status: number): ContentProviderFailureCode {
  if (status === 401 || status === 403) return 'authentication_error'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status >= 500 && status <= 599) return 'server_error'
  if (status >= 400 && status <= 499) return 'configuration_error'
  return 'unknown_provider_failure'
}

export function createDeepSeekModel(apiKey: string, model = DEEPSEEK_MODEL): ContentModel {
  return {
    name: model,
    async complete({ system, user, timeoutMs = 30_000 }) {
      let response: Response
      try {
        response = await fetchWithTimeout(
          `${DEEPSEEK_BASE_URL}/chat/completions`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              // Verified against a live call: without this the model still emits a
              // reasoning trace and bills the tokens. These calls return structured
              // JSON and have no use for one.
              thinking: { type: 'disabled' },
              response_format: { type: 'json_object' },
              temperature: 0,
              max_tokens: DEEPSEEK_CONTENT_MAX_TOKENS,
            }),
          },
          { label: 'Checking your content', timeoutMs, discardNonOkBody: true },
        )
      } catch (error) {
        throw reportContentProviderFailure(
          error,
          model,
          error instanceof RequestTimeoutError ? 'timeout' : 'network_failure',
        )
      }

      if (!response.ok) {
        throw reportContentProviderFailure(
          new ContentProviderFailure(httpFailureCode(response.status), model, response.status),
          model,
        )
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw reportContentProviderFailure(
          new ContentProviderFailure('malformed_json', model, response.status),
          model,
        )
      }
      const choice = isRecord(body) && Array.isArray(body.choices) ? body.choices[0] : undefined
      if (!isRecord(choice)) {
        throw reportContentProviderFailure(
          new ContentProviderFailure('schema_invalid', model, response.status),
          model,
        )
      }

      if (choice.finish_reason === 'length') {
        throw reportContentProviderFailure(
          new ContentProviderFailure('truncated_response', model, response.status),
          model,
        )
      }
      if (choice.finish_reason === 'insufficient_system_resource') {
        throw reportContentProviderFailure(
          new ContentProviderFailure('server_error', model, response.status),
          model,
        )
      }
      if (choice.finish_reason === 'content_filter') {
        throw reportContentProviderFailure(
          new ContentProviderFailure('unknown_provider_failure', model, response.status),
          model,
        )
      }

      const message = isRecord(choice) ? choice.message : undefined
      const content = isRecord(message) ? message.content : undefined

      if (typeof content !== 'string') {
        throw reportContentProviderFailure(
          new ContentProviderFailure('schema_invalid', model, response.status),
          model,
        )
      }
      if (content.trim().length === 0) {
        throw reportContentProviderFailure(
          new ContentProviderFailure('empty_response', model, response.status),
          model,
        )
      }
      return content
    },
  }
}
