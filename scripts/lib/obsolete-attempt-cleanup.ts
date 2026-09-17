import type { Client } from 'pg'
import { classifySpeakingActivity, isSpeakingActivity } from '@/lib/activity/speaking'
import {
  classifyAttemptGeneration,
  ownedObsoleteAudioPaths,
  promptKind,
  selectObsoleteAttempts,
  selectTerminalCleanupAttempts,
  type MaintenanceAttemptRow,
  type ObsoleteAttemptGeneration,
} from '@/lib/maintenance/obsolete-attempts'
import { V3_SCORE_PAYLOAD_VERSION } from '@/lib/scoring/v3/contracts'
import { localDateKey } from '@/lib/timezone'

export const ATTEMPT_SELECT = `
  id, user_id, rubric_version, practice_mode, prompt_source, lesson_id,
  retry_of_attempt_id, status, duration_ms, transcript, score, section_scores,
  metrics, content_result, audio_path, created_at, finished_at
`

const EXPECTED_ATTEMPT_REFERENCES = new Map([
  ['public.attempts.retry_of_attempt_id', 'SET NULL'],
  ['public.lesson_progress.best_attempt_id', 'SET NULL'],
  ['public.note_feedback.attempt_id', 'CASCADE'],
])

interface AttemptReference {
  constraint_name: string
  source_schema: string
  source_table: string
  source_column: string
  delete_action: string
}

interface AttemptTrigger {
  name: string
  definition: string
}

export interface CleanupInventoryRow {
  scope: 'database' | 'target_user'
  classification: string
  generation: string
  rubricVersion: string
  mode: string
  promptKind: ReturnType<typeof promptKind>
  status: string
  count: number
}

export interface CleanupDependencySummary {
  foreignKeys: AttemptReference[]
  triggers: AttemptTrigger[]
  unexpectedReferences: AttemptReference[]
  missingExpectedReferences: string[]
  deleteTriggers: AttemptTrigger[]
  noteFeedbackRows: number
  durableBestReferences: number
  recomputedBestReferences: number
  removedProgressRows: number
  currentRetryChildren: number
  otherUserRetryChildren: number
  impactedActivityDays: number
  removedActivityDays: number
  ownedAudioPaths: string[]
  existingAudioObjects: number
  missingAudioObjects: number
  mismatchedAudioObjectOwners: number
  sharedAudioPaths: number
  unsafeAudioAttemptIds: string[]
}

export interface CleanupPlan {
  targetUserId: string
  generations: ObsoleteAttemptGeneration[]
  terminalAttemptIds: string[]
  inventory: CleanupInventoryRow[]
  attempts: MaintenanceAttemptRow[]
  dependencies: CleanupDependencySummary
}

export interface CleanupApplyResult {
  deletedAttempts: number
  deletedNoteFeedbackRows: number
  clearedRetryReferences: number
  deletedProgressRows: number
  rebuiltProgressRows: number
  deletedActivityDays: number
  audioPathsToDelete: string[]
  remainingTargetedAttempts: number
}

function numericCount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('Database returned an invalid count.')
  return parsed
}

function asIso(value: unknown): string | null {
  if (value === null) return null
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : String(value)
}

function normalizeAttempt(row: Record<string, unknown>): MaintenanceAttemptRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    rubric_version: row.rubric_version === null ? null : String(row.rubric_version),
    practice_mode: row.practice_mode === null ? null : String(row.practice_mode),
    prompt_source: row.prompt_source === null ? null : String(row.prompt_source),
    lesson_id: row.lesson_id === null ? null : String(row.lesson_id),
    retry_of_attempt_id: row.retry_of_attempt_id === null ? null : String(row.retry_of_attempt_id),
    status: String(row.status),
    duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
    transcript: row.transcript === null ? null : String(row.transcript),
    score: row.score === null ? null : Number(row.score),
    section_scores: row.section_scores,
    metrics: row.metrics,
    content_result: row.content_result,
    audio_path: row.audio_path === null ? null : String(row.audio_path),
    created_at: asIso(row.created_at) ?? '',
    finished_at: asIso(row.finished_at),
  }
}

export async function loadMaintenanceAttempts(client: Client): Promise<MaintenanceAttemptRow[]> {
  const result = await client.query(`select ${ATTEMPT_SELECT} from public.attempts`)
  return result.rows.map(normalizeAttempt)
}

