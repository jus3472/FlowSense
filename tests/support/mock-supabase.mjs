import { createServer } from 'node:http'

const HOST = '127.0.0.1'
const PORT = 54321
const USER_ID = '00000000-0000-4000-8000-000000000001'
const RUN_STARTED_AT = Date.now()
const FREE_PROMPTS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    text: 'Tell me about a time you solved a difficult problem.',
    active: true,
    mode: 'interview',
    difficulty: 'intermediate',
    target_duration_seconds: 30,
    collection_id: 'behavioral',
    free_practice_visible: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    text: 'Describe one small change that would improve your day.',
    active: true,
    mode: 'practice',
    difficulty: 'beginner',
    target_duration_seconds: 30,
    collection_id: 'reflection',
    free_practice_visible: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
]
const PATH_DEFINITIONS = [
  { slug: 'general-speaking', title: 'General Speaking', mode: 'practice' },
  { slug: 'interviews', title: 'Interviews', mode: 'interview' },
  { slug: 'presentations', title: 'Presentations', mode: 'presentation' },
  { slug: 'conversations', title: 'Conversations', mode: 'conversation' },
]
const CHAPTER_LEVELS = ['beginner', 'intermediate', 'advanced']
const uuid = (prefix, sequence) =>
  `${prefix}0000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
const PRACTICE_PATHS = PATH_DEFINITIONS.map((path, pathIndex) => ({
  id: uuid('3', pathIndex + 1),
  ...path,
  position: pathIndex + 1,
  active: true,
}))
const PRACTICE_CHAPTERS = PRACTICE_PATHS.flatMap((path, pathIndex) =>
  CHAPTER_LEVELS.map((level, chapterIndex) => ({
    id: uuid('4', pathIndex * CHAPTER_LEVELS.length + chapterIndex + 1),
    path_id: path.id,
    level,
    title: `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`,
    position: chapterIndex + 1,
    active: true,
  })),
)
const PRACTICE_LESSONS = PRACTICE_CHAPTERS.flatMap((chapter, chapterIndex) => {
  const path = PRACTICE_PATHS.find((candidate) => candidate.id === chapter.path_id)
  if (!path) throw new Error('E2E curriculum chapter is missing its path.')
  return Array.from({ length: 10 }, (_, lessonIndex) => {
    const position = lessonIndex + 1
    const sequence = chapterIndex * 10 + position
    return {
      id: uuid('5', sequence),
      chapter_id: chapter.id,
      slug: `${path.slug}-${chapter.level}-${String(position).padStart(2, '0')}-skill-${position}`,
      title: `${chapter.title} lesson ${position}`,
      skill_focus: `Practice one clear ${path.title.toLowerCase()} response.`,
      position,
      checkpoint: position === 10,
      prompt_id: uuid('6', sequence),
      active: true,
    }
  })
})
const CURRICULUM_PROMPTS = PRACTICE_LESSONS.map((lesson) => {
  const chapter = PRACTICE_CHAPTERS.find((candidate) => candidate.id === lesson.chapter_id)
  const path = PRACTICE_PATHS.find((candidate) => candidate.id === chapter?.path_id)
  if (!chapter || !path) throw new Error('E2E curriculum lesson is missing its chapter or path.')
  return {
    id: lesson.prompt_id,
    text: `Give a clear response for ${lesson.title.toLowerCase()}.`,
    active: true,
    mode: path.mode,
    difficulty: chapter.level,
    target_duration_seconds: 60,
    collection_id: null,
    free_practice_visible: false,
    created_at: '2026-08-28T00:00:00.000Z',
  }
})
const PROMPTS = [...FREE_PROMPTS, ...CURRICULUM_PROMPTS]
const QUERY_CONTROL_KEYS = new Set(['select', 'order', 'limit', 'offset', 'or'])
const WEIGHTS = {
  practice: [22, 20, 12, 12, 18, 16],
  interview: [18, 22, 14, 12, 22, 12],
  presentation: [16, 20, 14, 10, 20, 20],
  conversation: [24, 22, 12, 12, 14, 16],
}

let state

const jwt = () =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: USER_ID, role: 'authenticated', exp: 4102444800 })).toString('base64url')}.e2e`

