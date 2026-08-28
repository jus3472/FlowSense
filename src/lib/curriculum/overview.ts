import {
  PATH_SLUGS,
  type CurriculumChapterDefinition,
  type CurriculumLessonDefinition,
  type CurriculumPathProgress,
  type PathSlug,
} from '@/lib/curriculum/contracts'

export type CurriculumPathSelection = 'primary' | 'selected' | 'available'

export interface CurriculumOverviewPath {
  progress: CurriculumPathProgress
  selection: CurriculumPathSelection
  preferenceRank: number | null
}

export interface CurriculumOverviewData {
  paths: readonly CurriculumOverviewPath[]
  usedDefaultPreference: boolean
}

export type CurriculumOverviewInputError = {
  kind: 'invalid_overview'
  code:
    | 'invalid_paths'
    | 'inactive_path'
    | 'invalid_preference_row'
    | 'invalid_preference_order'
    | 'unknown_preference_path'
}

export type CurriculumOverviewBuildOutcome =
  { ok: true; value: CurriculumOverviewData } | { ok: false; error: CurriculumOverviewInputError }

export interface CurriculumPreferenceRow {
  pathId: string
  rank: number
}

function failure(code: CurriculumOverviewInputError['code']): CurriculumOverviewBuildOutcome {
  return { ok: false, error: { kind: 'invalid_overview', code } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCurriculumPreferenceRows(
  value: unknown,
): readonly CurriculumPreferenceRow[] | null {
  if (!Array.isArray(value)) return null

  const rows: CurriculumPreferenceRow[] = []
  for (const row of value) {
    if (
      !isRecord(row) ||
      typeof row.path_id !== 'string' ||
      row.path_id.length === 0 ||
      !Number.isInteger(row.rank) ||
      (row.rank as number) < 0 ||
      (row.rank as number) >= PATH_SLUGS.length
    ) {
      return null
    }
    rows.push({ pathId: row.path_id, rank: row.rank as number })
  }
  return rows
}

/**
 * Applies preference ordering without changing progression. A truly empty set
 * receives the migration's General Speaking default; malformed rows fail closed.
 */
export function buildCurriculumOverview(
  pathProgress: readonly CurriculumPathProgress[],
  preferenceRows: readonly CurriculumPreferenceRow[],
): CurriculumOverviewBuildOutcome {
  if (!Array.isArray(pathProgress) || pathProgress.length !== PATH_SLUGS.length) {
    return failure('invalid_paths')
  }
  if (!Array.isArray(preferenceRows)) return failure('invalid_preference_row')

  const bySlug = new Map<PathSlug, CurriculumPathProgress>()
  const byId = new Map<string, CurriculumPathProgress>()
  for (const progress of pathProgress) {
    const slug = progress.path.slug
    if (!PATH_SLUGS.includes(slug) || bySlug.has(slug) || byId.has(progress.path.id)) {
      return failure('invalid_paths')
    }
    if (
      !progress.path.active ||
      progress.path.chapters.some(
        (chapter: CurriculumChapterDefinition) =>
          !chapter.active ||
          chapter.lessons.some((lesson: CurriculumLessonDefinition) => !lesson.active),
      )
    ) {
      return failure('inactive_path')
    }
    bySlug.set(slug, progress)
    byId.set(progress.path.id, progress)
  }
  if (PATH_SLUGS.some((slug) => !bySlug.has(slug))) return failure('invalid_paths')

  const usedDefaultPreference = preferenceRows.length === 0
  const general = bySlug.get('general-speaking')
  if (!general) return failure('invalid_paths')
  const effectivePreferences: readonly CurriculumPreferenceRow[] = usedDefaultPreference
    ? [{ pathId: general.path.id, rank: 0 }]
    : preferenceRows

  const selectedIds = new Set<string>()
  const selectedRanks = new Set<number>()
  for (const preference of effectivePreferences) {
    if (
      typeof preference.pathId !== 'string' ||
      preference.pathId.length === 0 ||
      !Number.isInteger(preference.rank) ||
      preference.rank < 0 ||
      preference.rank >= PATH_SLUGS.length
    ) {
      return failure('invalid_preference_row')
    }
    if (!byId.has(preference.pathId)) return failure('unknown_preference_path')
    if (selectedIds.has(preference.pathId) || selectedRanks.has(preference.rank)) {
      return failure('invalid_preference_order')
    }
    selectedIds.add(preference.pathId)
    selectedRanks.add(preference.rank)
  }
  for (let rank = 0; rank < effectivePreferences.length; rank += 1) {
    if (!selectedRanks.has(rank)) return failure('invalid_preference_order')
  }

  const selected: CurriculumOverviewPath[] = []
  for (const preference of [...effectivePreferences].sort(
    (left, right) => left.rank - right.rank,
  )) {
    const progress = byId.get(preference.pathId)
    if (!progress) return failure('unknown_preference_path')
    selected.push({
      progress,
      selection: preference.rank === 0 ? 'primary' : 'selected',
      preferenceRank: preference.rank,
    })
  }
  const available: CurriculumOverviewPath[] = []
  for (const slug of PATH_SLUGS) {
    const progress = bySlug.get(slug)
    if (!progress) return failure('invalid_paths')
    if (!selectedIds.has(progress.path.id)) {
      available.push({ progress, selection: 'available', preferenceRank: null })
    }
  }

  return {
    ok: true,
    value: { paths: [...selected, ...available], usedDefaultPreference },
  }
}
