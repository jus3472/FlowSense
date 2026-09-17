import {
  applyLiveTranscriptResult,
  EMPTY_LIVE_TRANSCRIPT,
  parseDeepgramLiveResult,
  type LiveTranscriptState,
} from '@/lib/recording/live-transcript'
import { buildDeepgramLiveUrl } from '@/lib/deepgram/request'
const MAX_QUEUED_BYTES = 2_000_000

interface LiveTokenResponse {
  token: string
}

interface LiveTranscriberOptions {
  onTranscript: (state: LiveTranscriptState) => void
  onUnavailable: () => void
  fetchToken?: () => Promise<LiveTokenResponse>
  createSocket?: (url: string, protocols: string[]) => WebSocket
}

async function requestLiveToken(): Promise<LiveTokenResponse> {
  const response = await fetch('/api/transcribe/live-token', {
    method: 'POST',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Live transcription token was unavailable.')
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('token' in body) ||
    typeof body.token !== 'string' ||
    body.token.length === 0
  ) {
    throw new Error('Live transcription token was invalid.')
  }
  return { token: body.token }
}

/**
 * Best-effort live captions. The stored recording and server-side prerecorded
 * transcript remain authoritative, so this connection can fail independently.
 */
export class LiveTranscriber {
  private socket: WebSocket | null = null
  private state: LiveTranscriptState = EMPTY_LIVE_TRANSCRIPT
  private queued: Blob[] = []
  private queuedBytes = 0
  private unavailable = false
  private closed = false

  constructor(private readonly options: LiveTranscriberOptions) {}

  async connect(): Promise<void> {
    try {
      const { token } = await (this.options.fetchToken ?? requestLiveToken)()
      if (this.closed || this.unavailable) return
      const socket = (
        this.options.createSocket ?? ((url, protocols) => new WebSocket(url, protocols))
      )(buildDeepgramLiveUrl(), ['bearer', token])
      this.socket = socket
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => this.flushQueue()
      socket.onmessage = (event) => this.handleMessage(event.data)
      socket.onerror = () => this.markUnavailable()
      socket.onclose = () => {
        if (!this.closed) this.markUnavailable()
      }
    } catch {
      this.markUnavailable()
    }
  }

  send(chunk: Blob): void {
    if (this.closed || this.unavailable) return
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(chunk)
      } catch {
        this.markUnavailable()
      }
      return
    }
    if (this.queuedBytes + chunk.size > MAX_QUEUED_BYTES) {
      this.markUnavailable()
      return
    }
    this.queued.push(chunk)
    this.queuedBytes += chunk.size
  }

  finish(): void {
    if (this.closed) return
    this.closed = true
    this.queued = []
    this.queuedBytes = 0
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({ type: 'Finalize' }))
        this.socket.send(JSON.stringify({ type: 'CloseStream' }))
      } catch {
        this.socket.close()
      }
    } else {
      this.socket?.close()
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queued = []
    this.queuedBytes = 0
    this.socket?.close()
  }

  private flushQueue(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN || this.closed) return
    try {
      for (const chunk of this.queued) socket.send(chunk)
    } catch {
      this.markUnavailable()
      return
    }
    this.queued = []
    this.queuedBytes = 0
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string' || this.closed) return
    try {
      const result = parseDeepgramLiveResult(JSON.parse(data) as unknown)
      if (!result) return
      this.state = applyLiveTranscriptResult(this.state, result)
      this.options.onTranscript(this.state)
    } catch {
      // Ignore malformed or unrelated provider messages without stopping capture.
    }
  }

  private markUnavailable(): void {
    if (this.unavailable || this.closed) return
    this.unavailable = true
    this.queued = []
    this.queuedBytes = 0
    this.socket?.close()
    this.options.onUnavailable()
  }
}
