import {
  PATH_MODES,
  PATH_POSITIONS,
  PATH_SLUGS,
  type PathSlug,
} from '@/lib/curriculum/contracts'
import { parseCurriculumPreferenceRows } from '@/lib/curriculum/overview'
import { sanitizeFocusAreas } from '@/lib/focus-areas'

export const DEFAULT_PRIMARY_PATH: PathSlug = 'general-speaking'

export interface PathPreferenceOption {
  id: string
  slug: PathSlug
  title: string
}

export interface LoadedPathPreferences {
  paths: readonly PathPreferenceOption[]
  primarySlug: PathSlug
  secondarySlugs: readonly PathSlug[]
  usedDefaultPreference: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPathSlug(value: unknown): value is PathSlug {
  return typeof value === 'string' && PATH_SLUGS.includes(value as PathSlug)
}

/** Validates the complete active path catalog before it reaches a preference form. */
export function parsePathPreferenceOptions(value: unknown): readonly PathPreferenceOption[] | null {
  if (!Array.isArray(value) || value.length !== PATH_SLUGS.length) return null

  const bySlug = new Map<PathSlug, PathPreferenceOption>()
  const ids = new Set<string>()
  for (const row of value) {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      row.id.length === 0 ||
      !isPathSlug(row.slug) ||
      typeof row.title !== 'string' ||
      row.title.length === 0 ||
      row.active !== true ||
      row.mode !== PATH_MODES[row.slug] ||
      row.position !== PATH_POSITIONS[row.slug] ||
      ids.has(row.id) ||
      bySlug.has(row.slug)
    ) {
      return null
    }
    ids.add(row.id)
    bySlug.set(row.slug, { id: row.id, slug: row.slug, title: row.title })
  }

  const ordered = PATH_SLUGS.map((slug) => bySlug.get(slug))
  return ordered.every((path): path is PathPreferenceOption => Boolean(path)) ? ordered : null
}

/** Applies owner preference rows without mutating the safe General Speaking fallback. */
export function buildLoadedPathPreferences(
  pathRows: unknown,
  preferenceRows: unknown,
): LoadedPathPreferences | null {
  const paths = parsePathPreferenceOptions(pathRows)
  const preferences = parseCurriculumPreferenceRows(preferenceRows)
  if (!paths || !preferences) return null

  const slugById = new Map(paths.map((path) => [path.id, path.slug]))
  const usedDefaultPreference = preferences.length === 0
  if (usedDefaultPreference) {
    return {
      paths,
      primarySlug: DEFAULT_PRIMARY_PATH,
      secondarySlugs: [],
      usedDefaultPreference: true,
    }
  }

  const ordered = [...preferences].sort((left, right) => left.rank - right.rank)
  if (ordered.some((preference, index) => preference.rank !== index)) return null

  const selected = new Set<PathSlug>()
  const slugs: PathSlug[] = []
  for (const preference of ordered) {
    const slug = slugById.get(preference.pathId)
    if (!slug || selected.has(slug)) return null
    selected.add(slug)
    slugs.push(slug)
  }
  const primarySlug = slugs[0]
  if (!primarySlug) return null

  return {
    paths,
    primarySlug,
    secondarySlugs: slugs.slice(1),
    usedDefaultPreference: false,
  }
}

/** Parses the exact ordered preference payload accepted by the atomic RPC. */
export function parseSubmittedPathPreferences(
  primaryValue: unknown,
  secondaryValues: readonly unknown[],
): readonly PathSlug[] | null {
  if (!isPathSlug(primaryValue)) return null

  const seen = new Set<PathSlug>([primaryValue])
  const secondaries: PathSlug[] = []
  for (const value of secondaryValues) {
    if (!isPathSlug(value) || seen.has(value)) return null
    seen.add(value)
    secondaries.push(value)
  }
  return [primaryValue, ...secondaries]
}

export function samePathPreferenceOrder(
  loaded: LoadedPathPreferences,
  expected: readonly PathSlug[],
): boolean {
  const actual = [loaded.primarySlug, ...loaded.secondarySlugs]
  return actual.length === expected.length && actual.every((slug, index) => slug === expected[index])
}

const LEGACY_FOCUS_BY_PATH: Readonly<Record<PathSlug, string>> = {
  'general-speaking': 'general-speaking',
  interviews: 'interviews',
  presentations: 'presentations',
  conversations: 'meetings-conversations',
}

/** Keeps new onboarding choices useful to legacy Free Practice suggestions. */
export function legacyFocusAreasForPaths(orderedSlugs: readonly PathSlug[]): readonly string[] {
  return sanitizeFocusAreas(orderedSlugs.map((slug) => LEGACY_FOCUS_BY_PATH[slug]))
}
