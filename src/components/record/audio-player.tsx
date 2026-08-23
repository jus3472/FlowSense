'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatDuration } from '@/lib/recording/format'
import {
  HAVE_METADATA,
  canScrub,
  clampSeekMs,
  describePlaybackError,
  resolveDurationMs,
} from '@/lib/recording/playback'

interface AudioPlayerProps {
  src: string
  /** Measured while recording. The container itself reports Infinity, NaN, or 0. */
  durationMs: number
  label?: string
}

/**
 * Custom transport over a hidden <audio> element.
 *
 * MediaRecorder containers carry no usable duration, so the native control's
 * scrub bar seeks nonlinearly. Everything shown here is driven by the duration
 * FlowSense measured during capture, and the element underneath is only ever
 * asked to play, pause, and seek.
 *
 * The shape of this component is set by iOS WebKit, which fails silently in
 * three separate ways that all present as "pressing play does nothing":
 *
 * 1. play() must be called synchronously inside the user gesture. Anything that
 *    runs first, including assigning currentTime, can cost the gesture or make
 *    WebKit abort the play in favour of a pending seek. So the gesture handler
 *    does nothing but call play().
 * 2. play() returns a promise that rejects with no console output and no event.
 *    It is caught here and turned into a visible sentence.
 * 3. Metadata arrives late and out of order. Measured on iOS 26 against a
 *    recording made by WebKit itself, `duration` was still NaN through
 *    loadedmetadata and through canplay at readyState 4, and only resolved once
 *    the whole file had downloaded. Nothing here waits for it: the duration
 *    measured during capture is authoritative, so the scrubber works from the
 *    first render and the element catches up on its own.
 *
 * The scrubber also ignores `seekable`. On the same file iOS reports
 * `[0, NaN]` and Chrome reports `[0, Infinity]`, and since every comparison
 * against NaN is false, trusting it disabled the scrubber outright on iOS.
 * Seeks are clamped to the measured duration, attempted, and then reconciled
 * against what the element actually did.
 *
 * Callers pass `key={src}` so a new recording gets a fresh transport.
 */
export function AudioPlayer({ src, durationMs, label = 'Your answer' }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [readyState, setReadyState] = useState(0)
  const [elementDuration, setElementDuration] = useState(Number.NaN)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const totalMs = resolveDurationMs(durationMs, elementDuration)
  const canSeek = canScrub({ totalMs, failed })
  // Metadata can lag the file by seconds. It gates the note, never the control.
  const loadingMetadata = readyState < HAVE_METADATA
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sync = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setElementDuration(audio.duration)
    setReadyState(audio.readyState)
  }, [])

  useEffect(
    () => () => {
      if (reconcileTimer.current !== null) clearTimeout(reconcileTimer.current)
    },
    [],
  )

  // timeupdate fires about 4 times a second, which reads as a stuttering
  // playhead. Reading currentTime every frame keeps it moving at a constant rate.
  useEffect(() => {
    if (!playing) return

    let frame = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio) setPositionMs(Math.min(audio.currentTime * 1000, totalMs))
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, totalMs])

  /**
   * The whole gesture handler. No awaits, no seeks, nothing before play().
   */
  const startPlayback = () => {
    const audio = audioRef.current
    if (!audio) return

    setMessage(null)
    const started = audio.play() as Promise<void> | undefined

    if (started && typeof started.catch === 'function') {
      started.catch((error: unknown) => {
        setPlaying(false)
        setMessage(describePlaybackError(error))
      })
    }
  }

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      return
    }
    startPlayback()
  }

  /**
   * Moves the playhead optimistically so the thumb follows the finger, asks the
   * element to seek, then reconciles against what actually happened. If the seek
   * is refused the display snaps back to the truth rather than lying about it.
   */
  const seek = (valueMs: number) => {
    const audio = audioRef.current
    if (!audio) return

    const target = clampSeekMs(valueMs, totalMs)
    setPositionMs(target)
    setMessage(null)

    try {
      audio.currentTime = target / 1000
    } catch {
      // WebKit throws InvalidStateError if the element loses readiness between
      // the gate and the assignment.
      setMessage('Seeking is not available yet. Press play first.')
      return
    }

    if (reconcileTimer.current !== null) clearTimeout(reconcileTimer.current)
    reconcileTimer.current = setTimeout(() => {
      const current = audioRef.current
      if (!current) return
      const actualMs = current.currentTime * 1000
      if (Math.abs(actualMs - target) > 600) {
        setPositionMs(Math.min(actualMs, totalMs))
        setMessage('That part of the recording is still loading.')
      }
    }, 500)
  }

  const status = (() => {
    if (failed) return 'This recording could not be loaded. Reload the page to try again.'
    if (message) return message
    if (loadingMetadata) return 'Loading audio'
    return null
  })()

  const percent = totalMs > 0 ? Math.min(100, (positionMs / totalMs) * 100) : 0

  return (
    <div className="bg-surface rounded-card flex flex-col gap-2 p-4">
      {/*
        Hidden on purpose. A controls-less <audio> is display:none in every
        browser's own stylesheet anyway, and unlike <video> that does not stop
        it playing. It is only ever the playback engine for the transport above.
      */}
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        aria-hidden="true"
        className="hidden"
        onLoadStart={sync}
        onLoadedMetadata={sync}
        onDurationChange={sync}
        onCanPlay={sync}
        onCanPlayThrough={sync}
        onProgress={sync}
        onSeeked={() => {
          sync()
          const audio = audioRef.current
          if (audio) setPositionMs(Math.min(audio.currentTime * 1000, totalMs))
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current
          if (audio && !playing) setPositionMs(Math.min(audio.currentTime * 1000, totalMs))
        }}
        onPlay={() => {
          setPlaying(true)
          setMessage(null)
          setFailed(false)
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPositionMs(totalMs)
          // Rewind now, while the element is definitely loaded, so the next
          // press is a bare play() with no seek queued in front of it.
          const audio = audioRef.current
          if (!audio) return
          try {
            audio.currentTime = 0
          } catch {
            // Nothing to undo. The next play starts wherever WebKit left it.
          }
        }}
        onError={() => {
          setFailed(true)
          setPlaying(false)
        }}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          disabled={failed}
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
          className="bg-accent text-accent-fg flex size-11 shrink-0 items-center justify-center rounded-full transition duration-150 ease-out hover:brightness-90 disabled:pointer-events-none disabled:opacity-60 dark:hover:brightness-110"
        >
          {playing ? (
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5" fill="currentColor">
              <rect x="5" y="4" width="3.5" height="12" rx="1" />
              <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5" fill="currentColor">
              <path d="M6.5 4.2v11.6c0 .6.7 1 1.2.6l8.2-5.8c.4-.3.4-.9 0-1.2L7.7 3.6c-.5-.4-1.2 0-1.2.6z" />
            </svg>
          )}
        </button>

        <input
          type="range"
          className="audio-scrubber min-w-0 flex-1 disabled:opacity-60"
          min={0}
          max={totalMs}
          step={100}
          value={Math.round(positionMs)}
          disabled={!canSeek || totalMs === 0}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={`Seek within ${label}`}
          aria-valuetext={formatDuration(positionMs)}
          style={{ '--played': `${percent}%` } as CSSProperties}
        />

        <p className="numeric text-muted shrink-0 text-sm">
          {formatDuration(positionMs)} / {formatDuration(totalMs)}
        </p>
      </div>

      {status ? (
        <p role="status" className={failed ? 'text-negative text-xs' : 'text-muted text-xs'}>
          {status}
        </p>
      ) : null}
    </div>
  )
}
