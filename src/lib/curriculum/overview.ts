import {
  PATH_SLUGS,
  type CurriculumChapterDefinition,
  type CurriculumLessonDefinition,
  type CurriculumPathProgress,
  type PathSlug,
} from '@/lib/curriculum/contracts'

export interface CurriculumOverviewPath {
  progress: CurriculumPathProgress
}

export interface CurriculumOverviewData {
  paths: readonly CurriculumOverviewPath[]
}

export type CurriculumOverviewInputError = {
  kind: 'invalid_overview'
  code: 'invalid_paths' | 'inactive_path' | 'invalid_preference_row'
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
 * Builds the Home overview in the product's canonical track order. Historical
 * path preferences remain stored for backwards compatibility, but no longer
 * organize Home or change which tracks are available.
 */
export function buildCurriculumOverview(
  pathProgress: readonly CurriculumPathProgress[],
  _legacyPreferenceRows?: readonly CurriculumPreferenceRow[],
): CurriculumOverviewBuildOutcome {
  if (!Array.isArray(pathProgress) || pathProgress.length !== PATH_SLUGS.length) {
    return failure('invalid_paths')
  }
  const bySlug = new Map<PathSlug, CurriculumPathProgress>()
  const pathIds = new Set<string>()
  for (const progress of pathProgress) {
    const slug = progress.path.slug
    if (!PATH_SLUGS.includes(slug) || bySlug.has(slug) || pathIds.has(progress.path.id)) {
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
    pathIds.add(progress.path.id)
  }
  if (PATH_SLUGS.some((slug) => !bySlug.has(slug))) return failure('invalid_paths')

  return {
    ok: true,
    value: {
      paths: PATH_SLUGS.map((slug) => ({ progress: bySlug.get(slug) as CurriculumPathProgress })),
    },
  }
}
