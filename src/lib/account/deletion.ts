import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  validateOwnedAttemptAudioPath,
  validateOwnedAttemptUploadPath,
} from '@/lib/attempts/audio-path'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import type { Database } from '@/lib/types/database'

const QUERY_PAGE_SIZE = 500
const STORAGE_PAGE_SIZE = 100
const STORAGE_DELETE_BATCH_SIZE = 100
const RECENT_SIGN_IN_WINDOW_MS = 15 * 60 * 1000

interface StoredAttemptAudio {
  id: string
  audio_path: string | null
  metrics: unknown
}

export type RecordingCleanupPlanOutcome =
  | { status: 'ready'; paths: string[]; attemptCount: number }
  | { status: 'failure'; reason: 'attempt_query' | 'storage_list' | 'invalid_path' }

export type RecordingCleanupOutcome = { status: 'removed'; count: number } | { status: 'failure' }

export interface ResetProgressReceipt {
  attemptsDeleted: number
  recordingPaths: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUploadPathClaim(metrics: unknown): boolean {
  return (
    isRecord(metrics) &&
    isRecord(metrics.upload) &&
    Object.prototype.hasOwnProperty.call(metrics.upload, 'storage_path')
  )
}

function safeStorageName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  )
}

function safeCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

export function logUserDataDeletionFailure(operation: string, error?: unknown): void {
  console.error('[user-data] deletion failed', { operation, code: safeCode(error) })
}

/** Emits the exact owner-scoped targets needed for an operational Storage retry. */
export function logRecordingCleanupRequired(userId: string, paths: readonly string[]): void {
  console.error('[user-data] recording cleanup required', {
    userId,
    paths: [...paths],
  })
}

export function isRecentAccountAuthentication(
  lastSignInAt: unknown,
  now: Date = new Date(),
): boolean {
  if (typeof lastSignInAt !== 'string') return false
  const signedInAt = Date.parse(lastSignInAt)
  const current = now.getTime()
  return (
    Number.isFinite(signedInAt) &&
    Number.isFinite(current) &&
    signedInAt <= current &&
    current - signedInAt <= RECENT_SIGN_IN_WINDOW_MS
  )
}

function validateAttemptPath(row: StoredAttemptAudio, userId: string): string | null {
  const owned = row.audio_path
    ? validateOwnedAttemptAudioPath({
        userId,
        attemptId: row.id,
        audioPath: row.audio_path,
        metrics: row.metrics,
      })
    : validateOwnedAttemptUploadPath({
        userId,
        attemptId: row.id,
        metrics: row.metrics,
      })
  return owned?.storagePath ?? null
}

/** Parses the transaction's exact deleted-attempt snapshot, including attempts
 * that committed after the preflight inventory but before the reset lock. */
export function parseResetProgressReceipt(
  value: unknown,
  userId: string,
): ResetProgressReceipt | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return null
  const row = value[0]
  const counts = ['attempts_deleted', 'lesson_progress_deleted', 'activity_days_deleted'].map(
    (key) => row[key],
  )
  if (counts.some((count) => typeof count !== 'number' || !Number.isInteger(count) || count < 0)) {
    return null
  }
  if (!Array.isArray(row.recording_claims) || row.recording_claims.length !== counts[0]) return null

  const paths = new Set<string>()
  for (const claim of row.recording_claims) {
    if (
      !isRecord(claim) ||
      typeof claim.id !== 'string' ||
      !Object.prototype.hasOwnProperty.call(claim, 'audio_path') ||
      !Object.prototype.hasOwnProperty.call(claim, 'metrics')
    ) {
      return null
    }
    const audioPath = claim.audio_path
    if (audioPath !== null && typeof audioPath !== 'string') return null
    const attempt: StoredAttemptAudio = {
      id: claim.id,
      audio_path: audioPath,
      metrics: claim.metrics,
    }
    const path = validateAttemptPath(attempt, userId)
    if (path) paths.add(path)
    if ((attempt.audio_path !== null || hasUploadPathClaim(attempt.metrics)) && !path) return null
  }

  return { attemptsDeleted: counts[0] as number, recordingPaths: [...paths].sort() }
}

