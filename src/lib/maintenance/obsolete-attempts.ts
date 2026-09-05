import {
  validateOwnedAttemptAudioPath,
  validateOwnedAttemptUploadPath,
} from '@/lib/attempts/audio-path'
import { attemptStoragePath } from '@/lib/attempts/creation'
import { isRecordingMimeType } from '@/lib/recording/mime'
import { isV3ScorePayload } from '@/lib/scoring/v3/assemble'
import { V3_SCORE_PAYLOAD_VERSION } from '@/lib/scoring/v3/contracts'

const V2_SCORE_PAYLOAD_VERSION = 'v2.score.1' as const
const V3_LEGACY_SCORE_PAYLOAD_VERSION = 'v3.score.1' as const

const PRACTICE_MODES = ['practice', 'interview', 'presentation', 'conversation'] as const
type PracticeMode = (typeof PRACTICE_MODES)[number]
const V2_CATEGORIES = [
  'fluency',
  'clarity',
  'vocabulary',
  'grammar',
  'structure',
  'delivery',
] as const
const V3_WHAT_METRICS = [
  'answered_prompt',
  'specificity',
  'structure',
  'conciseness',
  'word_choice',
  'grammar',
] as const
const V3_LEGACY_SOUNDED_METRICS = [
  'pace',
  'time_to_first_word',
  'paused_time',
  'articulation',
  'energy',
] as const

const V2_WEIGHTS: Readonly<Record<PracticeMode, Readonly<Record<string, number>>>> = {
  practice: { fluency: 22, clarity: 20, vocabulary: 12, grammar: 12, structure: 18, delivery: 16 },
  interview: { fluency: 18, clarity: 22, vocabulary: 14, grammar: 12, structure: 22, delivery: 12 },
  presentation: { fluency: 16, clarity: 20, vocabulary: 14, grammar: 10, structure: 20, delivery: 20 },
  conversation: { fluency: 24, clarity: 22, vocabulary: 12, grammar: 12, structure: 14, delivery: 16 },
}

const V3_LEGACY_WEIGHTS: Readonly<
  Record<PracticeMode, { what_you_said: Readonly<Record<string, number>>; how_you_sounded: Readonly<Record<string, number>> }>
> = {
  practice: {
    what_you_said: { answered_prompt: 10, specificity: 9, structure: 9, conciseness: 8, word_choice: 7, grammar: 7 },
    how_you_sounded: { pace: 12, time_to_first_word: 5, paused_time: 10, articulation: 13, energy: 10 },
  },
  interview: {
    what_you_said: { answered_prompt: 12, specificity: 11, structure: 10, conciseness: 6, word_choice: 6, grammar: 5 },
    how_you_sounded: { pace: 10, time_to_first_word: 6, paused_time: 9, articulation: 15, energy: 10 },
  },
  presentation: {
    what_you_said: { answered_prompt: 9, specificity: 9, structure: 12, conciseness: 7, word_choice: 7, grammar: 6 },
    how_you_sounded: { pace: 12, time_to_first_word: 3, paused_time: 9, articulation: 11, energy: 15 },
  },
  conversation: {
    what_you_said: { answered_prompt: 9, specificity: 8, structure: 7, conciseness: 10, word_choice: 8, grammar: 8 },
    how_you_sounded: { pace: 11, time_to_first_word: 4, paused_time: 10, articulation: 15, energy: 10 },
  },
}

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
  terminalAttemptIds: string[]
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

function finiteScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function isPracticeMode(value: unknown): value is PracticeMode {
  return typeof value === 'string' && (PRACTICE_MODES as readonly string[]).includes(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => key in value)
}

