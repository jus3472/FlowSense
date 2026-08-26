import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RETRY_CTA = 'Try this prompt again'
const RETRY_URL = 'href={`/record?retry=${attempt.id}`}'
const retryActionSources = [
  'src/app/(app)/attempts/[id]/page.tsx',
  'src/components/results/results-view.tsx',
]

describe('same-prompt retry actions', () => {
  it('labels each same-prompt retry URL clearly', () => {
    for (const source of retryActionSources) {
      const contents = readFileSync(source, 'utf8')
      expect(contents).toContain(RETRY_URL)
      expect(contents).toContain(RETRY_CTA)
    }
  })
})
