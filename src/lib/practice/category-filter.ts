import type { PracticeCategory } from '@/lib/practice/category'

export type ResponseCategoryFilter = 'all' | 'custom' | PracticeCategory

/** Apply category semantics before pagination. JSONB metadata never changes scoring mode. */
export function applyResponseCategoryFilter<T>(
  query: T,
  category: ResponseCategoryFilter,
  includeLegacyGeneral = false,
): T {
  const filter = query as T & {
    eq(column: string, value: string): T
    or(filters: string): T
  }
  if (category === 'all') return query
  if (category === 'custom') return filter.eq('prompt_source', 'custom')
  if (category === 'other') {
    return applyOtherCategoryFilter(filter)
  }
  if (category !== 'practice') return filter.eq('practice_mode', category)

  const general = (
    includeLegacyGeneral
      ? filter.or('practice_mode.eq.practice,practice_mode.is.null')
      : filter.eq('practice_mode', 'practice')
  ) as typeof filter
  // SQL nulls must be included explicitly. Old rows without a category keep their mode.
  return general.or(
    'practice_mode.is.null,prompt_source.is.null,prompt_source.neq.custom,metrics->practice->>category.is.null,metrics->practice->>category.neq.other',
  )
}

function applyOtherCategoryFilter<T>(query: T & { eq(column: string, value: string): T }): T {
  const source = query.eq('prompt_source', 'custom') as typeof query
  const mode = source.eq('practice_mode', 'practice') as typeof query
  return mode.eq('metrics->practice->>category', 'other')
}
