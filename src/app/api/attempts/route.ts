import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { extensionForMimeType } from '@/lib/recording/mime'
import { parseCreateAttemptPayload } from '@/lib/recording/attempt-payload'
import { createClient } from '@/lib/supabase/server'

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

  const payload = parseCreateAttemptPayload(body)
  if (!payload.ok) return apiError(payload.error, 400)

  const { data, error } = await supabase
    .from('attempts')
    .insert({
      user_id: user.id,
      prompt_id: payload.value.promptId,
      prompt_text: payload.value.promptText,
      duration_ms: payload.value.durationMs,
    })
    .select('id')
    .single()

  if (error || !data) {
    return apiError(error?.message ?? 'The attempt could not be created.', 500)
  }

  return NextResponse.json({
    attemptId: data.id,
    storagePath: `${user.id}/${data.id}.${extensionForMimeType(payload.value.mimeType)}`,
  })
}
