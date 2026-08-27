import { createServer } from 'node:http'

const HOST = '127.0.0.1'
const PORT = 54321
const USER_ID = '00000000-0000-4000-8000-000000000001'
const PROMPTS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    text: 'Tell me about a time you solved a difficult problem.',
    active: true,
    mode: 'interview',
    difficulty: 'intermediate',
    target_duration_seconds: 30,
    collection_id: 'behavioral',
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
    created_at: '2026-01-01T00:00:00.000Z',
  },
]
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
    uploads: 0,
    next: 1,
  }
}
reset()
function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}
async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}
function selected(row, value) {
  if (!value || value === '*') return row
  const out = {}
  for (const key of value.split(',')) if (key in row) out[key] = row[key]
  return out
}
function singular(req, rows) {
  return req.headers.accept?.includes('vnd.pgrst.object') ? (rows[0] ?? null) : rows
}
function filterRows(rows, url) {
  let result = [...rows]
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit'].includes(key)) continue
    if (value.startsWith('eq.'))
      result = result.filter((row) => String(row[key]) === value.slice(3))
    if (value === 'not.is.null') result = result.filter((row) => row[key] !== null)
  }
  const order = url.searchParams.get('order')
  if (order?.startsWith('created_at.desc'))
    result.sort((a, b) => b.created_at.localeCompare(a.created_at))
  const limit = Number(url.searchParams.get('limit'))
  if (limit > 0) result = result.slice(0, limit)
  return result
}
const WEIGHTS = {
  practice: [22, 20, 12, 12, 18, 16],
  interview: [18, 22, 14, 12, 22, 12],
  presentation: [16, 20, 14, 10, 20, 20],
  conversation: [24, 22, 12, 12, 14, 16],
}
function scorePayload(attempt, failure = false) {
  const names = ['fluency', 'clarity', 'vocabulary', 'grammar', 'structure', 'delivery']
  const weights = WEIGHTS[attempt.practice_mode] ?? WEIGHTS.practice
  const categories = Object.fromEntries(
    names.map((name, index) => {
      const unavailable = failure && ['vocabulary', 'grammar', 'structure'].includes(name)
      const max = weights[index]
      const earned = Math.max(0, max - (state.attempts.length > 1 ? 1 : 3))
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
  const complete = !failure
  return {
    version: 'v2.score.1',
    rubric_version: 'v2',
    mode: attempt.practice_mode,
    total_earned_points: complete
      ? Object.values(categories).reduce((sum, item) => sum + item.earned_points, 0)
      : null,
    total_max_points: 100,
    categories,
    warnings: failure ? ['Some provider checks were unavailable.'] : [],
  }
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*')
  res.setHeader('access-control-allow-headers', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return json(res, 200, {})
  if (url.pathname === '/__e2e/reset' && req.method === 'POST') {
    reset()
    const input = await body(req)
    if (input.onboarded === false) state.userMetadata = {}
    return json(res, 200, state)
  }
  if (url.pathname === '/__e2e/state') return json(res, 200, state)
  if (url.pathname.startsWith('/__e2e/process/') && req.method === 'POST') {
    const id = url.pathname.split('/').at(-1)
    const attempt = state.attempts.find((item) => item.id === id)
    if (!attempt) return json(res, 404, { message: 'missing attempt' })
    const input = await body(req)
    attempt.transcript =
      'I solved the problem by listening, testing one change, and explaining the result.'
    attempt.score = input.failure ? null : 84
    attempt.section_scores = scorePayload(attempt, Boolean(input.failure))
    return json(res, 200, { score: attempt.score, wordCount: 13 })
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
  if (url.pathname.startsWith('/storage/v1/object/')) {
    if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/recordings/')) {
      for await (const _ of req) void _
      state.uploads += 1
      return json(res, 200, { Key: url.pathname })
    }
    if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/recordings/')) {
      return json(res, 200, { signedURL: '/storage/v1/object/e2e-audio.webm' })
    }
    if (req.method === 'DELETE') return json(res, 200, [])
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
              : []
      const rows = filterRows(source, url).map((row) => selected(row, select))
      return json(res, 200, singular(req, rows), {
        'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
      })
    }
    if (req.method === 'POST') {
      const input = await body(req)
      if (table === 'attempts') {
        const row = {
          id: `20000000-0000-4000-8000-${String(state.next++).padStart(12, '0')}`,
          audio_path: null,
          transcript: null,
          score: null,
          section_scores: null,
          content_result: null,
          created_at: new Date(Date.now() + state.next * 1000).toISOString(),
          ...input,
        }
        state.attempts.push(row)
        return json(res, 201, singular(req, [selected(row, select)]))
      }
      return json(res, 201, singular(req, [input]))
    }
    if (req.method === 'PATCH') {
      const input = await body(req)
      const rows = table === 'profiles' ? [state.profile] : state.attempts
      for (const row of filterRows(rows, url)) Object.assign(row, input)
      return json(
        res,
        200,
        singular(
          req,
          filterRows(rows, url).map((row) => selected(row, select)),
        ),
      )
    }
    if (req.method === 'DELETE') {
      if (table === 'attempts') {
        const doomed = new Set(filterRows(state.attempts, url).map((row) => row.id))
        state.attempts = state.attempts.filter((row) => !doomed.has(row.id))
      }
      return json(res, 204, null)
    }
  }
  json(res, 404, { message: `E2E mock rejected ${req.method} ${url.pathname}` })
})
server.listen(PORT, HOST, () =>
  process.stdout.write(`Mock Supabase listening on http://${HOST}:${PORT}\n`),
)
