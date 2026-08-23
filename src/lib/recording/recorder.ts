import type { AmplitudeSample, PitchSample } from '@/lib/types/metrics'

/**
 * The slice of MediaRecorder this code touches, so tests can stand in for it.
 * Handler signatures mirror lib.dom exactly, which keeps a real MediaRecorder
 * assignable without a cast.
 */
export interface MediaRecorderLike {
  readonly state: string
  /** What the browser actually chose, which can differ from what was asked for. */
  readonly mimeType: string
  start(timesliceMs?: number): void
  stop(): void
  ondataavailable: ((event: BlobEvent) => void) | null
  onstop: ((event: Event) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export interface CaptureSampler {
  start(): void
  stop(): void
  snapshot(): { amplitude: AmplitudeSample[]; pitch: PitchSample[] }
}

export interface AttemptRecording {
  blob: Blob
  /** The recorder's real output type, not the type that was requested. */
  mimeType: string
  durationMs: number
  startedAt: string
  amplitude: AmplitudeSample[]
  pitch: PitchSample[]
}

export interface AttemptRecorderOptions {
  mimeType: string
  createRecorder: (mimeType: string) => MediaRecorderLike
  sampler: CaptureSampler
  maxDurationMs?: number
  /** Runs once the recording is finished or has failed, to release the stream. */
  onRelease?: () => void
}

export const MAX_RECORDING_MS = 60_000

export class RecorderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecorderError'
  }
}

/**
 * Owns exactly one MediaRecorder for exactly one attempt.
 *
 * Three failure modes from a previous implementation are designed out here:
 *
 * 1. `start()` is idempotent. It returns the same promise on every call and
 *    never builds a second recorder, so React StrictMode double invoking an
 *    effect in development cannot produce two recorders on one stream.
 * 2. `ondataavailable` is assigned, never added as a listener. Assigning twice
 *    replaces the handler; adding twice appends a second one and every chunk
 *    lands in the array twice, which sounds like slapback delay and produces a
 *    container transcription rejects.
 * 3. The chunk array is reset when a recording starts, not when it ends.
 */
export class AttemptRecorder {
  private readonly maxDurationMs: number
  private recorder: MediaRecorderLike | null = null
  private chunks: Blob[] = []
  private resultPromise: Promise<AttemptRecording> | null = null
  private resolveResult: ((recording: AttemptRecording) => void) | null = null
  private rejectResult: ((error: unknown) => void) | null = null
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null
  private actualMimeType: string
  private startedAtMs = 0
  private startedAtIso = ''
  private durationMs = 0
  private stopRequested = false
  private settled = false

  constructor(private readonly options: AttemptRecorderOptions) {
    this.maxDurationMs = options.maxDurationMs ?? MAX_RECORDING_MS
    this.actualMimeType = options.mimeType
  }

  /**
   * What the recorder is really producing. `isTypeSupported` is only advisory:
   * Safari has both refused a type it can record and accepted one it silently
   * substitutes. Reading this back after start is the only reliable answer, and
   * it decides the blob type, the stored mime, the file extension, and the
   * Content-Type the object is served with.
   */
  get mimeType(): string {
    return this.actualMimeType
  }

  /** True once a recorder exists. A second start is a no op. */
  get isStarted(): boolean {
    return this.resultPromise !== null
  }

  start(): Promise<AttemptRecording> {
    if (this.resultPromise) return this.resultPromise

    this.chunks = []
    this.startedAtMs = Date.now()
    this.startedAtIso = new Date(this.startedAtMs).toISOString()

    this.resultPromise = new Promise<AttemptRecording>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })

    let recorder: MediaRecorderLike
    try {
      recorder = this.options.createRecorder(this.options.mimeType)
    } catch (error) {
      this.fail(error)
      return this.resultPromise
    }

    this.recorder = recorder
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data)
    }
    recorder.onstop = () => this.finish()
    recorder.onerror = () => this.fail(new RecorderError('The recorder stopped unexpectedly.'))

    try {
      this.options.sampler.start()
      // No timeslice: one dataavailable at stop, so there is nothing to interleave.
      recorder.start()
      // Only valid once started. An empty string means the browser will not say.
      if (recorder.mimeType) this.actualMimeType = recorder.mimeType
    } catch (error) {
      this.fail(error)
      return this.resultPromise
    }

    this.autoStopTimer = setTimeout(() => this.stop(), this.maxDurationMs)
    return this.resultPromise
  }

  stop(): void {
    if (this.stopRequested || !this.resultPromise) return
    this.stopRequested = true
    this.clearAutoStop()
    this.durationMs = Math.max(0, Date.now() - this.startedAtMs)
    this.options.sampler.stop()

    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      this.finish()
    }
  }

  /** Stops without producing a recording, for unmount mid recording. */
  cancel(): void {
    if (this.settled) return
    // Settle first. Stopping the recorder below fires onstop, and without the
    // flag already set that path would resolve the promise this call is about
    // to reject.
    this.settle()
    this.stopRequested = true
    this.options.sampler.stop()
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      // The recorder was already torn down by the browser. Nothing to undo.
    }
    this.release()
    this.rejectResult?.(new RecorderError('Recording was cancelled.'))
  }

  private finish(): void {
    if (this.settled) return

    // Read the timelines before settling. settle() runs onRelease, which tears
    // down the sampler and the stream behind it.
    const { amplitude, pitch } = this.options.sampler.snapshot()
    const blob = new Blob(this.chunks, { type: this.actualMimeType })
    this.settle()
    this.release()

    this.resolveResult?.({
      blob,
      mimeType: this.actualMimeType,
      durationMs: this.durationMs || Math.max(0, Date.now() - this.startedAtMs),
      startedAt: this.startedAtIso,
      amplitude,
      pitch,
    })
  }

  private fail(error: unknown): void {
    if (this.settled) return
    this.settle()
    this.options.sampler.stop()
    this.release()
    this.rejectResult?.(error)
  }

  /** Closes the door on every other completion path. */
  private settle(): void {
    this.settled = true
    this.clearAutoStop()
  }

  private release(): void {
    this.options.onRelease?.()
  }

  private clearAutoStop(): void {
    if (this.autoStopTimer !== null) {
      clearTimeout(this.autoStopTimer)
      this.autoStopTimer = null
    }
  }
}
