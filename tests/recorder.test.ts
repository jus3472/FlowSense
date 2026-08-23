import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AttemptRecorder,
  RecorderError,
  type CaptureSampler,
  type MediaRecorderLike,
} from '@/lib/recording/recorder'

class FakeMediaRecorder implements MediaRecorderLike {
  state = 'inactive'
  /** Browsers report their real choice here, which can differ from the request. */
  mimeType = ''
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  startCalls = 0

  start(): void {
    this.startCalls += 1
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.emitChunk('audio-bytes')
    this.onstop?.(new Event('stop'))
  }

  emitChunk(text: string): void {
    this.ondataavailable?.({ data: new Blob([text]) } as BlobEvent)
  }
}

function fakeSampler() {
  return {
    starts: 0,
    stops: 0,
    start() {
      this.starts += 1
    },
    stop() {
      this.stops += 1
    },
    snapshot() {
      return { amplitude: [{ t_ms: 0, rms: 0.1 }], pitch: [{ t_ms: 0, hz: 120 }] }
    },
  } satisfies CaptureSampler & { starts: number; stops: number }
}

function build(
  overrides: { maxDurationMs?: number; onRelease?: () => void; actualMimeType?: string } = {},
) {
  const created: FakeMediaRecorder[] = []
  const sampler = fakeSampler()
  const { actualMimeType, ...recorderOptions } = overrides
  const recorder = new AttemptRecorder({
    mimeType: 'audio/webm;codecs=opus',
    createRecorder: () => {
      const fake = new FakeMediaRecorder()
      fake.mimeType = actualMimeType ?? 'audio/webm;codecs=opus'
      created.push(fake)
      return fake
    },
    sampler,
    ...recorderOptions,
  })
  return { recorder, created, sampler }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AttemptRecorder', () => {
  /**
   * The guard that matters most. React StrictMode double invokes effects in
   * development, and a second recorder on the same stream produces a blob with
   * two interleaved copies of the audio.
   */
  it('creates exactly one MediaRecorder no matter how often start is called', async () => {
    const { recorder, created } = build()

    const first = recorder.start()
    const second = recorder.start()
    const third = recorder.start()

    expect(created).toHaveLength(1)
    expect(created[0]?.startCalls).toBe(1)
    expect(second).toBe(first)
    expect(third).toBe(first)

    recorder.stop()
    await first
  })

  it('starts the sampler once alongside the recorder', async () => {
    const { recorder, sampler } = build()
    recorder.start()
    recorder.start()
    expect(sampler.starts).toBe(1)
    recorder.stop()
    await recorder.start()
    expect(sampler.stops).toBe(1)
  })

  it('reports whether it has started', () => {
    const { recorder } = build()
    expect(recorder.isStarted).toBe(false)
    recorder.start()
    expect(recorder.isStarted).toBe(true)
    recorder.stop()
  })

  it('collects each chunk exactly once', async () => {
    const { recorder, created } = build()
    const promise = recorder.start()

    const fake = created[0]
    expect(fake).toBeDefined()
    fake?.emitChunk('one')
    fake?.emitChunk('two')
    recorder.stop() // emits 'audio-bytes' as the final chunk

    const result = await promise
    // 'one' + 'two' + 'audio-bytes' with nothing repeated.
    expect(result.blob.size).toBe(3 + 3 + 11)
    expect(result.mimeType).toBe('audio/webm;codecs=opus')
  })

  it('ignores empty chunks', async () => {
    const { recorder, created } = build()
    const promise = recorder.start()
    created[0]?.ondataavailable?.({ data: new Blob([]) } as BlobEvent)
    recorder.stop()
    const result = await promise
    expect(result.blob.size).toBe(11)
  })

  it('carries the sampler timelines and a start timestamp into the result', async () => {
    const { recorder } = build()
    const promise = recorder.start()
    recorder.stop()

    const result = await promise
    expect(result.amplitude).toEqual([{ t_ms: 0, rms: 0.1 }])
    expect(result.pitch).toEqual([{ t_ms: 0, hz: 120 }])
    expect(Number.isNaN(Date.parse(result.startedAt))).toBe(false)
  })

  it('stops itself at the maximum duration', async () => {
    vi.useFakeTimers()
    const { recorder, created } = build({ maxDurationMs: 60_000 })
    const promise = recorder.start()

    vi.advanceTimersByTime(59_000)
    expect(created[0]?.state).toBe('recording')

    vi.advanceTimersByTime(1_000)
    const result = await promise
    expect(created[0]?.state).toBe('inactive')
    expect(result.durationMs).toBe(60_000)
  })

  it('cancels the auto stop when stopped by hand', async () => {
    vi.useFakeTimers()
    const { recorder, created } = build({ maxDurationMs: 60_000 })
    const promise = recorder.start()

    vi.advanceTimersByTime(5_000)
    recorder.stop()
    const result = await promise
    expect(result.durationMs).toBe(5_000)

    // Nothing further should happen once the timer would have fired.
    vi.advanceTimersByTime(60_000)
    expect(created).toHaveLength(1)
  })

  it('ignores a second stop', async () => {
    const { recorder, created } = build()
    const promise = recorder.start()
    recorder.stop()
    recorder.stop()
    const result = await promise
    expect(result.blob.size).toBe(11)
    expect(created).toHaveLength(1)
  })

  /**
   * isTypeSupported is advisory. Safari has both refused a type it can record
   * and accepted one it silently substitutes, so the type that reaches storage,
   * the file extension, and the Content-Type must come from the recorder.
   */
  it('reports the type the recorder actually produced, not the one requested', async () => {
    const { recorder } = build({ actualMimeType: 'audio/mp4' })
    const promise = recorder.start()
    expect(recorder.mimeType).toBe('audio/mp4')
    recorder.stop()

    const result = await promise
    expect(result.mimeType).toBe('audio/mp4')
    expect(result.blob.type).toBe('audio/mp4')
  })

  it('keeps the requested type when the browser will not say', async () => {
    const { recorder } = build({ actualMimeType: '' })
    const promise = recorder.start()
    recorder.stop()
    const result = await promise
    expect(result.mimeType).toBe('audio/webm;codecs=opus')
  })

  it('releases the stream when the recording finishes', async () => {
    const onRelease = vi.fn()
    const { recorder } = build({ onRelease })
    const promise = recorder.start()
    recorder.stop()
    await promise
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('releases the stream and rejects when cancelled mid recording', async () => {
    const onRelease = vi.fn()
    const { recorder, sampler } = build({ onRelease })
    const promise = recorder.start()
    recorder.cancel()

    await expect(promise).rejects.toBeInstanceOf(RecorderError)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(sampler.stops).toBeGreaterThan(0)
  })
})
