import { logAuthDiagnostic } from '@/lib/auth-diagnostic'
import { clearCustomPracticeHandoffCookie } from '@/lib/practice/custom-handoff-cookie'
import { createClient } from '@/lib/supabase/server'

const CALLBACK_FAILURE = '/login?mode=login&oauth=failed'

function relativeRedirect(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location: path, 'cache-control': 'no-store' },
  })
}

export async function GET(request: Request) {
  const codes = new URL(request.url).searchParams.getAll('code')
  const code = codes.length === 1 ? codes[0] : null
  if (!code || code.length > 4096) return relativeRedirect(CALLBACK_FAILURE)

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      logAuthDiagnostic('oauth_callback', error)
      return relativeRedirect(CALLBACK_FAILURE)
    }
    try {
      await clearCustomPracticeHandoffCookie()
    } catch (error) {
      logAuthDiagnostic('oauth_cleanup', error)
    }
    // Proxy sends a new OAuth user through onboarding and a returning user to Home.
    return relativeRedirect('/')
  } catch (error) {
    logAuthDiagnostic('oauth_callback', error)
    return relativeRedirect(CALLBACK_FAILURE)
  }
}
