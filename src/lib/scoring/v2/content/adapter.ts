import type { ContentModel } from '@/lib/deepseek/provider'
import { buildV2ContentUserPrompt, V2_CONTENT_SYSTEM_PROMPT } from '@/lib/scoring/v2/content/prompt'
import type { V2ContentDetectorProvider } from '@/lib/scoring/v2/content/contracts'

/** Reuses the legacy transport seam without reusing its prompt or response format. */
export function contentDetectorFromModel(model: ContentModel): V2ContentDetectorProvider {
  return {
    name: model.name,
    complete(request) {
      return model.complete({
        system: V2_CONTENT_SYSTEM_PROMPT,
        user: buildV2ContentUserPrompt(request),
        timeoutMs: request.timeoutMs,
      })
    },
  }
}
