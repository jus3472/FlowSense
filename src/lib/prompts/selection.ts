import {
  PRACTICE_MODES,
  PROMPT_DIFFICULTIES,
  type PracticeMode,
  type PromptDifficulty,
} from '@/lib/practice/contracts'
import { hasStoredScorePayload } from '@/lib/scoring/v2/assemble'

const PROMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COLLECTION_ID_PATTERN = /^[a-z]+(?:_[a-z]+)*$/

export interface LibraryPrompt {
  id: string
  text: string
  mode: PracticeMode
  difficulty: PromptDifficulty
  targetDurationSeconds: number
  collectionId: string | null
}

export interface PromptLibraryFilters {
  mode?: PracticeMode
  difficulty?: PromptDifficulty
  collectionId?: string
  /** Category is the public selection alias for the stored `collection_id`. */
  category?: string
  excludeIds?: readonly string[]
}

export interface PromptCollection {
  id: string
  mode: PracticeMode
  promptCount: number
}

export interface PromptBrowseData {
  prompts: LibraryPrompt[]
  collections: PromptCollection[]
  recommended: LibraryPrompt | null
}

export interface RecentPromptAttempt {
  prompt_id?: unknown
  prompt_source?: unknown
  score?: unknown
  section_scores?: unknown
}

export type RandomSource = () => number

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

export function isPromptId(value: string): boolean {
  return PROMPT_ID_PATTERN.test(value)
}

export function isPromptCollectionId(value: string): boolean {
  return COLLECTION_ID_PATTERN.test(value)
}

/** Converts untrusted database data to the minimal DTO the UI may receive. */
export function parseLibraryPrompt(value: unknown): LibraryPrompt | null {
  if (!isRecord(value)) return null

  const {
    id,
    text,
    mode,
    difficulty,
    target_duration_seconds: duration,
    collection_id: collectionId,
  } = value
  if (
    typeof id !== 'string' ||
    !isPromptId(id) ||
    typeof text !== 'string' ||
    text.trim().length === 0 ||
    !includes(PRACTICE_MODES, mode) ||
    !includes(PROMPT_DIFFICULTIES, difficulty) ||
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < 15 ||
    duration > 600 ||
    (collectionId !== null &&
      (typeof collectionId !== 'string' || !isPromptCollectionId(collectionId)))
  ) {
    return null
  }

  return {
    id,
    text: text.trim(),
    mode,
    difficulty,
    targetDurationSeconds: duration,
    collectionId,
  }
}

function selectedCollection(filters: PromptLibraryFilters): string | null | undefined {
  const collectionId = filters.collectionId?.trim()
  const category = filters.category?.trim()
  if (collectionId && category && collectionId !== category) return null
  return collectionId || category
}

/** Filters active, well-formed stored rows without depending on the database adapter. */
export function filterPromptLibrary(
  rows: readonly unknown[],
  filters: PromptLibraryFilters = {},
): LibraryPrompt[] {
  const collectionId = selectedCollection(filters)
  if (collectionId === null) return []

  const excluded = new Set(filters.excludeIds ?? [])
  return rows.flatMap((row) => {
    if (!isRecord(row) || row.active !== true) return []
    const prompt = parseLibraryPrompt(row)
    if (!prompt || excluded.has(prompt.id)) return []
    if (filters.mode && prompt.mode !== filters.mode) return []
    if (filters.difficulty && prompt.difficulty !== filters.difficulty) return []
    if (collectionId && prompt.collectionId !== collectionId) return []
    return [prompt]
  })
}

export function filterParsedPromptLibrary(
  prompts: readonly LibraryPrompt[],
  filters: PromptLibraryFilters = {},
): LibraryPrompt[] {
  const collectionId = selectedCollection(filters)
  if (collectionId === null) return []

  const excluded = new Set(filters.excludeIds ?? [])
  return prompts.filter((prompt) => {
    if (excluded.has(prompt.id)) return false
    if (filters.mode && prompt.mode !== filters.mode) return false
    if (filters.difficulty && prompt.difficulty !== filters.difficulty) return false
    if (collectionId && prompt.collectionId !== collectionId) return false
    return true
  })
}

