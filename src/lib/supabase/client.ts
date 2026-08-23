import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env/public'
import type { Database } from '@/lib/types/database'

/** Supabase client for client components. Uses the publishable key only. */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey)
}
