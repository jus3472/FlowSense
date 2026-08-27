import type {
  PronunciationAssessmentRequest,
  PronunciationEvaluation,
  PronunciationParseResult,
} from '@/lib/pronunciation/contracts'
import { mapAzurePronunciationResponse } from '@/lib/pronunciation/azure-mapper'
import type { PronunciationProvider } from '@/lib/pronunciation/provider'

export const AZURE_MAX_AUDIO_DURATION_MS = 30_000
export const AZURE_SUPPORTED_LOCALES = ['en-US'] as const
export const AZURE_SUPPORTED_AUDIO_TYPES = [
  'audio/wav; codecs=audio/pcm; samplerate=16000',
  'audio/ogg; codecs=opus',
] as const

export interface AzureSpeechConfig {
  endpoint: string
  key: string
  locale: string
}

export interface AzureTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export function isAzureLocaleSupported(locale: string): boolean {
  return AZURE_SUPPORTED_LOCALES.includes(locale as (typeof AZURE_SUPPORTED_LOCALES)[number])
}

export function isAzureAudioSupported(contentType: string, durationMs: number): boolean {
  const normalized = contentType.trim().toLowerCase()
  return (
    (normalized === AZURE_SUPPORTED_AUDIO_TYPES[0] ||
      normalized === AZURE_SUPPORTED_AUDIO_TYPES[1]) &&
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    durationMs <= AZURE_MAX_AUDIO_DURATION_MS
  )
}

export function validateAzureEndpoint(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null
    }
    const suffix = '.cognitiveservices.azure.com'
    if (!url.hostname.toLocaleLowerCase('en-US').endsWith(suffix)) return null
    const resourceName = url.hostname.slice(0, -suffix.length)
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i.test(resourceName)) return null
    return url.origin
  } catch {
    return null
  }
}

export function validateAzureSpeechConfig(
  value: Partial<AzureSpeechConfig>,
): AzureSpeechConfig | null {
  const endpoint = typeof value.endpoint === 'string' ? validateAzureEndpoint(value.endpoint) : null
  const key = typeof value.key === 'string' && value.key.trim().length > 0 ? value.key : null
  const locale =
    typeof value.locale === 'string' && /^[a-z]{2,3}-[A-Z]{2,4}$/.test(value.locale)
      ? value.locale
      : null
  return endpoint && key && locale ? { endpoint, key, locale } : null
}

export function buildAzureRequest(
  config: AzureSpeechConfig,
  request: PronunciationAssessmentRequest,
  audio: ArrayBuffer,
): { url: string; init: RequestInit } {
  const params = new URLSearchParams({
    language: config.locale,
    format: 'detailed',
  })
  const assessment = Buffer.from(
    JSON.stringify({
      ReferenceText: request.referenceText ?? '',
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Basic',
      EnableMiscue: true,
    }),
  ).toString('base64')
  return {
    url: `${config.endpoint}/stt/speech/recognition/conversation/cognitiveservices/v1?${params}`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': request.audio.contentType,
        'Ocp-Apim-Subscription-Key': config.key,
        'Pronunciation-Assessment': assessment,
      },
      body: audio,
    },
  }
}

function failed(
  message: string,
  code: 'outage' | 'timeout' | 'malformed_response',
  locale: string,
): PronunciationEvaluation {
  return {
    contractVersion: 'v1',
    provider: { id: 'azure-speech', model: 'short-audio', version: 'rest-v1', locale },
    status: 'failed',
    words: [],
    unsupportedWords: [],
    warnings: [],
    error: { code, message, retryable: code !== 'malformed_response' },
    eligibleForDeductions: false,
  }
}

function notChecked(message: string, locale: string): PronunciationEvaluation {
  return {
    contractVersion: 'v1',
    provider: { id: 'azure-speech', model: 'short-audio', version: 'rest-v1', locale },
    status: 'not_checked',
    words: [],
    unsupportedWords: [],
    warnings: [message],
    error: null,
    eligibleForDeductions: false,
  }
}

function requestIsValid(
  config: AzureSpeechConfig,
  request: PronunciationAssessmentRequest,
  audio: ArrayBuffer,
): boolean {
  let previousWordEnd = 0
  const wordsAreValid =
    request.recognizedWords.length > 0 &&
    request.recognizedWords.every((word) => {
      const valid =
        word.word.trim().length > 0 &&
        Number.isFinite(word.startMs) &&
        Number.isFinite(word.endMs) &&
        word.startMs >= previousWordEnd &&
        word.endMs > word.startMs &&
        word.endMs <= request.audio.durationMs
      previousWordEnd = word.endMs
      return valid
    })
  return Boolean(
    validateAzureSpeechConfig(config) &&
    isAzureLocaleSupported(config.locale) &&
    request.contractVersion === 'v1' &&
    request.provider.id === 'azure-speech' &&
    request.provider.model === 'short-audio' &&
    request.provider.version === 'rest-v1' &&
    request.scenario === 'scripted' &&
    request.locale === config.locale &&
    typeof request.referenceText === 'string' &&
    request.referenceText.trim().length > 0 &&
    wordsAreValid &&
    audio.byteLength > 0,
  )
}

export async function assessAzurePronunciation(
  config: AzureSpeechConfig,
  request: PronunciationAssessmentRequest,
  audio: ArrayBuffer,
  transport: AzureTransport = globalThis,
  timeoutMs = 10_000,
): Promise<PronunciationEvaluation> {
  if (!requestIsValid(config, request, audio)) {
    const locale = config.locale.trim() || request.locale.trim() || 'und'
    return notChecked('Pronunciation assessment configuration or request was unsupported.', locale)
  }
  if (!isAzureAudioSupported(request.audio.contentType, request.audio.durationMs)) {
    return notChecked(
      'Audio format or duration is not supported by Azure short-audio assessment.',
      config.locale,
    )
  }
  const { url, init } = buildAzureRequest(config, request, audio)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await transport.fetch(url, { ...init, signal: controller.signal })
    if (!response.ok)
      return failed(`Azure returned status ${response.status}.`, 'outage', config.locale)
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return failed('Azure returned malformed JSON.', 'malformed_response', config.locale)
    }
    const parsed: PronunciationParseResult = mapAzurePronunciationResponse(payload, request)
    return parsed.ok
      ? parsed.value
      : failed(parsed.error.message, 'malformed_response', config.locale)
  } catch {
    if (controller.signal.aborted)
      return failed('Azure pronunciation assessment timed out.', 'timeout', config.locale)
    return failed('Azure could not be reached.', 'outage', config.locale)
  } finally {
    clearTimeout(timer)
  }
}

export function createAzurePronunciationProvider(
  config: AzureSpeechConfig,
  transport: AzureTransport = globalThis,
  timeoutMs = 10_000,
): PronunciationProvider {
  return {
    id: 'azure-speech',
    assess: (request, audio) =>
      assessAzurePronunciation(config, request, audio, transport, timeoutMs),
  }
}