export function derivePromptCollections(prompts: readonly LibraryPrompt[]): PromptCollection[] {
  const counts = new Map<string, PromptCollection>()
  for (const prompt of prompts) {
    if (!prompt.collectionId) continue
    const key = `${prompt.mode}:${prompt.collectionId}`
    const current = counts.get(key)
    if (current) {
      current.promptCount += 1
    } else {
      counts.set(key, { id: prompt.collectionId, mode: prompt.mode, promptCount: 1 })
    }
  }

  return [...counts.values()].sort(
    (left, right) => left.mode.localeCompare(right.mode) || left.id.localeCompare(right.id),
  )
}

/** Chooses one candidate with an injectable source for deterministic tests. */
export function choosePrompt(
  candidates: readonly LibraryPrompt[],
  random: RandomSource = Math.random,
): LibraryPrompt | null {
  if (candidates.length === 0) return null

  const value = random()
  const index = Number.isFinite(value)
    ? Math.min(candidates.length - 1, Math.max(0, Math.floor(value * candidates.length)))
    : 0
  return candidates[index] ?? null
}

/** Chooses from the first preferred mode that has a valid prompt. */
export function choosePromptByModePriority(
  candidates: readonly LibraryPrompt[],
  modes: readonly PracticeMode[],
  random: RandomSource = Math.random,
): LibraryPrompt | null {
  for (const mode of [...new Set<PracticeMode>([...modes, 'practice'])]) {
    const prompt = choosePrompt(
      candidates.filter((candidate) => candidate.mode === mode),
      random,
    )
    if (prompt) return prompt
  }
  return null
}

/** Prefers a prompt outside the recent set, then deterministically reuses the full pool. */
export function choosePromptWithRecentFallback(
  candidates: readonly LibraryPrompt[],
  excludeIds: readonly string[],
  random: RandomSource = Math.random,
): LibraryPrompt | null {
  const excluded = new Set(excludeIds)
  const freshCandidates = candidates.filter((candidate) => !excluded.has(candidate.id))
  return choosePrompt(freshCandidates.length > 0 ? freshCandidates : candidates, random)
}

/** Applies mode priority to fresh prompts first and only reuses once that pool is exhausted. */
export function choosePromptByModePriorityWithRecentFallback(
  candidates: readonly LibraryPrompt[],
  modes: readonly PracticeMode[],
  excludeIds: readonly string[],
  random: RandomSource = Math.random,
): LibraryPrompt | null {
  const excluded = new Set(excludeIds)
  const freshCandidates = candidates.filter((candidate) => !excluded.has(candidate.id))
  return choosePromptByModePriority(
    freshCandidates.length > 0 ? freshCandidates : candidates,
    modes,
    random,
  )
}

/** Derives a complete mode-browse view from one coherent prompt snapshot. */
export function buildPromptBrowseData(
  prompts: readonly LibraryPrompt[],
  filters: Pick<PromptLibraryFilters, 'mode' | 'difficulty' | 'collectionId'>,
  recentPromptIds: readonly string[],
  random: RandomSource = Math.random,
): PromptBrowseData {
  const modePrompts = filterParsedPromptLibrary(prompts, { mode: filters.mode })
  const collections = derivePromptCollections(
    filterParsedPromptLibrary(modePrompts, { difficulty: filters.difficulty }),
  )
  const visiblePrompts = filterParsedPromptLibrary(modePrompts, filters)

  return {
    prompts: visiblePrompts,
    collections,
    recommended: choosePromptWithRecentFallback(visiblePrompts, recentPromptIds, random),
  }
}

/** Extracts recent completed, owned library prompt identifiers in query order. */
export function recentCompletedLibraryPromptIds(
  attempts: readonly RecentPromptAttempt[],
  limit = 8,
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const attempt of attempts) {
    const isLibraryAttempt = attempt.prompt_source === 'library' || attempt.prompt_source === null
    if (
      !isLibraryAttempt ||
      !isCompletedPromptAttempt(attempt) ||
      typeof attempt.prompt_id !== 'string' ||
      !isPromptId(attempt.prompt_id) ||
      seen.has(attempt.prompt_id)
    ) {
      continue
    }
    seen.add(attempt.prompt_id)
    ids.push(attempt.prompt_id)
    if (ids.length >= limit) break
  }
  return ids
}

/** Interim completion seam until the lifecycle migration can switch this to `status = done`. */
export function isCompletedPromptAttempt(attempt: RecentPromptAttempt): boolean {
  return (
    (typeof attempt.score === 'number' && Number.isFinite(attempt.score)) ||
    hasStoredScorePayload(attempt.section_scores)
  )
}
