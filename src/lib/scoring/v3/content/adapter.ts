import type { ContentModel } from '@/lib/deepseek/provider'
import type { V3ContentEvaluatorProvider } from '@/lib/scoring/v3/content/contracts'
import { buildV3ContentUserPrompt, V3_CONTENT_SYSTEM_PROMPT } from '@/lib/scoring/v3/content/prompt'

/** Reuses the provider-neutral DeepSeek transport without inheriting an older score ontology. */
export function v3ContentEvaluatorFromModel(model: ContentModel): V3ContentEvaluatorProvider {
  return {
    name: model.name,
    complete(request) {
      return model.complete({
        system: V3_CONTENT_SYSTEM_PROMPT,
        user: buildV3ContentUserPrompt(request),
        timeoutMs: request.timeoutMs,
      })
    },
  }
}
