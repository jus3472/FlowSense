import { beforeEach, describe, expect, it, vi } from 'vitest'
import { legacySectionSnapshot, v2Snapshot } from './helpers/result-snapshots'

vi.mock('server-only', () => ({}))

import { loadPracticeActivitySummary, recordPracticeActivityDay } from '@/lib/activity/server'

interface SetupOptions {
  timezone?: unknown
  profileError?: unknown
  activityError?: unknown
  pages?: unknown[][]
}

function queryWithSingle(response: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => response),
  }
  return query
}

function setupClient(options: SetupOptions = {}) {
  const profile = queryWithSingle({
    data: { timezone: options.timezone ?? null },
    error: options.profileError ?? null,
  })
  const upserts: unknown[] = []
  const pages = [...(options.pages ?? [[]])]
  const activity = {
    upsert: vi.fn(async (value: unknown) => {
      upserts.push(value)
      return { error: options.activityError ?? null }
    }),
    select: vi.fn(() => activity),
    eq: vi.fn(() => activity),
    lte: vi.fn(() => activity),
    order: vi.fn(() => activity),
    range: vi.fn(async () => ({ data: pages.shift() ?? [], error: options.activityError ?? null })),
  }
  const client = {
    from: vi.fn((table: string) => (table === 'profiles' ? profile : activity)),
  }
  return { client, profile, activity, upserts }
}

function attempt(overrides: Record<string, unknown> = {}) {
  const sectionScores = overrides.sectionScores ?? v2Snapshot({ component: 0.8 })
  const score =
    'score' in overrides
      ? overrides.score
      : typeof sectionScores === 'object' &&
          sectionScores !== null &&
          'total_earned_points' in sectionScores
        ? sectionScores.total_earned_points
        : null
  return {
    status: 'done',
    durationMs: 30_000,
    transcript: 'A complete speaking response.',
    score,
    sectionScores,
    ...overrides,
  }
}

beforeEach(() => vi.restoreAllMocks())

describe('recordPracticeActivityDay', () => {
  it.each([
    ['below the lesson threshold', attempt({ sectionScores: v2Snapshot({ component: 0.6 }) })],
    ['above the lesson threshold', attempt({ sectionScores: v2Snapshot({ component: 0.9 }) })],
    [
      'provider neutral',
      attempt({ score: null, sectionScores: v2Snapshot({ notCheckedCategory: 'grammar' }) }),
    ],
    [
      'legacy free or custom practice',
      attempt({ score: 80, sectionScores: legacySectionSnapshot }),
    ],
  ])('records %s as activity', async (_label, input) => {
    const setup = setupClient({ timezone: 'America/New_York' })

    await expect(
      recordPracticeActivityDay(
        setup.client as never,
        'user-1',
        input,
        new Date('2026-08-28T03:30:00.000Z'),
      ),
    ).resolves.toEqual({
      status: 'recorded',
      localDate: '2026-08-27',
      timezone: 'America/New_York',
    })
    expect(setup.activity.upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        local_date: '2026-08-27',
        timezone: 'America/New_York',
      },
      { onConflict: 'user_id,local_date', ignoreDuplicates: true },
    )
  })

  it.each([
    ['failed upload', { status: 'failed' }],
    ['timed out', { status: 'timed_out' }],
    ['abandoned recording', { status: 'failed', durationMs: 0 }],
    ['failed transcription', { transcript: '' }],
    ['malformed result', { sectionScores: { version: 'v2.score.1' } }],
  ])('does not record a %s', async (_label, overrides) => {
    const setup = setupClient()
    const result = await recordPracticeActivityDay(
      setup.client as never,
      'user-1',
      attempt(overrides),
    )
    expect(result.status).toBe('skipped')
    expect(setup.activity.upsert).not.toHaveBeenCalled()
  })

  it('uses UTC when no profile timezone is available', async () => {
    const setup = setupClient({ profileError: { code: 'PGRST500' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await recordPracticeActivityDay(
      setup.client as never,
      'user-1',
      attempt(),
      new Date('2026-08-28T23:30:00.000Z'),
    )
    expect(result).toMatchObject({ status: 'recorded', localDate: '2026-08-28', timezone: 'UTC' })
  })

  it('keeps a completed attempt successful when the ledger insert fails', async () => {
    const setup = setupClient({ activityError: { code: 'PGRST500', message: 'private' } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      recordPracticeActivityDay(setup.client as never, 'user-1', attempt()),
    ).resolves.toEqual({ status: 'failure' })
    expect(error).toHaveBeenCalledWith('[activity] operation failed', {
      operation: 'record_day',
      code: 'PGRST500',
    })
    expect(JSON.stringify(error.mock.calls)).not.toContain('private')
  })
})

describe('loadPracticeActivitySummary', () => {
  it('returns a complete daily goal and local streak', async () => {
    const setup = setupClient({
      timezone: 'America/Los_Angeles',
      pages: [[{ local_date: '2026-08-27' }, { local_date: '2026-08-26' }]],
    })
    await expect(
      loadPracticeActivitySummary(
        setup.client as never,
        'user-1',
        new Date('2026-08-28T02:00:00.000Z'),
      ),
    ).resolves.toEqual({
      status: 'ready',
      data: {
        current: 2,
        todayActive: true,
        timezone: 'America/Los_Angeles',
        today: '2026-08-27',
        dailyGoal: 'complete',
      },
    })
  })

  it('keeps yesterday anchored while today is incomplete', async () => {
    const setup = setupClient({
      timezone: 'UTC',
      pages: [[{ local_date: '2026-08-27' }, { local_date: '2026-08-26' }]],
    })
    const result = await loadPracticeActivitySummary(
      setup.client as never,
      'user-1',
      new Date('2026-08-28T12:00:00.000Z'),
    )
    expect(result).toMatchObject({
      status: 'ready',
      data: { current: 2, todayActive: false, dailyGoal: 'incomplete' },
    })
  })
})
