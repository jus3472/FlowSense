import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const home = readFileSync('src/app/(app)/home/page.tsx', 'utf8')
const record = readFileSync('src/app/(app)/record/page.tsx', 'utf8')
const modePage = readFileSync('src/app/(app)/practice/[mode]/page.tsx', 'utf8')
const overview = readFileSync('src/components/curriculum/practice-overview.tsx', 'utf8')
const recordFlow = readFileSync('src/components/record/record-flow.tsx', 'utf8')

describe('practice hub routes', () => {
  it('keeps Home focused while Tracks exposes Practice and Custom Prompt', () => {
    expect(home).toContain('HomePrimaryPath')
    expect(home).not.toContain('HomeOtherPractice')
    expect(home).not.toContain('Latest response')
    expect(overview).toContain('Practice')
    expect(overview).toContain('practiceBrowseHref(option.mode)')
    expect(overview).toContain('Custom Prompt')
    expect(overview).toContain('href="/practice/custom"')
  })

  it('uses the server prompt service for mode browsing and validates its route segment', () => {
    expect(modePage).toContain("from '@/lib/prompts/server'")
    expect(modePage).toContain('parsePracticeMode')
    expect(modePage).toContain('if (!mode) notFound()')
    expect(modePage).toContain('href={practiceBrowseHref(mode)}')
    expect(modePage).not.toContain('href={`/practice/${mode}`}')
    expect(modePage).toContain('getPromptBrowseData(')
    expect(modePage).not.toContain('Choose a prompt, or start with one selected for you.')
    expect(modePage).not.toContain('getPromptCollections(')
    expect(modePage).not.toContain('getPromptLibrary(')
    expect(modePage).not.toContain('pickPracticePrompt(')
    expect(modePage).not.toContain("from('prompts')")
  })

  it('fails closed for explicit unavailable prompt and retry intent instead of randomizing', () => {
    expect(record).toContain("export const dynamic = 'force-dynamic'")
    expect(record).toContain('resolveLibraryPromptSession(params.prompt, getPromptById)')
    expect(record).toContain('resolveExplicitRetryIntent(params')
    expect(record).toContain('title="That prompt is not available"')
    expect(record).toContain('title="That retry is not available"')
    expect(record.indexOf('resolveExplicitRetryIntent(params')).toBeLessThan(
      record.indexOf('pickRecordPrompt('),
    )
    expect(record.indexOf('resolveLibraryPromptSession(params.prompt')).toBeLessThan(
      record.indexOf('pickRecordPrompt('),
    )
  })

  it('keeps explicit modes exact and leaves prompt selection outside Home', () => {
    expect(record).toContain('pickRecordPrompt(')
    expect(record).toContain('requestedMode,')
    expect(record).not.toContain("recentPromptIdsResult.status === 'failure'")
    expect(modePage).toContain('const browseOutcome = await getPromptBrowseData(')
    expect(home).not.toContain('loadHomeResponseData')
    expect(home).not.toContain('pickPreferredPracticePrompt')
    expect(home).not.toContain('recordHrefForPrompt')
  })

  it('bypasses the removed ready screen and starts the shared recording flow on arrival', () => {
    expect(recordFlow).toContain('void start()')
    expect(recordFlow).not.toContain('ReadyStep')
    expect(recordFlow).not.toContain('One prompt, 60 seconds')
    expect(recordFlow).not.toContain("I'm ready")
  })

  it('keeps filter controls and prompt actions mobile-stable and token based', () => {
    const filters = readFileSync('src/components/practice/prompt-filters.tsx', 'utf8')
    expect(filters).toContain('flex flex-wrap gap-2')
    expect(filters).toContain('min-h-11')
    expect(filters).toContain('bg-surface-sunken')
    expect(filters).toContain('aria-current')
    expect(filters).toContain('Clear collection')
    expect(modePage).toContain('text-foreground')
  })

  it('renders query failures separately from a legitimate empty prompt pool', () => {
    expect(modePage).toContain("browseOutcome.status === 'failure'")
    expect(modePage).toContain('The prompt library did not load')
    expect(modePage).toContain('No prompts match these choices')
    expect(modePage).toContain('<RetryButton />')
  })
})
