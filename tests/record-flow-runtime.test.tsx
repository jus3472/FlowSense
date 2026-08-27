// @vitest-environment jsdom

import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordFlow } from '@/components/record/record-flow'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'
import type { PracticeSessionDescriptor } from '@/lib/practice/session'
import { MICROPHONE_ACQUISITION_TIMEOUT_MS } from '@/lib/recording/microphone'

const NativeURL = URL

const runtime = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  abandonUploadingAttempt: vi.fn(),
  createAttempt: vi.fn(),
  createAttemptForSession: vi.fn(),
  persistAttemptFailure: vi.fn(),
  uploadAudio: vi.fn(),
  saveRecording: vi.fn(),
  transcribeAttempt: vi.fn(),
  scoreAttempt: vi.fn(),
  createAudioSampler: vi.fn(),
  getUserMedia: vi.fn(),
  samplerStart: vi.fn(),
  samplerStop: vi.fn(),
  samplerClose: vi.fn(),
  samplerSnapshot: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: runtime.routerReplace }),
}))

vi.mock('@/lib/recording/api', () => ({
  abandonUploadingAttempt: runtime.abandonUploadingAttempt,
  createAttempt: runtime.createAttempt,
  createAttemptForSession: runtime.createAttemptForSession,
  persistAttemptFailure: runtime.persistAttemptFailure,
  uploadAudio: runtime.uploadAudio,
  saveRecording: runtime.saveRecording,
  transcribeAttempt: runtime.transcribeAttempt,
  scoreAttempt: runtime.scoreAttempt,
}))

vi.mock('@/lib/recording/audio-sampler', () => ({
  SAMPLE_INTERVAL_MS: 50,
  createAudioSampler: runtime.createAudioSampler,
}))

vi.mock('@/lib/recording/support', () => {
  const supported = { ok: true as const, mimeType: 'audio/webm;codecs=opus' }
  return {
    mediaSupportSnapshot: () => supported,
    serverMediaSupportSnapshot: () => supported,
    subscribeToMediaSupport: () => () => undefined,
  }
})

vi.mock('@/components/record/countdown-step', () => ({
  CountdownStep: ({ onComplete }: { onComplete: () => void }) => (
    <button type="button" onClick={onComplete}>
      Finish countdown
    </button>
  ),
}))

vi.mock('@/components/record/recording-step', () => ({
  RecordingStep: ({ onStop }: { onStop: () => void }) => (
    <button type="button" onClick={onStop}>
      Stop
    </button>
  ),
}))

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static emitAudio = true
  static constructionError: Error | null = null
  static isTypeSupported = () => true

  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  startCalls = 0
  stopCalls = 0

  constructor() {
    if (FakeMediaRecorder.constructionError) throw FakeMediaRecorder.constructionError
    FakeMediaRecorder.instances.push(this)
  }

  start() {
    this.startCalls += 1
    this.state = 'recording'
  }

  stop() {
    this.stopCalls += 1
    this.state = 'inactive'
    if (FakeMediaRecorder.emitAudio) {
      this.ondataavailable?.({ data: new Blob(['recorded-audio']) } as BlobEvent)
    }
    this.onstop?.(new Event('stop'))
  }
}

const session: PracticeSessionDescriptor = {
  promptText: 'Describe a decision you made.',
  promptId: '10000000-0000-4000-8000-000000000001',
  mode: 'practice',
  difficulty: 'beginner',
  source: 'library',
  targetDurationSeconds: 60,
  retryOfAttemptId: null,
}

function quietSpeech() {
  return Array.from({ length: 21 }, (_, index) => ({
    t_ms: index * 50,
    rms: index % 2 === 0 ? 0.00002 : 0.00004,
  }))
}

function streamWithTrack() {
  const stop = vi.fn()
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop }
}

async function reachCountdown() {
  fireEvent.click(screen.getByRole('button', { name: "I'm ready" }))
  await screen.findByRole('button', { name: 'Finish countdown' })
}

