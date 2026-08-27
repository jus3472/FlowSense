import { SAMPLE_INTERVAL_MS } from '@/lib/recording/audio-sampler'
import type { AttemptRecording } from '@/lib/recording/recorder'

export const MIN_PROCESSABLE_RECORDING_MS = 750

export type CaptureRejectionReason = 'too_short' | 'empty_audio' | 'no_speech'

export type CaptureReadiness =
  { ok: true } | { ok: false; reason: CaptureRejectionReason; message: string }

const TOO_SHORT_MESSAGE = 'That recording was too short to process. Start again and speak first.'
const EMPTY_AUDIO_MESSAGE = 'No usable audio was captured. Check your microphone and start again.'
const NO_SPEECH_MESSAGE = 'No speech was detected. Check your microphone and start again.'
const DIGITAL_SILENCE_RMS_EPSILON = 1e-8

function hasValidVoicedFrame(recording: AttemptRecording): boolean {
  return recording.pitch.some(
    ({ t_ms: tMs, hz }) =>
      Number.isFinite(tMs) &&
      tMs >= 0 &&
      tMs <= recording.durationMs &&
      Number.isFinite(hz) &&
      hz > 0,
  )
}

/**
 * Silence is actionable only when the local timeline is dense enough to cover
 * the recording. Sparse or throttled sampling is inconclusive and must not
 * discard an otherwise usable audio blob.
 */
function hasConclusiveSilentTimeline(recording: AttemptRecording): boolean {
  const samples = recording.amplitude
  const expectedSamples = Math.max(1, Math.floor(recording.durationMs / SAMPLE_INTERVAL_MS))
  if (samples.length < Math.max(4, Math.floor(expectedSamples * 0.6))) return false

  let previousTimestamp = -1
  let digitallySilent = true
  for (const { t_ms: tMs, rms } of samples) {
    if (
      !Number.isFinite(tMs) ||
      tMs < 0 ||
      tMs > recording.durationMs ||
      tMs < previousTimestamp ||
      !Number.isFinite(rms) ||
      rms < -DIGITAL_SILENCE_RMS_EPSILON
    ) {
      return false
    }
    previousTimestamp = tMs
    if (rms > DIGITAL_SILENCE_RMS_EPSILON) digitallySilent = false
  }

  const firstTimestamp = samples[0]?.t_ms ?? Number.POSITIVE_INFINITY
  const lastTimestamp = samples.at(-1)?.t_ms ?? Number.NEGATIVE_INFINITY
  const edgeToleranceMs = SAMPLE_INTERVAL_MS * 3
  if (firstTimestamp > edgeToleranceMs || lastTimestamp < recording.durationMs - edgeToleranceMs) {
    return false
  }

  // Nonzero audio is inconclusive. Pitch detection can miss whispered or
  // unvoiced speech, and browser AGC can flatten a real response's RMS.
  return digitallySilent
}

/**
 * A local preflight only. It blocks provably empty or immediate captures before
 * any attempt row, upload, or provider request exists. Inconclusive evidence is
 * allowed through for downstream provider and scoring quality handling.
 */
export function assessCaptureReadiness(recording: AttemptRecording): CaptureReadiness {
  if (
    !Number.isFinite(recording.durationMs) ||
    recording.durationMs < MIN_PROCESSABLE_RECORDING_MS
  ) {
    return { ok: false, reason: 'too_short', message: TOO_SHORT_MESSAGE }
  }
  if (recording.blob.size === 0) {
    return { ok: false, reason: 'empty_audio', message: EMPTY_AUDIO_MESSAGE }
  }
  if (!hasValidVoicedFrame(recording) && hasConclusiveSilentTimeline(recording)) {
    return { ok: false, reason: 'no_speech', message: NO_SPEECH_MESSAGE }
  }
  return { ok: true }
}
