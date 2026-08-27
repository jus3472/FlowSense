import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PronunciationEvaluation } from '@/lib/pronunciation/contracts'
import { collectPronunciationEvidence } from '@/lib/pronunciation/orchestrate'
import type { PronunciationProvider } from '@/lib/pronunciation/provider'
import type { CaptureMetrics } from '@/lib/types/metrics'

const config = {
  endpoint: 'https://eastus.cognitiveservices.azure.com',
  key: 'private-key',
  locale: 'en-US',
}

const capture: CaptureMetrics = {
  mime_type: 'audio/wav; codecs=audio/pcm; samplerate=16000',
  started_at: '2026-08-26T12:00:00.000Z',
  duration_ms: 3_000,
  sample_interval_ms: 50,
  amplitude: [],
  pitch: [],
}

const normalized: PronunciationEvaluation = {
  contractVersion: 'v1',
  provider: { id: 'azure-speech', model: 'short-audio', version: 'rest-v1', locale: 'en-US' },
  status: 'not_checked',
  words: [],
  unsupportedWords: [],
  warnings: ['No evidence was returned.'],
  error: null,
  eligibleForDeductions: false,
}

function input(overrides: Partial<Parameters<typeof collectPronunciationEvidence>[0]> = {}) {
  let providerCalls = 0
  let downloadCalls = 0
  const provider: PronunciationProvider = {
    id: 'azure-speech',
    assess: async () => {
      providerCalls += 1
      return normalized
    },
  }
  return {
    value: {
      config,
      provider,
      audioPath: 'user/attempt.wav',
      capture,
      transcript: 'one two',
      transcriptWords: [
        { word: 'one', start: 0.1, end: 0.4 },
        { word: 'two', start: 0.5, end: 0.8 },
      ],
      download: async () => {
        downloadCalls += 1
        return { data: new Blob(['audio']), error: null }
      },
      ...overrides,
    },
    calls: () => ({ provider: providerCalls, download: downloadCalls }),
  }
}

describe('pronunciation score orchestration', () => {
  it.each([
    ['WebM', { mime_type: 'audio/webm' }],
    ['MP4', { mime_type: 'audio/mp4' }],
    ['over 30 seconds', { duration_ms: 30_001 }],
  ])('does not download or call the provider for unsupported %s audio', async (_label, change) => {
    const scenario = input({ capture: { ...capture, ...change } })
    const result = await collectPronunciationEvidence(scenario.value)
    expect(result?.status).toBe('not_checked')
    expect(scenario.calls()).toEqual({ provider: 0, download: 0 })
  })

  it('downloads supported private audio and calls the provider exactly once', async () => {
    const scenario = input()
    const result = await collectPronunciationEvidence(scenario.value)
    expect(result).toEqual(normalized)
    expect(scenario.calls()).toEqual({ provider: 1, download: 1 })
  })

  it('accepts the recorder-style OGG MIME before private download', async () => {
    const scenario = input({ capture: { ...capture, mime_type: 'audio/ogg;codecs=opus' } })
    expect(await collectPronunciationEvidence(scenario.value)).toEqual(normalized)
    expect(scenario.calls()).toEqual({ provider: 1, download: 1 })
  })

  it('does nothing when configuration is missing', async () => {
    const scenario = input({ config: null })
    expect(await collectPronunciationEvidence(scenario.value)).toBeNull()
    expect(scenario.calls()).toEqual({ provider: 0, download: 0 })
  })

  it('does not download for incomplete or invalid configuration', async () => {
    const scenario = input({ config: { ...config, endpoint: 'http://example.test' } })
    expect(await collectPronunciationEvidence(scenario.value)).toBeNull()
    expect(scenario.calls()).toEqual({ provider: 0, download: 0 })
  })

  it('fails safely when download returns an error or throws', async () => {
    const returned = input({ download: async () => ({ data: null, error: new Error('storage') }) })
    const thrown = input({ download: async () => Promise.reject(new Error('storage')) })
    expect(await collectPronunciationEvidence(returned.value)).toBeNull()
    expect(await collectPronunciationEvidence(thrown.value)).toBeNull()
    expect(returned.calls().provider).toBe(0)
    expect(thrown.calls().provider).toBe(0)
  })

  it('fails safely when private audio conversion fails', async () => {
    class BrokenBlob extends Blob {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error('conversion')
      }
    }
    const scenario = input({ download: async () => ({ data: new BrokenBlob(), error: null }) })
    expect(await collectPronunciationEvidence(scenario.value)).toBeNull()
    expect(scenario.calls().provider).toBe(0)
  })

  it('rejects malformed provider output before persistence', async () => {
    const malformed: PronunciationEvaluation = { ...normalized, status: 'failed', error: null }
    const scenario = input({
      provider: { id: 'azure-speech', assess: async () => malformed },
    })
    expect(await collectPronunciationEvidence(scenario.value)).toBeNull()
  })

  it('keeps the attempt query user-scoped and persists the normalized snapshot', () => {
    const route = readFileSync('src/app/api/score/route.ts', 'utf8')
    expect(route).toContain(".eq('user_id', userId)")
    expect(route).toContain('authenticatedAttemptContext()')
    expect(route).toContain('...(pronunciation ? { pronunciation } : {})')
    expect(route).toContain('Promise.all([pronunciationPromise, contentPromise])')
  })
})
