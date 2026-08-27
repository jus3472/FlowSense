import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HistoryList } from '@/components/history/history-list'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { focusPhrase, sanitizeFocusAreas } from '@/lib/focus-areas'
import { parseHistoryQuery, type HistorySearchParams } from '@/lib/results/history'
import { loadHistoryPage, safeHistoryErrorCode } from '@/lib/results/history-server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'History',
}

export const dynamic = 'force-dynamic'

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<HistorySearchParams>
}) {
  const parsed = parseHistoryQuery(await searchParams)
  if (parsed.status === 'invalid') redirect('/history')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, historyResult] = await Promise.all([
    supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
    loadHistoryPage(supabase, user.id, parsed.query),
  ])

  const phrase = focusPhrase(sanitizeFocusAreas(profileResult.data?.focus_areas ?? []))
  if (profileResult.error) {
    console.error('[history] profile preferences failed', {
      code: safeHistoryErrorCode(profileResult.error),
    })
  }
  if (historyResult.status === 'failure') {
    console.error('[history] attempt query failed', {
      operation: historyResult.operation,
      code: safeHistoryErrorCode(historyResult.error),
    })
    return (
      <div className="flex flex-col gap-12 pt-4 pb-12">
        <h1 className="prompt-display text-foreground text-2xl">Your history</h1>
        <ErrorState
          title="Your history did not load"
          description="The connection to your account failed. Your responses are safe."
        >
          <RetryButton />
        </ErrorState>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-12 pt-4 pb-12">
      <h1 className="prompt-display text-foreground text-2xl">Your history</h1>
      <HistoryList
        entries={historyResult.data.entries}
        scoreSummary={historyResult.data.scoreSummary}
        focusPhrase={phrase}
        query={parsed.query}
        hasAnyEntries={historyResult.data.hasAnyEntries}
        hasPrevious={historyResult.data.hasPrevious}
        hasNext={historyResult.data.hasNext}
      />
    </div>
  )
}
