import 'server-only'

import type { PracticeMode, PromptDifficulty } from '@/lib/practice/contracts'
import {
  choosePrompt,
  choosePromptByModePriority,
  derivePromptCollections,
  filterPromptLibrary,
  isPromptId,
  parseLibraryPrompt,
  type LibraryPrompt,
  type PromptCollection,
  type PromptLibraryFilters,
  type RandomSource,
} from '@/lib/prompts/selection'
import { createClient } from '@/lib/supabase/server'

export type PromptQuery = Omit<PromptLibraryFilters, 'excludeIds'>

const PROMPT_COLUMNS = 'id, text, active, mode, difficulty, target_duration_seconds, collection_id'

function collectionFilter(query: PromptQuery): string | null | undefined {
  const collectionId = query.collectionId?.trim()
  const category = query.category?.trim()
  if (collectionId && category && collectionId !== category) return null
  return collectionId || category
}

/** Reads active prompt rows only. Selection stays in the pure module above. */
async function loadActivePromptRows(query: PromptQuery = {}): Promise<unknown[]> {
  const collectionId = collectionFilter(query)
  if (collectionId === null) return []

  const supabase = await createClient()
  let request = supabase.from('prompts').select(PROMPT_COLUMNS).eq('active', true)
  if (query.mode) request = request.eq('mode', query.mode)
  if (query.difficulty) request = request.eq('difficulty', query.difficulty)
  if (collectionId) request = request.eq('collection_id', collectionId)

  const { data, error } = await request
  if (error || !data) return []
  return data
}

export async function getPromptById(id: string): Promise<LibraryPrompt | null> {
  if (!isPromptId(id)) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prompts')
    .select(PROMPT_COLUMNS)
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  if (error || !data || data.active !== true) return null
  return parseLibraryPrompt(data)
}

export async function getPromptLibrary(
  filters: PromptLibraryFilters = {},
): Promise<LibraryPrompt[]> {
  const rows = await loadActivePromptRows(filters)
  return filterPromptLibrary(rows, filters)
}

export async function pickPracticePrompt(
  filters: PromptLibraryFilters = {},
  random: RandomSource = Math.random,
): Promise<LibraryPrompt | null> {
  return choosePrompt(await getPromptLibrary(filters), random)
}

/** Selects the first available preferred mode, always ending at General Practice. */
export async function pickPreferredPracticePrompt(
  modes: readonly PracticeMode[],
  random: RandomSource = Math.random,
): Promise<LibraryPrompt | null> {
  return choosePromptByModePriority(await getPromptLibrary(), modes, random)
}

export async function getPromptCollections(
  filters: Pick<PromptLibraryFilters, 'mode' | 'difficulty'> = {},
): Promise<PromptCollection[]> {
  return derivePromptCollections(await getPromptLibrary(filters))
}

export type { PracticeMode, PromptDifficulty }
