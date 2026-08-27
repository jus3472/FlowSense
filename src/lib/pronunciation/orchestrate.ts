import type { TranscriptWord } from '@/lib/deepgram/parse'
import {
  isAzureAudioSupported,
  isAzureLocaleSupported,
  validateAzureSpeechConfig,
  type AzureSpeechConfig,
} from '@/lib/pronunciation/azure'
import type {
  PronunciationAssessmentRequest,
  PronunciationEvaluation,
} from '@/lib/pronunciation/contracts'
import { parsePronunciationEvaluation } from '@/lib/pronunciation/contracts'
import type { PronunciationProvider } from '@/lib/pronunciation/provider'
import type { CaptureMetrics } from '@/lib/types/metrics'

export interface PrivateAudioDownload {
  data: Blob | null
  error: unknown
}

export interface PronunciationOrchestrationInput {
  config: AzureSpeechConfig | null
  provider: PronunciationProvider | null
  audioPath: string | null
  capture: CaptureMetrics | null | undefined
  transcript: string
  transcriptWords: readonly TranscriptWord[]
  download(path: string): Promise<PrivateAudioDownload>
}

function notChecked(locale: string, warning: string): PronunciationEvaluation {
  return {
    contractVersion: 'v1',
    provider: { id: 'azure-speech', model: 'short-audio', version: 'rest-v1', locale },
    status: 'not_checked',
    words: [],
    unsupportedWords: [],
    warnings: [warning],
    error: null,
    eligibleForDeductions: false,
  }
}

/** Downloads private audio only after configuration and media gates pass. */
export async function collectPronunciationEvidence(
  input: PronunciationOrchestrationInput,
): Promise<PronunciationEvaluation | null> {
  const { config, provider, capture } = input
  if (!config || !provider || !input.audioPath || !capture) return null
  if (!validateAzureSpeechConfig(config)) return null
  if (!isAzureLocaleSupported(config.locale)) {
    return notChecked(config.locale, 'Pronunciation assessment configuration was unsupported.')
  }
  if (!isAzureAudioSupported(capture.mime_type, capture.duration_ms)) {
    return notChecked(
      config.locale,
      'Azure short-audio assessment does not support this recording format or duration.',
    )
  }

  let downloaded: PrivateAudioDownload
  try {
    downloaded = await input.download(input.audioPath)
  } catch {
    return null
  }
  if (downloaded.error || !downloaded.data) return null

  let audio: ArrayBuffer
  try {
    audio = await downloaded.data.arrayBuffer()
  } catch {
    return null
  }

  const request: PronunciationAssessmentRequest = {
    contractVersion: 'v1',
    provider: { id: 'azure-speech', model: 'short-audio', version: 'rest-v1' },
    locale: config.locale,
    scenario: 'scripted',
    audio: { contentType: capture.mime_type, durationMs: capture.duration_ms },
    referenceText: input.transcript,
    recognizedWords: input.transcriptWords.map((word) => ({
      word: word.word,
      startMs: word.start * 1000,
      endMs: word.end * 1000,
    })),
  }
  try {
    const result = await provider.assess(request, audio)
    const parsed = parsePronunciationEvaluation(result)
    return parsed.ok ? parsed.value : null
  } catch {
    return null
  }
}
