// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abandonUploadingAttempt: vi.fn(),
  createAttempt: vi.fn(),
  createAttemptForSession: vi.fn(),
  liveClose: vi.fn(),
  liveConnect: vi.fn(),
  liveFinish: vi.fn(),
  liveSend: vi.fn(),
  persistAttemptFailure: vi.fn(),
  replace: vi.fn(),
  saveRecording: vi.fn(),
  scoreAttempt: vi.fn(),
  transcribeAttempt: vi.fn(),
  uploadAudio: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/components/record/use-active-recording-exit-guard', () => ({
  useActiveRecordingExitGuard: () => ({ allowNextNavigation: vi.fn() }),
}))
vi.mock('@/lib/recording/support', () => {
  const support = { ok: true as const, mimeType: 'audio/webm;codecs=opus' }
  return {
    isResolvedMediaSupport: () => true,
    mediaSupportSnapshot: () => support,
    serverMediaSupportSnapshot: () => support,
    subscribeToMediaSupport: () => () => undefined,
  }
})
vi.mock('@/lib/recording/microphone', () => ({
  acquireMicrophone: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
  stopMediaStream: vi.fn(),
}))
vi.mock('@/lib/recording/audio-sampler', () => ({
  SAMPLE_INTERVAL_MS: 50,
  createAudioSampler: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    level: () => 0.1,
    snapshot: () => ({
      amplitude: [{ t_ms: 0, rms: 0.1 }],
      pitch: [{ t_ms: 0, hz: 120 }],
    }),
  }),
}))
vi.mock('@/lib/recording/capture-readiness', () => ({
  assessCaptureReadiness: () => ({ ok: true as const }),
}))
vi.mock('@/lib/recording/api', () => ({
  abandonUploadingAttempt: mocks.abandonUploadingAttempt,
  createAttempt: mocks.createAttempt,
  createAttemptForSession: mocks.createAttemptForSession,
  persistAttemptFailure: mocks.persistAttemptFailure,
  saveRecording: mocks.saveRecording,
  scoreAttempt: mocks.scoreAttempt,
  transcribeAttempt: mocks.transcribeAttempt,
  uploadAudio: mocks.uploadAudio,
}))
vi.mock('@/lib/recording/live-transcription', () => ({
  LiveTranscriber: class {
    constructor(
      private readonly options: {
        onUnavailable: () => void
      },
    ) {}

    async connect() {
      mocks.liveConnect()
      this.options.onUnavailable()
    }

    send(chunk: Blob) {
      mocks.liveSend(chunk)
    }

    finish() {
      mocks.liveFinish()
    }

    close() {
      mocks.liveClose()
    }
  },
}))

import { RecordFlow } from '@/components/record/record-flow'

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported() {
    return true
  }

  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  startCalls = 0
  timesliceMs: number | undefined
  stopCalls = 0
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  constructor() {
    FakeMediaRecorder.instances.push(this)
  }

  start(timesliceMs?: number) {
    this.startCalls += 1
    this.timesliceMs = timesliceMs
    this.state = 'recording'
  }

  stop() {
    this.stopCalls += 1
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['recorded audio']) } as BlobEvent)
    this.onstop?.(new Event('stop'))
  }
}

const SESSION = {
  promptId: '10000000-0000-4000-8000-000000000001',
  promptText: 'Describe a choice you made recently.',
  mode: 'practice' as const,
  difficulty: 'beginner' as const,
  source: 'library' as const,
  targetDurationSeconds: 60,
  retryOfAttemptId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  FakeMediaRecorder.instances = []
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  mocks.createAttemptForSession.mockReturnValue({ clientRequestId: 'request-id' })
  mocks.createAttempt.mockResolvedValue({
    attemptId: '20000000-0000-4000-8000-000000000002',
    storagePath: 'user/attempt.webm',
  })
  mocks.uploadAudio.mockResolvedValue(undefined)
  mocks.saveRecording.mockResolvedValue(undefined)
  mocks.transcribeAttempt.mockResolvedValue({ wordCount: 4 })
  mocks.scoreAttempt.mockResolvedValue({ score: 82 })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RecordFlow live transcription isolation', () => {
  it('completes the authoritative pipeline after live setup fails and starts once via Start now', async () => {
    render(<RecordFlow session={SESSION} />)

    const startNow = await screen.findByRole('button', { name: 'Start now' })
    await waitFor(() => expect(mocks.liveConnect).toHaveBeenCalledOnce())
    fireEvent.click(startNow)

    expect(
      await screen.findByText('Your words are not appearing right now. Your recording continues.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Live transcript')).not.toBeInTheDocument()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(FakeMediaRecorder.instances[0]?.startCalls).toBe(1)
    expect(FakeMediaRecorder.instances[0]?.timesliceMs).toBe(100)
    expect(mocks.liveConnect).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => {
      expect(mocks.uploadAudio).toHaveBeenCalledOnce()
      expect(mocks.saveRecording).toHaveBeenCalledOnce()
      expect(mocks.transcribeAttempt).toHaveBeenCalledOnce()
      expect(mocks.scoreAttempt).toHaveBeenCalledOnce()
      expect(mocks.replace).toHaveBeenCalledWith('/attempts/20000000-0000-4000-8000-000000000002')
    })
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(FakeMediaRecorder.instances[0]?.startCalls).toBe(1)
    expect(mocks.liveSend).toHaveBeenCalledOnce()
    expect(mocks.liveFinish).toHaveBeenCalledOnce()
  })
})
