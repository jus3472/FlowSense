import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/session'

export default async function proxy(request: NextRequest) {
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
