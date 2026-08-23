import type { User } from '@supabase/supabase-js'

/**
 * Onboarding completion is stored on the auth user rather than on `profiles`,
 * which keeps the profiles table to the columns the product actually reads.
 * Focus areas are skippable, so they cannot double as the completion signal.
 */
export const ONBOARDED_AT_KEY = 'onboarded_at'

export function hasCompletedOnboarding(user: User | null): boolean {
  const value = user?.user_metadata?.[ONBOARDED_AT_KEY]
  return typeof value === 'string' && value.length > 0
}
