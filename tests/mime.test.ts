import { describe, expect, it } from 'vitest'
import {
  extensionForMimeType,
  isRecordingMimeType,
  selectRecordingMimeType,
} from '@/lib/recording/mime'

const supporting =
  (...supported: string[]) =>
  (type: string) =>
    supported.includes(type)

describe('selectRecordingMimeType', () => {
  it('prefers opus in webm when the browser offers it', () => {
    expect(selectRecordingMimeType(supporting('audio/webm;codecs=opus', 'audio/webm'))).toBe(
      'audio/webm;codecs=opus',
    )
  })

  it('falls back to plain webm when the codec string is not recognised', () => {
    expect(selectRecordingMimeType(supporting('audio/webm'))).toBe('audio/webm')
  })

  it('picks mp4 on Safari, which supports no webm at all', () => {
    expect(selectRecordingMimeType(supporting('audio/mp4'))).toBe('audio/mp4')
  })

  it('prefers the explicit mp4 codec over the bare container', () => {
    expect(selectRecordingMimeType(supporting('audio/mp4;codecs=mp4a.40.2', 'audio/mp4'))).toBe(
      'audio/mp4;codecs=mp4a.40.2',
    )
  })

  it('accepts ogg when it is the only option', () => {
    expect(selectRecordingMimeType(supporting('audio/ogg;codecs=opus'))).toBe(
      'audio/ogg;codecs=opus',
    )
  })

  it('returns null when the browser supports nothing usable', () => {
    expect(selectRecordingMimeType(supporting())).toBeNull()
    expect(selectRecordingMimeType(supporting('video/webm', 'audio/aac'))).toBeNull()
  })
})

describe('extensionForMimeType', () => {
  it('maps each container to its file extension', () => {
    expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm')
    expect(extensionForMimeType('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(extensionForMimeType('audio/ogg;codecs=opus')).toBe('ogg')
    expect(extensionForMimeType('audio/wav')).toBe('wav')
  })

  it('ignores case and spacing around the codec parameter', () => {
    expect(extensionForMimeType('AUDIO/MP4; codecs=mp4a.40.2')).toBe('m4a')
  })

  it('defaults to webm for anything unrecognised', () => {
    expect(extensionForMimeType('application/octet-stream')).toBe('webm')
  })
})

describe('isRecordingMimeType', () => {
  it('accepts every format the recorder can select', () => {
    expect(isRecordingMimeType('audio/webm;codecs=opus')).toBe(true)
    expect(isRecordingMimeType('audio/webm')).toBe(true)
    expect(isRecordingMimeType('audio/mp4;codecs=mp4a.40.2')).toBe(true)
    expect(isRecordingMimeType('audio/mp4')).toBe(true)
    expect(isRecordingMimeType('audio/ogg;codecs=opus')).toBe(true)
  })

  it('rejects formats outside the recording allowlist', () => {
    expect(isRecordingMimeType('audio/wav')).toBe(false)
    expect(isRecordingMimeType('audio/webm; codecs=opus')).toBe(false)
  })
})
