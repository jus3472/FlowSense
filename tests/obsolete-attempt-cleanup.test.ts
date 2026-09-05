import { describe, expect, it } from 'vitest'
import {
  classifyAttemptGeneration,
  ownedObsoleteAudioPaths,
  parseCleanupArguments,
  parseObsoleteGenerations,
  selectObsoleteAttempts,
  selectTerminalCleanupAttempts,
  type MaintenanceAttemptRow,
} from '@/lib/maintenance/obsolete-attempts'
import { assertSafePlan, type CleanupPlan } from '../scripts/lib/obsolete-attempt-cleanup'
import { v3Snapshot } from './helpers/result-snapshots'
import {
  legacySectionSnapshot,
  obsoleteV2Snapshot,
  obsoleteV3Snapshot,
} from './helpers/obsolete-result-snapshots'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '20000000-0000-4000-8000-000000000002'

function row(
  id: string,
  sectionScores: unknown,
  overrides: Partial<MaintenanceAttemptRow> = {},
): MaintenanceAttemptRow {
  const payload =
    typeof sectionScores === 'object' &&
    sectionScores !== null &&
    'total_earned_points' in sectionScores
      ? sectionScores
      : null
  const version =
    typeof sectionScores === 'object' && sectionScores !== null && 'version' in sectionScores
      ? sectionScores.version
      : null
  return {
    id,
    user_id: USER_ID,
    rubric_version:
      version === 'v2.score.1' ? 'v2' : version === null ? null : version ? 'v3' : null,
    practice_mode: 'practice',
    prompt_source: 'library',
    lesson_id: null,
    retry_of_attempt_id: null,
    status: 'done',
    duration_ms: 10_000,
    transcript: 'A complete test response.',
    score: payload ? (payload.total_earned_points as number | null) : 100,
    section_scores: sectionScores,
    metrics: null,
    content_result: null,
    audio_path: null,
    created_at: '2026-09-01T12:00:00.000Z',
    finished_at: '2026-09-01T12:00:10.000Z',
    ...overrides,
  }
}

