import 'server-only'

import { dataEmpty, dataFailure, dataReady, type DataOutcome } from '@/lib/data/outcome'
import type { PracticeMode, PromptDifficulty } from '@/lib/practice/contracts'
import { promptRowOutcome, promptRowsOutcome } from '@/lib/prompts/data'
import {
  buildPromptBrowseData,
  choosePromptByModePriorityWithRecentFallback,
  choosePromptForRecord,
  choosePromptWithRecentFallback,
  filterParsedPromptLibrary,
  isPromptId,
  recentCompletedLibraryPromptIds,
  type LibraryPrompt,
  type PromptBrowseData,
  type PromptLibraryFilters,
  type RandomSource,
} from '@/lib/prompts/selection'
import { createClient } from '@/lib/supabase/server'

export type PromptQuery = Omit<PromptLibraryFilters, 'excludeIds'>

export const RECENT_PROMPT_EXCLUSION_LIMIT = 8
const RECENT_PROMPT_CANDIDATE_LIMIT = 30

const PROMPT_COLUMNS = 'id, text, active, mode, difficulty, target_duration_seconds, collection_id'

function collectionFilter(query: PromptQuery): string | null | undefined {
  const collectionId = query.collectionId?.trim()
  const category = query.category?.trim()
  if (collectionId && category && collectionId !== category) return null
  return collectionId || category
}

/** Reads active prompt rows only. Selection stays in the pure module above. */
function safeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'unknown'
  const code = error.code
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code) ? code : 'unknown'
}

function logDataFailure(operation: string, error?: unknown, reason?: string): void {
  console.error('[prompts] data load failed', {
    operation,
    code: safeErrorCode(error),
    ...(reason ? { reason } : {}),
  })
}

async function loadActivePrompts(query: PromptQuery = {}): Promise<DataOutcome<LibraryPrompt[]>> {
  const collectionId = collectionFilter(query)
  if (collectionId === null) return dataEmpty()

  const supabase = await createClient()
  let request = supabase.from('prompts').select(PROMPT_COLUMNS).eq('active', true)
  if (query.mode) request = request.eq('mode', query.mode)
  if (query.difficulty) request = request.eq('difficulty', query.difficulty)
  if (collectionId) request = request.eq('collection_id', collectionId)

  const { data, error } = await request
  const outcome = promptRowsOutcome(data, Boolean(error))
  if (outcome.status === 'failure') {
    logDataFailure('active_prompt_list', error, error ? undefined : 'invalid_response')
  }
  return outcome
}

export async function getPromptById(id: string): Promise<DataOutcome<LibraryPrompt>> {
  if (!isPromptId(id)) return dataEmpty()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prompts')
    .select(PROMPT_COLUMNS)
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  const outcome = promptRowOutcome(data, Boolean(error))
  if (outcome.status === 'failure') {
    logDataFailure('active_prompt_by_id', error, error ? undefined : 'invalid_response')
  }
  return outcome
}

export async function getPromptLibrary(
  filters: PromptLibraryFilters = {},
): Promise<DataOutcome<LibraryPrompt[]>> {
  const outcome = await loadActivePrompts(filters)
  if (outcome.status !== 'ready') return outcome

  const prompts = filterParsedPromptLibrary(outcome.data, filters)
  return prompts.length > 0 ? dataReady(prompts) : dataEmpty()
}

export async function pickPracticePrompt(
  filters: PromptLibraryFilters = {},
  random: RandomSource = Math.random,
): Promise<DataOutcome<LibraryPrompt>> {
  const { excludeIds = [], ...query } = filters
  const outcome = await getPromptLibrary(query)
  if (outcome.status !== 'ready') return outcome

  const prompt = choosePromptWithRecentFallback(outcome.data, excludeIds, random)
  return prompt ? dataReady(prompt) : dataEmpty()
}

/** Selects the first available preferred mode, always ending at General Practice. */
export async function pickPreferredPracticePrompt(
  modes: readonly PracticeMode[],
  excludeIds: readonly string[] = [],
  random: RandomSource = Math.random,
): Promise<DataOutcome<LibraryPrompt>> {
  const outcome = await getPromptLibrary()
  if (outcome.status !== 'ready') return outcome

  const prompt = choosePromptByModePriorityWithRecentFallback(
    outcome.data,
    modes,
    excludeIds,
    random,
  )
  return prompt ? dataReady(prompt) : dataEmpty()
}

export async function pickRecordPrompt(
  requestedMode: PracticeMode | undefined,
  preferredModes: readonly PracticeMode[],
  excludeIds: readonly string[] = [],
  random: RandomSource = Math.random,
): Promise<DataOutcome<LibraryPrompt>> {
  const outcome = await getPromptLibrary(requestedMode ? { mode: requestedMode } : {})
  if (outcome.status !== 'ready') return outcome

  const prompt = choosePromptForRecord(
    outcome.data,
    requestedMode,
    preferredModes,
    excludeIds,
    random,
  )
  return prompt ? dataReady(prompt) : dataEmpty()
}

export async function getPromptBrowseData(
  filters: Pick<PromptLibraryFilters, 'mode' | 'difficulty' | 'collectionId'>,
  recentPromptIds: readonly string[],
  random: RandomSource = Math.random,
): Promise<DataOutcome<PromptBrowseData>> {
  const outcome = await loadActivePrompts({ mode: filters.mode })
  if (outcome.status === 'failure') return outcome

  const prompts = outcome.status === 'ready' ? outcome.data : []
  return dataReady(buildPromptBrowseData(prompts, filters, recentPromptIds, random))
}

export async function getRecentCompletedLibraryPromptIds(
  userId: string,
): Promise<DataOutcome<string[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('attempts')
    .select('prompt_id, prompt_source, score, section_scores')
    .eq('user_id', userId)
    .not('prompt_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(RECENT_PROMPT_CANDIDATE_LIMIT)

  if (error || !Array.isArray(data)) {
    logDataFailure('recent_library_attempts', error, error ? undefined : 'invalid_response')
    return dataFailure()
  }

  const ids = recentCompletedLibraryPromptIds(data, RECENT_PROMPT_EXCLUSION_LIMIT)
  return ids.length > 0 ? dataReady([...new Set(ids)]) : dataEmpty()
}

export type { PracticeMode, PromptDifficulty }
