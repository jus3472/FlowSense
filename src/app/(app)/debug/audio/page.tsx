/**
 * DIAGNOSTIC PAGE, not part of the product surface.
 *
 * Reports how the current browser handles our own recordings: which containers
 * MediaRecorder claims to support, and what readyState, duration, buffered, and
 * seekable actually say over the life of a playback attempt. Built to compare
 * iOS WebKit against desktop Chrome, where the same file behaves differently.
 */
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AudioProbe, type ProbeItem } from '@/components/debug/audio-probe'
import { formatDuration } from '@/lib/recording/format'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { createClient } from '@/lib/supabase/server'
import type { AttemptMetrics } from '@/lib/types/metrics'

export const metadata: Metadata = {
  title: 'Audio diagnostics',
}

export const dynamic = 'force-dynamic'

export default async function AudioDebugPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, prompt_text, duration_ms, audio_path, metrics, created_at')
    .not('audio_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)

  const items: ProbeItem[] = []
  for (const attempt of attempts ?? []) {
    if (!attempt.audio_path) continue
    const { data } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(attempt.audio_path, 60 * 60)
    if (!data?.signedUrl) continue

    const metrics = (attempt.metrics as AttemptMetrics | null) ?? {}
    items.push({
      id: attempt.id,
      label: `${formatDuration(attempt.duration_ms ?? 0)}  ${attempt.prompt_text.slice(0, 40)}`,
      url: data.signedUrl,
      durationMs: attempt.duration_ms ?? 0,
      mimeType: metrics.capture?.mime_type ?? 'unknown',
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-foreground text-xl font-semibold">Audio diagnostics</h1>
        <p className="text-muted text-sm">
          Press Attach, then Play, then the seek buttons. Copy the log out and compare it across
          browsers.
        </p>
      </div>
      <AudioProbe items={items} />
    </div>
  )
}
