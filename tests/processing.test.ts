import { describe, expect, it, vi } from 'vitest'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'
import { isTerminal, runProcessingPipeline, type ProcessingState } from '@/lib/recording/processing'

function record() {
  const states: ProcessingState[] = []
  return { states, onState: (state: ProcessingState) => states.push(state) }
}

const noop = async () => {}

describe('runProcessingPipeline', () => {
  it('walks uploading then transcribing then done', async () => {
    const { states, onState } = record()
    const final = await runProcessingPipeline({ upload: noop, transcribe: noop }, onState)

    expect(states.map((state) => state.stage)).toEqual(['uploading', 'transcribing', 'done'])
    expect(final.stage).toBe('done')
    expect(final.message).toBeNull()
  })

  it('does not start transcribing when the upload fails', async () => {
    const transcribe = vi.fn(noop)
    const final = await runProcessingPipeline(
      {
        upload: async () => {
          throw new Error('The recording could not be saved.')
        },
        transcribe,
      },
      () => {},
    )

    expect(transcribe).not.toHaveBeenCalled()
    expect(final.stage).toBe('failed')
    expect(final.failedStage).toBe('uploading')
    expect(final.message).toBe('The recording could not be saved.')
  })

  it('names the transcribing stage when that is what broke', async () => {
    const final = await runProcessingPipeline(
      {
        upload: noop,
        transcribe: async () => {
          throw new Error('Deepgram rejected the audio: corrupt container')
        },
      },
      () => {},
    )

    expect(final.stage).toBe('failed')
    expect(final.failedStage).toBe('transcribing')
    expect(final.message).toContain('corrupt container')
  })

  it('separates a timeout from a plain failure', async () => {
    const final = await runProcessingPipeline(
      {
        upload: noop,
        transcribe: async () => {
          throw new RequestTimeoutError('Transcribing your answer', 30_000)
        },
      },
      () => {},
    )

    expect(final.stage).toBe('timed_out')
    expect(final.failedStage).toBe('transcribing')
    expect(final.message).toContain('30 seconds')
  })

  /**
   * The property that matters: a previous version left people on a spinner
   * because a promise neither resolved nor rejected. Whatever a step throws,
   * the pipeline has to come to rest somewhere terminal.
   */
  it.each([
    ['an Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['an object', { code: 500 }],
  ])('reaches a terminal state when a step throws %s', async (_label, thrown) => {
    for (const failing of ['upload', 'transcribe'] as const) {
      const steps = {
        upload: noop,
        transcribe: noop,
        [failing]: async () => {
          throw thrown
        },
      }
      const final = await runProcessingPipeline(steps, () => {})
      expect(isTerminal(final.stage)).toBe(true)
      expect(final.message).toBeTruthy()
    }
  })

  it('always emits a terminal state as its last update', async () => {
    const { states, onState } = record()
    await runProcessingPipeline(
      {
        upload: noop,
        transcribe: async () => {
          throw new Error('nope')
        },
      },
      onState,
    )
    const last = states.at(-1)
    expect(last).toBeDefined()
    expect(isTerminal(last?.stage ?? 'uploading')).toBe(true)
  })
})

describe('isTerminal', () => {
  it('treats only done, failed, and timed_out as terminal', () => {
    expect(isTerminal('uploading')).toBe(false)
    expect(isTerminal('transcribing')).toBe(false)
    expect(isTerminal('done')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('timed_out')).toBe(true)
  })
})
