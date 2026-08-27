import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HistoryList } from '@/components/history/history-list'
import { focusPhrase, sanitizeFocusAreas } from '@/lib/focus-areas'
import type { HistoryEntry } from '@/lib/results/history'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'History',
}

export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, attemptsResult] = await Promise.all([
    supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
    supabase
      .from('attempts')
      .select(
        'id, created_at, prompt_text, score, practice_mode, prompt_source, retry_of_attempt_id',
      )
      .eq('user_id', user.id)
      .not('score', 'is', null)
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  const phrase = focusPhrase(sanitizeFocusAreas(profileResult.data?.focus_areas ?? []))

  const entries: HistoryEntry[] = []
  for (const attempt of attemptsResult.data ?? []) {
    if (attempt.score === null) continue

    entries.push({
      id: attempt.id,
      createdAt: attempt.created_at,
      promptText: attempt.prompt_text,
      score: attempt.score,
      practiceMode: attempt.practice_mode,
      promptSource: attempt.prompt_source,
      retryOfAttemptId: attempt.retry_of_attempt_id,
    })
  }

  return (
    <div className="flex flex-col gap-12 pt-4 pb-12">
      <h1 className="prompt-display text-foreground text-2xl">Your history</h1>
      <HistoryList entries={entries} focusPhrase={phrase} />
    </div>
  )
}
