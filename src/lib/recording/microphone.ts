export const MICROPHONE_ACQUISITION_TIMEOUT_MS = 10_000

export class MicrophoneAcquisitionTimeoutError extends Error {
  constructor() {
    super('Microphone access timed out.')
    this.name = 'MicrophoneAcquisitionTimeoutError'
  }
}

/** Stops every track without letting one browser-specific stop failure hide the rest. */
export function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // The browser may already have ended this track during teardown.
    }
  }
}

/**
 * Bounds a browser permission request that may otherwise remain pending forever.
 * A stream that resolves after the timeout is immediately released so a retry
 * cannot leave two microphone streams active.
 */
export async function acquireMicrophone(
  request: () => Promise<MediaStream>,
  timeoutMs = MICROPHONE_ACQUISITION_TIMEOUT_MS,
): Promise<MediaStream> {
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const acquisition = request().then((stream) => {
    if (timedOut) {
      stopMediaStream(stream)
      throw new MicrophoneAcquisitionTimeoutError()
    }
    return stream
  })
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      reject(new MicrophoneAcquisitionTimeoutError())
    }, timeoutMs)
  })

  try {
    return await Promise.race([acquisition, timeout])
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId)
  }
}
