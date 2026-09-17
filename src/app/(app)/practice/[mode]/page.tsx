import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PromptFilters } from '@/components/practice/prompt-filters'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import {
  formatExpectedDuration,
  parsePracticeBrowseParams,
  parsePracticeMode,
  practiceBrowseHref,
  recordHrefForPrompt,
} from '@/lib/practice/navigation'
import { recentPromptIdsOrEmpty } from '@/lib/prompts/data'
import { getPromptBrowseData, getRecentCompletedLibraryPromptIds } from '@/lib/prompts/server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Practice',
}

function modeTitle(mode: string): string {
  return mode === 'practice'
    ? 'General Practice'
    : `${mode.slice(0, 1).toUpperCase()}${mode.slice(1)}s`
}

function ModeHeader({ mode }: { mode: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Link href="/home" className="text-accent-ink text-sm hover:underline">
        Home
      </Link>
      <PageTitle>{modeTitle(mode)}</PageTitle>
    </div>
  )
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

  const parsedFilters = parsePracticeBrowseParams(await searchParams)
  if (parsedFilters.status === 'invalid') {
    return (
      <PageShell width="reading" className="gap-8">
        <ModeHeader mode={mode} />
        <ErrorState
          title="Those filters are not available"
          description="Clear the filters and choose from the current practice library."
        >
          <ButtonLink href={practiceBrowseHref(mode)} variant="secondary">
            Clear filters
          </ButtonLink>
        </ErrorState>
      </PageShell>
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const recentPromptIdsOutcome = await getRecentCompletedLibraryPromptIds(user.id)
  const browseOutcome = await getPromptBrowseData(
    { mode, ...parsedFilters.filters },
    recentPromptIdsOrEmpty(recentPromptIdsOutcome),
  )

  if (browseOutcome.status === 'failure') {
    return (
      <PageShell width="reading" className="gap-8">
        <ModeHeader mode={mode} />
        <ErrorState
          title="The prompt library did not load"
          description="The connection to the practice library failed. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      </PageShell>
    )
  }

  const browse =
    browseOutcome.status === 'ready'
      ? browseOutcome.data
      : { prompts: [], collections: [], recommended: null }
  const { difficulty, collectionId } = parsedFilters.filters

  return (
    <PageShell width="reading" className="gap-8">
      <ModeHeader mode={mode} />

      {browse.recommended ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="section-label text-muted">Recommended</p>
            <p className="text-foreground text-lg">{browse.recommended.text}</p>
            <p className="text-muted text-sm">
              {formatExpectedDuration(browse.recommended.targetDurationSeconds)}
            </p>
          </div>
          <ButtonLink href={recordHrefForPrompt(browse.recommended.id)} fullWidth>
            Start this prompt
          </ButtonLink>
        </Card>
      ) : null}

      <PromptFilters
        mode={mode}
        difficulty={difficulty}
        collectionId={collectionId}
        collections={browse.collections}
      />

      <section aria-labelledby="prompts-heading" className="flex flex-col gap-4">
        <h2 id="prompts-heading" className="section-label text-muted">
          Prompts
        </h2>
        {browse.prompts.length === 0 ? (
          <EmptyState
            title="No prompts match these choices"
            description="Choose another difficulty or collection."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {browse.prompts.map((prompt) => (
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
    </PageShell>
  )
}
