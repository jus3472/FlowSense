import type { ContentModel } from '@/lib/deepseek/provider'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'

export interface WorkBudget {
  readonly totalMs: number
  remainingMs(): number
  timeoutFor(requestedMs: number): number
}

export function createWorkBudget(totalMs: number, now: () => number = Date.now): WorkBudget {
  if (!Number.isFinite(totalMs) || totalMs <= 0) throw new Error('Work budget must be positive.')
  const startedAt = now()
  const remainingMs = () => Math.max(0, Math.floor(totalMs - (now() - startedAt)))

  return {
    totalMs,
    remainingMs,
    timeoutFor(requestedMs) {
      if (!Number.isFinite(requestedMs) || requestedMs <= 0) return 0
      return Math.min(Math.floor(requestedMs), remainingMs())
    },
  }
}

/** Every provider retry receives only the time left in the shared route budget. */
export function contentModelWithinBudget(model: ContentModel, budget: WorkBudget): ContentModel {
  return {
    name: model.name,
    async complete(request) {
      const timeoutMs = budget.timeoutFor(request.timeoutMs ?? budget.totalMs)
      if (timeoutMs <= 0) {
        throw new RequestTimeoutError('Scoring provider work', budget.totalMs)
      }
      return model.complete({ ...request, timeoutMs })
    },
  }
}

/** Resolves a non-scoring fallback when optional work exceeds the shared budget. */
export async function settleWithinWorkBudget<T>(
  work: Promise<T>,
  budget: WorkBudget,
  fallback: T,
): Promise<T> {
  const remainingMs = budget.remainingMs()
  if (remainingMs <= 0) {
    void work.catch(() => undefined)
    return fallback
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), remainingMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
