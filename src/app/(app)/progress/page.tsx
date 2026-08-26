import { redirect } from 'next/navigation'
import { getV2Progress } from '@/lib/progress/server'
import { PRACTICE_MODES, SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import { createClient } from '@/lib/supabase/server'

const labels: Record<PracticeMode | SkillCategory, string> = { practice: 'Practice', interview: 'Interviews', presentation: 'Presentations', conversation: 'Conversations', fluency: 'Fluency', clarity: 'Clarity', vocabulary: 'Vocabulary', grammar: 'Grammar', structure: 'Structure', delivery: 'Delivery' }
export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) redirect('/login')
  const mode = (await searchParams).mode
  const selected = PRACTICE_MODES.includes(mode as PracticeMode) ? mode as PracticeMode : undefined
  const progress = await getV2Progress({ now: new Date(), mode: selected })
  const window = progress.windows.all
  const categoryValues = SKILL_CATEGORIES.map((category) => ({ category, value: window.categories[category].averageValue }))
  const scored = categoryValues.filter((item) => item.value !== null)
  const strongest = scored.toSorted((a, b) => b.value! - a.value!)[0]
  const needs = scored.toSorted((a, b) => a.value! - b.value!)[0]
  return <main className="flex flex-col gap-8 pb-12"><header><p className="section-label text-muted">Progress</p><h1 className="prompt-display text-foreground text-2xl">Your practice</h1></header><nav aria-label="Mode filters" className="flex flex-wrap gap-2">{['all', ...PRACTICE_MODES].map((value) => <a key={value} href={value === 'all' ? '/progress' : `/progress?mode=${value}`} className="bg-surface-sunken rounded-full px-4 py-2 text-sm">{value === 'all' ? 'All' : labels[value as PracticeMode]}</a>)}</nav><section className="bg-surface rounded-card p-5"><h2 className="text-foreground font-medium">Overall trend</h2>{window.overall.points.length < 2 ? <p className="text-muted mt-3 text-sm">Complete two compatible responses to see a trend.</p> : <p className="numeric text-foreground mt-3 text-2xl">{window.overall.points.map((point) => point.value).join(' → ')}</p>}</section><section className="grid gap-3 sm:grid-cols-2">{categoryValues.map(({ category, value }) => <div key={category} className="bg-surface rounded-card p-4"><p className="text-muted text-sm">{labels[category]}</p><p className="numeric text-foreground mt-2">{value === null ? 'Not enough data' : `${Math.round(value)} / 100`}</p></div>)}</section><section className="text-muted flex flex-col gap-2 text-sm">{strongest ? <p>Current strongest category: {labels[strongest.category]}</p> : null}{needs ? <p>Category needing the most practice: {labels[needs.category]}</p> : null}<p>Recent practice: {progress.windows.recent.attemptCount} response{progress.windows.recent.attemptCount === 1 ? '' : 's'} in 7 days.</p></section></main>
}
