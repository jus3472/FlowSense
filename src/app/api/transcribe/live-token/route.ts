import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { deepgramAuthHeader } from '@/lib/deepgram/request'
import { deepgramApiKey } from '@/lib/env/server'
import { fetchWithTimeout } from '@/lib/net/fetch-with-timeout'
import { createClient } from '@/lib/supabase/server'

const DEEPGRAM_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant'
const TOKEN_REQUEST_TIMEOUT_MS = 10_000

function tokenFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('access_token' in value)) return null
  return typeof value.access_token === 'string' && value.access_token.length > 0
    ? value.access_token
    : null
}

function reportLiveTokenFailure(code: string, status: number | null): void {
  console.warn('[live-transcription]', { code, status })
}

/** Mints a short-lived browser credential while keeping the API key server-only. */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError('Your session ended. Log in and try again.', 401)

  try {
    const response = await fetchWithTimeout(
      DEEPGRAM_GRANT_URL,
      {
        method: 'POST',
        headers: {
          Authorization: deepgramAuthHeader(deepgramApiKey()),
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
      { label: 'Preparing live transcription', timeoutMs: TOKEN_REQUEST_TIMEOUT_MS },
    )
    if (!response.ok) {
      reportLiveTokenFailure('grant_rejected', response.status)
      return apiError('Live transcription is not available.', 502)
    }
    const token = tokenFrom((await response.json()) as unknown)
    if (!token) {
      reportLiveTokenFailure('grant_malformed', response.status)
      return apiError('Live transcription is not available.', 502)
    }
    return NextResponse.json(
      { token },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    )
  } catch {
    reportLiveTokenFailure('grant_failed', null)
    return apiError('Live transcription is not available.', 502)
  }
}
