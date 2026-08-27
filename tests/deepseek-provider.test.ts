import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
  ContentProviderFailure,
  createDeepSeekModel,
} from '@/lib/deepseek/provider'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'
import { notCheckedContent, scoreContent } from '@/lib/scoring/content'
import { runContentCheck, runContentCheckSafely } from '@/lib/scoring/run-content'
import { contentDetectorFromModel } from '@/lib/scoring/v2/content/adapter'
import { runV2ContentEvaluation } from '@/lib/scoring/v2/content/evaluate'

const FAKE_SECRET = 'fake-provider-secret-should-never-escape'
const FAKE_API_KEY = 'fake-api-key-should-never-escape'
const UNSAFE_RESPONSE_BODY = `<html><body>${FAKE_SECRET}</body></html>{"detail":"private"}`
const REQUEST = {
  system: 'Private system instructions.',
  user: 'Private prompt and transcript.',
  timeoutMs: 1_000,
}

function failedResponse(): Response {
  return new Response(UNSAFE_RESPONSE_BODY, {
    status: 503,
    headers: { 'content-type': 'text/html' },
  })
}

function serialized(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      ...(value instanceof ContentProviderFailure ? { diagnostic: value.diagnostic } : {}),
    })
  }
  return JSON.stringify(value)
}

function watchConsole() {
  return [
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  ]
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DeepSeek provider failure safety', () => {
  it('does not read or expose a non-2xx response body', async () => {
    const response = failedResponse()
    const text = vi.spyOn(response, 'text')
    const json = vi.spyOn(response, 'json')
    if (!response.body) throw new Error('The response fixture requires a body.')
    const cancel = vi.spyOn(response.body, 'cancel')
    const consoleSpies = watchConsole()
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)

    let thrown: unknown
    try {
      await createDeepSeekModel(FAKE_API_KEY).complete(REQUEST)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ContentProviderFailure)
    expect(thrown).toMatchObject({
      message: CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
      diagnostic: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        code: 'http_error',
        status: 503,
      },
    })
    expect(text).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    const thrownOutput = serialized(thrown)
    const loggedOutput = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [FAKE_SECRET, FAKE_API_KEY, REQUEST.system, REQUEST.user]) {
      expect(thrownOutput).not.toContain(privateValue)
      expect(loggedOutput).not.toContain(privateValue)
    }
    expect(consoleSpies[3]).toHaveBeenCalledOnce()
    expect(consoleSpies[3]).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      code: 'http_error',
      status: 503,
    })
    for (const spy of consoleSpies.slice(0, 3)) expect(spy).not.toHaveBeenCalled()
  })

  it('normalizes timeout, transport, and malformed response failures', async () => {
    const consoleSpies = watchConsole()
    const cases = [
      {
        expectedCode: 'timeout',
        expectedStatus: null,
        fetch: vi.fn().mockRejectedValue(new RequestTimeoutError('private label', 1_000)),
      },
      {
        expectedCode: 'transport_error',
        expectedStatus: null,
        fetch: vi.fn().mockRejectedValue(new Error(`${FAKE_SECRET}: network failed`)),
      },
      {
        expectedCode: 'invalid_response',
        expectedStatus: 200,
        fetch: vi.fn().mockResolvedValue(new Response(UNSAFE_RESPONSE_BODY, { status: 200 })),
      },
    ] as const

    for (const testCase of cases) {
      vi.stubGlobal('fetch', testCase.fetch)
      let failure: unknown
      try {
        await createDeepSeekModel('test-key').complete(REQUEST)
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        message: CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
        diagnostic: { code: testCase.expectedCode, status: testCase.expectedStatus },
      })
      expect(serialized(failure)).not.toContain(FAKE_SECRET)
      vi.unstubAllGlobals()
    }

    expect(consoleSpies[3]).toHaveBeenCalledTimes(cases.length)
    expect(serialized(consoleSpies.flatMap((spy) => spy.mock.calls))).not.toContain(FAKE_SECRET)
  })
})

