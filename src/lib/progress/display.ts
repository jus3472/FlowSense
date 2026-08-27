import type { ProgressSeries } from '@/lib/progress/aggregation'
import type { SkillCategory } from '@/lib/practice/contracts'

export function selectCategory(
  series: Readonly<Record<SkillCategory, ProgressSeries>>,
  descending: boolean,
): SkillCategory | null {
  return (
    (Object.keys(series) as SkillCategory[])
      .filter((key) => series[key].state === 'ready')
      .sort((a, b) => {
        const delta = (series[b].averageValue ?? 0) - (series[a].averageValue ?? 0)
        return (descending ? delta : -delta) || a.localeCompare(b)
      })[0] ?? null
  )
}
