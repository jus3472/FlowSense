import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
  DEEPSEEK_CONTENT_MAX_TOKENS,
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

const VALID_V2_CONTENT = JSON.stringify({
  version: 'v2.content-detector.1',
  structure: {
    checks: Object.fromEntries(
      [
        'answered_prompt',
        'main_point',
        'logical_progression',
        'relevant_support',
        'unnecessary_repetition',
        'topic_drift',
        'completion',
      ].map((id) => [
        id,
        {
          passed: true,
          severity: null,
          quote: null,
          start: null,
          end: null,
          observation: null,
          suggestion: null,
        },
      ]),
    ),
  },
  grammar: { findings: [] },
  vocabulary: { findings: [] },
})

const V2_INPUT = {
  mode: 'practice' as const,
  prompt: 'Describe a familiar place.',
  transcript: 'A private response.',
}

function successfulResponse(content = VALID_V2_CONTENT, finishReason: string = 'stop'): Response {
  return Response.json({
    choices: [{ finish_reason: finishReason, message: { content } }],
  })
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
  it('uses the deterministic bounded JSON request contract', async () => {
    const fetch = vi.fn().mockResolvedValue(successfulResponse())
    vi.stubGlobal('fetch', fetch)

    await expect(createDeepSeekModel(FAKE_API_KEY).complete(REQUEST)).resolves.toBe(
      VALID_V2_CONTENT,
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 4_096,
    })
    expect(body.max_tokens).toBe(DEEPSEEK_CONTENT_MAX_TOKENS)
    expect(body.messages).toEqual([
      { role: 'system', content: REQUEST.system },
      { role: 'user', content: REQUEST.user },
    ])
  })

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
        code: 'server_error',
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
      code: 'server_error',
      status: 503,
    })
    for (const spy of consoleSpies.slice(0, 3)) expect(spy).not.toHaveBeenCalled()
  })

  it('classifies authentication, configuration, rate-limit, and server responses', async () => {
    const consoleSpies = watchConsole()
    const cases = [
      { status: 401, expectedCode: 'authentication_error' },
      { status: 400, expectedCode: 'configuration_error' },
      { status: 429, expectedCode: 'rate_limit' },
      { status: 503, expectedCode: 'server_error' },
    ] as const

    for (const testCase of cases) {
      const response = new Response(UNSAFE_RESPONSE_BODY, { status: testCase.status })
      const text = vi.spyOn(response, 'text')
      const json = vi.spyOn(response, 'json')
      const fetch = vi.fn().mockResolvedValue(response)
      vi.stubGlobal('fetch', fetch)

      await expect(createDeepSeekModel(FAKE_API_KEY).complete(REQUEST)).rejects.toMatchObject({
        message: CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
        diagnostic: { code: testCase.expectedCode, status: testCase.status },
      })
      expect(text).not.toHaveBeenCalled()
      expect(json).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    }

    expect(consoleSpies[3]).toHaveBeenCalledTimes(cases.length)
    const loggedOutput = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [FAKE_SECRET, FAKE_API_KEY, REQUEST.system, REQUEST.user]) {
      expect(loggedOutput).not.toContain(privateValue)
    }
  })

  it('classifies malformed JSON, schema-invalid, empty, and truncated responses', async () => {
    const consoleSpies = watchConsole()
    const cases = [
      {
        expectedCode: 'malformed_json',
        response: new Response(UNSAFE_RESPONSE_BODY, { status: 200 }),
      },
      {
        expectedCode: 'schema_invalid',
        response: Response.json({ private: FAKE_SECRET }),
      },
      {
        expectedCode: 'empty_response',
        response: successfulResponse('   '),
      },
      {
        expectedCode: 'truncated_response',
        response: successfulResponse(FAKE_SECRET, 'length'),
      },
    ] as const

    for (const testCase of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(testCase.response))
      let failure: unknown
      try {
        await createDeepSeekModel(FAKE_API_KEY).complete(REQUEST)
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        message: CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
        diagnostic: { code: testCase.expectedCode, status: 200 },
      })
      expect(serialized(failure)).not.toContain(FAKE_SECRET)
      vi.unstubAllGlobals()
    }

    expect(consoleSpies[3]).toHaveBeenCalledTimes(cases.length)
    expect(serialized(consoleSpies.flatMap((spy) => spy.mock.calls))).not.toContain(FAKE_SECRET)
  })

  it('normalizes timeout and network failures without retaining source error text', async () => {
    const consoleSpies = watchConsole()
    const cases = [
      {
        expectedCode: 'timeout',
        expectedStatus: null,
        fetch: vi.fn().mockRejectedValue(new RequestTimeoutError('private label', 1_000)),
      },
      {
        expectedCode: 'network_failure',
        expectedStatus: null,
        fetch: vi.fn().mockRejectedValue(new Error(`${FAKE_SECRET}: network failed`)),
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

describe('v2 provider retry boundary', () => {
  it.each([
    {
      name: 'malformed JSON',
      first: 'not json',
      expectedCode: 'malformed_json',
    },
    {
      name: 'schema-invalid JSON',
      first: JSON.stringify({ version: 'v2.content-detector.1' }),
      expectedCode: 'schema_invalid',
    },
  ])('retries a first $name response and accepts a valid second response', async (testCase) => {
    const consoleSpies = watchConsole()
    const complete = vi
      .fn()
      .mockResolvedValueOnce(testCase.first)
      .mockResolvedValueOnce(VALID_V2_CONTENT)

    const result = await runV2ContentEvaluation({
      provider: { name: 'fake', complete },
      ...V2_INPUT,
    })

    expect(result).toMatchObject({ status: 'checked', calls: 2, warnings: [] })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(consoleSpies[3]).toHaveBeenCalledOnce()
    expect(consoleSpies[3]).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'fake',
      code: testCase.expectedCode,
      status: null,
    })
  })

  it('returns safe not_checked content after both output responses are invalid', async () => {
    const consoleSpies = watchConsole()
    const complete = vi
      .fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify({ version: 'v2.content-detector.1' }))

    const result = await runV2ContentEvaluation({
      provider: { name: 'fake', complete },
      ...V2_INPUT,
    })

    expect(result).toMatchObject({
      status: 'not_checked',
      calls: 2,
      warnings: ['structure was missing', 'grammar was missing', 'vocabulary was missing'],
      categories: {
        structure: { status: 'not_checked', component: null },
        grammar: { status: 'not_checked', component: null },
        vocabulary: { status: 'not_checked', component: null },
      },
    })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(consoleSpies[3]).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ code: 'malformed_json' }),
    )
    expect(consoleSpies[3]).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ code: 'schema_invalid' }),
    )
    const persisted = serialized(result)
    const logged = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [V2_INPUT.prompt, V2_INPUT.transcript]) {
      expect(persisted).not.toContain(privateValue)
      expect(logged).not.toContain(privateValue)
    }
  })

  it.each([
    { code: 'rate_limit' as const, status: 429 },
    { code: 'server_error' as const, status: 503 },
    { code: 'network_failure' as const, status: undefined },
    { code: 'timeout' as const, status: undefined },
    { code: 'empty_response' as const, status: 200 },
    { code: 'truncated_response' as const, status: 200 },
  ])('retries one $code provider failure and succeeds', async ({ code, status }) => {
    const consoleSpies = watchConsole()
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ContentProviderFailure(code, 'fake', status))
      .mockResolvedValueOnce(VALID_V2_CONTENT)

    const result = await runV2ContentEvaluation({
      provider: { name: 'fake', complete },
      ...V2_INPUT,
    })

    expect(result).toMatchObject({ status: 'checked', calls: 2 })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(consoleSpies[3]).toHaveBeenCalledOnce()
    expect(consoleSpies[3]).toHaveBeenCalledWith(
      expect.objectContaining({ code, status: status ?? null }),
    )
  })

  it('returns safe not_checked content after both transient provider calls fail', async () => {
    const consoleSpies = watchConsole()
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ContentProviderFailure('network_failure', 'fake'))
      .mockRejectedValueOnce(new ContentProviderFailure('server_error', 'fake', 503))

    const result = await runV2ContentEvaluation({
      provider: { name: 'fake', complete },
      ...V2_INPUT,
    })

    expect(result).toMatchObject({
      status: 'not_checked',
      calls: 2,
      warnings: [CONTENT_PROVIDER_UNAVAILABLE_MESSAGE],
    })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(consoleSpies[3]).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ code: 'network_failure', status: null }),
    )
    expect(consoleSpies[3]).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ code: 'server_error', status: 503 }),
    )
  })

  it.each([
    { code: 'authentication_error' as const, status: 401 },
    { code: 'configuration_error' as const, status: 400 },
  ])('does not retry $code failures', async ({ code, status }) => {
    const consoleSpies = watchConsole()
    const complete = vi.fn().mockRejectedValue(new ContentProviderFailure(code, 'fake', status))

    const result = await runV2ContentEvaluation({
      provider: { name: 'fake', complete },
      ...V2_INPUT,
    })

    expect(result).toMatchObject({
      status: 'not_checked',
      calls: 1,
      warnings: [CONTENT_PROVIDER_UNAVAILABLE_MESSAGE],
    })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(consoleSpies[3]).toHaveBeenCalledOnce()
    expect(consoleSpies[3]).toHaveBeenCalledWith(expect.objectContaining({ code, status }))
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
      expect.objectContaining({ code: 'server_error', status: 503 }),
    )
    const persistedOutput = serialized(outcome)
    const loggedOutput = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [FAKE_SECRET, FAKE_API_KEY, REQUEST.system, REQUEST.user]) {
      expect(persistedOutput).not.toContain(privateValue)
      expect(loggedOutput).not.toContain(privateValue)
    }
  })

  it('retries a v2 5xx once and keeps both response bodies out of not_checked warnings', async () => {
    const firstResponse = failedResponse()
    const secondResponse = failedResponse()
    const firstText = vi.spyOn(firstResponse, 'text')
    const secondText = vi.spyOn(secondResponse, 'text')
    const consoleSpies = watchConsole()
    const fetch = vi.fn().mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse)
    vi.stubGlobal('fetch', fetch)

    const result = await runV2ContentEvaluation({
      provider: contentDetectorFromModel(createDeepSeekModel(FAKE_API_KEY)),
      mode: 'practice',
      prompt: 'Describe a familiar place.',
      transcript: 'A private response.',
    })

    expect(result).toMatchObject({
      status: 'not_checked',
      calls: 2,
      warnings: [CONTENT_PROVIDER_UNAVAILABLE_MESSAGE],
      categories: {
        structure: { status: 'not_checked', component: null },
        grammar: { status: 'not_checked', component: null },
        vocabulary: { status: 'not_checked', component: null },
      },
    })
    expect(firstText).not.toHaveBeenCalled()
    expect(secondText).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(consoleSpies[3]).toHaveBeenCalledTimes(2)
    expect(consoleSpies[3]).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ code: 'server_error', status: 503 }),
    )
    expect(consoleSpies[3]).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ code: 'server_error', status: 503 }),
    )
    const persistedOutput = serialized(result)
    const loggedOutput = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [FAKE_SECRET, FAKE_API_KEY, REQUEST.system, REQUEST.user]) {
      expect(persistedOutput).not.toContain(privateValue)
      expect(loggedOutput).not.toContain(privateValue)
    }
  })

  it('sanitizes unexpected, configuration, and parser failures', async () => {
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
    expect(v2Parse.warnings).toEqual([CONTENT_PROVIDER_UNAVAILABLE_MESSAGE])
    expect(consoleSpies[3]).toHaveBeenCalledTimes(5)
    expect(consoleSpies[3]?.mock.calls).toEqual([
      [{ provider: 'deepseek', model: 'fake', code: 'unknown_provider_failure', status: null }],
      [{ provider: 'deepseek', model: 'fake', code: 'unknown_provider_failure', status: null }],
      [{ provider: 'deepseek', model: 'unknown', code: 'configuration_error', status: null }],
      [{ provider: 'deepseek', model: 'fake', code: 'malformed_json', status: null }],
      [{ provider: 'deepseek', model: 'fake', code: 'malformed_json', status: null }],
    ])
    const loggedOutput = serialized(consoleSpies.flatMap((spy) => spy.mock.calls))
    for (const privateValue of [
      FAKE_SECRET,
      FAKE_API_KEY,
      REQUEST.system,
      REQUEST.user,
      V2_INPUT.prompt,
      V2_INPUT.transcript,
      UNSAFE_RESPONSE_BODY,
    ]) {
      expect(loggedOutput).not.toContain(privateValue)
    }
  })
})
