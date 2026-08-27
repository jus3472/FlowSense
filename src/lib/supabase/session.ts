import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnv } from '@/lib/env/public'
import { customPracticeHandoffSecret } from '@/lib/env/server'
import { hasCompletedOnboarding } from '@/lib/onboarding'
import { CUSTOM_HANDOFF_HEADER, resolveCustomPracticeHandoff } from '@/lib/practice/custom-handoff'
import { CUSTOM_SESSION_COOKIE, isCustomPracticeMarker } from '@/lib/practice/custom'
import { isProtectedPath } from '@/lib/routes'
import { supabaseAuthCookieOptions } from '@/lib/supabase/cookie-options'
import type { Database } from '@/lib/types/database'

/**
 * Refreshes the auth cookies on every request and decides where a visitor is
 * allowed to be. Redirect responses copy the refreshed cookies across, without
 * which the session would be dropped on the very request that redirects.
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  // Browser-supplied copies are never trusted. Only this Proxy may add it.
  requestHeaders.delete(CUSTOM_HANDOFF_HEADER)
  const syncRequestCookies = () => {
    const cookieHeader = request.headers.get('cookie')
    if (cookieHeader) requestHeaders.set('cookie', cookieHeader)
    else requestHeaders.delete('cookie')
  }
  const nextResponse = () => NextResponse.next({ request: { headers: requestHeaders } })
  let response = nextResponse()

  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookieOptions: supabaseAuthCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          syncRequestCookies()
          response = nextResponse()
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

  const customValues = request.nextUrl.searchParams.getAll('custom')
  const customRequest =
    pathname === '/record' && customValues.length === 1 && isCustomPracticeMarker(customValues[0])
  if (customRequest) {
    const existingCookies = response.cookies.getAll()
    const handoff = resolveCustomPracticeHandoff(
      request.cookies.get(CUSTOM_SESSION_COOKIE)?.value,
      user?.id ?? null,
      customPracticeHandoffSecret(),
    )
    if (handoff.headerValue) requestHeaders.set(CUSTOM_HANDOFF_HEADER, handoff.headerValue)
    if (handoff.clearCookie) {
      request.cookies.delete(CUSTOM_SESSION_COOKIE)
      syncRequestCookies()
    }
    response = nextResponse()
    for (const cookie of existingCookies) response.cookies.set(cookie)
    if (handoff.clearCookie) {
      response.cookies.set(CUSTOM_SESSION_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/record',
        maxAge: 0,
      })
    }
  }

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
