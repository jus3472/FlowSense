import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/env/public'
import { supabaseAuthCookieOptions } from '@/lib/supabase/cookie-options'
import type { Database } from '@/lib/types/database'

/** Request scoped Supabase client for server components, actions, and routes. */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookieOptions: supabaseAuthCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server components cannot write cookies. The middleware refreshes
          // the session on every request, so nothing is lost here.
        }
      },
    },
  })
}