function validLegacySnapshot(value: unknown, rowScore: number | null): boolean {
  if (!isRecord(value) || !exactKeys(value, ['content', 'delivery']) ||
      !isRecord(value.content) || !isRecord(value.delivery)) return false
  const content = value.content
  const delivery = value.delivery
  const contentMaxima = { answered: 14, explained: 12, word_choice: 12, logical_order: 7, no_repetition: 5 }
  const deliveryMaxima = { fillers: 18, mid_sentence_pauses: 14, energy: 8, pace: 6, time_to_first_word: 4 }
  if (!(
    exactKeys(content, ['earned', 'max', 'checks']) &&
    exactKeys(delivery, ['earned', 'max', 'metrics']) &&
    finiteScore(content.earned) &&
    content.max === 50 &&
    isRecord(content.checks) &&
    exactKeys(content.checks, [
      'answered',
      'explained',
      'word_choice',
      'logical_order',
      'no_repetition',
    ]) &&
    Object.entries(content.checks).every(([key, points]) =>
      Number.isInteger(points) && Number(points) >= 0 && Number(points) <= contentMaxima[key as keyof typeof contentMaxima]) &&
    finiteScore(delivery.earned) &&
    delivery.max === 50 &&
    isRecord(delivery.metrics) &&
    exactKeys(delivery.metrics, [
      'fillers',
      'mid_sentence_pauses',
      'energy',
      'pace',
      'time_to_first_word',
    ]) &&
    Object.entries(delivery.metrics).every(([key, points]) =>
      Number.isInteger(points) && Number(points) >= 0 && Number(points) <= deliveryMaxima[key as keyof typeof deliveryMaxima])
  )) return false
  const contentEarned = Object.values(content.checks).reduce<number>((sum, points) => sum + Number(points), 0)
  const deliveryEarned = Object.values(delivery.metrics).reduce<number>((sum, points) => sum + Number(points), 0)
  return content.earned === contentEarned && delivery.earned === deliveryEarned &&
    rowScore === contentEarned + deliveryEarned
}

function validObsoleteVersionedSnapshot(
  row: MaintenanceAttemptRow,
  version: typeof V2_SCORE_PAYLOAD_VERSION | typeof V3_LEGACY_SCORE_PAYLOAD_VERSION,
): boolean {
  const payload = row.section_scores
  if (!isRecord(payload) || payload.version !== version || !isPracticeMode(payload.mode)) return false
  const rubric = version === V2_SCORE_PAYLOAD_VERSION ? 'v2' : 'v3'
  if (
    payload.rubric_version !== rubric ||
    row.rubric_version !== rubric ||
    payload.mode !== row.practice_mode ||
    payload.total_earned_points !== row.score
  ) return false
  return version === V2_SCORE_PAYLOAD_VERSION
    ? validV2Snapshot(payload, payload.mode)
    : validLegacyV3Snapshot(payload, payload.mode)
}

function validV2Category(value: unknown, category: string, maxPoints: number): boolean {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'category', 'availability', 'status', 'component', 'earned_points', 'max_points',
      'measurements', 'evidence', 'deductions', 'warnings',
    ]) ||
    value.category !== category ||
    value.max_points !== maxPoints ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(isRecord) ||
    !Array.isArray(value.deductions) ||
    !value.deductions.every(isRecord) ||
    !isStringArray(value.warnings)
  ) return false
  if (value.status === 'scored') {
    return value.availability === 'available' &&
      typeof value.component === 'number' && Number.isFinite(value.component) &&
      value.component >= 0 && value.component <= 1 &&
      Number.isInteger(value.earned_points) &&
      value.earned_points === Math.round(value.component * maxPoints)
  }
  if (value.status === 'not_checked') {
    return value.availability === 'available' && value.component === null && value.earned_points === null
  }
  return value.status === 'unavailable' && value.availability === 'unavailable' &&
    value.component === null && value.earned_points === null
}

