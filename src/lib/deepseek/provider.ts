import { fetchWithTimeout } from '@/lib/net/fetch-with-timeout'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-v4-flash'

export interface ContentModelRequest {
  system: string
  user: string
  timeoutMs?: number
}

/**
 * The seam that keeps the provider swappable. Everything above this returns
 * plain JSON text, so changing model or vendor is a config change.
 */
export interface ContentModel {
  readonly name: string
  complete(request: ContentModelRequest): Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createDeepSeekModel(apiKey: string, model = DEEPSEEK_MODEL): ContentModel {
  return {
    name: model,
    async complete({ system, user, timeoutMs = 30_000 }) {
      const response = await fetchWithTimeout(
        `${DEEPSEEK_BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            // Verified against a live call: without this the model still emits a
            // reasoning trace and bills the tokens. These calls return structured
            // JSON and have no use for one.
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' },
            temperature: 0,
          }),
        },
        { label: 'Checking your content', timeoutMs },
      )

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(
          `DeepSeek returned ${response.status}: ${detail.slice(0, 200) || 'no explanation'}`,
        )
      }

      const body: unknown = await response.json()
      const choice = isRecord(body) && Array.isArray(body.choices) ? body.choices[0] : undefined
      const message = isRecord(choice) ? choice.message : undefined
      const content = isRecord(message) ? message.content : undefined

      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('DeepSeek returned no content.')
      }
      return content
    },
  }
}
