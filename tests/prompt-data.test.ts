import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dataEmpty, dataFailure, dataReady } from '@/lib/data/outcome'
import { promptRowOutcome, promptRowsOutcome, recentPromptIdsOrEmpty } from '@/lib/prompts/data'

const PROMPT_ID = '11111111-1111-4111-8111-111111111111'

function promptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMPT_ID,
    text: 'Describe a place you know well.',
    active: true,
    mode: 'practice',
    difficulty: 'beginner',
    target_duration_seconds: 30,
    collection_id: 'spontaneous_description',
    free_practice_visible: true,
    ...overrides,
  }
}

describe('prompt data outcomes', () => {
  it('keeps query failure distinct from a legitimate empty result', () => {
    expect(promptRowsOutcome([], true)).toEqual({ status: 'failure' })
    expect(promptRowsOutcome([], false)).toEqual({ status: 'empty' })
    expect(promptRowOutcome(null, true)).toEqual({ status: 'failure' })
    expect(promptRowOutcome(null, false)).toEqual({ status: 'empty' })
  })

  it('treats failed or empty recent history as an optional empty exclusion set', () => {
    expect(recentPromptIdsOrEmpty(dataFailure())).toEqual([])
    expect(recentPromptIdsOrEmpty(dataEmpty())).toEqual([])
    expect(recentPromptIdsOrEmpty(dataReady([PROMPT_ID]))).toEqual([PROMPT_ID])
  })

  it('returns validated prompt data only for a complete stable schema row', () => {
    expect(promptRowsOutcome([promptRow()], false)).toMatchObject({
      status: 'ready',
      data: [{ id: PROMPT_ID, mode: 'practice', difficulty: 'beginner' }],
    })
    expect(promptRowsOutcome([promptRow({ difficulty: null })], false)).toEqual({
      status: 'failure',
    })
    expect(promptRowsOutcome(null, false)).toEqual({ status: 'failure' })
  })

  it('does not hide a malformed row inside an otherwise valid result', () => {
    expect(promptRowsOutcome([promptRow(), promptRow({ id: 'invalid' })], false)).toEqual({
      status: 'failure',
    })
  })

  it('rejects curriculum-only prompts at the Free Practice data boundary', () => {
    expect(promptRowsOutcome([promptRow({ free_practice_visible: false })], false)).toEqual({
      status: 'failure',
    })
    expect(promptRowOutcome(promptRow({ free_practice_visible: false }), false)).toEqual({
      status: 'failure',
    })
  })

  it('loads recent exclusions only from completed lifecycle rows', () => {
    const source = readFileSync('src/lib/prompts/server.ts', 'utf8')
    expect(source).toContain("select('prompt_id, prompt_source, status')")
    expect(source).toContain(".eq('status', 'done')")
    expect(source).toContain('recentCompletedLibraryPromptIds(data')
    expect(source).not.toContain(".not('score', 'is', null)")
    expect(source.match(/\.eq\('free_practice_visible', true\)/g)).toHaveLength(2)
  })
})
