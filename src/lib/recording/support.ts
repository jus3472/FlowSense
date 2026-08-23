import { selectRecordingMimeType } from '@/lib/recording/mime'

export type UnsupportedReason = 'no-capture' | 'no-recorder' | 'no-format'

export type MediaSupport = { ok: true; mimeType: string } | { ok: false; reason: UnsupportedReason }

/**
 * Checked before the record flow renders anything, so an unsupported browser
 * gets a named explanation instead of a button that quietly does nothing.
 */
export function detectMediaSupport(): MediaSupport {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'no-capture' }
  }
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return { ok: false, reason: 'no-recorder' }
  }

  const mimeType = selectRecordingMimeType((type) => MediaRecorder.isTypeSupported(type))
  if (!mimeType) return { ok: false, reason: 'no-format' }

  return { ok: true, mimeType }
}

/**
 * Browser capabilities do not change during a visit, so the answer is computed
 * once and handed back by reference. useSyncExternalStore compares snapshots
 * with Object.is and would loop forever on a fresh object each call.
 */
let cachedSupport: MediaSupport | null = null

const SERVER_SUPPORT: MediaSupport = { ok: true, mimeType: '' }

export function mediaSupportSnapshot(): MediaSupport {
  cachedSupport ??= detectMediaSupport()
  return cachedSupport
}

/** The server cannot know, so it renders the ready screen and hydration corrects it. */
export function serverMediaSupportSnapshot(): MediaSupport {
  return SERVER_SUPPORT
}

export function subscribeToMediaSupport(): () => void {
  return () => {}
}