async function loadOwnedAttemptPaths(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<
  | { status: 'ready'; paths: string[]; attemptCount: number }
  | { status: 'failure'; reason: 'attempt_query' | 'invalid_path' }
> {
  const paths = new Set<string>()
  let attemptCount = 0

  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const { data, error } = await admin
      .from('attempts')
      .select('id, audio_path, metrics')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + QUERY_PAGE_SIZE - 1)
    if (error || !Array.isArray(data)) {
      logUserDataDeletionFailure('load_owned_attempt_recordings', error)
      return { status: 'failure', reason: 'attempt_query' }
    }

    for (const row of data) {
      attemptCount += 1
      const path = validateAttemptPath(row, userId)
      if (path) paths.add(path)
      if ((row.audio_path !== null || hasUploadPathClaim(row.metrics)) && !path) {
        logUserDataDeletionFailure('validate_owned_attempt_recording')
        return { status: 'failure', reason: 'invalid_path' }
      }
    }

    if (data.length < QUERY_PAGE_SIZE) break
  }

  return { status: 'ready', paths: [...paths], attemptCount }
}

async function listOwnedStoragePaths(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<{ status: 'ready'; paths: string[] } | { status: 'failure' }> {
  const paths: string[] = []
  const pendingFolders = [userId]
  const visitedFolders = new Set<string>()

  while (pendingFolders.length > 0) {
    const folder = pendingFolders.shift()
    if (!folder || visitedFolders.has(folder)) continue
    visitedFolders.add(folder)

    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const { data, error } = await admin.storage.from(RECORDINGS_BUCKET).list(folder, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error || !Array.isArray(data)) {
        logUserDataDeletionFailure('list_owned_recordings', error)
        return { status: 'failure' }
      }
      for (const object of data) {
        if (!safeStorageName(object.name)) {
          logUserDataDeletionFailure('validate_owned_storage_object')
          return { status: 'failure' }
        }
        const objectPath = `${folder}/${object.name}`
        if (object.id === null) pendingFolders.push(objectPath)
        else paths.push(objectPath)
      }
      if (data.length < STORAGE_PAGE_SIZE) break
    }
  }
  return { status: 'ready', paths }
}

/**
 * Resolves both immutable attempt paths and objects already orphaned inside
 * the authenticated user's exact Storage folder before any destructive write.
 */
export async function prepareOwnedRecordingCleanup(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<RecordingCleanupPlanOutcome> {
  try {
    const attempts = await loadOwnedAttemptPaths(admin, userId)
    if (attempts.status === 'failure') return attempts
    const storage = await listOwnedStoragePaths(admin, userId)
    if (storage.status === 'failure') return { status: 'failure', reason: 'storage_list' }
    return {
      status: 'ready',
      paths: [...new Set([...attempts.paths, ...storage.paths])].sort(),
      attemptCount: attempts.attemptCount,
    }
  } catch (error) {
    logUserDataDeletionFailure('prepare_owned_recording_cleanup', error)
    return { status: 'failure', reason: 'storage_list' }
  }
}

/** Removes only preverified paths. A reported Storage failure is tolerated only
 * when a fresh owner-folder listing proves that every target is already absent. */
export async function removeOwnedRecordings(
  admin: SupabaseClient<Database>,
  userId: string,
  paths: readonly string[],
): Promise<RecordingCleanupOutcome> {
  if (
    paths.some((path) => {
      if (!path.startsWith(`${userId}/`)) return true
      const parts = path.slice(userId.length + 1).split('/')
      return parts.length === 0 || parts.some((part) => !safeStorageName(part))
    })
  ) {
    logUserDataDeletionFailure('reject_unowned_recording_cleanup')
    return { status: 'failure' }
  }

  let removalError: unknown = null
  for (let index = 0; index < paths.length; index += STORAGE_DELETE_BATCH_SIZE) {
    const batch = paths.slice(index, index + STORAGE_DELETE_BATCH_SIZE)
    let error: unknown = null
    try {
      const result = await admin.storage.from(RECORDINGS_BUCKET).remove([...batch])
      error = result.error
    } catch (thrown) {
      error = thrown
    }
    if (error) removalError = error
  }

  let remaining: Awaited<ReturnType<typeof listOwnedStoragePaths>>
  try {
    remaining = await listOwnedStoragePaths(admin, userId)
  } catch (thrown) {
    logUserDataDeletionFailure('verify_owned_recording_cleanup', thrown)
    return { status: 'failure' }
  }
  const targets = new Set(paths)
  if (remaining.status === 'failure' || remaining.paths.some((path) => targets.has(path))) {
    logUserDataDeletionFailure('verify_owned_recording_cleanup', removalError)
    return { status: 'failure' }
  }

  return { status: 'removed', count: paths.length }
}