const user = () => ({
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'speaker@example.test',
  user_metadata: state.userMetadata,
  app_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
})

function reset() {
  state = {
    userMetadata: { onboarded_at: '2026-01-01T00:00:00.000Z' },
    profile: {
      id: USER_ID,
      display_name: 'Test Speaker',
      focus_areas: ['interviews'],
      created_at: '2026-01-01T00:00:00.000Z',
    },
    attempts: [],
    lessonProgress: [],
    pathPreferences: [{ user_id: USER_ID, path_id: PRACTICE_PATHS[1].id, rank: 0 }],
    lifecycleEvents: [],
    uploadedObjects: [],
    uploads: 0,
    attemptInserts: 0,
    next: 1,
    clock: 1,
  }
}

reset()

function seedLessonProgress(input) {
  const path = PRACTICE_PATHS.find((candidate) => candidate.slug === input?.pathSlug)
  const passedLessons = Number.isInteger(input?.passedLessons) ? input.passedLessons : 0
  const score =
    Number.isInteger(input?.score) && input.score >= 70 && input.score <= 100 ? input.score : 70
  if (!path || passedLessons < 0 || passedLessons > 30) return
  const chapterIds = PRACTICE_CHAPTERS.filter((chapter) => chapter.path_id === path.id).map(
    (chapter) => chapter.id,
  )
  const lessons = PRACTICE_LESSONS.filter((lesson) => chapterIds.includes(lesson.chapter_id)).sort(
    (left, right) => {
      const leftChapter = PRACTICE_CHAPTERS.find((chapter) => chapter.id === left.chapter_id)
      const rightChapter = PRACTICE_CHAPTERS.find((chapter) => chapter.id === right.chapter_id)
      return (
        (leftChapter?.position ?? 0) - (rightChapter?.position ?? 0) ||
        left.position - right.position
      )
    },
  )
  state.lessonProgress = lessons.slice(0, passedLessons).map((lesson, index) => ({
    user_id: USER_ID,
    lesson_id: lesson.id,
    best_score: score,
    best_attempt_id: null,
    created_at: new Date(RUN_STARTED_AT + index * 1_000).toISOString(),
    updated_at: new Date(RUN_STARTED_AT + index * 1_000).toISOString(),
  }))
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(value))
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}

async function bytes(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function selected(row, value) {
  if (!value || value === '*') return row
  const output = {}
  for (const field of value.split(',')) {
    const key = field.trim()
    if (key in row) output[key] = row[key]
  }
  return output
}

function singular(req, rows) {
  return req.headers.accept?.includes('vnd.pgrst.object') ? (rows[0] ?? null) : rows
}

function fieldValue(row, field) {
  const [column, jsonKey] = field.split('->>')
  if (!jsonKey) return row[column]
  const source = row[column]
  return source && typeof source === 'object' ? source[jsonKey] : null
}

function splitOrExpressions(value) {
  const source = value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1) : value
  const expressions = []
  let depth = 0
  let current = ''
  for (const character of source) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      expressions.push(current)
      current = ''
    } else {
      current += character
    }
  }
  if (current) expressions.push(current)
  return expressions
}

function parseFilter(expression) {
  const match = expression.match(/^(.+?)\.(not\.is|is|eq|neq|gte|gt|lte|lt|in)\.(.*)$/)
  return match ? { field: match[1], operator: match[2], operand: match[3] } : null
}

function comparable(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return value
}

function matchesFilter(row, expression) {
  const filter = parseFilter(expression)
  if (!filter) return false
  const actual = fieldValue(row, filter.field)
  const expected = filter.operand
  if (filter.operator === 'eq') return String(actual) === expected
  if (filter.operator === 'neq') return String(actual) !== expected
  if (filter.operator === 'is')
    return expected === 'null' ? actual == null : String(actual) === expected
  if (filter.operator === 'not.is') {
    return expected === 'null' ? actual != null : String(actual) !== expected
  }
  if (filter.operator === 'in') {
    const choices =
      expected.startsWith('(') && expected.endsWith(')') ? expected.slice(1, -1).split(',') : []
    return choices.includes(String(actual))
  }
  const left = comparable(actual)
  const right = comparable(expected)
  if (filter.operator === 'gte') return left >= right
  if (filter.operator === 'gt') return left > right
  if (filter.operator === 'lte') return left <= right
  if (filter.operator === 'lt') return left < right
  return false
}

