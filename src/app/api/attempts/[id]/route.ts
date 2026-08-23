import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { parseCaptureMetrics } from '@/lib/recording/capture-payload'
import { createClient } from '@/lib/supabase/server'
import type { AttemptMetrics } from '@/lib/types/metrics'

/**
 * Records where the audio landed and stores the raw capture timelines. Runs
 * after the object is already in storage, so the recording survives even if
 * transcription never succeeds.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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
  const audioPath = typeof payload.audioPath === 'string' ? payload.audioPath : ''
  if (!audioPath.startsWith(`${user.id}/`)) {
    return apiError('The recording path did not belong to your account.', 400)
  }

  const capture = parseCaptureMetrics(payload.capture)
  if (!capture) return apiError('The capture timelines were missing or malformed.', 400)

  const { data: existing, error: readError } = await supabase
    .from('attempts')
    .select('metrics')
    .eq('id', id)
    .maybeSingle()

  if (readError) return apiError(readError.message, 500)
  if (!existing) return apiError('That attempt does not exist.', 404)

  const metrics: AttemptMetrics = {
    ...((existing.metrics as AttemptMetrics | null) ?? {}),
    capture,
  }

  const { error } = await supabase
    .from('attempts')
    .update({ audio_path: audioPath, metrics: JSON.parse(JSON.stringify(metrics)) })
    .eq('id', id)

  if (error) return apiError(error.message, 500)
  return NextResponse.json({ ok: true })
}
