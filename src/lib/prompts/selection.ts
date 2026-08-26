import {
  PRACTICE_MODES,
  PROMPT_DIFFICULTIES,
  type PracticeMode,
  type PromptDifficulty,
} from '@/lib/practice/contracts'

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

/** Converts untrusted database data to the minimal DTO the UI may receive. */
export function parseLibraryPrompt(value: unknown): LibraryPrompt | null {
  if (!isRecord(value)) return null

  const { id, text, mode, difficulty, target_duration_seconds: duration, collection_id: collectionId } = value
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
      (typeof collectionId !== 'string' || !COLLECTION_ID_PATTERN.test(collectionId)))
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
