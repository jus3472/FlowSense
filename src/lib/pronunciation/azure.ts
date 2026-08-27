import type {
  PronunciationAssessmentRequest,
  PronunciationEvaluation,
  PronunciationParseResult,
} from '@/lib/pronunciation/contracts'
import { mapAzurePronunciationResponse } from '@/lib/pronunciation/azure-mapper'
import type { PronunciationProvider } from '@/lib/pronunciation/provider'

export const AZURE_MAX_AUDIO_DURATION_MS = 30_000
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
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null
    if (!/^https:\/\/[a-z0-9-]+\.cognitiveservices\.azure\.com$/i.test(url.origin)) return null
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
      Dimension: 'Comprehensive',
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

export async function assessAzurePronunciation(
  config: AzureSpeechConfig,
  request: PronunciationAssessmentRequest,
  audio: ArrayBuffer,
  transport: AzureTransport = globalThis,
  timeoutMs = 10_000,
): Promise<PronunciationEvaluation> {
  if (!isAzureAudioSupported(request.audio.contentType, request.audio.durationMs)) {
    return {
      ...failed(
        'Audio format or duration is not supported by Azure short-audio assessment.',
        'malformed_response',
        config.locale,
      ),
      status: 'not_checked',
      error: null,
    }
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
  } catch (cause) {
    if (controller.signal.aborted)
      return failed('Azure pronunciation assessment timed out.', 'timeout', config.locale)
    return failed(
      cause instanceof Error ? cause.message : 'Azure could not be reached.',
      'outage',
      config.locale,
    )
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
