import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HistoryList } from '@/components/history/history-list'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { PageTitle } from '@/components/ui/page-title'
import { PageShell } from '@/components/ui/page-shell'
import { focusPhrase, sanitizeFocusAreas } from '@/lib/focus-areas'
import { historyHref, parseHistoryQuery, type HistorySearchParams } from '@/lib/results/history'
import { loadHistoryPage, safeHistoryErrorCode } from '@/lib/results/history-server'
import { createClient } from '@/lib/supabase/server'
import { safeTimezone } from '@/lib/timezone'

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
  if (parsed.canonical) redirect(historyHref(parsed.query))
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, historyResult] = await Promise.all([
    supabase.from('profiles').select('focus_areas, timezone').eq('id', user.id).maybeSingle(),
    loadHistoryPage(supabase, user.id, parsed.query),
  ])

  const phrase = focusPhrase(sanitizeFocusAreas(profileResult.data?.focus_areas ?? []))
  const timezone = safeTimezone(profileResult.data?.timezone)
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
      <PageShell width="reading">
        <PageTitle>History</PageTitle>
        <ErrorState
          title="Your history did not load"
          description="The connection to your account failed. Your responses are safe."
        >
          <RetryButton />
        </ErrorState>
      </PageShell>
    )
  }

  return (
    <PageShell width="reading">
      <PageTitle>History</PageTitle>
      <HistoryList
        entries={historyResult.data.entries}
        focusPhrase={phrase}
        renderedAt={new Date().toISOString()}
        timezone={timezone}
        query={parsed.query}
        hasAnyEntries={historyResult.data.hasAnyEntries}
        hasPrevious={historyResult.data.hasPrevious}
        hasNext={historyResult.data.hasNext}
      />
    </PageShell>
  )
}
