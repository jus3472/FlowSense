import { dataEmpty, dataFailure, dataReady, type DataOutcome } from '@/lib/data/outcome'
import { parseLibraryPrompt, type LibraryPrompt } from '@/lib/prompts/selection'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Converts an adapter response without conflating query failure, empty data, and invalid data. */
export function promptRowsOutcome(
  data: unknown,
  queryFailed: boolean,
): DataOutcome<LibraryPrompt[]> {
  if (queryFailed || !Array.isArray(data)) return dataFailure()
  if (data.length === 0) return dataEmpty()

  const prompts: LibraryPrompt[] = []
  for (const row of data) {
    if (!isRecord(row) || row.active !== true || row.free_practice_visible !== true) {
      return dataFailure()
    }
    const prompt = parseLibraryPrompt(row)
    if (!prompt) return dataFailure()
    prompts.push(prompt)
  }

  return dataReady(prompts)
}

export function promptRowOutcome(data: unknown, queryFailed: boolean): DataOutcome<LibraryPrompt> {
  if (queryFailed) return dataFailure()
  if (data === null) return dataEmpty()
  if (!isRecord(data) || data.active !== true || data.free_practice_visible !== true) {
    return dataFailure()
  }

  const prompt = parseLibraryPrompt(data)
  return prompt ? dataReady(prompt) : dataFailure()
}

/** Recent history improves variety but never controls prompt-library availability. */
export function recentPromptIdsOrEmpty(outcome: DataOutcome<string[]>): string[] {
  return outcome.status === 'ready' ? outcome.data : []
}
