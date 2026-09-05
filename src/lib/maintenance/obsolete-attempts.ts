import { validateOwnedAttemptAudioPath } from '@/lib/attempts/audio-path'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import {
  V3_LEGACY_SCORE_PAYLOAD_VERSION,
  V3_SCORE_PAYLOAD_VERSION,
} from '@/lib/scoring/v3/contracts'

export const OBSOLETE_ATTEMPT_GENERATIONS = [
  'legacy',
  'v2.score.1',
  V3_LEGACY_SCORE_PAYLOAD_VERSION,
] as const

export type ObsoleteAttemptGeneration = (typeof OBSOLETE_ATTEMPT_GENERATIONS)[number]

export interface CleanupArguments {
  apply: boolean
  deleteAudio: boolean
  generations: ObsoleteAttemptGeneration[]
  userId?: string
  userEmail?: string
  onlyUser: boolean
}

export interface MaintenanceAttemptRow {
  id: string
  user_id: string
  rubric_version: string | null
  practice_mode: string | null
  prompt_source: string | null
  lesson_id: string | null
  retry_of_attempt_id: string | null
  status: string
  duration_ms: number | null
  transcript: string | null
  score: number | null
  section_scores: unknown
  metrics: unknown
  content_result: unknown
  audio_path: string | null
  created_at: string
  finished_at: string | null
}

export type AttemptGenerationClassification =
  | { kind: 'current'; generation: typeof V3_SCORE_PAYLOAD_VERSION }
  | { kind: 'obsolete'; generation: ObsoleteAttemptGeneration }
  | { kind: 'no_result'; generation: 'none' }
  | { kind: 'malformed'; generation: string }
  | { kind: 'unsupported'; generation: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function declaredGeneration(row: MaintenanceAttemptRow): string {
  if (!isRecord(row.section_scores)) return row.section_scores === null ? 'none' : 'unversioned'
  const version = row.section_scores.version
  return typeof version === 'string' && version.length > 0 ? version : 'unversioned'
}

export function classifyAttemptGeneration(
  row: MaintenanceAttemptRow,
): AttemptGenerationClassification {
  const snapshot = decodeStoredSectionSnapshot(row.section_scores)
  if (snapshot.kind === 'none') return { kind: 'no_result', generation: 'none' }
  if (snapshot.kind === 'legacy') return { kind: 'obsolete', generation: 'legacy' }
  if (snapshot.kind === 'v2') {
    if (
      row.rubric_version !== snapshot.payload.rubric_version ||
      row.practice_mode !== snapshot.payload.mode ||
      row.score !== snapshot.payload.total_earned_points
    ) {
      return { kind: 'malformed', generation: snapshot.payload.version }
    }
    return { kind: 'obsolete', generation: snapshot.payload.version as 'v2.score.1' }
  }
  if (snapshot.kind === 'v3') {
    if (
      row.rubric_version !== snapshot.payload.rubric_version ||
      row.practice_mode !== snapshot.payload.mode ||
      row.score !== snapshot.payload.total_earned_points
    ) {
      return { kind: 'malformed', generation: snapshot.payload.version }
    }
    return snapshot.payload.version === V3_SCORE_PAYLOAD_VERSION
      ? { kind: 'current', generation: V3_SCORE_PAYLOAD_VERSION }
      : { kind: 'obsolete', generation: V3_LEGACY_SCORE_PAYLOAD_VERSION }
  }
  if (snapshot.kind === 'unsupported_version') {
    return {
      kind: 'unsupported',
      generation: snapshot.scoreVersion ?? declaredGeneration(row),
    }
  }
  return { kind: 'malformed', generation: declaredGeneration(row) }
}

export function isSelectableObsoleteAttempt(
  row: MaintenanceAttemptRow,
  targetUserId: string,
  generations: ReadonlySet<ObsoleteAttemptGeneration>,
): boolean {
  if (row.user_id !== targetUserId || row.status !== 'done') return false
  const classification = classifyAttemptGeneration(row)
  return classification.kind === 'obsolete' && generations.has(classification.generation)
}

export function selectObsoleteAttempts(
  rows: readonly MaintenanceAttemptRow[],
  targetUserId: string,
  generations: ReadonlySet<ObsoleteAttemptGeneration>,
): MaintenanceAttemptRow[] {
  return rows.filter((row) => isSelectableObsoleteAttempt(row, targetUserId, generations))
}

export function promptKind(
  row: MaintenanceAttemptRow,
): 'structured' | 'custom_prompt' | 'general_practice' {
  if (row.lesson_id !== null) return 'structured'
  return row.prompt_source === 'custom' ? 'custom_prompt' : 'general_practice'
}

export function ownedObsoleteAudioPaths(
  rows: readonly MaintenanceAttemptRow[],
  targetUserId: string,
): { paths: string[]; unsafeAttemptIds: string[] } {
  const paths: string[] = []
  const unsafeAttemptIds: string[] = []
  for (const row of rows) {
    if (row.audio_path === null) continue
    const owned = validateOwnedAttemptAudioPath({
      userId: targetUserId,
      attemptId: row.id,
      audioPath: row.audio_path,
      metrics: row.metrics,
    })
    if (owned) paths.push(owned.storagePath)
    else unsafeAttemptIds.push(row.id)
  }
  return { paths: [...new Set(paths)], unsafeAttemptIds }
}

export function parseObsoleteGenerations(values: readonly string[]): ObsoleteAttemptGeneration[] {
  const requested = [...new Set(values.flatMap((value) => value.split(',')).filter(Boolean))]
  if (requested.length === 0) {
    throw new Error('Name at least one obsolete generation with --generation.')
  }
  for (const value of requested) {
    if (value === V3_SCORE_PAYLOAD_VERSION) {
      throw new Error(`${V3_SCORE_PAYLOAD_VERSION} is current and can never be targeted.`)
    }
    if (!(OBSOLETE_ATTEMPT_GENERATIONS as readonly string[]).includes(value)) {
      throw new Error(`Unsupported cleanup generation: ${value}`)
    }
  }
  return requested as ObsoleteAttemptGeneration[]
}

function argumentValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

export function parseCleanupArguments(argv: readonly string[]): CleanupArguments {
  let apply = false
  let deleteAudio = false
  let userId: string | undefined
  let userEmail: string | undefined
  let onlyUser = false
  const generationValues: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--apply') apply = true
    else if (flag === '--delete-audio') deleteAudio = true
    else if (flag === '--only-user') onlyUser = true
    else if (flag === '--user-id') {
      userId = argumentValue(argv, index, flag)
      index += 1
    } else if (flag === '--user-email') {
      userEmail = argumentValue(argv, index, flag)
      index += 1
    } else if (flag === '--generation') {
      generationValues.push(argumentValue(argv, index, flag))
      index += 1
    } else {
      throw new Error(`Unknown argument: ${flag}`)
    }
  }

  const selectors =
    Number(userId !== undefined) + Number(userEmail !== undefined) + Number(onlyUser)
  if (selectors !== 1) {
    throw new Error('Choose exactly one user scope: --user-id, --user-email, or --only-user.')
  }
  if (
    userId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
  ) {
    throw new Error('--user-id must be a UUID.')
  }
  if (deleteAudio && !apply) {
    throw new Error('--delete-audio is destructive and requires --apply.')
  }

  return {
    apply,
    deleteAudio,
    generations: parseObsoleteGenerations(generationValues),
    ...(userId ? { userId } : {}),
    ...(userEmail ? { userEmail } : {}),
    onlyUser,
  }
}
