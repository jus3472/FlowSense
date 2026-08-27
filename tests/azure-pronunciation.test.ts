import { describe, expect, it } from 'vitest'
import {
  assessAzurePronunciation,
  buildAzureRequest,
  isAzureAudioSupported,
  validateAzureEndpoint,
  validateAzureSpeechConfig,
} from '@/lib/pronunciation/azure'
import { mapAzurePronunciationResponse } from '@/lib/pronunciation/azure-mapper'
import type { PronunciationAssessmentRequest } from '@/lib/pronunciation/contracts'

const request: PronunciationAssessmentRequest = {
  contractVersion: 'v1',
  provider: { id: 'azure-speech', model: 'short-audio', version: 'rest-v1' },
  locale: 'en-US',
  scenario: 'scripted',
  audio: { contentType: 'audio/wav; codecs=audio/pcm; samplerate=16000', durationMs: 3_000 },
  referenceText: 'FlowSense helps speakers',
  recognizedWords: [
    { word: 'FlowSense', startMs: 100, endMs: 600 },
    { word: 'helps', startMs: 700, endMs: 1_100 },
    { word: 'speakers', startMs: 1_200, endMs: 1_800 },
  ],
}

function azureResponse(words = request.recognizedWords) {
  return {
    NBest: [
      {
        PronunciationAssessment: {
          PronScore: 71,
          FluencyScore: 12,
          CompletenessScore: 99,
          ProsodyScore: 20,
          ContentAssessment: { Topic: 0 },
        },
        Words: words.map((word, index) => ({
          Word: word.word,
          Offset: (word.startMs ?? 0) * 10_000,
          Duration: ((word.endMs ?? 0) - (word.startMs ?? 0)) * 10_000,
          PronunciationAssessment: { AccuracyScore: 90 - index * 5, ErrorType: 'None' },
          Phonemes: [
            {
              Phoneme: 'x',
              PronunciationAssessment: { AccuracyScore: 80 },
            },
          ],
        })),
      },
    ],
  }
}

