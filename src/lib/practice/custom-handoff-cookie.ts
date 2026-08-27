import 'server-only'
import { cookies } from 'next/headers'
import { CUSTOM_HANDOFF_TTL_SECONDS } from '@/lib/practice/custom-handoff'
import { CUSTOM_SESSION_COOKIE } from '@/lib/practice/custom'

const options = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: true,
  path: '/record',
}

export async function storeCustomPracticeHandoffCookie(value: string): Promise<void> {
  ;(await cookies()).set(CUSTOM_SESSION_COOKIE, value, {
    ...options,
    maxAge: CUSTOM_HANDOFF_TTL_SECONDS,
  })
}

export async function clearCustomPracticeHandoffCookie(): Promise<void> {
  ;(await cookies()).set(CUSTOM_SESSION_COOKIE, '', { ...options, maxAge: 0 })
}
