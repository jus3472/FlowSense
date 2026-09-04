import { describe, expect, it } from 'vitest'
import { isResolvedMediaSupport, serverMediaSupportSnapshot } from '@/lib/recording/support'

describe('recording support hydration', () => {
  it('does not treat the optimistic server snapshot as a usable recording format', () => {
    expect(isResolvedMediaSupport(serverMediaSupportSnapshot())).toBe(false)
  })

  it('treats browser-supported and browser-unsupported results as resolved', () => {
    expect(isResolvedMediaSupport({ ok: true, mimeType: 'audio/webm;codecs=opus' })).toBe(true)
    expect(isResolvedMediaSupport({ ok: false, reason: 'no-format' })).toBe(true)
  })
})