function validV2Snapshot(value: Record<string, unknown>, mode: PracticeMode): boolean {
  const categoryValues = isRecord(value.categories) ? value.categories : null
  if (
    !exactKeys(value, [
      'version', 'rubric_version', 'mode', 'total_earned_points', 'total_max_points',
      'categories', 'warnings',
    ]) ||
    value.version !== V2_SCORE_PAYLOAD_VERSION || value.rubric_version !== 'v2' ||
    value.total_max_points !== 100 || categoryValues === null ||
    !exactKeys(categoryValues, V2_CATEGORIES) || !isStringArray(value.warnings)
  ) return false
  const weights = V2_WEIGHTS[mode]
  if (!V2_CATEGORIES.every((category) => validV2Category(categoryValues[category], category, weights[category]!))) {
    return false
  }
  const categories = V2_CATEGORIES.map((category) => categoryValues[category] as Record<string, unknown>)
  const complete = categories.every((category) => category.status === 'scored')
  if (!complete) return value.total_earned_points === null
  return Number.isInteger(value.total_earned_points) && value.total_earned_points ===
    categories.reduce((total, category) => total + Number(category.earned_points), 0)
}

function validV3Evidence(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ['source', 'start', 'end', 'coordinate', 'quote', 'detail'])) return false
  if (typeof value.source !== 'string' || typeof value.detail !== 'string' ||
      (typeof value.quote !== 'string' && value.quote !== null)) return false
  if (value.start === null || value.end === null) {
    return value.start === null && value.end === null && value.coordinate === null && value.quote === null
  }
  return typeof value.start === 'number' && Number.isFinite(value.start) && value.start >= 0 &&
    typeof value.end === 'number' && Number.isFinite(value.end) && value.end > value.start &&
    isRecord(value.coordinate) && exactKeys(value.coordinate, ['space', 'unit']) &&
    ((value.coordinate.space === 'transcript' && value.coordinate.unit === 'utf16_code_unit' &&
      Number.isInteger(value.start) && Number.isInteger(value.end)) ||
      (value.coordinate.space === 'audio_timeline' &&
        (value.coordinate.unit === 'millisecond' || value.coordinate.unit === 'second')))
}

function validV3Detail(value: unknown): boolean {
  return isRecord(value) &&
    exactKeys(value, ['kind', 'source', 'quote', 'observation', 'suggestion', 'evidence']) &&
    typeof value.kind === 'string' &&
    (value.source === 'ai' || value.source === 'mechanical' || value.source === 'audio') &&
    (typeof value.quote === 'string' || value.quote === null) &&
    typeof value.observation === 'string' &&
    (typeof value.suggestion === 'string' || value.suggestion === null) &&
    Array.isArray(value.evidence) && value.evidence.every(validV3Evidence)
}

function validV3Measurements(value: unknown): boolean {
  return value === null || (isRecord(value) && Object.values(value).every((item) =>
    item === null || typeof item === 'string' || typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item))))
}

function validV3Metric(value: unknown, metric: string, maxPoints: number): boolean {
  if (!isRecord(value) || !exactKeys(value, [
    'metric', 'status', 'component', 'earned_points', 'max_points', 'explanation',
    'measurements', 'evidence', 'details', 'warnings',
  ]) || value.metric !== metric || value.max_points !== maxPoints ||
    !validV3Measurements(value.measurements) || !Array.isArray(value.evidence) ||
    !value.evidence.every(validV3Evidence) || !Array.isArray(value.details) ||
    !value.details.every(validV3Detail) || !isStringArray(value.warnings)) return false
  if (value.status === 'scored') {
    return typeof value.component === 'number' && Number.isFinite(value.component) &&
      value.component >= 0 && value.component <= 1 && Number.isInteger(value.earned_points) &&
      value.earned_points === Math.round(value.component * maxPoints) &&
      typeof value.explanation === 'string' && value.explanation.trim().length > 0
  }
  return (value.status === 'not_checked' || value.status === 'unavailable') &&
    value.component === null && value.earned_points === null && value.explanation === null &&
    value.measurements === null && value.evidence.length === 0 && value.details.length === 0
}

