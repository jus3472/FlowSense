import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('completed attempt query boundaries', () => {
  it('requires done status for Progress and removes the temporary lifecycle seam', () => {
    const progress = source('src/lib/progress/server.ts')

    expect(progress).toContain('retry_of_attempt_id, status')
    expect(progress.match(/\.eq\('status', 'done'\)/g)).toHaveLength(1)
    expect(progress).not.toContain('Task B')
  })

  it('requires done status for prompt recency, Home history, and latest response', () => {
    const prompts = source('src/lib/prompts/server.ts')
    const home = source('src/lib/home/server.ts')

    expect(prompts).toContain("select('prompt_id, prompt_source, status')")
    expect(prompts.match(/\.eq\('status', 'done'\)/g)).toHaveLength(1)
    expect(home.match(/\.eq\('status', 'done'\)/g)).toHaveLength(1)
    expect(home).not.toContain('score.not.is.null')
    expect(home).not.toContain('section_scores.not.is.null')
  })

  it('lists terminal History rows but keeps its score cohort done-only', () => {
    const history = source('src/lib/results/history-server.ts')

    expect(history.match(/\.eq\('status', 'done'\)/g)).toHaveLength(1)
    expect(history.match(/\.in\('status', \['done', 'failed', 'timed_out'\]\)/g)).toHaveLength(2)
    expect(history).not.toContain('score.not.is.null')
    expect(history).not.toContain('section_scores.not.is.null')
  })

  it('does not hide an explicitly opened owned result behind completion status', () => {
    const resultPage = source('src/app/(app)/attempts/[id]/page.tsx')

    expect(resultPage).toContain(".eq('user_id', user.id)")
    expect(resultPage).not.toContain(".eq('status', 'done')")
  })
})