async function recordValidResponse() {
  await reachCountdown()
  fireEvent.click(screen.getByRole('button', { name: 'Finish countdown' }))
  act(() => vi.advanceTimersByTime(1_000))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    // Let the immediately resolved mock boundaries settle inside React's act.
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-08-27T12:00:00.000Z'))
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.emitAudio = true
  FakeMediaRecorder.constructionError = null
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  class RuntimeURL extends NativeURL {
    static override createObjectURL = vi.fn(() => 'blob:recording')
    static override revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', RuntimeURL)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: runtime.getUserMedia },
  })

  runtime.createAttempt.mockResolvedValue({ attemptId: 'attempt-id', storagePath: 'path' })
  runtime.createAttemptForSession.mockReturnValue({
    ...session,
    clientRequestId: '20000000-0000-4000-8000-000000000001',
    durationMs: 1_000,
    mimeType: 'audio/webm;codecs=opus',
  })
  runtime.persistAttemptFailure.mockResolvedValue(undefined)
  runtime.uploadAudio.mockResolvedValue(undefined)
  runtime.saveRecording.mockResolvedValue(undefined)
  runtime.transcribeAttempt.mockResolvedValue(undefined)
  runtime.scoreAttempt.mockResolvedValue(undefined)
  runtime.samplerSnapshot.mockReturnValue({ amplitude: quietSpeech(), pitch: [] })
  runtime.createAudioSampler.mockReturnValue({
    start: runtime.samplerStart,
    stop: runtime.samplerStop,
    close: runtime.samplerClose,
    snapshot: runtime.samplerSnapshot,
    level: () => 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('RecordFlow runtime guards', () => {
  it('times out an unresolved microphone request and leaves a recoverable state', async () => {
    runtime.getUserMedia.mockReturnValue(new Promise<MediaStream>(() => undefined))
    render(<RecordFlow session={session} />)

    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }))
    expect(screen.getByRole('button', { name: 'Waiting for your browser' })).toBeDisabled()

    await act(async () => vi.advanceTimersByTime(MICROPHONE_ACQUISITION_TIMEOUT_MS))

    expect(
      await screen.findByRole('heading', { name: 'Microphone access is blocked' }),
    ).toBeVisible()
    expect(screen.getByText(/Allow microphone access, then try again/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(runtime.createAttempt).not.toHaveBeenCalled()
  })

  it('shows the recoverable microphone error when permission is rejected', async () => {
    runtime.getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    render(<RecordFlow session={session} />)

    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }))

    expect(
      await screen.findByRole('heading', { name: 'Microphone access is blocked' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(runtime.createAttempt).not.toHaveBeenCalled()
  })

  it('requests the microphone again when retrying after a timeout', async () => {
    const { stream } = streamWithTrack()
    runtime.getUserMedia
      .mockReturnValueOnce(new Promise<MediaStream>(() => undefined))
      .mockResolvedValueOnce(stream)
    render(<RecordFlow session={session} />)

    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }))
    await act(async () => vi.advanceTimersByTime(MICROPHONE_ACQUISITION_TIMEOUT_MS))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('button', { name: 'Finish countdown' })).toBeVisible()
    expect(runtime.getUserMedia).toHaveBeenCalledTimes(2)
    expect(runtime.createAttempt).not.toHaveBeenCalled()
  })

  it('stops a stream that resolves after its acquisition timed out', async () => {
    const late = streamWithTrack()
    const retry = streamWithTrack()
    let resolveLate: ((stream: MediaStream) => void) | undefined
    runtime.getUserMedia
      .mockReturnValueOnce(
        new Promise<MediaStream>((resolve) => {
          resolveLate = resolve
        }),
      )
      .mockResolvedValueOnce(retry.stream)
    render(<RecordFlow session={session} />)

    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }))
    await act(async () => vi.advanceTimersByTime(MICROPHONE_ACQUISITION_TIMEOUT_MS))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Finish countdown' })
    await act(async () => resolveLate?.(late.stream))

    expect(late.stop).toHaveBeenCalledTimes(1)
    expect(retry.stop).not.toHaveBeenCalled()
    expect(runtime.createAudioSampler).toHaveBeenCalledTimes(1)
    expect(runtime.createAttempt).not.toHaveBeenCalled()
  })

  it('releases partially initialized media resources when recorder setup fails', async () => {
    const { stream, stop } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    FakeMediaRecorder.constructionError = new Error('Recorder setup failed.')
    render(<RecordFlow session={session} />)

    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finish countdown' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Recorder setup failed.')
    expect(runtime.samplerStop).toHaveBeenCalledTimes(1)
    expect(runtime.samplerClose).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(runtime.createAttempt).not.toHaveBeenCalled()
  })

  it('deduplicates microphone and recorder setup under StrictMode', async () => {
    const { stream } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    render(
      <StrictMode>
        <RecordFlow session={session} />
      </StrictMode>,
    )

    const start = screen.getByRole('button', { name: "I'm ready" })
    act(() => {
      start.click()
      start.click()
    })
    await screen.findByRole('button', { name: 'Finish countdown' })
    fireEvent.click(screen.getByRole('button', { name: 'Finish countdown' }))

    expect(runtime.getUserMedia).toHaveBeenCalledTimes(1)
    expect(runtime.createAudioSampler).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(FakeMediaRecorder.instances[0]?.startCalls).toBe(1)
  })

  it('stops a microphone permission result that arrives after unmount', async () => {
    const { stream, stop } = streamWithTrack()
    let resolveStream: ((stream: MediaStream) => void) | undefined
    runtime.getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve
      }),
    )
    const view = render(<RecordFlow session={session} />)

    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }))
    view.unmount()
    await act(async () => resolveStream?.(stream))

    expect(stop).toHaveBeenCalledTimes(1)
    expect(runtime.createAudioSampler).not.toHaveBeenCalled()
  })

  it('releases countdown resources exactly once on unmount', async () => {
    const { stream, stop } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    const view = render(<RecordFlow session={session} />)
    await reachCountdown()

    view.unmount()

    expect(runtime.samplerStop).toHaveBeenCalledTimes(1)
    expect(runtime.samplerClose).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops recorder, sampler, and track once when unmounted while recording', async () => {
    const { stream, stop } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    const view = render(<RecordFlow session={session} />)
    await reachCountdown()
    fireEvent.click(screen.getByRole('button', { name: 'Finish countdown' }))

    view.unmount()

    expect(FakeMediaRecorder.instances[0]?.stopCalls).toBe(1)
    expect(runtime.samplerStop).toHaveBeenCalledTimes(1)
    expect(runtime.samplerClose).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('cancels capture and recovers when a popstate traversal leaves the flow mounted', async () => {
    const { stream, stop } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    render(<RecordFlow session={session} />)
    await reachCountdown()
    fireEvent.click(screen.getByRole('button', { name: 'Finish countdown' }))
    let releasedBeforeRouterListener = false
    const laterRouterListener = () => {
      releasedBeforeRouterListener = stop.mock.calls.length === 1
    }
    window.addEventListener('popstate', laterRouterListener)

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    window.removeEventListener('popstate', laterRouterListener)
    expect(releasedBeforeRouterListener).toBe(true)
    expect(FakeMediaRecorder.instances[0]?.stopCalls).toBe(1)
    expect(runtime.samplerStop).toHaveBeenCalledTimes(1)
    expect(runtime.samplerClose).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The recording stopped when the page changed.',
    )
    expect(screen.getByRole('button', { name: 'Start over' })).toBeVisible()
  })

  it('keeps an immediate stop local and recoverable', async () => {
    const { stream } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    render(<RecordFlow session={session} />)
    await reachCountdown()
    fireEvent.click(screen.getByRole('button', { name: 'Finish countdown' }))

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('too short to process')
    expect(screen.getByRole('button', { name: 'Start over' })).toBeVisible()
    expect(runtime.createAttempt).not.toHaveBeenCalled()
    expect(runtime.uploadAudio).not.toHaveBeenCalled()
    expect(runtime.transcribeAttempt).not.toHaveBeenCalled()
    expect(runtime.scoreAttempt).not.toHaveBeenCalled()
  })

  it('uploads and processes one valid quiet recording in order', async () => {
    const { stream } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    render(<RecordFlow session={session} />)
    await reachCountdown()
    fireEvent.click(screen.getByRole('button', { name: 'Finish countdown' }))
    act(() => vi.advanceTimersByTime(1_000))

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(runtime.routerReplace).toHaveBeenCalledWith('/attempts/attempt-id'))
    expect(runtime.createAttempt).toHaveBeenCalledTimes(1)
    expect(runtime.uploadAudio).toHaveBeenCalledTimes(1)
    expect(runtime.saveRecording).toHaveBeenCalledTimes(1)
    expect(runtime.transcribeAttempt).toHaveBeenCalledTimes(1)
    expect(runtime.scoreAttempt).toHaveBeenCalledTimes(1)
    expect(runtime.createAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.uploadAudio.mock.invocationCallOrder[0] ?? 0,
    )
    expect(runtime.uploadAudio.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.transcribeAttempt.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('persists a client transcription failure before offering a retry', async () => {
    const { stream } = streamWithTrack()
    let finishPersistence: (() => void) | undefined
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.transcribeAttempt.mockRejectedValueOnce(new Error('The connection failed.'))
    runtime.persistAttemptFailure.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishPersistence = resolve
      }),
    )
    render(<RecordFlow session={session} />)

    await recordValidResponse()

    await waitFor(() =>
      expect(runtime.persistAttemptFailure).toHaveBeenCalledWith(
        'attempt-id',
        'transcribing',
        'failed',
      ),
    )
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()

    await act(async () => finishPersistence?.())

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('persists a client scoring timeout as timed out', async () => {
    const { stream } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.scoreAttempt.mockRejectedValueOnce(new RequestTimeoutError('Scoring your answer', 75))
    render(<RecordFlow session={session} />)

    await recordValidResponse()

    await waitFor(() =>
      expect(runtime.persistAttemptFailure).toHaveBeenCalledWith(
        'attempt-id',
        'scoring',
        'timed_out',
      ),
    )
    expect(await screen.findByRole('heading', { name: 'Scoring timed out' })).toBeVisible()
  })

  it('keeps an upload failure local and retries the same attempt without duplicate work', async () => {
    const { stream } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.uploadAudio.mockRejectedValueOnce(new Error('The upload failed.'))
    render(<RecordFlow session={session} />)

    await recordValidResponse()
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(runtime.routerReplace).toHaveBeenCalledWith('/attempts/attempt-id'))
    expect(runtime.createAttempt).toHaveBeenCalledTimes(1)
    expect(runtime.uploadAudio).toHaveBeenCalledTimes(2)
    expect(runtime.saveRecording).toHaveBeenCalledTimes(1)
    expect(runtime.persistAttemptFailure).not.toHaveBeenCalled()
  })

  it('abandons the retryable row when the user leaves after an upload failure', async () => {
    const { stream } = streamWithTrack()
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.uploadAudio.mockRejectedValueOnce(new Error('The upload failed.'))
    const view = render(<RecordFlow session={session} />)

    await recordValidResponse()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled()

    view.unmount()

    expect(runtime.abandonUploadingAttempt).toHaveBeenCalledWith(
      runtime.createAttemptForSession.mock.results[0]?.value,
      'attempt-id',
    )
  })

  it('ignores a second retry click while one processing run is active', async () => {
    const { stream } = streamWithTrack()
    let finishRetry: (() => void) | undefined
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.transcribeAttempt
      .mockRejectedValueOnce(new Error('The connection failed.'))
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishRetry = resolve
        }),
      )
    render(<RecordFlow session={session} />)

    await recordValidResponse()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    act(() => {
      retry.click()
      retry.click()
    })

    await waitFor(() => expect(runtime.transcribeAttempt).toHaveBeenCalledTimes(2))
    await act(async () => finishRetry?.())
    await waitFor(() => expect(runtime.routerReplace).toHaveBeenCalledWith('/attempts/attempt-id'))
    expect(runtime.scoreAttempt).toHaveBeenCalledTimes(1)
  })

  it('abandons a pending creation with its full idempotent payload and does not upload afterward', async () => {
    const { stream } = streamWithTrack()
    let finishCreation: ((attempt: { attemptId: string; storagePath: string }) => void) | undefined
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.createAttempt.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCreation = resolve
      }),
    )
    const view = render(<RecordFlow session={session} />)

    await recordValidResponse()
    await waitFor(() => expect(runtime.createAttempt).toHaveBeenCalledTimes(1))
    view.unmount()

    expect(runtime.abandonUploadingAttempt).toHaveBeenCalledWith(
      runtime.createAttemptForSession.mock.results[0]?.value,
      undefined,
    )
    await act(async () => finishCreation?.({ attemptId: 'attempt-id', storagePath: 'path' }))
    expect(runtime.uploadAudio).not.toHaveBeenCalled()
  })

  it('does not start provider work when teardown happens while recording details are saving', async () => {
    const { stream } = streamWithTrack()
    let finishSave: (() => void) | undefined
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.saveRecording.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    const view = render(<RecordFlow session={session} />)

    await recordValidResponse()
    await waitFor(() => expect(runtime.saveRecording).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => finishSave?.())

    expect(runtime.abandonUploadingAttempt).toHaveBeenCalledWith(
      runtime.createAttemptForSession.mock.results[0]?.value,
      'attempt-id',
    )
    expect(runtime.transcribeAttempt).not.toHaveBeenCalled()
    expect(runtime.scoreAttempt).not.toHaveBeenCalled()
  })

  it('does not abandon an upload when pagehide is entering the back-forward cache', async () => {
    const { stream } = streamWithTrack()
    let finishCreation: ((attempt: { attemptId: string; storagePath: string }) => void) | undefined
    runtime.getUserMedia.mockResolvedValue(stream)
    runtime.createAttempt.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCreation = resolve
      }),
    )
    const view = render(<RecordFlow session={session} />)
    await recordValidResponse()
    await waitFor(() => expect(runtime.createAttempt).toHaveBeenCalledTimes(1))
    const pageHide = new Event('pagehide')
    Object.defineProperty(pageHide, 'persisted', { value: true })

    window.dispatchEvent(pageHide)

    expect(runtime.abandonUploadingAttempt).not.toHaveBeenCalled()
    await act(async () => finishCreation?.({ attemptId: 'attempt-id', storagePath: 'path' }))
    await waitFor(() => expect(runtime.routerReplace).toHaveBeenCalledWith('/attempts/attempt-id'))
    view.unmount()
  })
})
