import 'server-only'

/**
 * The only module allowed to read the secret keys. The `server-only` import
 * above turns any client component that reaches this file into a build error,
 * and an ESLint rule blocks `process.env.<SECRET>` everywhere else.
 *
 * Values are read lazily so a missing Deepgram or DeepSeek key does not break
 * the build before the features that need them exist.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local.`)
  }
  return value
}

export function supabaseSecretKey(): string {
  return required('SUPABASE_SECRET_KEY', process.env.SUPABASE_SECRET_KEY)
}

/** Domain-separated before use by the custom-practice handoff cipher. */
export function customPracticeHandoffSecret(): string {
  return supabaseSecretKey()
}

/** Diagnostic routes are local/test tools and must not exist in production. */
export function audioDebugRouteEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
}

/** Used by server-side transcription requests. */
export function deepgramApiKey(): string {
  return required('DEEPGRAM_API_KEY', process.env.DEEPGRAM_API_KEY)
}

/** Used by server-side content evaluation requests. */
export function deepseekApiKey(): string {
  return required('DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY)
}
