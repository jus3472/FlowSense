import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { getPromptById, getPromptLibrary } from '@/lib/prompts/server'

const PROMPT_ID = '11111111-1111-4111-8111-111111111111'
const MISSING_COLUMN = {
  code: '42703',
  message: 'column prompts.free_practice_visible does not exist',
}

function promptRow() {
  return {
    id: PROMPT_ID,
    text: 'Describe a place you know well.',
    active: true,
    mode: 'practice',
    difficulty: 'beginner',
    target_duration_seconds: 30,
    collection_id: 'spontaneous_description',
  }
}

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    filter: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.filter.mockReturnValue(builder)
  return builder
}

function clientFrom(...queries: ReturnType<typeof query>[]) {
  const client = { from: vi.fn(() => queries.shift()) }
  mocks.createClient.mockResolvedValue(client)
  return client
}

beforeEach(() => vi.clearAllMocks())

describe('Free Practice prompt server compatibility', () => {
  it('returns existing prompts against the pre-curriculum schema', async () => {
    const firstVisible = query({ data: null, error: MISSING_COLUMN })
    const legacy = query({ data: [promptRow()], error: null })
    const recheck = query({ data: null, error: MISSING_COLUMN })
    const client = clientFrom(firstVisible, legacy, recheck)

    await expect(getPromptLibrary()).resolves.toMatchObject({
      status: 'ready',
      data: [{ id: PROMPT_ID }],
    })
    expect(client.from).toHaveBeenCalledTimes(3)
    expect(legacy.filter).not.toHaveBeenCalled()
  })

  it('uses only visible prompts against the post-curriculum schema', async () => {
    const visible = query({ data: [promptRow()], error: null })
    const client = clientFrom(visible)

    await expect(getPromptLibrary()).resolves.toMatchObject({
      status: 'ready',
      data: [{ id: PROMPT_ID }],
    })
    expect(visible.filter).toHaveBeenCalledWith('free_practice_visible', 'eq', true)
    expect(client.from).toHaveBeenCalledOnce()
  })

  it('does not silently fall back for an unrelated database error', async () => {
    const denied = query({ data: null, error: { code: '42501', message: 'permission denied' } })
    const client = clientFrom(denied)

    await expect(getPromptLibrary()).resolves.toEqual({ status: 'failure' })
    expect(client.from).toHaveBeenCalledOnce()
  })

  it('keeps a hidden prompt unavailable through direct prompt selection', async () => {
    const hidden = query({ data: null, error: null })
    clientFrom(hidden)

    await expect(getPromptById(PROMPT_ID)).resolves.toEqual({ status: 'empty' })
    expect(hidden.filter).toHaveBeenCalledWith('free_practice_visible', 'eq', true)
  })
})
