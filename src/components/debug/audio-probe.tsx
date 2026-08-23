'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { RECORDING_MIME_CANDIDATES } from '@/lib/recording/mime'
import { rangesToArray } from '@/lib/recording/playback'

export interface ProbeItem {
  id: string
  label: string
  url: string
  durationMs: number
  mimeType: string
}

function describeRanges(ranges: TimeRanges | null | undefined): string {
  const list = rangesToArray(ranges)
  if (list.length === 0) return 'empty'
  return list.map((r) => `${r.start.toFixed(2)} to ${r.end.toFixed(2)}`).join(', ')
}

function snapshot(audio: HTMLAudioElement): string {
  return [
    `readyState=${audio.readyState}`,
    `networkState=${audio.networkState}`,
    `duration=${audio.duration}`,
    `currentTime=${audio.currentTime.toFixed(3)}`,
    `paused=${audio.paused}`,
    `buffered=[${describeRanges(audio.buffered)}]`,
    `seekable=[${describeRanges(audio.seekable)}]`,
  ].join('  ')
}

const MEDIA_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'canplaythrough',
  'durationchange',
  'progress',
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'waiting',
  'stalled',
  'suspend',
  'ended',
  'error',
] as const

/**
 * Reports what this browser actually does with our recordings. It exists
 * because iOS WebKit fails silently: the numbers below are the difference
 * between "playback is broken" and knowing which of readyState, duration, or
 * seekable is the one lying.
 */
export function AudioProbe({ items }: { items: ProbeItem[] }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const startedAt = useRef<number>(0)
  const [selected, setSelected] = useState(0)
  const [lines, setLines] = useState<string[]>([])
  const [attached, setAttached] = useState(false)

  const item = items[selected]

  const log = (label: string, detail = '') => {
    if (startedAt.current === 0) startedAt.current = performance.now()
    const at = Math.round(performance.now() - startedAt.current)
    setLines((current) => [...current, `+${String(at).padStart(5)}ms  ${label}  ${detail}`])
  }

  const attach = () => {
    const audio = audioRef.current
    if (!audio || attached) return
    setAttached(true)
    startedAt.current = performance.now()

    setLines([
      `userAgent: ${navigator.userAgent}`,
      `MediaRecorder: ${typeof MediaRecorder === 'undefined' ? 'missing' : 'present'}`,
      ...RECORDING_MIME_CANDIDATES.map(
        (type) =>
          `isTypeSupported(${type}) = ${
            typeof MediaRecorder === 'undefined'
              ? 'n/a'
              : String(MediaRecorder.isTypeSupported(type))
          }`,
      ),
      `stored mime: ${item?.mimeType ?? 'unknown'}`,
      `measured duration: ${item?.durationMs ?? 0} ms`,
      '',
    ])

    for (const name of MEDIA_EVENTS) {
      audio.addEventListener(name, () => log(name.padEnd(16), snapshot(audio)))
    }
    log('attached'.padEnd(16), snapshot(audio))
  }

  const runPlay = () => {
    const audio = audioRef.current
    if (!audio) return
    log('play() called'.padEnd(16), snapshot(audio))
    const promise = audio.play() as Promise<void> | undefined
    if (!promise) {
      log('play() returned'.padEnd(16), 'undefined, no promise on this browser')
      return
    }
    promise.then(
      () => log('play() RESOLVED'.padEnd(16), snapshot(audio)),
      (error: unknown) => {
        const name = error instanceof DOMException ? error.name : typeof error
        const detail = error instanceof Error ? error.message : String(error)
        log('play() REJECTED'.padEnd(16), `${name}: ${detail}`)
      },
    )
  }

  const trySeek = (seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const before = audio.currentTime
    log(`seek to ${seconds}s`.padEnd(16), `before currentTime=${before.toFixed(3)}`)
    try {
      audio.currentTime = seconds
    } catch (error) {
      log('seek THREW'.padEnd(16), error instanceof Error ? error.message : String(error))
      return
    }
    // WebKit applies the seek asynchronously, or silently drops it.
    window.setTimeout(() => {
      log(
        'seek result'.padEnd(16),
        `currentTime=${audio.currentTime.toFixed(3)} moved=${audio.currentTime !== before}`,
      )
    }, 400)
  }

  if (!item) {
    return <p className="text-muted text-base">No attempts with audio to probe.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="probe-attempt" className="text-foreground text-sm font-medium">
          Recording
        </label>
        <select
          id="probe-attempt"
          value={selected}
          disabled={attached}
          onChange={(event) => setSelected(Number(event.target.value))}
          className="bg-surface-sunken rounded-input text-foreground min-h-11 px-4 text-base"
        >
          {items.map((entry, index) => (
            <option key={entry.id} value={index}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <audio ref={audioRef} src={item.url} preload="auto" className="w-full" />

      <div className="flex flex-wrap gap-3">
        <Button onClick={attach} disabled={attached}>
          1. Attach
        </Button>
        <Button onClick={runPlay} disabled={!attached}>
          2. Play
        </Button>
        <Button variant="secondary" onClick={() => audioRef.current?.pause()} disabled={!attached}>
          Pause
        </Button>
        <Button variant="secondary" onClick={() => trySeek(0)} disabled={!attached}>
          Seek 0
        </Button>
        <Button
          variant="secondary"
          onClick={() => trySeek(Math.max(1, item.durationMs / 2000))}
          disabled={!attached}
        >
          Seek middle
        </Button>
        <Button variant="ghost" onClick={() => setLines([])} disabled={!attached}>
          Clear log
        </Button>
      </div>

      <pre className="bg-surface-sunken rounded-card text-foreground overflow-x-auto p-4 font-mono text-xs whitespace-pre-wrap">
        {lines.length === 0 ? 'Press Attach, then Play.' : lines.join('\n')}
      </pre>
    </div>
  )
}
