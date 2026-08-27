import { computeRms, detectPitchHz } from '@/lib/recording/signal'
import type { CaptureSampler } from '@/lib/recording/recorder'
import type { AmplitudeSample, PitchSample } from '@/lib/types/metrics'

/** 20 samples per second on both timelines. */
export const SAMPLE_INTERVAL_MS = 50

/** 2048 samples is about 43ms at 48 kHz, roughly 2.5 periods of the 60 Hz floor. */
const FFT_SIZE = 2048

export interface AudioSampler extends CaptureSampler {
  /** Most recent RMS, for the on screen amplitude pulse. */
  level(): number
  close(): void
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Reads amplitude and pitch off the same stream the recorder is using, through
 * an AnalyserNode that is never connected to the destination, so nothing is
 * played back into the room.
 */
export function createAudioSampler(stream: MediaStream): AudioSampler {
  const context = new AudioContext()
  let source: MediaStreamAudioSourceNode
  let analyser: AnalyserNode
  try {
    source = context.createMediaStreamSource(stream)
    analyser = context.createAnalyser()
    analyser.fftSize = FFT_SIZE
    // Raw frames. Smoothing here would quietly corrupt the measurements later.
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)
  } catch (error) {
    void context.close().catch(() => undefined)
    throw error
  }

  const frame = new Float32Array(analyser.fftSize)
  const amplitude: AmplitudeSample[] = []
  const pitch: PitchSample[] = []

  let timer: ReturnType<typeof setInterval> | null = null
  let startedAt = 0
  let latestRms = 0
  let closed = false

  const sample = () => {
    if (closed) return
    analyser.getFloatTimeDomainData(frame)
    const tMs = Math.round(performance.now() - startedAt)

    const rms = computeRms(frame)
    latestRms = rms
    amplitude.push({ t_ms: tMs, rms: round(rms, 5) })

    const hz = detectPitchHz(frame, context.sampleRate)
    if (hz !== null) pitch.push({ t_ms: tMs, hz: round(hz, 1) })
  }

  return {
    start() {
      if (closed || timer !== null) return
      startedAt = performance.now()
      timer = setInterval(sample, SAMPLE_INTERVAL_MS)
    },
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
    snapshot() {
      return { amplitude: [...amplitude], pitch: [...pitch] }
    },
    level() {
      return latestRms
    },
    close() {
      if (closed) return
      closed = true
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      latestRms = 0
      try {
        source.disconnect()
      } catch {
        // Already disconnected by the browser during teardown.
      }
      try {
        analyser.disconnect()
      } catch {
        // Already disconnected by the browser during teardown.
      }
      try {
        void context.close().catch(() => undefined)
      } catch {
        // Already closed by the browser during teardown.
      }
    },
  }
}