describe('obsolete-attempt cleanup selection', () => {
  it('never accepts the current generation as a target', () => {
    expect(() => parseObsoleteGenerations(['v3.score.2'])).toThrow(/current/)
    const current = row('10000000-0000-4000-8000-000000000010', v3Snapshot())
    expect(classifyAttemptGeneration(current)).toEqual({
      kind: 'current',
      generation: 'v3.score.2',
    })
    expect(
      selectObsoleteAttempts(current ? [current] : [], USER_ID, new Set(['v3.score.1'])),
    ).toEqual([])
  })

  it('selects each exact supported obsolete generation', () => {
    const rows = [
      row('10000000-0000-4000-8000-000000000011', legacySectionSnapshot),
      row('10000000-0000-4000-8000-000000000012', obsoleteV2Snapshot()),
      row('10000000-0000-4000-8000-000000000013', obsoleteV3Snapshot()),
    ]
    expect(
      selectObsoleteAttempts(rows, USER_ID, new Set(['legacy', 'v2.score.1', 'v3.score.1'])).map(
        (attempt) => attempt.id,
      ),
    ).toEqual(rows.map((attempt) => attempt.id))
  })

  it('keeps another user and unfinished or malformed rows out of scope', () => {
    const obsolete = obsoleteV3Snapshot()
    const rows = [
      row('10000000-0000-4000-8000-000000000014', obsolete),
      row('20000000-0000-4000-8000-000000000015', obsolete, { user_id: OTHER_USER_ID }),
      row('10000000-0000-4000-8000-000000000016', obsolete, { status: 'scoring' }),
      row('10000000-0000-4000-8000-000000000017', { version: 'v3.score.1' }),
      row('10000000-0000-4000-8000-000000000018', {
        ...v3Snapshot(),
        version: 'future.score.1',
      }),
    ]
    expect(selectObsoleteAttempts(rows, USER_ID, new Set(['v3.score.1']))).toEqual([rows[0]])
    expect(classifyAttemptGeneration(rows[3]!)).toMatchObject({ kind: 'malformed' })
    expect(classifyAttemptGeneration(rows[4]!)).toMatchObject({ kind: 'unsupported' })
  })

  it('rejects forged obsolete payloads with incomplete or invalid nested shapes', () => {
    const valid = obsoleteV3Snapshot()
    const emptySections = row('10000000-0000-4000-8000-000000000022', {
      ...valid,
      sections: {},
    })
    const wrongMetricKeys = row('10000000-0000-4000-8000-000000000023', {
      ...valid,
      sections: {
        ...valid.sections,
        how_you_sounded: {
          ...valid.sections.how_you_sounded,
          metrics: { energy: valid.sections.how_you_sounded.metrics.energy },
        },
      },
    })
    const nonnumericPoints = row('10000000-0000-4000-8000-000000000024', {
      ...valid,
      sections: {
        ...valid.sections,
        what_you_said: { ...valid.sections.what_you_said, earned_points: '40' },
      },
    })
    const emptyCategories = row('10000000-0000-4000-8000-000000000025', {
      ...obsoleteV2Snapshot(),
      categories: {},
    })
    const legacySectionMismatch = row('10000000-0000-4000-8000-000000000026', {
      ...legacySectionSnapshot,
      content: { ...legacySectionSnapshot.content, earned: 49 },
    })
    const legacyRowMismatch = row('10000000-0000-4000-8000-000000000027', legacySectionSnapshot, {
      score: 99,
    })
    for (const candidate of [
      emptySections,
      wrongMetricKeys,
      nonnumericPoints,
      emptyCategories,
      legacySectionMismatch,
      legacyRowMismatch,
    ]) {
      expect(classifyAttemptGeneration(candidate)).toMatchObject({ kind: 'malformed' })
    }
    expect(
      selectObsoleteAttempts(
        [
          emptySections,
          wrongMetricKeys,
          nonnumericPoints,
          emptyCategories,
          legacySectionMismatch,
          legacyRowMismatch,
        ],
        USER_ID,
        new Set(['v2.score.1', 'v3.score.1']),
      ),
    ).toEqual([])
  })

  it('targets only exact owned immutable audio paths', () => {
    const attemptId = '10000000-0000-4000-8000-000000000019'
    const path = `${USER_ID}/${attemptId}.webm`
    const uploadOnlyAttemptId = '10000000-0000-4000-8000-000000000033'
    const uploadOnlyPath = `${USER_ID}/${uploadOnlyAttemptId}.webm`
    const valid = row(attemptId, obsoleteV3Snapshot(), {
      audio_path: path,
      metrics: { upload: { storage_path: path, mime_type: 'audio/webm' } },
    })
    const uploadOnly = row(uploadOnlyAttemptId, null, {
      status: 'failed',
      score: null,
      audio_path: null,
      metrics: {
        upload: { storage_path: uploadOnlyPath, mime_type: 'audio/webm' },
      },
    })
    const unsafe = row('10000000-0000-4000-8000-000000000020', obsoleteV3Snapshot(), {
      audio_path: `${OTHER_USER_ID}/shared.webm`,
      metrics: {
        upload: { storage_path: `${OTHER_USER_ID}/shared.webm`, mime_type: 'audio/webm' },
      },
    })
    expect(ownedObsoleteAudioPaths([valid, uploadOnly, unsafe], USER_ID)).toEqual({
      paths: [path, uploadOnlyPath],
      unsafeAttemptIds: [unsafe.id],
    })
  })

  it('keeps the CLI dry-run by default and requires an explicit version scope', () => {
    expect(parseCleanupArguments(['--only-user', '--generation', 'v3.score.1'])).toMatchObject({
      apply: false,
      deleteAudio: false,
      onlyUser: true,
      generations: ['v3.score.1'],
      terminalAttemptIds: [],
    })
    expect(() => parseCleanupArguments(['--only-user'])).toThrow(/exactly one cleanup selector/)
    expect(() =>
      parseCleanupArguments(['--only-user', '--generation', 'v3.score.1', '--delete-audio']),
    ).toThrow(/requires --apply/)
  })

  it('selects only exact owned resultless terminal IDs', () => {
    const failed = row('10000000-0000-4000-8000-000000000028', null, {
      status: 'failed',
      score: null,
      rubric_version: 'v3',
    })
    const timedOut = row('10000000-0000-4000-8000-000000000029', null, {
      status: 'timed_out',
      score: null,
    })
    expect(
      selectTerminalCleanupAttempts([failed, timedOut], USER_ID, [failed.id, timedOut.id]),
    ).toEqual([failed, timedOut])
    expect(
      parseCleanupArguments([
        '--only-user',
        '--terminal-attempt-id',
        failed.id,
        '--terminal-attempt-id',
        timedOut.id,
      ]),
    ).toMatchObject({
      apply: false,
      generations: [],
      terminalAttemptIds: [failed.id, timedOut.id],
    })
  })

  it('fails closed when an explicit terminal ID is missing, differently owned, or scored', () => {
    const failed = row('10000000-0000-4000-8000-000000000030', null, {
      status: 'failed',
      score: null,
    })
    const otherUser = row('10000000-0000-4000-8000-000000000031', null, {
      user_id: OTHER_USER_ID,
      status: 'timed_out',
      score: null,
    })
    const staleScored = row('10000000-0000-4000-8000-000000000032', v3Snapshot(), {
      status: 'failed',
    })
    expect(() =>
      selectTerminalCleanupAttempts([failed], USER_ID, [failed.id, otherUser.id]),
    ).toThrow(/resolve/)
    expect(() => selectTerminalCleanupAttempts([otherUser], USER_ID, [otherUser.id])).toThrow(
      /owned failed or timed-out/,
    )
    expect(() => selectTerminalCleanupAttempts([staleScored], USER_ID, [staleScored.id])).toThrow(
      /without a score result/,
    )
    expect(() =>
      parseCleanupArguments([
        '--only-user',
        '--generation',
        'v3.score.1',
        '--terminal-attempt-id',
        failed.id,
      ]),
    ).toThrow(/exactly one cleanup selector/)
  })

  it('fails closed before mutation when dependencies are unexpected', () => {
    const attempt = row('10000000-0000-4000-8000-000000000021', obsoleteV3Snapshot())
    const plan: CleanupPlan = {
      targetUserId: USER_ID,
      generations: ['v3.score.1'],
      terminalAttemptIds: [],
      inventory: [],
      attempts: [attempt],
      dependencies: {
        foreignKeys: [],
        triggers: [],
        unexpectedReferences: [
          {
            constraint_name: 'unexpected',
            source_schema: 'public',
            source_table: 'unexpected',
            source_column: 'attempt_id',
            delete_action: 'CASCADE',
          },
        ],
        missingExpectedReferences: [],
        deleteTriggers: [],
        noteFeedbackRows: 0,
        durableBestReferences: 0,
        recomputedBestReferences: 0,
        removedProgressRows: 0,
        currentRetryChildren: 0,
        otherUserRetryChildren: 0,
        impactedActivityDays: 0,
        removedActivityDays: 0,
        ownedAudioPaths: [],
        existingAudioObjects: 0,
        missingAudioObjects: 0,
        mismatchedAudioObjectOwners: 0,
        sharedAudioPaths: 0,
        unsafeAudioAttemptIds: [],
      },
    }
    expect(() => assertSafePlan(plan)).toThrow(/unexpected foreign keys/)
    expect(() =>
      assertSafePlan({
        ...plan,
        dependencies: {
          ...plan.dependencies,
          unexpectedReferences: [],
          mismatchedAudioObjectOwners: 1,
        },
      }),
    ).toThrow(/mismatched audio object ownership/)
  })
})
