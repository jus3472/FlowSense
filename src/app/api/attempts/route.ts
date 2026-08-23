import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { extensionForMimeType } from '@/lib/recording/mime'
import { MAX_RECORDING_MS } from '@/lib/recording/recorder'
import { createClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Creates the attempt row before the audio exists. The row is the anchor: the
 * storage path is derived from its id, so a failed upload leaves an obvious
 * empty attempt rather than an orphaned object.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError('Your session ended. Log in and try again.', 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const payload = body as Record<string, unknown>
  const promptText = typeof payload.promptText === 'string' ? payload.promptText.trim() : ''
  const promptId =
    typeof payload.promptId === 'string' && UUID.test(payload.promptId) ? payload.promptId : null
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : ''
  const durationMs =
    typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
      ? Math.round(payload.durationMs)
      : null

  if (promptText.length === 0) return apiError('The prompt text was missing.', 400)
  if (mimeType.length === 0) return apiError('The recording format was missing.', 400)
  if (durationMs === null || durationMs <= 0) {
    return apiError('The recording length was missing.', 400)
  }
  if (durationMs > MAX_RECORDING_MS * 2) {
    return apiError('That recording is longer than FlowSense accepts.', 400)
  }

  const { data, error } = await supabase
    .from('attempts')
    .insert({
      user_id: user.id,
      prompt_id: promptId,
      prompt_text: promptText,
      duration_ms: durationMs,
    })
    .select('id')
    .single()

  if (error || !data) {
    return apiError(error?.message ?? 'The attempt could not be created.', 500)
  }

  return NextResponse.json({
    attemptId: data.id,
    storagePath: `${user.id}/${data.id}.${extensionForMimeType(mimeType)}`,
  })
}
