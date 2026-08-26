import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PROMPT_DIFFICULTIES } from '@/lib/practice/contracts'
import {
  collectionLabel,
  formatExpectedDuration,
  parsePracticeBrowseParams,
  parsePracticeMode,
  practiceBrowseHref,
  recordHrefForPrompt,
} from '@/lib/practice/navigation'
import { getPromptCollections, getPromptLibrary, pickPracticePrompt } from '@/lib/prompts/server'

export const metadata: Metadata = {
  title: 'Practice',
}

function modeTitle(mode: string): string {
  return mode === 'practice'
    ? 'General Practice'
    : `${mode.slice(0, 1).toUpperCase()}${mode.slice(1)}s`
}

export default async function PracticeModePage({
  params,
  searchParams,
}: {
  params: Promise<{ mode: string }>
  searchParams: Promise<{ difficulty?: string | string[]; collection?: string | string[] }>
}) {
  const mode = parsePracticeMode((await params).mode)
  if (!mode) notFound()

  const filters = parsePracticeBrowseParams(await searchParams)
  const promptFilters = { mode, ...filters }
  const [prompts, collections, recommended] = await Promise.all([
    getPromptLibrary(promptFilters),
    getPromptCollections({ mode, difficulty: filters.difficulty }),
    pickPracticePrompt(promptFilters),
  ])

  return (
    <div className="flex flex-col gap-8 pt-4 pb-12">
      <div className="flex flex-col gap-2">
        <Link href="/practice" className="text-accent text-sm hover:underline">
          Practice
        </Link>
        <h1 className="prompt-display text-foreground text-2xl">{modeTitle(mode)}</h1>
        <p className="text-muted text-base">Choose a prompt, or start with one selected for you.</p>
      </div>

      {recommended ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="section-label text-muted">Recommended</p>
            <p className="text-foreground text-lg">{recommended.text}</p>
            <p className="text-muted text-sm">
              {formatExpectedDuration(recommended.targetDurationSeconds)}
            </p>
          </div>
          <ButtonLink href={recordHrefForPrompt(recommended.id)} fullWidth>
            Start this prompt
          </ButtonLink>
        </Card>
      ) : null}

      <section aria-labelledby="difficulty-heading" className="flex flex-col gap-3">
        <h2 id="difficulty-heading" className="section-label text-muted">
          Difficulty
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href={practiceBrowseHref(mode, { collectionId: filters.collectionId })}
            className="bg-surface-sunken text-foreground hover:bg-accent-soft flex min-h-11 items-center rounded-full px-6 text-sm font-medium"
          >
            All levels
          </Link>
          {PROMPT_DIFFICULTIES.map((difficulty) => (
            <Link
              key={difficulty}
              href={practiceBrowseHref(mode, { difficulty, collectionId: filters.collectionId })}
              className="bg-surface-sunken text-foreground hover:bg-accent-soft flex min-h-11 items-center rounded-full px-6 text-sm font-medium"
            >
              {difficulty.slice(0, 1).toUpperCase() + difficulty.slice(1)}
            </Link>
          ))}
        </div>
      </section>

      {collections.length > 0 ? (
        <section aria-labelledby="collections-heading" className="flex flex-col gap-3">
          <h2 id="collections-heading" className="section-label text-muted">
            Collections
          </h2>
          <div className="flex flex-wrap gap-2">
            {collections.map((collection) => (
              <Link
                key={collection.id}
                href={practiceBrowseHref(mode, {
                  difficulty: filters.difficulty,
                  collectionId: collection.id,
                })}
                className="bg-surface-sunken text-foreground hover:bg-accent-soft flex min-h-11 items-center rounded-full px-6 text-sm font-medium"
              >
                {collectionLabel(collection.id)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="prompts-heading" className="flex flex-col gap-4">
        <h2 id="prompts-heading" className="section-label text-muted">
          Prompts
        </h2>
        {prompts.length === 0 ? (
          <EmptyState
            title="No prompts match these choices"
            description="Choose another difficulty or collection."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {prompts.map((prompt) => (
              <Card key={prompt.id} className="flex flex-col gap-3">
                <p className="text-foreground text-base">{prompt.text}</p>
                <div className="text-muted flex flex-wrap items-center gap-2 text-sm">
                  <span>{prompt.difficulty}</span>
                  <span aria-hidden="true">•</span>
                  <span>{formatExpectedDuration(prompt.targetDurationSeconds)}</span>
                </div>
                <ButtonLink href={recordHrefForPrompt(prompt.id)} variant="secondary" fullWidth>
                  Choose this prompt
                </ButtonLink>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
