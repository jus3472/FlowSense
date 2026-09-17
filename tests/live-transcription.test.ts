import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLiveTranscriptResult,
  EMPTY_LIVE_TRANSCRIPT,
  liveTranscriptText,
  parseDeepgramLiveResult,
} from '@/lib/recording/live-transcript'
import { buildDeepgramLiveUrl } from '@/lib/deepgram/request'
import { LiveTranscriber } from '@/lib/recording/live-transcription'

class FakeSocket {
  static readonly OPEN = 1
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: unknown[] = []
  close = vi.fn(() => {
    this.readyState = 3
  })

  send(value: unknown) {
    this.sent.push(value)
  }

  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
})

describe('live transcript assembly', () => {
  it('replaces changing interim text instead of appending it', () => {
    const first = applyLiveTranscriptResult(EMPTY_LIVE_TRANSCRIPT, {
      start: 0,
      text: 'I chose',
      isFinal: false,
    })
    const second = applyLiveTranscriptResult(first, {
      start: 0,
      text: 'I chose the train',
      isFinal: false,
    })
    expect(liveTranscriptText(second)).toBe('I chose the train')
  })

  it('replaces interim text with finalized spans without duplication', () => {
    const interim = applyLiveTranscriptResult(EMPTY_LIVE_TRANSCRIPT, {
      start: 0,
      text: 'I chose the train',
      isFinal: false,
    })
    const finalized = applyLiveTranscriptResult(interim, {
      start: 0,
      text: 'I chose the train.',
      isFinal: true,
    })
    const repeatedFinal = applyLiveTranscriptResult(finalized, {
      start: 0,
      text: 'I chose the train.',
      isFinal: true,
    })
    expect(liveTranscriptText(repeatedFinal)).toBe('I chose the train.')
  })

  it('replaces an earlier finalized hypothesis when the provider corrects the same span', () => {
    const firstFinal = applyLiveTranscriptResult(EMPTY_LIVE_TRANSCRIPT, {
      start: 0,
      text: 'We planned a verification.',
      isFinal: true,
    })
    const correctedFinal = applyLiveTranscriptResult(firstFinal, {
      start: 0,
      text: 'We planned a vacation.',
      isFinal: true,
    })

    expect(liveTranscriptText(correctedFinal)).toBe('We planned a vacation.')
  })

  it('parses transcript results and ignores unrelated messages', () => {
    expect(parseDeepgramLiveResult({ type: 'Metadata' })).toBeNull()
    expect(
      parseDeepgramLiveResult({
        type: 'Results',
        start: 2.5,
        is_final: true,
        channel: { alternatives: [{ transcript: 'Next thought.' }] },
      }),
    ).toEqual({ start: 2.5, text: 'Next thought.', isFinal: true })
  })
})

describe('LiveTranscriber', () => {
  it('uses a Bearer subprotocol with a short-lived token and required model settings', async () => {
    const socket = new FakeSocket()
    const createSocket = vi.fn(() => socket as unknown as WebSocket)
    const transcriber = new LiveTranscriber({
      fetchToken: async () => ({ token: 'short-lived-jwt' }),
      createSocket,
      onTranscript: vi.fn(),
      onUnavailable: vi.fn(),
    })

    await transcriber.connect()

    expect(createSocket).toHaveBeenCalledWith(buildDeepgramLiveUrl(), ['bearer', 'short-lived-jwt'])
    const url = new URL(buildDeepgramLiveUrl())
    expect(url.searchParams.get('model')).toBe('nova-2')
    expect(url.searchParams.get('filler_words')).toBe('true')
    expect(url.searchParams.get('interim_results')).toBe('true')
    expect(url.searchParams.get('endpointing')).toBe('false')
    expect(url.searchParams.has('smart_format')).toBe(false)
  })

  it('queues recording chunks until connected and emits interim and final updates', async () => {
    const socket = new FakeSocket()
    const onTranscript = vi.fn()
    const transcriber = new LiveTranscriber({
      fetchToken: async () => ({ token: 'jwt' }),
      createSocket: () => socket as unknown as WebSocket,
      onTranscript,
      onUnavailable: vi.fn(),
    })
    await transcriber.connect()
    const chunk = new Blob(['audio'])
    transcriber.send(chunk)
    expect(socket.sent).toEqual([])
    socket.open()
    expect(socket.sent).toEqual([chunk])

    socket.message({
      type: 'Results',
      start: 0,
      is_final: false,
      channel: { alternatives: [{ transcript: 'interim words' }] },
    })
    socket.message({
      type: 'Results',
      start: 0,
      is_final: true,
      channel: { alternatives: [{ transcript: 'Final words.' }] },
    })
    expect(onTranscript).toHaveBeenCalledTimes(2)
    expect(liveTranscriptText(onTranscript.mock.calls[1]?.[0])).toBe('Final words.')
  })

  it('reports setup failure without throwing into the recording flow', async () => {
    const onUnavailable = vi.fn()
    const transcriber = new LiveTranscriber({
      fetchToken: async () => {
        throw new Error('grant unavailable')
      },
      onTranscript: vi.fn(),
      onUnavailable,
    })

    await expect(transcriber.connect()).resolves.toBeUndefined()
    expect(onUnavailable).toHaveBeenCalledOnce()
    expect(() => transcriber.send(new Blob(['still recording']))).not.toThrow()
  })
})
