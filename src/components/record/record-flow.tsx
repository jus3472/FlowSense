'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  MICROPHONE_BLOCKED_TITLE,
  MicrophoneRecovery,
} from '@/components/media/microphone-recovery'
import {
  MicrophoneUnavailable,
  titleForUnavailable,
  type UnavailableReason,
} from '@/components/media/microphone-unavailable'
import { CountdownStep } from '@/components/record/countdown-step'
import { ProcessingStep } from '@/components/record/processing-step'
import { ReadyStep } from '@/components/record/ready-step'
import { RecordingStep } from '@/components/record/recording-step'
import { Button, ButtonLink } from '@/components/ui/button'
import {
  createAttempt,
  saveRecording,
  scoreAttempt,
  transcribeAttempt,
  uploadAudio,
} from '@/lib/recording/api'
import {
  SAMPLE_INTERVAL_MS,
  createAudioSampler,
  type AudioSampler,
} from '@/lib/recording/audio-sampler'
import { countdownSecondsFor } from '@/lib/recording/countdown'
import {
  INITIAL_PROCESSING_STATE,
  describeError,
  runProcessingPipeline,
  type PipelineSteps,
  type ProcessingState,
} from '@/lib/recording/processing'
import {
  AttemptRecorder,
  MAX_RECORDING_MS,
  RecorderError,
  type AttemptRecording,
} from '@/lib/recording/recorder'
import {
  mediaSupportSnapshot,
  serverMediaSupportSnapshot,
  subscribeToMediaSupport,
} from '@/lib/recording/support'
import type { CaptureMetrics } from '@/lib/types/metrics'

interface RecordFlowProps {
  promptId: string
  promptText: string
}

type Phase =
  | { name: 'ready' }
  | { name: 'requesting' }
  | { name: 'blocked' }
  | { name: 'unavailable'; reason: UnavailableReason }
  | { name: 'countdown' }
  | { name: 'recording' }
  | { name: 'processing' }
  | { name: 'recorder-failed'; message: string }

