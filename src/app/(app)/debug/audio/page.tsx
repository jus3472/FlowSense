/**
 * DIAGNOSTIC PAGE, not part of the product surface.
 *
 * Reports how the current browser handles our own recordings: which containers
 * MediaRecorder claims to support, and what readyState, duration, buffered, and
 * seekable actually say over the life of a playback attempt. Built to compare
 * iOS WebKit against desktop Chrome, where the same file behaves differently.
 */
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AudioProbe, type ProbeItem } from '@/components/debug/audio-probe'
import { ErrorState } from '@/components/ui/error-state'
import { audioDebugRouteEnabled } from '@/lib/env/server'
import { formatDuration } from '@/lib/recording/format'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Audio diagnostics',
}

export const dynamic = 'force-dynamic'

const MAX_DEBUG_ATTEMPTS = 5
const SIGNED_URL_SECONDS = 60 * 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeDiagnosticCode(error: unknown): string {
  if (!isRecord(error)) return 'unknown'
  for (const key of ['code', 'statusCode', 'name']) {
    const value = error[key]
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value
  }
  return 'unknown'
}

function logDebugFailure(operation: 'load_attempts' | 'sign_recording', error: unknown): void {
  console.error('[debug/audio] operation failed', {
    operation,
    code: safeDiagnosticCode(error),
  })
}

function debugMimeType(metrics: unknown): string {
  if (!isRecord(metrics) || !isRecord(metrics.capture)) return 'unknown'
  return typeof metrics.capture.mime_type === 'string' ? metrics.capture.mime_type : 'unknown'
}

function loadError() {
  return (
    <ErrorState
      title="Audio diagnostics unavailable"
      description="Your recordings could not be loaded. Try again."
    />
  )
}

export default async function AudioDebugPage() {
  if (!audioDebugRouteEnabled()) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const attemptsOutcome = await (async () => {
    try {
      const { data, error } = await supabase
        .from('attempts')
        .select('id, prompt_text, duration_ms, audio_path, metrics, created_at')
        .eq('user_id', user.id)
        .not('audio_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MAX_DEBUG_ATTEMPTS)
      if (error) {
        logDebugFailure('load_attempts', error)
        return { status: 'failure' } as const
      }
      return { status: 'ready', attempts: data ?? [] } as const
    } catch (error) {
      logDebugFailure('load_attempts', error)
      return { status: 'failure' } as const
    }
  })()
  if (attemptsOutcome.status === 'failure') return loadError()

  const signed = await Promise.all(
    attemptsOutcome.attempts.map(async (attempt) => {
      if (!attempt.audio_path) return { item: null, failed: false }
      try {
        const { data, error } = await supabase.storage
          .from(RECORDINGS_BUCKET)
          .createSignedUrl(attempt.audio_path, SIGNED_URL_SECONDS)
        if (error || !data?.signedUrl) {
          logDebugFailure('sign_recording', error)
          return { item: null, failed: true }
        }

        const item: ProbeItem = {
          id: attempt.id,
          label: `${formatDuration(attempt.duration_ms ?? 0)}  ${attempt.prompt_text.slice(0, 40)}`,
          url: data.signedUrl,
          durationMs: attempt.duration_ms ?? 0,
          mimeType: debugMimeType(attempt.metrics),
        }
        return { item, failed: false }
      } catch (error) {
        logDebugFailure('sign_recording', error)
        return { item: null, failed: true }
      }
    }),
  )
  const items = signed.flatMap(({ item }) => (item ? [item] : []))
  const signingFailed = signed.some(({ failed }) => failed)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-foreground text-xl font-semibold">Audio diagnostics</h1>
        <p className="text-muted text-sm">
          Press Attach, then Play, then the seek buttons. Copy the log out and compare it across
          browsers.
        </p>
      </div>
      {signingFailed ? (
        <p role="status" className="text-muted text-sm">
          Some recordings could not be attached.
        </p>
      ) : null}
      <AudioProbe
        items={items}
        emptyMessage={signingFailed ? 'No recordings could be attached.' : undefined}
      />
    </div>
  )
}
