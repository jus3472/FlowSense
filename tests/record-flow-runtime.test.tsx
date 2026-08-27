// @vitest-environment jsdom

import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordFlow } from '@/components/record/record-flow'
import type { PracticeSessionDescriptor } from '@/lib/practice/session'

const NativeURL = URL

const runtime = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  createAttempt: vi.fn(),
  createAttemptForSession: vi.fn(),
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
  createAttempt: runtime.createAttempt,
  createAttemptForSession: runtime.createAttemptForSession,
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
  static isTypeSupported = () => true

  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  startCalls = 0
  stopCalls = 0

  constructor() {
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-08-27T12:00:00.000Z'))
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.emitAudio = true
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
  runtime.createAttemptForSession.mockReturnValue({ payload: true })
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
})
