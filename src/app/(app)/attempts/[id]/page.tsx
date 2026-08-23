/**
 * TEMPORARY RESULTS PAGE.
 *
 * This exists only to prove the recording and transcription pipeline end to
 * end: the prompt, the audio, the verbatim transcript, and the length. The real
 * results view arrives in a later prompt, with the marked up transcript, the
 * score breakdown, and the tightened rewrite. Replace this file wholesale.
 */
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AudioPlayer } from '@/components/record/audio-player'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDuration } from '@/lib/recording/format'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Your answer',
}

const SIGNED_URL_SECONDS = 60 * 60

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, prompt_text, transcript, duration_ms, audio_path, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!attempt) notFound()

  let audioUrl: string | null = null
  if (attempt.audio_path) {
    const { data } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(attempt.audio_path, SIGNED_URL_SECONDS)
    audioUrl = data?.signedUrl ?? null
  }

  const durationMs = attempt.duration_ms ?? 0

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-foreground text-xl font-semibold">{attempt.prompt_text}</h1>
        <p className="numeric text-muted text-sm">You spoke for {formatDuration(durationMs)}</p>
      </div>

      {audioUrl ? (
        <AudioPlayer src={audioUrl} durationMs={durationMs} />
      ) : (
        <Card>
          <EmptyState
            title="No audio saved"
            description="This attempt has no recording attached to it."
          />
        </Card>
      )}

      <Card className="flex flex-col gap-4">
        <h2 className="text-muted text-sm font-medium">Transcript</h2>
        {attempt.transcript && attempt.transcript.trim().length > 0 ? (
          <p className="text-foreground text-base">{attempt.transcript}</p>
        ) : (
          <EmptyState
            title="No transcript yet"
            description="Nothing was transcribed for this attempt."
          />
        )}
      </Card>

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/record" size="lg">
          Answer another prompt
        </ButtonLink>
        <ButtonLink href="/home" variant="secondary" size="lg">
          Back to home
        </ButtonLink>
      </div>
    </div>
  )
}
