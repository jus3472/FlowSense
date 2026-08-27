import type { CookieOptionsWithName } from '@supabase/ssr'

/**
 * Supabase auth remains browser-readable for direct private Storage uploads.
 * Production uses Secure cookies, while local HTTP development must be able to
 * set them. Naming, chunking, and lifetime stay owned by @supabase/ssr.
 */
export function supabaseAuthCookieOptions(
  environment: string | undefined = process.env.NODE_ENV,
): CookieOptionsWithName {
  return {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: environment === 'production',
  }
}
