import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const home = readFileSync('src/app/(app)/home/page.tsx', 'utf8')
const record = readFileSync('src/app/(app)/record/page.tsx', 'utf8')
const modePage = readFileSync('src/app/(app)/practice/[mode]/page.tsx', 'utf8')

describe('practice hub routes', () => {
  it('keeps the home fast start and browse path visible together', () => {
    expect(home).toContain('href={`/record?mode=${recommendedMode}`}')
    expect(home).toContain('Start a response')
    expect(home).toContain('href="/practice"')
    expect(home).toContain('Browse practice')
  })

  it('uses the server prompt service for mode browsing and validates its route segment', () => {
    expect(modePage).toContain("from '@/lib/prompts/server'")
    expect(modePage).toContain('parsePracticeMode')
    expect(modePage).toContain('if (!mode) notFound()')
    expect(modePage).not.toContain("from('prompts')")
  })

  it('fails closed for an explicit unavailable record prompt instead of randomizing', () => {
    expect(record).toContain('parseRecordPromptParam')
    expect(record).toContain('getPromptById(requestedPromptId)')
    expect(record).toContain('title="That prompt is not available"')
    expect(record.indexOf('requestedPromptId !== undefined')).toBeLessThan(
      record.indexOf('pickPracticePrompt({ mode })'),
    )
  })

  it('keeps filter controls and prompt actions mobile-stable and token based', () => {
    expect(modePage).toContain('flex flex-wrap gap-2')
    expect(modePage).toContain('min-h-11')
    expect(modePage).toContain('bg-surface-sunken')
    expect(modePage).toContain('text-foreground')
  })
})
