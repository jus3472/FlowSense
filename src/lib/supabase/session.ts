import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnv } from '@/lib/env/public'
import { hasCompletedOnboarding } from '@/lib/onboarding'
import { isProtectedPath } from '@/lib/routes'
import type { Database } from '@/lib/types/database'

/**
 * Refreshes the auth cookies on every request and decides where a visitor is
 * allowed to be. Redirect responses copy the refreshed cookies across, without
 * which the session would be dropped on the very request that redirects.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const protectedPath = isProtectedPath(pathname)
  const inOnboarding = pathname === '/onboarding' || pathname.startsWith('/onboarding/')

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone()
    url.pathname = path
    url.search = ''
    const redirect = NextResponse.redirect(url)
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  if (!user) {
    return protectedPath ? redirectTo('/login') : response
  }

  const onboarded = hasCompletedOnboarding(user)

  if (pathname === '/' || pathname === '/login') {
    return redirectTo(onboarded ? '/home' : '/onboarding')
  }

  if (inOnboarding && onboarded) {
    return redirectTo('/home')
  }

  if (protectedPath && !inOnboarding && !onboarded) {
    return redirectTo('/onboarding')
  }

  return response
}
