import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentModel } from '@/lib/deepseek/provider'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'
import {
  contentModelWithinBudget,
  createWorkBudget,
  settleWithinWorkBudget,
} from '@/lib/scoring/work-budget'

afterEach(() => {
  vi.useRealTimers()
})

describe('scoring work budget', () => {
  it('shares one deadline across initial and retry provider calls', async () => {
    let now = 10_000
    const complete = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => String(timeoutMs))
    const model: ContentModel = { name: 'test-model', complete }
    const budget = createWorkBudget(50_000, () => now)
    const bounded = contentModelWithinBudget(model, budget)

    await expect(bounded.complete({ system: 's', user: 'u', timeoutMs: 30_000 })).resolves.toBe(
      '30000',
    )

    now += 35_000
    await expect(bounded.complete({ system: 's', user: 'retry', timeoutMs: 30_000 })).resolves.toBe(
      '15000',
    )

    now += 15_000
    await expect(
      bounded.complete({ system: 's', user: 'too late', timeoutMs: 30_000 }),
    ).rejects.toEqual(new RequestTimeoutError('Scoring provider work', 50_000))
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('settles optional work with its fallback when the remaining budget expires', async () => {
    vi.useFakeTimers()
    const budget = createWorkBudget(1_000)
    const work = new Promise<string>(() => undefined)

    const result = settleWithinWorkBudget(work, budget, 'not checked')
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(result).resolves.toBe('not checked')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid budgets and never emits an invalid provider timeout', () => {
    expect(() => createWorkBudget(0)).toThrow('Work budget must be positive.')
    expect(() => createWorkBudget(Number.NaN)).toThrow('Work budget must be positive.')

    const budget = createWorkBudget(1_000, () => 0)
    expect(budget.timeoutFor(-1)).toBe(0)
    expect(budget.timeoutFor(Number.NaN)).toBe(0)
    expect(budget.timeoutFor(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