describe('Azure pronunciation adapter', () => {
  it('gates documented MIME types and the 30 second limit', () => {
    expect(isAzureAudioSupported('audio/wav; codecs=audio/pcm; samplerate=16000', 30_000)).toBe(
      true,
    )
    expect(isAzureAudioSupported('audio/ogg; codecs=opus', 1_000)).toBe(true)
    expect(isAzureAudioSupported('audio/webm', 1_000)).toBe(false)
    expect(isAzureAudioSupported('audio/wav; codecs=audio/pcm; samplerate=16000', 30_001)).toBe(
      false,
    )
  })

  it('rejects SSRF-shaped endpoints and incomplete configuration', () => {
    expect(validateAzureEndpoint('http://eastus.cognitiveservices.azure.com')).toBeNull()
    expect(validateAzureEndpoint('https://example.test')).toBeNull()
    expect(validateAzureEndpoint('https://eastus.cognitiveservices.azure.com/path')).toBeNull()
    expect(
      validateAzureSpeechConfig({
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: '',
        locale: 'en-US',
      }),
    ).toBeNull()
    expect(
      validateAzureSpeechConfig({
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'secret',
        locale: 'en-US',
      }),
    ).toEqual({
      endpoint: 'https://eastus.cognitiveservices.azure.com',
      key: 'secret',
      locale: 'en-US',
    })
    expect(
      validateAzureSpeechConfig({
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'secret',
        locale: 'xx',
      }),
    ).toBeNull()
  })

  it('builds the REST request without putting credentials in the URL or body', () => {
    const built = buildAzureRequest(
      {
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'private-key',
        locale: 'en-US',
      },
      request,
      new ArrayBuffer(4),
    )
    expect(built.url).toContain('/stt/speech/recognition/conversation/cognitiveservices/v1')
    expect(built.url).toContain('language=en-US')
    expect(built.url).not.toContain('private-key')
    expect(built.init.headers).toMatchObject({
      'Content-Type': request.audio.contentType,
      'Ocp-Apim-Subscription-Key': 'private-key',
    })
    const header = (built.init.headers as Record<string, string>)['Pronunciation-Assessment']
    expect(header).toBeTypeOf('string')
    if (!header) return
    expect(JSON.parse(Buffer.from(header, 'base64').toString('utf8'))).toMatchObject({
      ReferenceText: request.referenceText,
      Granularity: 'Phoneme',
    })
  })

  it('maps Azure ticks to bounded word evidence and excludes aggregate fields', () => {
    const parsed = mapAzurePronunciationResponse(azureResponse(), request)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.words[0]).toMatchObject({
      referenceWord: 'FlowSense',
      recognizedWord: 'FlowSense',
      startMs: 100,
      endMs: 600,
      pronunciationAccuracy: 0.9,
    })
    expect(parsed.value.words[0]?.phonemes[0]).toMatchObject({ accuracy: 0.8 })
    expect(parsed.value.eligibleForDeductions).toBe(false)
    expect(parsed.value.provider.id).toBe('azure-speech')
    expect(parsed.value).not.toHaveProperty('PronScore')
    expect(parsed.value).not.toHaveProperty('FluencyScore')
    expect(parsed.value).not.toHaveProperty('CompletenessScore')
    expect(parsed.value).not.toHaveProperty('ProsodyScore')
    expect(parsed.value).not.toHaveProperty('ContentAssessment')
  })

  it('fails closed for malformed, contradictory, and out-of-range provider output', () => {
    expect(mapAzurePronunciationResponse({ NBest: [] }, request).ok).toBe(false)
    expect(
      mapAzurePronunciationResponse(
        {
          NBest: azureResponse().NBest.map((entry) => ({
            ...entry,
            Words: [{ ...entry.Words[0], Offset: 9_000_000_000 }],
          })),
        },
        request,
      ).ok,
    ).toBe(false)
    expect(
      mapAzurePronunciationResponse(
        {
          NBest: azureResponse().NBest.map((entry) => ({
            ...entry,
            Words: [{ ...entry.Words[0], Duration: -1 }],
          })),
        },
        request,
      ).ok,
    ).toBe(false)
    const malformedAccuracy = azureResponse()
    const malformedWord = malformedAccuracy.NBest[0]?.Words[0]
    if (!malformedWord) throw new Error('Fixture word was missing.')
    malformedWord.PronunciationAssessment = { AccuracyScore: 120, ErrorType: 'None' }
    expect(mapAzurePronunciationResponse(malformedAccuracy, request).ok).toBe(false)
  })

  it('keeps provider-unsupported words explicit without inventing accuracy', () => {
    const response = azureResponse()
    const first = response.NBest[0]?.Words[0]
    if (!first) throw new Error('Fixture word was missing.')
    first.PronunciationAssessment = { ErrorType: 'Unknown', AccuracyScore: 99 }
    const parsed = mapAzurePronunciationResponse(response, request)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.words[0]).toMatchObject({
      lexicalOutcome: 'unsupported',
      pronunciationAccuracy: null,
      pronunciationAvailability: 'unsupported',
    })
    expect(parsed.value.unsupportedWords).toEqual(['FlowSense'])
  })

  it('returns explicit not_checked for unsupported audio before transport', async () => {
    let called = false
    const result = await assessAzurePronunciation(
      {
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'private-key',
        locale: 'en-US',
      },
      { ...request, audio: { contentType: 'audio/webm', durationMs: 1_000 } },
      new ArrayBuffer(2),
      {
        fetch: async () => {
          called = true
          return new Response('{}')
        },
      },
    )
    expect(result.status).toBe('not_checked')
    expect(result.error).toBeNull()
    expect(called).toBe(false)
  })

  it('handles non-2xx, malformed JSON, and successful mocked calls', async () => {
    const config = {
      endpoint: 'https://eastus.cognitiveservices.azure.com',
      key: 'private-key',
      locale: 'en-US',
    }
    const failed = await assessAzurePronunciation(config, request, new ArrayBuffer(2), {
      fetch: async () => new Response('', { status: 503 }),
    })
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'outage' } })

    const malformed = await assessAzurePronunciation(config, request, new ArrayBuffer(2), {
      fetch: async () => new Response('not-json', { status: 200 }),
    })
    expect(malformed).toMatchObject({ status: 'failed', error: { code: 'malformed_response' } })

    const success = await assessAzurePronunciation(config, request, new ArrayBuffer(2), {
      fetch: async () => new Response(JSON.stringify(azureResponse())),
    })
    expect(success).toMatchObject({ status: 'completed', eligibleForDeductions: false })
  })

  it('fails closed on a transport timeout', async () => {
    const result = await assessAzurePronunciation(
      {
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'private-key',
        locale: 'en-US',
      },
      request,
      new ArrayBuffer(2),
      {
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      },
      1,
    )
    expect(result).toMatchObject({ status: 'failed', error: { code: 'timeout' } })
  })
})
