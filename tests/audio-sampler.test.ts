import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_INTERVAL_MS, createAudioSampler } from '@/lib/recording/audio-sampler'

class FakeSource {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeAnalyser {
  fftSize = 8
  smoothingTimeConstant = 0
  disconnect = vi.fn()

  getFloatTimeDomainData(frame: Float32Array) {
    frame.fill(0.1)
  }
}

class FakeAudioContext {
  sampleRate = 48_000
  source = new FakeSource()
  analyser = new FakeAnalyser()
  close = vi.fn(async () => undefined)
  createMediaStreamSource = vi.fn(() => this.source)
  createAnalyser = vi.fn(() => this.analyser)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createAudioSampler', () => {
  it('starts one loop and closes every audio resource exactly once', async () => {
    vi.useFakeTimers()
    const context = new FakeAudioContext()
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => context),
    )
    const sampler = createAudioSampler({} as MediaStream)

    sampler.start()
    sampler.start()
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2)
    const countBeforeClose = sampler.snapshot().amplitude.length
    expect(countBeforeClose).toBe(2)

    sampler.close()
    sampler.close()
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2)

    expect(sampler.snapshot().amplitude).toHaveLength(countBeforeClose)
    expect(sampler.level()).toBe(0)
    expect(context.source.disconnect).toHaveBeenCalledTimes(1)
    expect(context.analyser.disconnect).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
  })

  it('closes the AudioContext when graph construction fails', () => {
    const context = new FakeAudioContext()
    context.source.connect.mockImplementation(() => {
      throw new Error('graph failed')
    })
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => context),
    )

    expect(() => createAudioSampler({} as MediaStream)).toThrow('graph failed')
    expect(context.close).toHaveBeenCalledTimes(1)
  })
})