describe('content evaluation failure boundaries', () => {
  it('keeps a non-2xx body out of the legacy persisted outcome', async () => {
    const response = failedResponse()
    const text = vi.spyOn(response, 'text')
    const consoleSpies = watchConsole()
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)

    const outcome = await runContentCheck({
      model: createDeepSeekModel(FAKE_API_KEY),
      request: REQUEST,
      transcript: 'A private response.',
    })

    expect(outcome).toMatchObject({
      parsed: null,
      error: CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
      calls: 1,
      tighten: null,
    })
    expect(scoreContent(outcome.parsed ?? notCheckedContent()).total).toBe(50)
    expect(text).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(consoleSpies[3]).toHaveBeenCalledOnce()
    expect(consoleSpies[3]).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'http_error', status: 503 }),
    )
    const persistedOutput = serialized(outcome)
    const loggedOutput = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [FAKE_SECRET, FAKE_API_KEY, REQUEST.system, REQUEST.user]) {
      expect(persistedOutput).not.toContain(privateValue)
      expect(loggedOutput).not.toContain(privateValue)
    }
  })

  it('keeps a non-2xx body out of v2 not_checked warnings', async () => {
    const response = failedResponse()
    const text = vi.spyOn(response, 'text')
    const consoleSpies = watchConsole()
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)

    const result = await runV2ContentEvaluation({
      provider: contentDetectorFromModel(createDeepSeekModel(FAKE_API_KEY)),
      mode: 'practice',
      prompt: 'Describe a familiar place.',
      transcript: 'A private response.',
    })

    expect(result).toMatchObject({
      status: 'not_checked',
      calls: 1,
      warnings: [CONTENT_PROVIDER_UNAVAILABLE_MESSAGE],
      categories: {
        structure: { status: 'not_checked', component: null },
        grammar: { status: 'not_checked', component: null },
        vocabulary: { status: 'not_checked', component: null },
      },
    })
    expect(text).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(consoleSpies[3]).toHaveBeenCalledOnce()
    expect(consoleSpies[3]).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'http_error', status: 503 }),
    )
    const persistedOutput = serialized(result)
    const loggedOutput = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [FAKE_SECRET, FAKE_API_KEY, REQUEST.system, REQUEST.user]) {
      expect(persistedOutput).not.toContain(privateValue)
      expect(loggedOutput).not.toContain(privateValue)
    }
  })

  it('sanitizes unexpected errors but preserves structural parse diagnostics', async () => {
    const consoleSpies = watchConsole()
    const legacyOutage = await runContentCheck({
      model: {
        name: 'fake',
        complete: async () => Promise.reject(new Error(`${FAKE_SECRET}: connection failed`)),
      },
      request: REQUEST,
      transcript: 'A private response.',
    })
    expect(legacyOutage.error).toBe(CONTENT_PROVIDER_UNAVAILABLE_MESSAGE)
    expect(legacyOutage.calls).toBe(1)

    const v2Outage = await runV2ContentEvaluation({
      provider: {
        name: 'fake',
        complete: async () => Promise.reject(new Error(`${FAKE_SECRET}: connection failed`)),
      },
      mode: 'practice',
      prompt: 'Describe a familiar place.',
      transcript: 'A private response.',
    })
    expect(v2Outage.warnings).toEqual([CONTENT_PROVIDER_UNAVAILABLE_MESSAGE])
    expect(v2Outage.calls).toBe(1)

    const configurationFailure = await runContentCheckSafely({
      createModel() {
        throw new Error(`${FAKE_SECRET}: missing configuration`)
      },
      request: REQUEST,
      transcript: 'A private response.',
    })
    expect(configurationFailure.error).toBe(CONTENT_PROVIDER_UNAVAILABLE_MESSAGE)
    expect(configurationFailure.calls).toBe(0)

    const legacyParse = await runContentCheck({
      model: { name: 'fake', complete: async () => 'not json' },
      request: REQUEST,
      transcript: 'A private response.',
    })
    expect(legacyParse.calls).toBe(2)
    expect(legacyParse.error).toMatch(/not JSON/)

    const v2Parse = await runV2ContentEvaluation({
      provider: { name: 'fake', complete: async () => 'not json' },
      mode: 'practice',
      prompt: 'Describe a familiar place.',
      transcript: 'A private response.',
    })
    expect(v2Parse.calls).toBe(2)
    expect(v2Parse.warnings).toEqual(['The v2 content response was not a JSON object.'])
    expect(consoleSpies[3]).toHaveBeenCalledTimes(3)
    expect(consoleSpies[3]?.mock.calls).toEqual([
      [{ provider: 'deepseek', model: 'fake', code: 'transport_error', status: null }],
      [{ provider: 'deepseek', model: 'fake', code: 'transport_error', status: null }],
      [{ provider: 'deepseek', model: 'unknown', code: 'configuration_error', status: null }],
    ])
    expect(serialized(consoleSpies.flatMap((spy) => spy.mock.calls))).not.toContain(FAKE_SECRET)
  })
})
