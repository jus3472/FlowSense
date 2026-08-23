import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { publicEnv } from '@/lib/env/public'
import { supabaseSecretKey } from '@/lib/env/server'
import type { Database } from '@/lib/types/database'

/**
 * Service role client. It bypasses row level security, so it is only for work
 * that genuinely cannot run as the signed in user, such as signing storage URLs
 * for a background job. Never import this from a client component.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
