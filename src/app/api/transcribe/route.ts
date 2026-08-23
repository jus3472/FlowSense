import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { parseDeepgramResponse } from '@/lib/deepgram/parse'
import {
  DEEPGRAM_MODEL,
  buildDeepgramUrl,
  deepgramAuthHeader,
  isFillerToken,
} from '@/lib/deepgram/request'
import { deepgramApiKey } from '@/lib/env/server'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { createClient } from '@/lib/supabase/server'
import type { AttemptMetrics } from '@/lib/types/metrics'

/** Deepgram on 60 seconds of audio finishes in a few seconds. This is headroom. */
export const maxDuration = 60

/** Leaves room to answer before the browser's own 30 second abort fires. */
const DEEPGRAM_TIMEOUT_MS = 25_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deepgram reports failures as err_msg. Anything else is surfaced verbatim. */
function describeDeepgramFailure(status: number, raw: string): string {
  try {
    const body: unknown = JSON.parse(raw)
    if (isRecord(body)) {
      for (const key of ['err_msg', 'message', 'error', 'reason']) {
        const value = body[key]
        if (typeof value === 'string' && value.trim().length > 0) {
          return `Deepgram rejected the audio: ${value}`
        }
      }
    }
  } catch {
    // Not JSON. Fall through to the raw text.
  }
  const snippet = raw.trim().slice(0, 200)
  return snippet.length > 0
    ? `Deepgram rejected the audio: ${snippet}`
    : `Deepgram returned status ${status} with no explanation.`
}

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

  const attemptId = isRecord(body) && typeof body.attemptId === 'string' ? body.attemptId : ''
  if (attemptId.length === 0) return apiError('The attempt id was missing.', 400)

  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, audio_path, metrics')
    .eq('id', attemptId)
    .maybeSingle()

  if (attemptError) return apiError(attemptError.message, 500)
  if (!attempt) return apiError('That attempt does not exist.', 404)
  if (!attempt.audio_path) {
    return apiError('The recording was not saved, so there is nothing to transcribe.', 400)
  }

  const { data: audio, error: downloadError } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .download(attempt.audio_path)

  if (downloadError || !audio) {
    return apiError(
      downloadError?.message ?? 'The recording could not be read back from storage.',
      502,
    )
  }

  const metrics = (attempt.metrics as AttemptMetrics | null) ?? {}
  const contentType = metrics.capture?.mime_type ?? 'audio/webm'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS)

  // The request is logged in full because a wrong or dropped query parameter is
  // invisible otherwise: Deepgram answers 200 either way. No secret appears
  // here, the key travels in the Authorization header.
  const url = buildDeepgramUrl()
  console.info('[transcribe] request', {
    attemptId,
    url,
    query: new URL(url).search,
    contentType,
    audioBytes: audio.size,
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: deepgramAuthHeader(deepgramApiKey()),
        'Content-Type': contentType,
      },
      body: await audio.arrayBuffer(),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      return apiError('Deepgram did not answer within 25 seconds.', 504)
    }
    const reason = error instanceof Error ? error.message : 'The connection failed.'
    return apiError(`Deepgram could not be reached: ${reason}`, 502)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return apiError(describeDeepgramFailure(response.status, await response.text()), 502)
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    return apiError('Deepgram returned a response that was not JSON.', 502)
  }

  if (process.env.DEEPGRAM_DEBUG === 'true') {
    console.info('[transcribe] raw response', JSON.stringify(raw))
  }

  let parsed
  try {
    parsed = parseDeepgramResponse(raw)
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : 'Deepgram returned an unreadable response.',
      502,
    )
  }

  // Filler count is the number worth watching. If it is 0 on speech that had
  // fillers, the model is ignoring filler_words rather than failing loudly.
  const fillerCount = parsed.words.filter((entry) => isFillerToken(entry.word)).length
  console.info('[transcribe] response', {
    attemptId,
    status: response.status,
    model: DEEPGRAM_MODEL,
    words: parsed.words.length,
    fillers: fillerCount,
    characters: parsed.transcript.length,
  })

  const nextMetrics: AttemptMetrics = {
    ...metrics,
    transcript: {
      provider: 'deepgram',
      model: DEEPGRAM_MODEL,
      confidence: parsed.confidence,
      words: parsed.words,
    },
  }

  const { error: saveError } = await supabase
    .from('attempts')
    .update({
      transcript: parsed.transcript,
      metrics: JSON.parse(JSON.stringify(nextMetrics)),
    })
    .eq('id', attemptId)

  if (saveError) {
    return apiError(`The transcript could not be saved: ${saveError.message}`, 500)
  }

  return NextResponse.json({
    transcript: parsed.transcript,
    wordCount: parsed.words.length,
  })
}
