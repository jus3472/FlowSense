import { isRecordingMimeType } from '@/lib/recording/mime'
import { MAX_RECORDING_MS } from '@/lib/recording/recorder'
import {
  parsePracticeSessionDescriptor,
  isUuid,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'

/**
 * Prompts are short, single questions. This leaves ample room for future
 * prompts while bounding text rendered in history and sent to content checks.
 */
export const MAX_ATTEMPT_PROMPT_TEXT_LENGTH = 1_000

export interface CreateAttemptPayload extends PracticeSessionDescriptor {
  clientRequestId: string
  mimeType: string
  durationMs: number
}

export type CreateAttemptPayloadResult =
  { ok: true; value: CreateAttemptPayload } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validates the browser payload before an attempt row or storage path is created. */
export function parseCreateAttemptPayload(value: unknown): CreateAttemptPayloadResult {
  if (!isRecord(value)) return { ok: false, error: 'The request body was malformed.' }

  const promptText = typeof value.promptText === 'string' ? value.promptText.trim() : ''
  const session = parsePracticeSessionDescriptor(value)
  const clientRequestId = isUuid(value.clientRequestId) ? value.clientRequestId : null
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : ''
  const durationMs =
    typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
      ? Math.round(value.durationMs)
      : null

  if (promptText.length === 0) return { ok: false, error: 'The prompt text was missing.' }
  if (!session) return { ok: false, error: 'The practice session was invalid.' }
  if (!clientRequestId) return { ok: false, error: 'The recording request id was invalid.' }
  if (session.promptText.length > MAX_ATTEMPT_PROMPT_TEXT_LENGTH) {
    return { ok: false, error: 'Your prompt is too long.' }
  }
  if (mimeType.length === 0) return { ok: false, error: 'The recording format was missing.' }
  if (!isRecordingMimeType(mimeType)) {
    return { ok: false, error: 'The recording format was not supported.' }
  }
  if (durationMs === null || durationMs <= 0) {
    return { ok: false, error: 'The recording length was missing.' }
  }
  if (durationMs > MAX_RECORDING_MS * 2) {
    return { ok: false, error: 'That recording is longer than FlowSense accepts.' }
  }
  return { ok: true, value: { ...session, clientRequestId, mimeType, durationMs } }
}