function compareValues(left, right) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  const leftComparable = comparable(left)
  const rightComparable = comparable(right)
  if (leftComparable < rightComparable) return -1
  if (leftComparable > rightComparable) return 1
  return 0
}

function requestedRange(req, url) {
  const range = req.headers.range?.match(/^(\d+)-(\d+)$/)
  const offset = range ? Number(range[1]) : Number(url.searchParams.get('offset') ?? 0)
  const limit = range
    ? Number(range[2]) - offset + 1
    : Number(url.searchParams.get('limit') ?? Number.POSITIVE_INFINITY)
  return { offset, limit }
}

function queryRows(req, rows, url, paginate = true) {
  let result = [...rows]
  for (const [key, value] of url.searchParams) {
    if (QUERY_CONTROL_KEYS.has(key)) continue
    result = result.filter((row) => matchesFilter(row, `${key}.${value}`))
  }
  const or = url.searchParams.get('or')
  if (or) {
    const expressions = splitOrExpressions(or)
    result = result.filter((row) =>
      expressions.some((expression) => matchesFilter(row, expression)),
    )
  }
  const order = url.searchParams.get('order')
  if (order) {
    const fields = order.split(',').map((entry) => {
      const [field, direction = 'asc'] = entry.split('.')
      return { field, descending: direction === 'desc' }
    })
    result.sort((left, right) => {
      for (const field of fields) {
        const comparison = compareValues(
          fieldValue(left, field.field),
          fieldValue(right, field.field),
        )
        if (comparison !== 0) return field.descending ? -comparison : comparison
      }
      return 0
    })
  }
  const total = result.length
  if (paginate) {
    const { offset, limit } = requestedRange(req, url)
    result = result.slice(offset, Number.isFinite(limit) ? offset + limit : undefined)
  }
  return { rows: result, total }
}

function timestamp() {
  return new Date(RUN_STARTED_AT + state.clock++ * 1_000).toISOString()
}

function allocateScore(weights, score) {
  const raw = weights.map((weight) => (weight * score) / 100)
  const earned = raw.map(Math.floor)
  let remaining = score - earned.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (const item of order) {
    if (remaining <= 0) break
    earned[item.index] += 1
    remaining -= 1
  }
  return earned
}

function scorePayload(attempt, failure = false, forcedScore = null) {
  const names = ['fluency', 'clarity', 'vocabulary', 'grammar', 'structure', 'delivery']
  const weights = WEIGHTS[attempt.practice_mode] ?? WEIGHTS.practice
  const forcedEarned = forcedScore === null ? null : allocateScore(weights, forcedScore)
  const categories = Object.fromEntries(
    names.map((name, index) => {
      const unavailable = failure && ['vocabulary', 'grammar', 'structure'].includes(name)
      const max = weights[index]
      const earned =
        forcedEarned === null
          ? Math.max(0, max - (state.attempts.length > 1 ? 1 : 3))
          : forcedEarned[index]
      return [
        name,
        {
          category: name,
          availability: 'available',
          status: unavailable ? 'not_checked' : 'scored',
          component: unavailable ? null : earned / max,
          earned_points: unavailable ? null : earned,
          max_points: max,
          measurements: {},
          evidence: [],
          deductions: unavailable ? [] : [{ detail: `${name} measurement.` }],
          warnings: unavailable ? ['Provider check was unavailable.'] : [],
        },
      ]
    }),
  )
  return {
    version: 'v2.score.1',
    rubric_version: 'v2',
    mode: attempt.practice_mode,
    total_earned_points: failure
      ? null
      : Object.values(categories).reduce((sum, item) => sum + item.earned_points, 0),
    total_max_points: 100,
    categories,
    warnings: failure ? ['Some provider checks were unavailable.'] : [],
  }
}