function inventoryRows(
  rows: readonly MaintenanceAttemptRow[],
  targetUserId: string,
): CleanupInventoryRow[] {
  const grouped = new Map<string, CleanupInventoryRow>()
  for (const row of rows) {
    for (const scope of ['database', 'target_user'] as const) {
      if (scope === 'target_user' && row.user_id !== targetUserId) continue
      const result = classifyAttemptGeneration(row)
      const classification =
        row.status !== 'done' && result.kind === 'no_result' ? 'unfinished_or_failed' : result.kind
      const item: Omit<CleanupInventoryRow, 'count'> = {
        scope,
        classification,
        generation: result.generation,
        rubricVersion: row.rubric_version ?? 'none',
        mode: row.practice_mode ?? 'none',
        promptKind: promptKind(row),
        status: row.status,
      }
      const key = JSON.stringify(item)
      const existing = grouped.get(key)
      if (existing) existing.count += 1
      else grouped.set(key, { ...item, count: 1 })
    }
  }
  return [...grouped.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
}

async function attemptReferences(client: Client): Promise<AttemptReference[]> {
  const result = await client.query<AttemptReference>(`
    select
      constraint_info.conname as constraint_name,
      source_namespace.nspname as source_schema,
      source_table.relname as source_table,
      source_attribute.attname as source_column,
      case constraint_info.confdeltype
        when 'a' then 'NO ACTION'
        when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'
        when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT'
      end as delete_action
    from pg_catalog.pg_constraint as constraint_info
    join pg_catalog.pg_class as target_table
      on target_table.oid = constraint_info.confrelid
    join pg_catalog.pg_namespace as target_namespace
      on target_namespace.oid = target_table.relnamespace
    join pg_catalog.pg_class as source_table
      on source_table.oid = constraint_info.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    join lateral unnest(constraint_info.conkey) with ordinality as source_key(attnum, position)
      on true
    join pg_catalog.pg_attribute as source_attribute
      on source_attribute.attrelid = source_table.oid
      and source_attribute.attnum = source_key.attnum
    where constraint_info.contype = 'f'
      and target_namespace.nspname = 'public'
      and target_table.relname = 'attempts'
    order by source_namespace.nspname, source_table.relname, source_attribute.attname
  `)
  return result.rows
}

async function attemptTriggers(client: Client): Promise<AttemptTrigger[]> {
  const result = await client.query<AttemptTrigger>(`
    select trigger_info.tgname as name, pg_catalog.pg_get_triggerdef(trigger_info.oid) as definition
    from pg_catalog.pg_trigger as trigger_info
    where trigger_info.tgrelid = 'public.attempts'::regclass
      and not trigger_info.tgisinternal
    order by trigger_info.tgname
  `)
  return result.rows
}

function completedAt(row: MaintenanceAttemptRow): Date {
  return new Date(row.finished_at ?? row.created_at)
}

function currentSpeakingAttempt(row: MaintenanceAttemptRow): boolean {
  const generation = classifyAttemptGeneration(row)
  return (
    generation.kind === 'current' &&
    generation.generation === V3_SCORE_PAYLOAD_VERSION &&
    isSpeakingActivity(
      classifySpeakingActivity({
        status: row.status,
        durationMs: row.duration_ms,
        transcript: row.transcript,
        score: row.score,
        sectionScores: row.section_scores,
      }),
    )
  )
}

async function dependencySummary(
  client: Client,
  targetUserId: string,
  attempts: readonly MaintenanceAttemptRow[],
  allRows: readonly MaintenanceAttemptRow[],
): Promise<CleanupDependencySummary> {
  const ids = attempts.map((row) => row.id)
  const { paths, unsafeAttemptIds } = ownedObsoleteAudioPaths(attempts, targetUserId)
  const foreignKeys = await attemptReferences(client)
  const triggers = await attemptTriggers(client)
  const unexpectedReferences = foreignKeys.filter((reference) => {
    const key = `${reference.source_schema}.${reference.source_table}.${reference.source_column}`
    return EXPECTED_ATTEMPT_REFERENCES.get(key) !== reference.delete_action
  })
  const actualReferences = new Set(
    foreignKeys.map(
      (reference) =>
        `${reference.source_schema}.${reference.source_table}.${reference.source_column}:${reference.delete_action}`,
    ),
  )
  const missingExpectedReferences = [...EXPECTED_ATTEMPT_REFERENCES].flatMap(([key, action]) =>
    actualReferences.has(`${key}:${action}`) ? [] : [`${key}:${action}`],
  )
  const deleteTriggers = triggers.filter((trigger) => /\bDELETE\b/i.test(trigger.definition))
  if (ids.length === 0) {
    return {
      foreignKeys,
      triggers,
      unexpectedReferences,
      missingExpectedReferences,
      deleteTriggers,
      noteFeedbackRows: 0,
      durableBestReferences: 0,
      recomputedBestReferences: 0,
      removedProgressRows: 0,
      currentRetryChildren: 0,
      otherUserRetryChildren: 0,
      impactedActivityDays: 0,
      removedActivityDays: 0,
      ownedAudioPaths: paths,
      existingAudioObjects: 0,
      missingAudioObjects: 0,
      mismatchedAudioObjectOwners: 0,
      sharedAudioPaths: 0,
      unsafeAudioAttemptIds: unsafeAttemptIds,
    }
  }

  const notes = await client.query(
    'select count(*)::integer as count from public.note_feedback where attempt_id = any($1::uuid[])',
    [ids],
  )
  const progress = await client.query(
    'select lesson_id::text from public.lesson_progress where best_attempt_id = any($1::uuid[])',
    [ids],
  )
  const retryChildren = await client.query(
    `select user_id::text, section_scores, rubric_version, practice_mode, score, status
     from public.attempts
     where retry_of_attempt_id = any($1::uuid[]) and not (id = any($1::uuid[]))`,
    [ids],
  )
  const activityRows = await client.query(
    'select local_date::text, timezone from public.practice_activity_days where user_id = $1',
    [targetUserId],
  )
  const storageObjects =
    paths.length === 0
      ? { rows: [{ count: 0 }] }
      : await client.query(
          `select count(*)::integer as count from storage.objects
           where bucket_id = 'recordings' and name = any($1::text[])`,
          [paths],
        )
  const mismatchedStorageOwners =
    paths.length === 0
      ? { rows: [{ count: 0 }] }
      : await client.query(
          `select count(*)::integer as count from storage.objects
           where bucket_id = 'recordings' and name = any($1::text[])
             and (owner::text is distinct from $2 or owner_id is distinct from $2)`,
          [paths, targetUserId],
        )
  const sharedAudio =
    paths.length === 0
      ? { rows: [{ count: 0 }] }
      : await client.query(
          `select count(*)::integer as count
           from public.attempts
           where not (id = any($1::uuid[])) and audio_path = any($2::text[])`,
          [ids, paths],
        )

  const impactedDays = activityRows.rows.filter((day) =>
    attempts.some(
      (attempt) => localDateKey(completedAt(attempt), String(day.timezone)) === day.local_date,
    ),
  )
  const survivingRows = allRows.filter(
    (row) => row.user_id === targetUserId && !ids.includes(row.id),
  )
  const removedActivityDays = impactedDays.filter(
    (day) =>
      !survivingRows.some(
        (attempt) =>
          currentSpeakingAttempt(attempt) &&
          localDateKey(completedAt(attempt), String(day.timezone)) === day.local_date,
      ),
  ).length
  const lessonsWithReplacement = new Set(
    progress.rows.flatMap((progressRow) => {
      const lessonId = String(progressRow.lesson_id)
      return survivingRows.some(
        (row) =>
          row.lesson_id === lessonId &&
          row.status === 'done' &&
          row.score !== null &&
          classifyAttemptGeneration(row).kind === 'current',
      )
        ? [lessonId]
        : []
    }),
  )
  const currentRetryChildren = retryChildren.rows.filter((row) => {
    const fake = normalizeAttempt({
      ...row,
      id: '00000000-0000-0000-0000-000000000000',
      lesson_id: null,
      retry_of_attempt_id: null,
      prompt_source: null,
      duration_ms: null,
      transcript: null,
      metrics: null,
      content_result: null,
      audio_path: null,
      created_at: new Date(0),
      finished_at: null,
    })
    return row.user_id === targetUserId && classifyAttemptGeneration(fake).kind === 'current'
  }).length

  const existingAudioObjects = numericCount(storageObjects.rows[0]?.count)
  return {
    foreignKeys,
    triggers,
    unexpectedReferences,
    missingExpectedReferences,
    deleteTriggers,
    noteFeedbackRows: numericCount(notes.rows[0]?.count),
    durableBestReferences: progress.rowCount ?? 0,
    recomputedBestReferences: lessonsWithReplacement.size,
    removedProgressRows: (progress.rowCount ?? 0) - lessonsWithReplacement.size,
    currentRetryChildren,
    otherUserRetryChildren: retryChildren.rows.filter((row) => row.user_id !== targetUserId).length,
    impactedActivityDays: impactedDays.length,
    removedActivityDays,
    ownedAudioPaths: paths,
    existingAudioObjects,
    missingAudioObjects: paths.length - existingAudioObjects,
    mismatchedAudioObjectOwners: numericCount(mismatchedStorageOwners.rows[0]?.count),
    sharedAudioPaths: numericCount(sharedAudio.rows[0]?.count),
    unsafeAudioAttemptIds: unsafeAttemptIds,
  }
}

export async function buildCleanupPlan(
  client: Client,
  targetUserId: string,
  generations: readonly ObsoleteAttemptGeneration[],
  terminalAttemptIds: readonly string[] = [],
): Promise<CleanupPlan> {
  const rows = await loadMaintenanceAttempts(client)
  if (generations.length > 0 === terminalAttemptIds.length > 0) {
    throw new Error('A cleanup plan requires exactly one selector.')
  }
  const attempts =
    terminalAttemptIds.length > 0
      ? selectTerminalCleanupAttempts(rows, targetUserId, terminalAttemptIds)
      : selectObsoleteAttempts(rows, targetUserId, new Set(generations))
  return {
    targetUserId,
    generations: [...generations],
    terminalAttemptIds: [...terminalAttemptIds],
    inventory: inventoryRows(rows, targetUserId),
    attempts,
    dependencies: await dependencySummary(client, targetUserId, attempts, rows),
  }
}

export function assertSafePlan(plan: CleanupPlan): void {
  const blockers: string[] = []
  if (plan.dependencies.unexpectedReferences.length > 0) blockers.push('unexpected foreign keys')
  if (plan.dependencies.missingExpectedReferences.length > 0)
    blockers.push('missing expected foreign keys')
  if (plan.dependencies.deleteTriggers.length > 0) blockers.push('DELETE triggers')
  if (plan.dependencies.otherUserRetryChildren > 0) blockers.push('cross-user retry references')
  if (plan.dependencies.sharedAudioPaths > 0) blockers.push('shared audio paths')
  if (plan.dependencies.missingAudioObjects > 0) blockers.push('missing audio objects')
  if (plan.dependencies.mismatchedAudioObjectOwners > 0)
    blockers.push('mismatched audio object ownership')
  if (plan.dependencies.unsafeAudioAttemptIds.length > 0)
    blockers.push('unverified audio ownership')
  if (blockers.length > 0) throw new Error(`Cleanup is blocked by ${blockers.join(', ')}.`)
  try {
    if (plan.terminalAttemptIds.length > 0) {
      selectTerminalCleanupAttempts(plan.attempts, plan.targetUserId, plan.terminalAttemptIds)
    } else if (
      plan.attempts.some(
        (row) =>
          classifyAttemptGeneration(row).kind !== 'obsolete' || row.user_id !== plan.targetUserId,
      )
    ) {
      throw new Error('Cleanup plan contains a current, invalid, or differently owned attempt.')
    }
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Cleanup plan selection is unsafe: ${error.message}`
        : 'Cleanup plan selection is unsafe.',
    )
  }
}

function newestFirst(left: MaintenanceAttemptRow, right: MaintenanceAttemptRow): number {
  const timeDifference = completedAt(right).getTime() - completedAt(left).getTime()
  return timeDifference === 0 ? right.id.localeCompare(left.id) : timeDifference
}

export async function applyCleanupPlan(
  client: Client,
  originalPlan: CleanupPlan,
): Promise<CleanupApplyResult> {
  assertSafePlan(originalPlan)
  await client.query('begin isolation level serializable')
  try {
    await client.query(
      'select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))',
      [originalPlan.targetUserId],
    )
    const locked = await client.query(
      `select ${ATTEMPT_SELECT} from public.attempts where user_id = $1 for update`,
      [originalPlan.targetUserId],
    )
    const rows = locked.rows.map(normalizeAttempt)
    const attempts =
      originalPlan.terminalAttemptIds.length > 0
        ? selectTerminalCleanupAttempts(
            rows,
            originalPlan.targetUserId,
            originalPlan.terminalAttemptIds,
          )
        : selectObsoleteAttempts(rows, originalPlan.targetUserId, new Set(originalPlan.generations))
    const expectedIds = originalPlan.attempts.map((row) => row.id).sort()
    const actualIds = attempts.map((row) => row.id).sort()
    if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
      throw new Error('Target attempts changed after the dry run; run a new dry run.')
    }
    const lockedPlan: CleanupPlan = {
      ...originalPlan,
      attempts,
      dependencies: await dependencySummary(client, originalPlan.targetUserId, attempts, rows),
    }
    assertSafePlan(lockedPlan)
    const ids = attempts.map((row) => row.id)
    if (ids.length === 0) {
      await client.query('commit')
      return {
        deletedAttempts: 0,
        deletedNoteFeedbackRows: 0,
        clearedRetryReferences: 0,
        deletedProgressRows: 0,
        rebuiltProgressRows: 0,
        deletedActivityDays: 0,
        audioPathsToDelete: [],
        remainingTargetedAttempts: 0,
      }
    }

    const progress = await client.query(
      `select lesson_id::text from public.lesson_progress
       where user_id = $1 and best_attempt_id = any($2::uuid[]) for update`,
      [originalPlan.targetUserId, ids],
    )
    const affectedLessons = progress.rows.map((row) => String(row.lesson_id))
    const survivingRows = rows.filter((row) => !ids.includes(row.id))
    const replacement = new Map<string, MaintenanceAttemptRow>()
    for (const lessonId of affectedLessons) {
      const best = survivingRows
        .filter(
          (row) =>
            row.lesson_id === lessonId &&
            row.status === 'done' &&
            row.score !== null &&
            classifyAttemptGeneration(row).kind === 'current',
        )
        .sort(
          (left, right) => (right.score ?? -1) - (left.score ?? -1) || newestFirst(left, right),
        )[0]
      if (best) replacement.set(lessonId, best)
    }

    const cleared = await client.query(
      `update public.attempts set retry_of_attempt_id = null
       where retry_of_attempt_id = any($1::uuid[]) and not (id = any($1::uuid[]))`,
      [ids],
    )
    const deletedProgress = await client.query(
      'delete from public.lesson_progress where user_id = $1 and lesson_id = any($2::uuid[])',
      [originalPlan.targetUserId, affectedLessons],
    )
    for (const [lessonId, best] of replacement) {
      await client.query(
        `insert into public.lesson_progress (user_id, lesson_id, best_score, best_attempt_id)
         values ($1, $2, $3, $4)`,
        [originalPlan.targetUserId, lessonId, best.score, best.id],
      )
    }

    const activityRows = await client.query(
      `select local_date::text, timezone from public.practice_activity_days
       where user_id = $1 for update`,
      [originalPlan.targetUserId],
    )
    const activityDatesToDelete = activityRows.rows
      .filter((day) =>
        attempts.some(
          (attempt) => localDateKey(completedAt(attempt), String(day.timezone)) === day.local_date,
        ),
      )
      .filter(
        (day) =>
          !survivingRows.some(
            (attempt) =>
              currentSpeakingAttempt(attempt) &&
              localDateKey(completedAt(attempt), String(day.timezone)) === day.local_date,
          ),
      )
      .map((day) => day.local_date)
    const deletedActivity =
      activityDatesToDelete.length === 0
        ? { rowCount: 0 }
        : await client.query(
            `delete from public.practice_activity_days
             where user_id = $1 and local_date = any($2::date[])`,
            [originalPlan.targetUserId, activityDatesToDelete],
          )

    const deleted = await client.query(
      'delete from public.attempts where user_id = $1 and id = any($2::uuid[])',
      [originalPlan.targetUserId, ids],
    )
    if (deleted.rowCount !== ids.length) throw new Error('Not every planned attempt was deleted.')
    const remaining = await client.query(
      'select count(*)::integer as count from public.attempts where id = any($1::uuid[])',
      [ids],
    )
    await client.query('commit')
    return {
      deletedAttempts: deleted.rowCount,
      deletedNoteFeedbackRows: lockedPlan.dependencies.noteFeedbackRows,
      clearedRetryReferences: cleared.rowCount ?? 0,
      deletedProgressRows: deletedProgress.rowCount ?? 0,
      rebuiltProgressRows: replacement.size,
      deletedActivityDays: deletedActivity.rowCount ?? 0,
      audioPathsToDelete: lockedPlan.dependencies.ownedAudioPaths,
      remainingTargetedAttempts: numericCount(remaining.rows[0]?.count),
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}
