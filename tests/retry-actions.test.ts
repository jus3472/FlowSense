import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RETRY_CTA = 'Try this prompt again'

describe('same-prompt retry actions', () => {
  it('labels retry actions and resolves generic and structured routes centrally', () => {
    const resultPage = readFileSync('src/app/(app)/attempts/[id]/page.tsx', 'utf8')
    const retryRoutes = readFileSync('src/lib/attempts/retry-href.ts', 'utf8')
    expect(resultPage).toContain('href={retryHref}')
    expect(resultPage).toContain(RETRY_CTA)
    expect(retryRoutes).toContain('`/record?retry=${encodeURIComponent(input.attemptId)}`')
    expect(retryRoutes).toContain('curriculumLessonRecordHref')
  })
})