function raiseLessonProgress(attempt) {
  const snapshot = attempt.section_scores
  if (
    typeof attempt.lesson_id !== 'string' ||
    attempt.status !== 'done' ||
    typeof attempt.score !== 'number' ||
    attempt.score < 0 ||
    attempt.score > 100 ||
    attempt.rubric_version !== 'v2' ||
    snapshot?.version !== 'v2.score.1' ||
    snapshot?.rubric_version !== 'v2' ||
    snapshot?.mode !== attempt.practice_mode ||
    snapshot?.total_earned_points !== attempt.score ||
    snapshot?.total_max_points !== 100
  ) {
    return
  }
  const lesson = PRACTICE_LESSONS.find((candidate) => candidate.id === attempt.lesson_id)
  const chapter = PRACTICE_CHAPTERS.find((candidate) => candidate.id === lesson?.chapter_id)
  const path = PRACTICE_PATHS.find((candidate) => candidate.id === chapter?.path_id)
  if (
    !lesson ||
    !chapter ||
    !path ||
    !lesson.active ||
    !chapter.active ||
    !path.active ||
    lesson.prompt_id !== attempt.prompt_id ||
    path.mode !== attempt.practice_mode
  ) {
    return
  }
  const categories = Object.entries(snapshot.categories ?? {})
  const validNames = new Set([
    'fluency',
    'clarity',
    'vocabulary',
    'grammar',
    'structure',
    'delivery',
  ])
  if (
    categories.length !== 6 ||
    categories.some(
      ([name, category]) =>
        !validNames.has(name) ||
        category?.category !== name ||
        category?.availability !== 'available' ||
        category?.status !== 'scored' ||
        typeof category?.earned_points !== 'number' ||
        typeof category?.max_points !== 'number',
    ) ||
    categories.reduce((sum, [, category]) => sum + category.earned_points, 0) !== attempt.score ||
    categories.reduce((sum, [, category]) => sum + category.max_points, 0) !== 100
  ) {
    return
  }

  const existing = state.lessonProgress.find(
    (row) => row.user_id === attempt.user_id && row.lesson_id === attempt.lesson_id,
  )
  if (existing && existing.best_score > attempt.score) return
  if (existing) {
    existing.best_score = attempt.score
    existing.best_attempt_id = attempt.id
    existing.updated_at = timestamp()
    return
  }
  const now = timestamp()
  state.lessonProgress.push({
    user_id: attempt.user_id,
    lesson_id: attempt.lesson_id,
    best_score: attempt.score,
    best_attempt_id: attempt.id,
    created_at: now,
    updated_at: now,
  })
}

function wordsForTranscript(transcript) {
  return transcript.split(' ').map((word, index) => ({
    word: word.replace(/[,.]$/, ''),
    punctuated_word: word,
    start: index * 0.35,
    end: index * 0.35 + 0.28,
    confidence: 0.99,
  }))
}

function findUploadedObject(name) {
  return state.uploadedObjects.find((object) => object.name === name)
}

