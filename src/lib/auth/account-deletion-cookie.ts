import 'server-only'

import { cookies } from 'next/headers'
import { ACCOUNT_DELETED_COOKIE } from '@/lib/theme'

/** Lets the first public render clear device-local state only after Auth deletion succeeds. */
export async function markAccountClientStateForDeletion(): Promise<void> {
  ;(await cookies()).set(ACCOUNT_DELETED_COOKIE, '1', {
    httpOnly: false,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60,
  })
}
