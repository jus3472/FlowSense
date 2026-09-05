import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import {
  classifyAttemptGeneration,
  parseCleanupArguments,
  type CleanupArguments,
} from '@/lib/maintenance/obsolete-attempts'
import { V3_RUBRIC_VERSION, V3_SCORE_PAYLOAD_VERSION } from '@/lib/scoring/v3/contracts'
import {
  V3_CONTENT_AUDIT_VERSION,
  V3_CONTENT_EVALUATOR_VERSION,
} from '@/lib/scoring/v3/content/contracts'
import { AUDIO_ANALYSIS_VERSION } from '@/lib/scoring/v3/audio'
import {
  applyCleanupPlan,
  buildCleanupPlan,
  type CleanupPlan,
} from './lib/obsolete-attempt-cleanup'
import { databaseClientOptions, loadEnvFile } from './lib/migrations.mjs'

async function resolveUserId(client: pg.Client, args: CleanupArguments): Promise<string> {
  if (args.userId) {
    const result = await client.query('select id::text from auth.users where id = $1', [
      args.userId,
    ])
    if (result.rowCount !== 1) throw new Error('The requested user does not exist.')
    return String(result.rows[0]?.id)
  }
  if (args.userEmail) {
    const result = await client.query(
      'select id::text from auth.users where lower(email) = lower($1)',
      [args.userEmail],
    )
    if (result.rowCount !== 1) throw new Error('The email must resolve to exactly one user.')
    return String(result.rows[0]?.id)
  }
  const result = await client.query('select id::text from auth.users order by id limit 2')
  if (result.rowCount !== 1) {
    throw new Error('--only-user requires the configured database to contain exactly one user.')
  }
  return String(result.rows[0]?.id)
}

function summarizedPlan(plan: CleanupPlan): object {
  const targetedByGeneration = Object.fromEntries(
    plan.generations.map((generation) => [
      generation,
      plan.attempts.filter(
        (attempt) => classifyAttemptGeneration(attempt).generation === generation,
      ).length,
    ]),
  )
  const currentTargetUserCount = plan.inventory
    .filter((row) => row.scope === 'target_user' && row.classification === 'current')
    .reduce((sum, row) => sum + row.count, 0)

  return {
    mode: 'dry-run',
    currentGeneration: {
      rubricVersion: V3_RUBRIC_VERSION,
      scorePayloadVersion: V3_SCORE_PAYLOAD_VERSION,
      contentEvaluatorVersion: V3_CONTENT_EVALUATOR_VERSION,
      contentAuditVersion: V3_CONTENT_AUDIT_VERSION,
      audioAnalysisVersion: AUDIO_ANALYSIS_VERSION,
    },
    userScope: 'one resolved auth user',
    selector:
      plan.terminalAttemptIds.length > 0
        ? 'explicit_resultless_terminal_ids'
        : 'obsolete_generations',
    targetedGenerations: plan.generations,
    targetedTerminalAttemptIds: plan.terminalAttemptIds,
    targetedAttempts: plan.attempts.length,
    targetedByGeneration,
    currentAttemptsExcluded: currentTargetUserCount,
    inventory: plan.inventory,
    dependencies: {
      foreignKeys: plan.dependencies.foreignKeys,
      attemptTriggers: plan.dependencies.triggers,
      unexpectedReferences: plan.dependencies.unexpectedReferences.length,
      missingExpectedReferences: plan.dependencies.missingExpectedReferences,
      deleteTriggers: plan.dependencies.deleteTriggers.length,
      noteFeedbackRows: plan.dependencies.noteFeedbackRows,
      durableBestReferences: plan.dependencies.durableBestReferences,
      recomputedBestReferences: plan.dependencies.recomputedBestReferences,
      removedProgressRows: plan.dependencies.removedProgressRows,
      currentRetryChildren: plan.dependencies.currentRetryChildren,
      otherUserRetryChildren: plan.dependencies.otherUserRetryChildren,
      impactedActivityDays: plan.dependencies.impactedActivityDays,
      removedActivityDays: plan.dependencies.removedActivityDays,
      ownedAudioPaths: plan.dependencies.ownedAudioPaths.length,
      existingAudioObjects: plan.dependencies.existingAudioObjects,
      missingAudioObjects: plan.dependencies.missingAudioObjects,
      mismatchedAudioObjectOwners: plan.dependencies.mismatchedAudioObjectOwners,
      sharedAudioPaths: plan.dependencies.sharedAudioPaths,
      unsafeAudioPaths: plan.dependencies.unsafeAudioAttemptIds.length,
    },
    malformedPolicy: 'reported and excluded',
    unsupportedPolicy: 'reported and excluded',
    terminalResultlessPolicy:
      plan.terminalAttemptIds.length > 0
        ? 'only explicitly named failed or timed-out IDs are selected'
        : 'reported and excluded',
  }
}

async function deleteAudioObjects(paths: readonly string[]): Promise<number> {
  if (paths.length === 0) return 0
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    throw new Error(
      'Database cleanup committed, but Storage cleanup needs configured Supabase credentials.',
    )
  }
  const supabase = createClient(url, secret, { auth: { persistSession: false } })
  let removed = 0
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100)
    const { error } = await supabase.storage.from('recordings').remove(batch)
    if (error) {
      throw new Error(
        `Database cleanup committed, but Storage cleanup failed after ${removed} objects.`,
      )
    }
    removed += batch.length
  }
  return removed
}

async function main(): Promise<void> {
  loadEnvFile('.env.local')
  const args = parseCleanupArguments(process.argv.slice(2))
  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) throw new Error('SUPABASE_DB_URL is not configured.')
  const client = new pg.Client(databaseClientOptions(connectionString))
  await client.connect()
  try {
    const userId = await resolveUserId(client, args)
    if (!args.apply) await client.query('begin read only')
    const plan = await buildCleanupPlan(client, userId, args.generations, args.terminalAttemptIds)
    console.log(JSON.stringify(summarizedPlan(plan), null, 2))
    if (!args.apply) {
      await client.query('rollback')
      return
    }
    const result = await applyCleanupPlan(client, plan)
    const removedAudioObjects = args.deleteAudio
      ? await deleteAudioObjects(result.audioPathsToDelete)
      : 0
    console.log(
      JSON.stringify(
        {
          mode: 'apply',
          ...result,
          removedAudioObjects,
          audioDeletionRequested: args.deleteAudio,
        },
        null,
        2,
      ),
    )
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Cleanup failed.')
  process.exitCode = 1
})