function storageObjectName(pathname, prefix) {
  return decodeURIComponent(pathname.slice(prefix.length)).replace(/^\/+/, '')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*')
  res.setHeader('access-control-allow-headers', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return json(res, 200, {})

  if (url.pathname === '/__e2e/reset' && req.method === 'POST') {
    const input = await body(req)
    reset()
    if (input.onboarded === false) state.userMetadata = {}
    if (input.curriculum) seedLessonProgress(input.curriculum)
    return json(res, 200, state)
  }
  if (url.pathname === '/__e2e/state' && req.method === 'GET') return json(res, 200, state)

  if (url.pathname.startsWith('/__e2e/transcribe/') && req.method === 'POST') {
    const id = url.pathname.split('/').at(-1)
    const attempt = state.attempts.find((item) => item.id === id)
    if (!attempt || attempt.status !== 'transcribing') {
      return json(res, 409, { message: 'attempt is not ready for transcription' })
    }
    const storagePath = attempt.metrics?.upload?.storage_path
    if (typeof storagePath !== 'string' || !findUploadedObject(storagePath)) {
      return json(res, 409, { message: 'recording upload is missing' })
    }
    const transcript =
      'I solved the problem by listening, testing one change, and explaining the result.'
    const transcriptMetrics = {
      provider: 'deepgram',
      model: 'nova-2',
      words: wordsForTranscript(transcript),
      quality: { status: 'checked', diagnostics: [] },
    }
    attempt.transcript = transcript
    attempt.metrics = { ...attempt.metrics, transcript: transcriptMetrics }
    attempt.status = 'scoring'
    attempt.status_changed_at = timestamp()
    attempt.failure_code = null
    state.lifecycleEvents.push({ attemptId: attempt.id, status: 'scoring' })
    return json(res, 200, { wordCount: transcriptMetrics.words.length })
  }

  if (url.pathname.startsWith('/__e2e/score/') && req.method === 'POST') {
    const id = url.pathname.split('/').at(-1)
    const attempt = state.attempts.find((item) => item.id === id)
    if (!attempt || attempt.status !== 'scoring') {
      return json(res, 409, { message: 'attempt is not ready for scoring' })
    }
    const input = await body(req)
    const failure = input.failure === true
    const forcedScore =
      Number.isInteger(input.score) && input.score >= 0 && input.score <= 100 ? input.score : null
    const snapshot = scorePayload(attempt, failure, forcedScore)
    attempt.score = failure ? null : snapshot.total_earned_points
    attempt.section_scores = snapshot
    attempt.content_result = null
    attempt.metrics = {
      ...attempt.metrics,
      v2: {
        score: snapshot,
        content: { status: failure ? 'not_checked' : 'checked' },
        scored_at: timestamp(),
      },
    }
    attempt.status = 'done'
    attempt.status_changed_at = timestamp()
    attempt.finished_at = timestamp()
    attempt.failure_code = null
    state.lifecycleEvents.push({ attemptId: attempt.id, status: 'done' })
    raiseLessonProgress(attempt)
    return json(res, 200, {
      score: attempt.score,
      wordCount: attempt.metrics.transcript.words.length,
    })
  }

  if (url.pathname === '/auth/v1/signup' || url.pathname === '/auth/v1/token') {
    state.profile = { ...state.profile, focus_areas: [] }
    if (url.pathname.endsWith('signup')) state.userMetadata = {}
    const session = {
      access_token: jwt(),
      refresh_token: 'e2e-refresh-token',
      expires_in: 3600,
      expires_at: 4102444800,
      token_type: 'bearer',
      user: user(),
    }
    return json(res, 200, session)
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') return json(res, 200, user())
  if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
    const input = await body(req)
    state.userMetadata = { ...state.userMetadata, ...(input.data ?? {}) }
    return json(res, 200, user())
  }
  if (url.pathname === '/auth/v1/logout') return json(res, 204, null)

  if (url.pathname === '/storage/v1/object/list/recordings' && req.method === 'POST') {
    const input = await body(req)
    const prefix = typeof input.prefix === 'string' ? input.prefix.replace(/\/$/, '') : ''
    const search = typeof input.search === 'string' ? input.search : ''
    const offset = Number.isInteger(input.offset) ? input.offset : 0
    const limit = Number.isInteger(input.limit) ? input.limit : 100
    const objects = state.uploadedObjects
      .filter((object) => !prefix || object.name.startsWith(`${prefix}/`))
      .map((object) => ({
        ...object,
        name: prefix ? object.name.slice(prefix.length + 1) : object.name,
      }))
      .filter((object) => !search || object.name.includes(search))
      .slice(offset, offset + limit)
    return json(res, 200, objects)
  }

  if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/recordings/')) {
    return json(res, 200, { signedURL: '/storage/v1/object/e2e-audio.webm' })
  }

  if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/recordings/')) {
    const prefix = '/storage/v1/object/recordings/'
    const name = storageObjectName(url.pathname, prefix)
    const content = await bytes(req)
    state.uploads += 1
    const object = {
      name,
      size: content.byteLength,
      contentType: req.headers['content-type'] ?? 'application/octet-stream',
      created_at: timestamp(),
      updated_at: timestamp(),
      last_accessed_at: timestamp(),
      metadata: { size: content.byteLength, mimetype: req.headers['content-type'] ?? null },
    }
    const existingIndex = state.uploadedObjects.findIndex((item) => item.name === name)
    if (existingIndex === -1) state.uploadedObjects.push(object)
    else state.uploadedObjects[existingIndex] = object
    return json(res, 200, { Key: `recordings/${name}` })
  }

  if (req.method === 'GET' && url.pathname.startsWith('/storage/v1/object/')) {
    res.writeHead(200, { 'content-type': 'audio/webm' })
    return res.end(Buffer.from('e2e-audio'))
  }

  if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/recordings') {
    const input = await body(req)
    const names = Array.isArray(input.prefixes) ? input.prefixes : []
    const removed = state.uploadedObjects.filter((object) => names.includes(object.name))
    state.uploadedObjects = state.uploadedObjects.filter((object) => !names.includes(object.name))
    return json(
      res,
      200,
      removed.map((object) => ({ name: object.name })),
    )
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/').at(-1)
    const select = url.searchParams.get('select')
    if (req.method === 'GET') {
      const source =
        table === 'profiles'
          ? [state.profile]
          : table === 'prompts'
            ? PROMPTS
            : table === 'attempts'
              ? state.attempts
              : table === 'practice_paths'
                ? PRACTICE_PATHS
                : table === 'practice_chapters'
                  ? PRACTICE_CHAPTERS
                  : table === 'practice_lessons'
                    ? PRACTICE_LESSONS
                    : table === 'lesson_progress'
                      ? state.lessonProgress
                      : table === 'profile_path_preferences'
                        ? state.pathPreferences
                        : []
      const { rows, total } = queryRows(req, source, url)
      const output = rows.map((row) => selected(row, select))
      const { offset } = requestedRange(req, url)
      const end = output.length === 0 ? offset : offset + output.length - 1
      return json(res, 200, singular(req, output), {
        'content-range': `${offset}-${end}/${total}`,
      })
    }

    if (req.method === 'POST') {
      const rawInput = await body(req)
      const input = Array.isArray(rawInput) ? rawInput[0] : rawInput
      if (table === 'attempts') {
        const duplicate = state.attempts.find(
          (attempt) =>
            attempt.user_id === input.user_id &&
            attempt.client_request_id === input.client_request_id,
        )
        if (duplicate) {
          return json(res, 409, {
            code: '23505',
            message: 'duplicate key value violates attempts_user_client_request_id_key',
          })
        }
        const sequence = state.next++
        const row = {
          id: input.id ?? `20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
          audio_path: null,
          transcript: null,
          score: null,
          section_scores: null,
          content_result: null,
          status: 'uploading',
          status_changed_at: timestamp(),
          failure_code: null,
          created_at: timestamp(),
          ...input,
        }
        state.attempts.push(row)
        state.lifecycleEvents.push({ attemptId: row.id, status: row.status })
        state.attemptInserts += 1
        return json(res, 201, singular(req, [selected(row, select)]))
      }
      return json(res, 201, singular(req, [selected(input, select)]))
    }

    if (req.method === 'PATCH') {
      const input = await body(req)
      const source = table === 'profiles' ? [state.profile] : state.attempts
      const matched = queryRows(req, source, url, false).rows
      for (const row of matched) {
        Object.assign(row, input)
        if ('status' in input) {
          row.status_changed_at = timestamp()
          state.lifecycleEvents.push({ attemptId: row.id, status: input.status })
        }
      }
      return json(
        res,
        200,
        singular(
          req,
          matched.map((row) => selected(row, select)),
        ),
      )
    }

    if (req.method === 'DELETE') {
      if (table !== 'attempts') return json(res, 200, singular(req, []))
      const matched = queryRows(req, state.attempts, url, false).rows
      const doomed = new Set(matched.map((row) => row.id))
      state.attempts = state.attempts.filter((row) => !doomed.has(row.id))
      return json(
        res,
        200,
        singular(
          req,
          matched.map((row) => selected(row, select)),
        ),
      )
    }
  }

  return json(res, 404, { message: `E2E mock rejected ${req.method} ${url.pathname}` })
})

server.listen(PORT, HOST, () =>
  process.stdout.write(`Mock Supabase listening on http://${HOST}:${PORT}\n`),
)
