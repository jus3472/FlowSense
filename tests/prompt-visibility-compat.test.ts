import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  isMissingFreePracticeVisibilityColumn,
  queryWithFreePracticeVisibilityFallback,
} from '@/lib/prompts/visibility-compat'

const MISSING_COLUMN = {
  code: '42703',
  message: 'column prompts.free_practice_visible does not exist',
}

describe('Free Practice schema compatibility', () => {
  it('recognizes only the exact pre-curriculum missing-column response', () => {
    expect(isMissingFreePracticeVisibilityColumn(MISSING_COLUMN)).toBe(true)
    expect(
      isMissingFreePracticeVisibilityColumn({
        ...MISSING_COLUMN,
        message: 'column prompts.mode does not exist',
      }),
    ).toBe(false)
    expect(isMissingFreePracticeVisibilityColumn({ ...MISSING_COLUMN, code: 'PGRST204' })).toBe(
      false,
    )
    expect(
      isMissingFreePracticeVisibilityColumn({ code: '42501', message: 'permission denied' }),
    ).toBe(false)
    expect(isMissingFreePracticeVisibilityColumn(null)).toBe(false)
  })

  it('returns legacy rows only while the visibility column remains absent', async () => {
    const visible = vi.fn(async () => ({ data: null, error: MISSING_COLUMN }))
    const legacy = vi.fn(async () => ({ data: ['existing prompt'], error: null }))

    await expect(queryWithFreePracticeVisibilityFallback(visible, legacy)).resolves.toEqual({
      data: ['existing prompt'],
      error: null,
    })
    expect(visible).toHaveBeenCalledTimes(2)
    expect(legacy).toHaveBeenCalledOnce()
  })

  it('uses the visibility-aware result without querying the legacy schema', async () => {
    const visible = vi.fn(async () => ({ data: ['visible prompt'], error: null }))
    const legacy = vi.fn(async () => ({ data: ['unfiltered prompt'], error: null }))

    await expect(queryWithFreePracticeVisibilityFallback(visible, legacy)).resolves.toEqual({
      data: ['visible prompt'],
      error: null,
    })
    expect(legacy).not.toHaveBeenCalled()
  })

  it('fails visibly for unrelated errors and failed legacy queries', async () => {
    const denied = { code: '42501', message: 'permission denied' }
    const unrelatedVisible = vi.fn(async () => ({ data: null, error: denied }))
    const unusedLegacy = vi.fn(async () => ({ data: ['prompt'], error: null }))
    await expect(
      queryWithFreePracticeVisibilityFallback(unrelatedVisible, unusedLegacy),
    ).resolves.toEqual({ data: null, error: denied })
    expect(unusedLegacy).not.toHaveBeenCalled()

    const failedLegacy = { code: '57014', message: 'query canceled' }
    await expect(
      queryWithFreePracticeVisibilityFallback(
        async () => ({ data: null, error: MISSING_COLUMN }),
        async () => ({ data: null, error: failedLegacy }),
      ),
    ).resolves.toEqual({ data: null, error: failedLegacy })
  })

  it('switches to the filtered result if migration completes during fallback', async () => {
    const visible = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: MISSING_COLUMN })
      .mockResolvedValueOnce({ data: ['visible prompt'], error: null })
    const legacy = vi.fn(async () => ({
      data: ['visible prompt', 'curriculum prompt'],
      error: null,
    }))

    await expect(queryWithFreePracticeVisibilityFallback(visible, legacy)).resolves.toEqual({
      data: ['visible prompt'],
      error: null,
    })
  })
})
