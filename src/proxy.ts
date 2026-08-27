import { NextResponse, type NextRequest } from 'next/server'
import { audioDebugRouteEnabled } from '@/lib/env/server'
import { updateSession } from '@/lib/supabase/session'

function isAudioDebugPath(pathname: string): boolean {
  return pathname === '/debug/audio' || pathname.startsWith('/debug/audio/')
}

export default async function proxy(request: NextRequest) {
  if (isAudioDebugPath(request.nextUrl.pathname) && !audioDebugRouteEnabled()) {
    return new NextResponse(null, { status: 404 })
  }
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and image files. Auth cookies have to be
     * refreshed on page requests, not on the files those pages pull in.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
}