function validV3Section(
  value: unknown,
  section: 'what_you_said' | 'how_you_sounded',
  metrics: readonly string[],
  weights: Readonly<Record<string, number>>,
): boolean {
  const metricValues = isRecord(value) && isRecord(value.metrics) ? value.metrics : null
  if (!isRecord(value) || !exactKeys(value, ['section', 'status', 'earned_points', 'max_points', 'metrics']) ||
    value.section !== section || value.max_points !== 50 || metricValues === null ||
    !exactKeys(metricValues, metrics) ||
    !metrics.every((metric) => validV3Metric(metricValues[metric], metric, weights[metric]!))) return false
  const values = metrics.map((metric) => metricValues[metric] as Record<string, unknown>)
  const complete = values.every((metric) => metric.status === 'scored')
  const unavailable = values.every((metric) => metric.status === 'unavailable')
  const status = complete ? 'scored' : unavailable ? 'unavailable' : 'not_checked'
  if (value.status !== status) return false
  return complete
    ? Number.isInteger(value.earned_points) && value.earned_points === values.reduce((sum, metric) => sum + Number(metric.earned_points), 0)
    : value.earned_points === null
}

function validLegacyV3Snapshot(value: Record<string, unknown>, mode: PracticeMode): boolean {
  if (!exactKeys(value, [
    'version', 'rubric_version', 'mode', 'total_earned_points', 'total_max_points',
    'sections', 'recommendation', 'warnings',
  ]) || value.version !== V3_LEGACY_SCORE_PAYLOAD_VERSION || value.rubric_version !== 'v3' ||
    value.total_max_points !== 100 || !isRecord(value.sections) ||
    !exactKeys(value.sections, ['what_you_said', 'how_you_sounded']) || !isStringArray(value.warnings)) return false
  const weights = V3_LEGACY_WEIGHTS[mode]
  if (!validV3Section(value.sections.what_you_said, 'what_you_said', V3_WHAT_METRICS, weights.what_you_said) ||
      !validV3Section(value.sections.how_you_sounded, 'how_you_sounded', V3_LEGACY_SOUNDED_METRICS, weights.how_you_sounded)) return false
  const what = value.sections.what_you_said as Record<string, unknown>
  const sounded = value.sections.how_you_sounded as Record<string, unknown>
  const complete = what.status === 'scored' && sounded.status === 'scored'
  if (!complete) return value.total_earned_points === null && value.recommendation === null
  const total = Number(what.earned_points) + Number(sounded.earned_points)
  return value.total_earned_points === total && total <= 100 && isRecord(value.recommendation) &&
    exactKeys(value.recommendation, ['strongest_metric', 'weakest_metric', 'text']) &&
    [...V3_WHAT_METRICS, ...V3_LEGACY_SOUNDED_METRICS].includes(value.recommendation.strongest_metric as never) &&
    [...V3_WHAT_METRICS, ...V3_LEGACY_SOUNDED_METRICS].includes(value.recommendation.weakest_metric as never) &&
    typeof value.recommendation.text === 'string' && value.recommendation.text.trim().length > 0
}