export function RecordFlow({ promptId, promptText }: RecordFlowProps) {
  const router = useRouter()
  const support = useSyncExternalStore(
    subscribeToMediaSupport,
    mediaSupportSnapshot,
    serverMediaSupportSnapshot,
  )

  const [phase, setPhase] = useState<Phase>({ name: 'ready' })
  const [processing, setProcessing] = useState<ProcessingState>(INITIAL_PROCESSING_STATE)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState<AttemptRecording | null>(null)

  // Everything below survives re-renders without driving them, and gives the
  // retry path a way to skip work that already succeeded.
  const streamRef = useRef<MediaStream | null>(null)
  const samplerRef = useRef<AudioSampler | null>(null)
  const recorderRef = useRef<AttemptRecorder | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const attemptRef = useRef<{ attemptId: string; storagePath: string } | null>(null)
  const uploadedRef = useRef(false)
  const savedRef = useRef(false)

  const releaseStream = useCallback(() => {
    samplerRef.current?.close()
    samplerRef.current = null
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      streamRef.current = null
    }
  }, [])

  // Covers navigating away mid recording: the tracks stop and the microphone
  // indicator goes out rather than staying lit on an abandoned page.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel()
      releaseStream()
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [releaseStream])

  const runPipeline = useCallback(
    async (recording: AttemptRecording) => {
      const capture: CaptureMetrics = {
        mime_type: recording.mimeType,
        started_at: recording.startedAt,
        duration_ms: recording.durationMs,
        sample_interval_ms: SAMPLE_INTERVAL_MS,
        amplitude: recording.amplitude,
        pitch: recording.pitch,
      }

      const steps: PipelineSteps = {
        // Each part checks whether it already succeeded, so a retry resumes
        // instead of duplicating rows or re-uploading audio that is already there.
        upload: async () => {
          attemptRef.current ??= await createAttempt({
            promptId,
            promptText,
            durationMs: recording.durationMs,
            mimeType: recording.mimeType,
          })
          const attempt = attemptRef.current

          if (!uploadedRef.current) {
            await uploadAudio(recording.blob, attempt.storagePath, recording.mimeType)
            uploadedRef.current = true
          }
          if (!savedRef.current) {
            await saveRecording(attempt.attemptId, attempt.storagePath, capture)
            savedRef.current = true
          }
        },
        transcribe: async () => {
          const attempt = attemptRef.current
          if (!attempt) throw new Error('The recording was not saved, so it cannot be transcribed.')
          await transcribeAttempt(attempt.attemptId)
        },
        // The mechanical half is instant. The model call is the slow part, and a
        // model outage is handled inside the route so it cannot cost points.
        score: async () => {
          const attempt = attemptRef.current
          if (!attempt) throw new Error('The recording was not saved, so it cannot be scored.')
          await scoreAttempt(attempt.attemptId)
        },
      }

      const final = await runProcessingPipeline(steps, setProcessing)
      const attempt = attemptRef.current
      if (final.stage === 'done' && attempt) {
        router.replace(`/attempts/${attempt.attemptId}`)
      }
    },
    [promptId, promptText, router],
  )

  const handleRecorded = useCallback(
    (recording: AttemptRecording) => {
      const url = URL.createObjectURL(recording.blob)
      objectUrlRef.current = url
      setRecording(recording)
      setAudioUrl(url)
      setPhase({ name: 'processing' })
      void runPipeline(recording)
    },
    [runPipeline],
  )

  const beginRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.isStarted) return

    setPhase({ name: 'recording' })
    recorder
      .start()
      .then(handleRecorded)
      .catch((error: unknown) => {
        // Cancellation is the unmount path and needs no screen.
        if (error instanceof RecorderError && error.message.includes('cancelled')) return
        releaseStream()
        setPhase({ name: 'recorder-failed', message: describeError(error) })
      })
  }, [handleRecorded, releaseStream])

  const start = useCallback(async () => {
    if (!support.ok) {
      setPhase({ name: 'unavailable', reason: support.reason })
      return
    }

    setPhase({ name: 'requesting' })

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      setPhase(
        name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? { name: 'unavailable', reason: 'missing' }
          : { name: 'blocked' },
      )
      return
    }

    streamRef.current = stream
    const sampler = createAudioSampler(stream)
    samplerRef.current = sampler

    // One recorder, one stream, one attempt. AttemptRecorder refuses a second start.
    recorderRef.current = new AttemptRecorder({
      mimeType: support.mimeType,
      createRecorder: (mimeType) => new MediaRecorder(stream, { mimeType }),
      sampler,
      maxDurationMs: MAX_RECORDING_MS,
      onRelease: releaseStream,
    })

    setPhase({ name: 'countdown' })
  }, [releaseStream, support])

  const retry = useCallback(() => {
    if (recording) void runPipeline(recording)
  }, [recording, runPipeline])

  // Memoized so the recording screen's animation loop is not torn down and
  // rebuilt every time this component happens to render.
  const getLevel = useCallback(() => samplerRef.current?.level() ?? 0, [])

  const backHome = (
    <ButtonLink href="/home" variant="ghost" fullWidth>
      Back to home
    </ButtonLink>
  )

  if (phase.name === 'unavailable') {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-foreground text-xl font-semibold">
          {titleForUnavailable(phase.reason)}
        </h1>
        <MicrophoneUnavailable
          reason={phase.reason}
          onRetry={phase.reason === 'missing' ? () => void start() : undefined}
        >
          {backHome}
        </MicrophoneUnavailable>
      </div>
    )
  }

  if (phase.name === 'blocked') {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-foreground text-xl font-semibold">{MICROPHONE_BLOCKED_TITLE}</h1>
        <MicrophoneRecovery onRetry={() => void start()}>{backHome}</MicrophoneRecovery>
      </div>
    )
  }

  if (phase.name === 'recorder-failed') {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-foreground text-xl font-semibold">Recording stopped</h1>
        <p role="alert" className="text-negative text-sm">
          {phase.message}
        </p>
        <p className="text-muted text-base">Start again when you are ready.</p>
        <div className="flex flex-col gap-3">
          <Button size="lg" fullWidth onClick={() => setPhase({ name: 'ready' })}>
            Start over
          </Button>
          {backHome}
        </div>
      </div>
    )
  }

  if (phase.name === 'countdown') {
    return (
      <CountdownStep
        promptText={promptText}
        seconds={countdownSecondsFor(promptText)}
        onComplete={beginRecording}
      />
    )
  }

  if (phase.name === 'recording') {
    return (
      <RecordingStep
        promptText={promptText}
        maxDurationMs={MAX_RECORDING_MS}
        getLevel={getLevel}
        onStop={() => recorderRef.current?.stop()}
      />
    )
  }

  if (phase.name === 'processing') {
    return (
      <ProcessingStep
        promptText={promptText}
        audioUrl={audioUrl}
        durationMs={recording?.durationMs ?? 0}
        state={processing}
        onRetry={retry}
      />
    )
  }

  return <ReadyStep onStart={() => void start()} requesting={phase.name === 'requesting'} />
}
