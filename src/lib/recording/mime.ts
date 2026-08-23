/**
 * Ordered by preference. Opus in WebM is what Chrome, Edge, and Firefox give us
 * and what Deepgram handles best. Safari only produces MP4/AAC.
 */
export const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const

export type IsTypeSupported = (mimeType: string) => boolean

/** The first candidate the browser will actually record, or null if none. */
export function selectRecordingMimeType(isTypeSupported: IsTypeSupported): string | null {
  for (const candidate of RECORDING_MIME_CANDIDATES) {
    if (isTypeSupported(candidate)) return candidate
  }
  return null
}

/** File extension for the storage object. The container, not the codec. */
export function extensionForMimeType(mimeType: string): string {
  const container = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (container === 'audio/mp4') return 'm4a'
  if (container === 'audio/ogg') return 'ogg'
  if (container === 'audio/wav' || container === 'audio/wave') return 'wav'
  return 'webm'
}