export function classifyAttemptGeneration(
  row: MaintenanceAttemptRow,
): AttemptGenerationClassification {
  if (row.section_scores === null) return { kind: 'no_result', generation: 'none' }
  if (isV3ScorePayload(row.section_scores)) {
    if (
      row.rubric_version !== row.section_scores.rubric_version ||
      row.practice_mode !== row.section_scores.mode ||
      row.score !== row.section_scores.total_earned_points
    ) {
      return { kind: 'malformed', generation: row.section_scores.version }
    }
    return { kind: 'current', generation: V3_SCORE_PAYLOAD_VERSION }
  }
  if (isRecord(row.section_scores) && 'content' in row.section_scores && 'delivery' in row.section_scores) {
    return row.rubric_version === null && validLegacySnapshot(row.section_scores, row.score)
      ? { kind: 'obsolete', generation: 'legacy' }
      : { kind: 'malformed', generation: 'legacy' }
  }
  const generation = declaredGeneration(row)
  if (generation === V2_SCORE_PAYLOAD_VERSION || generation === V3_LEGACY_SCORE_PAYLOAD_VERSION) {
    return validObsoleteVersionedSnapshot(row, generation)
      ? { kind: 'obsolete', generation }
      : { kind: 'malformed', generation }
  }
  return isRecord(row.section_scores) && typeof row.section_scores.version === 'string'
    ? { kind: 'unsupported', generation }
    : { kind: 'malformed', generation }
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

export function isSelectableTerminalCleanupAttempt(
  row: MaintenanceAttemptRow,
  targetUserId: string,
): boolean {
  return (
    row.user_id === targetUserId &&
    (row.status === 'failed' || row.status === 'timed_out') &&
    row.score === null &&
    row.section_scores === null
  )
}

/**
 * Selects only explicitly named resultless terminal rows. Missing, cross-user,
 * active, completed, or result-bearing IDs fail closed rather than narrowing
 * the request silently.
 */
export function selectTerminalCleanupAttempts(
  rows: readonly MaintenanceAttemptRow[],
  targetUserId: string,
  attemptIds: readonly string[],
): MaintenanceAttemptRow[] {
  const requested = new Set(attemptIds)
  const matched = rows.filter((row) => requested.has(row.id))
  if (matched.length !== requested.size) {
    throw new Error('Every terminal attempt ID must resolve to exactly one stored attempt.')
  }
  if (!matched.every((row) => isSelectableTerminalCleanupAttempt(row, targetUserId))) {
    throw new Error(
      'Every terminal attempt ID must be an owned failed or timed-out row without a score result.',
    )
  }
  return matched
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
    const owned =
      row.audio_path === null
        ? validateOwnedAttemptUploadPath({
            userId: targetUserId,
            attemptId: row.id,
            metrics: row.metrics,
          })
        : validateOwnedAttemptAudioPath({
            userId: targetUserId,
            attemptId: row.id,
            audioPath: row.audio_path,
            metrics: row.metrics,
          })
    if (owned) {
      paths.push(owned.storagePath)
      continue
    }

    if (row.audio_path === null) {
      if (isRecord(row.metrics) && row.metrics.upload !== undefined) {
        unsafeAttemptIds.push(row.id)
      }
      continue
    }

    // Maintenance can still remove an explicitly selected historical row that
    // predates immutable upload snapshots. Runtime storage access never uses
    // this capture-only compatibility path.
    const capture = isRecord(row.metrics) ? row.metrics.capture : null
    const mimeType = isRecord(capture) ? capture.mime_type : null
    const legacyOwned =
      isRecord(row.metrics) &&
      row.metrics.upload === undefined &&
      typeof mimeType === 'string' &&
      isRecordingMimeType(mimeType) &&
      row.audio_path === attemptStoragePath(targetUserId, row.id, mimeType)
    if (legacyOwned) paths.push(row.audio_path)
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
  const terminalAttemptIds: string[] = []

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
    } else if (flag === '--terminal-attempt-id') {
      terminalAttemptIds.push(argumentValue(argv, index, flag))
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
  const uniqueTerminalAttemptIds = [...new Set(terminalAttemptIds)]
  for (const attemptId of uniqueTerminalAttemptIds) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
      throw new Error('--terminal-attempt-id must be a UUID.')
    }
  }
  if ((generationValues.length > 0) === (uniqueTerminalAttemptIds.length > 0)) {
    throw new Error(
      'Choose exactly one cleanup selector: --generation or --terminal-attempt-id.',
    )
  }

  return {
    apply,
    deleteAudio,
    generations: generationValues.length > 0 ? parseObsoleteGenerations(generationValues) : [],
    terminalAttemptIds: uniqueTerminalAttemptIds,
    ...(userId ? { userId } : {}),
    ...(userEmail ? { userEmail } : {}),
    onlyUser,
  }
}
