import { promptRowOutcome, promptRowsOutcome } from '@/lib/prompts/data'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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

  it('keeps recent completion on the isolated result-snapshot seam', () => {
    const source = readFileSync('src/lib/prompts/server.ts', 'utf8')
    expect(source).toContain("select('prompt_id, prompt_source, score, section_scores')")
    expect(source).toContain('recentCompletedLibraryPromptIds(data')
    expect(source).not.toContain(".not('score', 'is', null)")
  })
})
