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

function azureWord(
  word: string,
  startMs: number,
  endMs: number,
  errorType: 'None' | 'Insertion' | 'Omission' | 'Unknown' | 'Mispronunciation' = 'None',
  accuracyScore = 90,
) {
  return {
    Word: word,
    ...(errorType === 'Omission'
      ? {}
      : { Offset: startMs * 10_000, Duration: (endMs - startMs) * 10_000 }),
    PronunciationAssessment: { AccuracyScore: accuracyScore, ErrorType: errorType },
    Phonemes: [{ Phoneme: 'x', PronunciationAssessment: { AccuracyScore: 80 } }],
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
    expect(validateAzureEndpoint('https://-eastus.cognitiveservices.azure.com')).toBeNull()
    expect(validateAzureEndpoint('https://eastus-.cognitiveservices.azure.com')).toBeNull()
    expect(validateAzureEndpoint('https://east.us.cognitiveservices.azure.com')).toBeNull()
    expect(validateAzureEndpoint('https://a.cognitiveservices.azure.com')).toBeNull()
    expect(validateAzureEndpoint('https://user@eastus.cognitiveservices.azure.com')).toBeNull()
    expect(validateAzureEndpoint('https://eastus.cognitiveservices.azure.com:8443')).toBeNull()
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
    const assessment = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    expect(assessment).toMatchObject({
      ReferenceText: request.referenceText,
      Granularity: 'Phoneme',
      Dimension: 'Basic',
    })
    expect(assessment).not.toHaveProperty('EnableProsodyAssessment')
    expect(assessment).not.toHaveProperty('ContentAssessment')
    expect(assessment).not.toHaveProperty('NativeSimilarity')
    expect(assessment).not.toHaveProperty('Dialect')
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
    expect(parsed.value.words[0]?.phonemes[0]?.recognized).toBeNull()
    expect(parsed.value.eligibleForDeductions).toBe(false)
    expect(parsed.value.provider.id).toBe('azure-speech')
    expect(parsed.value).not.toHaveProperty('PronScore')
    expect(parsed.value).not.toHaveProperty('FluencyScore')
    expect(parsed.value).not.toHaveProperty('CompletenessScore')
    expect(parsed.value).not.toHaveProperty('ProsodyScore')
    expect(parsed.value).not.toHaveProperty('ContentAssessment')
  })

  it('aligns an insertion in the middle without shifting later words', () => {
    const parsed = mapAzurePronunciationResponse(
      {
        NBest: [
          {
            Words: [
              azureWord('FlowSense', 100, 600),
              azureWord('actually', 620, 690, 'Insertion'),
              azureWord('helps', 700, 1_100),
              azureWord('speakers', 1_200, 1_800),
            ],
          },
        ],
      },
      request,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(
      parsed.value.words.map((word) => [
        word.lexicalOutcome,
        word.referenceWord,
        word.recognizedWord,
      ]),
    ).toEqual([
      ['match', 'FlowSense', 'FlowSense'],
      ['insertion', null, 'actually'],
      ['match', 'helps', 'helps'],
      ['match', 'speakers', 'speakers'],
    ])
  })

  it('aligns an explicit durationless omission in the middle', () => {
    const parsed = mapAzurePronunciationResponse(
      {
        NBest: [
          {
            Words: [
              azureWord('FlowSense', 100, 600),
              azureWord('helps', 0, 0, 'Omission'),
              azureWord('speakers', 1_200, 1_800),
            ],
          },
        ],
      },
      request,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.words.map((word) => word.lexicalOutcome)).toEqual([
      'match',
      'omission',
      'match',
    ])
    expect(parsed.value.words[1]).toMatchObject({
      referenceWord: 'helps',
      recognizedWord: null,
      startMs: null,
      endMs: null,
    })
  })

  it('separates a true substitution from same-word low sound accuracy', () => {
    const substitution = mapAzurePronunciationResponse(
      {
        NBest: [
          {
            Words: [
              azureWord('FlowSense', 100, 600),
              azureWord('aids', 700, 1_100),
              azureWord('speakers', 1_200, 1_800),
            ],
          },
        ],
      },
      request,
    )
    const sameWord = mapAzurePronunciationResponse(
      {
        NBest: [
          {
            Words: [
              azureWord('FlowSense', 100, 600),
              azureWord('helps', 700, 1_100, 'Mispronunciation', 5),
              azureWord('speakers', 1_200, 1_800),
            ],
          },
        ],
      },
      request,
    )
    expect(substitution.ok).toBe(true)
    expect(sameWord.ok).toBe(true)
    if (!substitution.ok || !sameWord.ok) return
    expect(substitution.value.words[1]).toMatchObject({
      lexicalOutcome: 'substitution',
      pronunciationAccuracy: null,
    })
    expect(sameWord.value.words[1]).toMatchObject({
      lexicalOutcome: 'match',
      pronunciationAccuracy: 0.05,
    })
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
    const nonmonotonic = azureResponse()
    const second = nonmonotonic.NBest[0]?.Words[1]
    if (!second) throw new Error('Fixture word was missing.')
    second.Offset = 200 * 10_000
    expect(mapAzurePronunciationResponse(nonmonotonic, request).ok).toBe(false)
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

  it.each([
    ['empty reference', { ...request, referenceText: '   ' }, new ArrayBuffer(2)],
    ['locale mismatch', { ...request, locale: 'en-GB' }, new ArrayBuffer(2)],
    [
      'provider mismatch',
      { ...request, provider: { ...request.provider, id: 'other' } },
      new ArrayBuffer(2),
    ],
    ['empty audio', request, new ArrayBuffer(0)],
  ])('does not call transport for an invalid %s request', async (_label, candidate, audio) => {
    let calls = 0
    const result = await assessAzurePronunciation(
      {
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'private-key',
        locale: 'en-US',
      },
      candidate,
      audio,
      {
        fetch: async () => {
          calls += 1
          return new Response('{}')
        },
      },
    )
    expect(result.status).toBe('not_checked')
    expect(calls).toBe(0)
  })

  it('does not call transport for an unsupported configured locale', async () => {
    let calls = 0
    const result = await assessAzurePronunciation(
      {
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'private-key',
        locale: 'fr-FR',
      },
      { ...request, locale: 'fr-FR' },
      new ArrayBuffer(2),
      {
        fetch: async () => {
          calls += 1
          return new Response('{}')
        },
      },
    )
    expect(result.status).toBe('not_checked')
    expect(calls).toBe(0)
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

  it('does not reflect sensitive provider error text', async () => {
    const result = await assessAzurePronunciation(
      {
        endpoint: 'https://eastus.cognitiveservices.azure.com',
        key: 'private-key',
        locale: 'en-US',
      },
      request,
      new ArrayBuffer(2),
      {
        fetch: async () => {
          throw new Error(
            'private-key FlowSense helps speakers raw-audio https://eastus.cognitiveservices.azure.com',
          )
        },
      },
    )
    expect(JSON.stringify(result)).not.toContain('private-key')
    expect(JSON.stringify(result)).not.toContain(request.referenceText)
    expect(JSON.stringify(result)).not.toContain('raw-audio')
    expect(JSON.stringify(result)).not.toContain('cognitiveservices.azure.com')
  })
})
