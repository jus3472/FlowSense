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

/** Wired up in a later prompt, when transcription lands. */
export function deepgramApiKey(): string {
  return required('DEEPGRAM_API_KEY', process.env.DEEPGRAM_API_KEY)
}

/** Wired up in a later prompt, when content evaluation lands. */
export function deepseekApiKey(): string {
  return required('DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY)
}
