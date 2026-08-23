'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatDuration } from '@/lib/recording/format'

interface AudioPlayerProps {
  src: string
  /** Measured while recording. The blob itself reports Infinity. */
  durationMs: number
  label?: string
}

/**
 * Custom transport over a hidden <audio> element.
 *
 * MediaRecorder blobs have no duration in their container. The browser reports
 * Infinity and backfills it only once the file has played through, which makes
 * the native control's scrub bar jump around. Everything shown here is driven by
 * the duration FlowSense measured during capture, and the element underneath is
 * only ever asked to play, pause, and seek.
 *
 * Callers pass `key={src}` so a new recording gets a fresh transport rather than
 * resuming halfway through the previous one.
 */
export function AudioPlayer({ src, durationMs, label = 'Your answer' }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)

  // timeupdate fires about 4 times a second, which reads as a stuttering
  // playhead. Reading currentTime every frame keeps it moving at a constant rate.
  useEffect(() => {
    if (!playing) return

    let frame = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio) setPositionMs(Math.min(audio.currentTime * 1000, durationMs))
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, durationMs])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return

    if (playing) {
      audio.pause()
      return
    }
    if (positionMs >= durationMs) audio.currentTime = 0
    void audio.play()
  }

  const seek = (value: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value / 1000
    setPositionMs(value)
  }

  const percent = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0

  return (
    <div className="bg-surface rounded-card flex flex-col gap-2 p-4">
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPositionMs(durationMs)
        }}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
          className="bg-accent text-accent-fg flex size-11 shrink-0 items-center justify-center rounded-full transition duration-150 ease-out hover:brightness-90 dark:hover:brightness-110"
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
          className="audio-scrubber min-w-0 flex-1"
          min={0}
          max={durationMs}
          step={100}
          value={Math.round(positionMs)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={`Seek within ${label}`}
          aria-valuetext={formatDuration(positionMs)}
          style={{ '--played': `${percent}%` } as CSSProperties}
        />

        <p className="numeric text-muted shrink-0 text-sm">
          {formatDuration(positionMs)} / {formatDuration(durationMs)}
        </p>
      </div>
    </div>
  )
}
