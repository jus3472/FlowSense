import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { MIN_PROCESSABLE_RECORDING_MS } from '../../src/lib/recording/capture-readiness'

const MOCK = 'http://127.0.0.1:54321'
const APP = 'http://127.0.0.1:3100'
const HYDRATION_DIAGNOSTIC =
  /hydration failed|hydration mismatch|didn't match|react\.dev\/errors\/418|minified react error #418/i

interface E2EAttempt {
  id: string
  created_at: string
  finished_at: string
  user_id: string
  lesson_id: string | null
  prompt_id: string | null
  prompt_text: string
  duration_ms: number
  practice_mode: string
  prompt_source: string
  prompt_difficulty: string
  rubric_version: string
  retry_of_attempt_id: string | null
  client_request_id: string
  status: string
  failure_code: string | null
  score: number | null
  section_scores: {
    version: string
    sections: {
      what_you_said: { metrics: Record<string, { status: string }> }
      how_you_sounded: { metrics: Record<string, { status: string }> }
    }
  } | null
  metrics: {
    practice: { target_duration_seconds: number; additional_context?: string }
    upload: { storage_path: string; mime_type: string }
  }
}

interface E2EState {
  profile: {
    id: string
    display_name: string | null
    focus_areas: string[]
    timezone: string | null
  }
  attempts: E2EAttempt[]
  lessonProgress: Array<{
    user_id: string
    lesson_id: string
    best_score: number
    best_attempt_id: string | null
  }>
  pathPreferences: Array<{ user_id: string; path_id: string; rank: number }>
  practiceActivityDays: Array<{
    user_id: string
    local_date: string
    timezone: string
    created_at: string
  }>
  lifecycleEvents: Array<{ attemptId: string; status: string }>
  uploadedObjects: Array<{ name: string; size: number }>
  uploads: number
  attemptInserts: number
}

interface E2ECurriculumSeed {
  pathSlug: string
  passedLessons: number
  score?: number
}

async function blockExternalNetwork(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'blob:') {
      await route.continue()
    } else {
      await route.abort('blockedbyclient')
    }
  })
}

async function reset(request: APIRequestContext, onboarded = true, curriculum?: E2ECurriculumSeed) {
  await request.post(`${MOCK}/__e2e/reset`, {
    data: { onboarded, ...(curriculum ? { curriculum } : {}) },
  })
}

async function resetWithProgress(request: APIRequestContext) {
  await request.post(`${MOCK}/__e2e/reset`, {
    data: { onboarded: true, progress: true },
  })
}

async function currentState(request: APIRequestContext): Promise<E2EState> {
  return (await (await request.get(`${MOCK}/__e2e/state`)).json()) as E2EState
}

function attemptAt(state: E2EState, index: number): E2EAttempt {
  const attempt = state.attempts[index]
  if (!attempt) throw new Error(`Expected attempt ${index} in the E2E mock state.`)
  return attempt
}

function uploadedObjectAt(state: E2EState, index: number): E2EState['uploadedObjects'][number] {
  const object = state.uploadedObjects[index]
  if (!object) throw new Error(`Expected uploaded object ${index} in the E2E mock state.`)
  return object
}

function lifecycleFor(state: E2EState, attemptId: string): string[] {
  return state.lifecycleEvents
    .filter((event) => event.attemptId === attemptId)
    .map((event) => event.status)
}

function lessonBest(state: E2EState, lessonId: string) {
  return state.lessonProgress.find((progress) => progress.lesson_id === lessonId)
}

async function logIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Sign up or log in').getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('Email').fill('speaker@example.test')
  await page.getByLabel('Password').fill('safe-test-password')
  await page.locator('form').getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/home$/)
}

function captureHydrationDiagnostics(page: Page): string[] {
  const diagnostics: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && HYDRATION_DIAGNOSTIC.test(message.text())) {
      diagnostics.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    if (HYDRATION_DIAGNOSTIC.test(error.message)) diagnostics.push(error.message)
  })
  return diagnostics
}

async function verifyHistoryHydration(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
) {
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page)
  await logIn(page)

  await page.goto('/practice/interview')
  await page.getByRole('link', { name: 'Choose this prompt' }).first().click()
  await recordOne(page)
  const state = await currentState(request)
  const attempt = attemptAt(state, 0)
  const expectedTime = new Intl.DateTimeFormat('en-US', {
    timeZone: state.profile.timezone ?? 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(attempt.created_at))
  const diagnostics = captureHydrationDiagnostics(page)

  const assertHistory = async () => {
    const row = page.locator(`a[href="/attempts/${attempt.id}"]`)
    await expect(row).toBeVisible()
    await expect(row.getByRole('time')).toHaveText(expectedTime)
    await expect(row.getByRole('time')).toHaveAttribute('datetime', attempt.created_at)
  }

  await page.goto('/history')
  await assertHistory()
  await page.reload()
  await assertHistory()
  await page.goto('/home')
  await page.getByRole('link', { name: 'History' }).click()
  await assertHistory()
  expect(diagnostics).toEqual([])

  await page.locator(`a[href="/attempts/${attempt.id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/attempts/${attempt.id}$`))
}

async function processingMocks(
  page: Page,
  options: boolean | { failure?: boolean; scores?: readonly number[] } = false,
) {
  const failure = typeof options === 'boolean' ? options : options.failure === true
  const scores = typeof options === 'boolean' ? [] : [...(options.scores ?? [])]
  await page.route('**/api/transcribe', async (route) => {
    const input = route.request().postDataJSON() as { attemptId: string }
    await new Promise((resolve) => setTimeout(resolve, 600))
    const response = await page.request.post(`${MOCK}/__e2e/transcribe/${input.attemptId}`)
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: JSON.stringify(await response.json()),
    })
  })
  await page.route('**/api/score', async (route) => {
    const input = route.request().postDataJSON() as { attemptId: string }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const score = scores.shift()
    const response = await page.request.post(`${MOCK}/__e2e/score/${input.attemptId}`, {
      data: { failure, ...(score === undefined ? {} : { score }) },
    })
    const result = await response.json()
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
}

async function recordOne(page: Page) {
  const stop = page.getByRole('button', { name: 'Stop' })
  await expect(stop).toBeVisible({ timeout: 10_000 })
  // This is an intentional capture duration, not a wait for UI state.
  await page.waitForTimeout(MIN_PROCESSABLE_RECORDING_MS + 150)
  await stop.click()
  await expect(page).toHaveURL(/\/attempts\//, { timeout: 15_000 })
}

test.beforeEach(async ({ page, request }) => {
  await reset(request)
  await blockExternalNetwork(page)
})

test('new user chooses an ordered primary and secondary path during onboarding', async ({
  page,
  request,
  context,
}) => {
  await reset(request, false)
  await context.grantPermissions(['microphone'], { origin: APP })
  await page.goto('/login')
  await page.getByLabel('Email').fill('new@example.test')
  await page.getByLabel('Password').fill('safe-test-password')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/onboarding\/microphone/)
  const allow = page.getByRole('button', { name: 'Allow microphone access' })
  if (await allow.isVisible()) await allow.click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'What do you want to get better at?' }),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: 'General Speaking' })).toBeChecked()
  await page.getByRole('group', { name: 'Primary track' }).getByText('Interviews').click()
  await page.getByRole('group', { name: 'Additional paths' }).getByText('Presentations').click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Interviews track' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Presentations track' })).toBeVisible()

  const state = await currentState(request)
  expect(state.pathPreferences).toEqual([
    {
      user_id: '00000000-0000-4000-8000-000000000001',
      path_id: '30000000-0000-4000-8000-000000000002',
      rank: 0,
    },
    {
      user_id: '00000000-0000-4000-8000-000000000001',
      path_id: '30000000-0000-4000-8000-000000000003',
      rank: 1,
    },
  ])
  expect(state.profile.timezone).not.toBeNull()
})

test('microphone denial gives a recoverable state', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', {
      value: { query: async () => ({ state: 'prompt' }) },
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          throw new DOMException('Denied', 'NotAllowedError')
        },
      },
    })
  })
  await logIn(page)
  await page.goto('/record?prompt=10000000-0000-4000-8000-000000000001')
  await expect(page.getByRole('heading', { name: 'Microphone access is blocked' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible()
})

test('selects library and custom prompts through real screens', async ({ page }) => {
  await logIn(page)
  await page.goto('/practice/interview')
  await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible()
  await page.getByRole('link', { name: 'Choose this prompt' }).first().click()
  await expect(page).toHaveURL(/\/record\?prompt=/)
  await expect(page.getByText('Tell me about a time you solved a difficult problem.')).toBeVisible()
  await expect(page.getByText('One prompt, 60 seconds')).toHaveCount(0)
  await page.goto('/practice/custom')
  await page.getByLabel('Prompt or question').fill('Explain a choice you made today.')
  await page.getByLabel('Practice mode').selectOption('conversation')
  await page.getByLabel(/Additional context/).fill('Keep the answer private and concise.')
  await page.getByRole('button', { name: 'Continue to record' }).click()
  await expect(page).toHaveURL(/\/record\?custom=1/)
  await expect(page.getByText('Explain a choice you made today.')).toBeVisible()
  await expect(page.getByText('One prompt, 60 seconds')).toHaveCount(0)

  await page.goto('/practice')
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Start' }).first().click()
  await expect(page).toHaveURL(/\/practice\/paths\/.*\/record$/)
  await expect(page.getByText('Give a clear response for beginner lesson 1.')).toBeVisible()
  await expect(page.getByText('One prompt, 60 seconds')).toHaveCount(0)
})

test('keeps direct standalone practice routes valid without rediscovering them', async ({
  page,
}) => {
  await logIn(page)

  for (const [route, heading] of [
    ['/practice/practice', 'General Practice'],
    ['/practice/interview', 'Interviews'],
    ['/practice/presentation', 'Presentations'],
    ['/practice/conversation', 'Conversations'],
  ] as const) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Home' }).first()).toBeVisible()
  }
})

test('opens path overviews from track cards', async ({ page }) => {
  await logIn(page)

  const tracks = [
    ['General Speaking', 'general-speaking'],
    ['Interviews', 'interviews'],
    ['Presentations', 'presentations'],
    ['Conversations', 'conversations'],
  ] as const

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/home')
    for (const [title] of tracks) {
      await expect(page.getByRole('link', { name: `View ${title} track` })).toBeVisible()
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
  }

  await page.goto('/home')
  for (const [title, slug] of tracks) {
    const cardLink = page.getByRole('link', { name: `View ${title} track` })
    const action = cardLink.locator('..').getByRole('link', { name: 'Start' })
    await expect(action).toHaveAttribute(
      'href',
      `/practice/paths/${slug}/lessons/${slug}-beginner-01-skill-1/record`,
    )
  }
  expect(await page.locator('a a').count()).toBe(0)

  await page
    .getByRole('link', { name: 'View General Speaking track' })
    .locator('..')
    .getByRole('link', { name: 'Start' })
    .click()
  await expect(page).toHaveURL(
    /\/practice\/paths\/general-speaking\/lessons\/general-speaking-beginner-01-skill-1\/record$/,
  )
  await page.goto('/home')

  const interviews = page.getByRole('link', { name: 'View Interviews track' })
  await interviews.focus()
  await expect(interviews).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/practice\/paths\/interviews$/)

  for (const [title, slug] of tracks) {
    await page.goto('/home')
    await page.getByRole('link', { name: `View ${title} track` }).click()
    await expect(page).toHaveURL(new RegExp(`/practice/paths/${slug}$`))
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  }
})

test('keeps the full brand and final navigation within desktop and narrow viewports', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await logIn(page)

  const assertHeader = async () => {
    const brand = page.getByRole('link', { name: 'FlowSense' })
    await expect(brand).toHaveText('FlowSense')
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
      'Home',
      'Progress',
      'History',
    ])
    expect(
      await brand.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return (
          element.scrollWidth <= element.clientWidth &&
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth
        )
      }),
    ).toBe(true)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }

  await assertHeader()
  await page.setViewportSize({ width: 390, height: 844 })
  await assertHeader()
})

test('history and progress start empty after an isolated reset', async ({ page }) => {
  await logIn(page)
  await page.goto('/history')
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()
  await expect(page.getByText('No responses yet')).toBeVisible()
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toHaveCount(1)
  await expect(page.getByText('No performance history yet')).toBeVisible()
})

test('Progress shows current performance histories, exact result links, and every mode filter', async ({
  page,
  request,
}) => {
  await resetWithProgress(request)
  await logIn(page)
  await page.goto('/progress')

  const state = await currentState(request)
  const attempts = [...state.attempts].sort(
    (left, right) =>
      Date.parse(left.finished_at) - Date.parse(right.finished_at) ||
      left.id.localeCompare(right.id),
  )
  expect(attempts).toHaveLength(12)
  expect(attempts.every((attempt) => attempt.rubric_version === 'v3')).toBe(true)
  expect(attempts.every((attempt) => attempt.section_scores?.version === 'v3.score.2')).toBe(true)

  const filter = page.getByLabel('Show responses')
  await expect(filter.getByRole('option')).toHaveText([
    'All',
    'General Speaking',
    'Interviews',
    'Presentations',
    'Conversations',
  ])
  expect(
    await filter
      .getByRole('option')
      .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
  ).toEqual(['all', 'practice', 'interview', 'presentation', 'conversation'])

  const overall = page.getByRole('button', { name: 'View Overall Score response history' })
  await expect(overall).not.toContainText(/responses from oldest to latest/i)
  await expect(overall.getByRole('img')).toHaveAttribute(
    'data-values',
    attempts
      .slice(-10)
      .map((attempt) => attempt.score)
      .join(','),
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await overall.click()
  const overallHistory = page.getByRole('region', { name: 'Overall Score response history' })
  const overallLinks = overallHistory.getByRole('link')
  await expect(overallLinks).toHaveCount(attempts.length)
  expect(
    await overallLinks.evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual([...attempts].reverse().map((attempt) => `/attempts/${attempt.id}`))
  await expect(overallHistory.locator('[data-chart-size="expanded"]')).toHaveAttribute(
    'data-values',
    attempts.map((attempt) => attempt.score).join(','),
  )
  await expect(overallHistory.getByText('Interviews · Retry')).toHaveCount(2)
  const historyTimes = overallHistory.getByRole('time')
  await expect(historyTimes).toHaveCount(attempts.length)
  expect(
    await historyTimes.evaluateAll((times) => times.map((time) => time.getAttribute('datetime'))),
  ).toEqual([...attempts].reverse().map((attempt) => attempt.finished_at))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: 'Hide Overall Score response history' }).click()

  const contentToggle = page.getByRole('button', {
    name: 'View Answered the Prompt response history',
  })
  await contentToggle.focus()
  await expect(contentToggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Hide Answered the Prompt response history' }),
  ).toHaveAttribute('aria-expanded', 'true')
  const contentHistory = page.getByRole('region', {
    name: 'Answered the Prompt response history',
  })
  await expect(contentHistory.getByRole('link')).toHaveCount(attempts.length)
  await page.getByRole('button', { name: 'Hide Answered the Prompt response history' }).click()

  await page.getByRole('button', { name: 'View Pace response history' }).click()
  const audioHistory = page.getByRole('region', { name: 'Pace response history' })
  await expect(audioHistory.getByRole('link')).toHaveCount(attempts.length)
  await expect(audioHistory.getByText('120 WPM')).toBeVisible()
  await page.getByRole('button', { name: 'Hide Pace response history' }).click()

  for (const [value, mode] of [
    ['practice', 'practice'],
    ['interview', 'interview'],
    ['presentation', 'presentation'],
    ['conversation', 'conversation'],
    ['all', null],
  ] as const) {
    await filter.selectOption(value)
    await expect(page).toHaveURL(mode === null ? `${APP}/progress` : `${APP}/progress?mode=${mode}`)
    await expect(filter).toHaveValue(value)
    const selectedAttempts =
      mode === null ? attempts : attempts.filter((attempt) => attempt.practice_mode === mode)
    const selectedOverall = page.getByRole('button', {
      name: 'View Overall Score response history',
    })
    await expect(selectedOverall).not.toContainText(/responses from oldest to latest/i)
    await expect(selectedOverall.getByRole('img')).toHaveAttribute(
      'data-values',
      selectedAttempts
        .slice(-10)
        .map((attempt) => attempt.score)
        .join(','),
    )
  }
})

test('@mobile Progress remains usable when a full history is expanded', async ({
  page,
  request,
}) => {
  await resetWithProgress(request)
  await logIn(page)
  await page.goto('/progress')

  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Show responses').getByRole('option')).toHaveCount(5)
  await page.getByRole('button', { name: 'View Pace response history' }).click()
  await expect(
    page.getByRole('region', { name: 'Pace response history' }).getByRole('link'),
  ).toHaveCount(12)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('Progress cards remain balanced across responsive breakpoints and dark mode', async ({
  page,
  request,
}) => {
  await resetWithProgress(request)
  await logIn(page)
  await page.goto('/progress')

  for (const [width, overviewRows, soundRows] of [
    [390, 3, 4],
    [768, 3, 2],
    [1024, 1, 2],
    [1280, 1, 1],
  ] as const) {
    await page.setViewportSize({ width, height: 900 })

    const geometry = await page.evaluate(() => {
      const cards = (headingId: string) =>
        Array.from(document.querySelectorAll(`[aria-labelledby="${headingId}"] button`)).map(
          (element) => {
            const bounds = element.getBoundingClientRect()
            return { height: bounds.height, top: Math.round(bounds.top) }
          },
        )
      const select = document.querySelector('#progress-response-filter')
      const selectBounds = select?.getBoundingClientRect()
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        selectHeight: selectBounds?.height ?? 0,
        overview: cards('performance-overview-heading'),
        sound: cards('audio-metrics-heading'),
      }
    })

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth)
    expect(geometry.selectHeight).toBeGreaterThanOrEqual(44)
    expect(new Set(geometry.overview.map(({ top }) => top)).size).toBe(overviewRows)
    expect(new Set(geometry.sound.map(({ top }) => top)).size).toBe(soundRows)
    for (const cards of [geometry.overview, geometry.sound]) {
      for (const rowTop of new Set(cards.map(({ top }) => top))) {
        expect(
          new Set(cards.filter(({ top }) => top === rowTop).map(({ height }) => height)).size,
        ).toBe(1)
      }
    }
  }

  await page.getByRole('button', { name: 'More options' }).click()
  const theme = page.getByRole('menuitemcheckbox', { name: 'Light mode' })
  await theme.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'View Pace response history' })).toBeVisible()
})

test('history hydrates cleanly when server and browser timezones differ', async ({
  page,
  context,
  request,
}) => {
  await verifyHistoryHydration(page, context, request)
})

test('@mobile History hydrates cleanly at a narrow viewport', async ({
  page,
  context,
  request,
}) => {
  await verifyHistoryHydration(page, context, request)
})

test('records once, shows processing and v3 results, retries, compares, filters, and deletes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page)
  let attemptPosts = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/attempts')) attemptPosts += 1
  })
  await logIn(page)
  await page.goto('/practice/interview')
  await page.getByRole('link', { name: 'Choose this prompt' }).first().click()
  await recordOne(page)
  await expect(page.getByRole('region', { name: 'Result summary' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Overall score' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Recommendation' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'What You Said' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'How You Sounded' })).toBeVisible()
  await expect(page.getByText(/for What You Said/)).toHaveCount(0)
  await expect(page.getByText(/for How You Sounded/)).toHaveCount(0)
  const overallProgress = page.getByRole('progressbar', { name: 'Overall score' })
  await expect(overallProgress).toHaveAttribute('aria-valuemin', '0')
  await expect(overallProgress).toHaveAttribute('aria-valuemax', '100')
  await expect(overallProgress).toHaveAttribute('aria-valuenow', /\d+/)
  for (const metric of [
    'Answered the Prompt',
    'Specificity',
    'Structure',
    'Conciseness',
    'Word Choice',
    'Grammar',
    'Pace',
    'Paused Time',
    'Articulation',
    'Energy',
  ]) {
    await expect(page.getByRole('heading', { name: metric })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: `${metric} score` })).toHaveAttribute(
      'aria-valuenow',
      /\d+/,
    )
  }
  await expect(page.getByRole('progressbar')).toHaveCount(13)
  await expect(page.getByRole('heading', { name: 'Time to First Word' })).toHaveCount(0)
  await expect(page.getByText('Review evidence', { exact: true })).toHaveCount(0)
  const paceDetails = page.getByRole('button', { name: 'Show Pace details' })
  await expect(paceDetails).toHaveAttribute('aria-expanded', 'false')
  await paceDetails.click()
  await expect(page.getByRole('button', { name: 'Hide Pace details' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(page.getByText('Ideal range', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Hide Pace details' }).click()
  await expect(page.getByRole('button', { name: 'Show Pace details' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('progressbar', { name: 'Overall score' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What You Said' })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)

    const scorePanels = page.locator('[data-result-layout="score-sections"] > section')
    const whatYouSaidBox = await scorePanels.nth(0).boundingBox()
    const howYouSoundedBox = await scorePanels.nth(1).boundingBox()
    expect(whatYouSaidBox).not.toBeNull()
    expect(howYouSoundedBox).not.toBeNull()
    if (!whatYouSaidBox || !howYouSoundedBox) continue
    if (viewport.width >= 1024) {
      expect(Math.abs(whatYouSaidBox.y - howYouSoundedBox.y)).toBeLessThan(4)
      expect(howYouSoundedBox.x).toBeGreaterThan(whatYouSaidBox.x + whatYouSaidBox.width)
    } else {
      expect(Math.abs(whatYouSaidBox.x - howYouSoundedBox.x)).toBeLessThan(4)
      expect(howYouSoundedBox.y).toBeGreaterThan(whatYouSaidBox.y + whatYouSaidBox.height)
    }
  }
  expect(attemptPosts).toBe(1)
  const firstState = await currentState(page.request)
  expect(firstState.uploads).toBe(1)
  expect(firstState.uploadedObjects).toHaveLength(1)
  expect(firstState.attemptInserts).toBe(1)
  expect(firstState.attempts).toHaveLength(1)
  const firstAttempt = attemptAt(firstState, 0)
  expect(firstAttempt).toMatchObject({ status: 'done', failure_code: null })
  expect(lifecycleFor(firstState, firstAttempt.id)).toEqual([
    'uploading',
    'transcribing',
    'scoring',
    'done',
  ])
  expect(uploadedObjectAt(firstState, 0).name).toBe(firstAttempt.metrics.upload.storage_path)
  const replay = await page.request.post(`${APP}/api/attempts`, {
    data: {
      clientRequestId: firstAttempt.client_request_id,
      promptText: firstAttempt.prompt_text,
      promptId: firstAttempt.prompt_id,
      mode: firstAttempt.practice_mode,
      difficulty: firstAttempt.prompt_difficulty,
      source: firstAttempt.prompt_source,
      targetDurationSeconds: firstAttempt.metrics.practice.target_duration_seconds,
      retryOfAttemptId: firstAttempt.retry_of_attempt_id,
      durationMs: firstAttempt.duration_ms,
      mimeType: firstAttempt.metrics.upload.mime_type,
    },
  })
  expect(replay.ok()).toBe(true)
  await expect(replay.json()).resolves.toMatchObject({ attemptId: firstAttempt.id })
  const replayState = await currentState(page.request)
  expect(replayState.attempts).toHaveLength(1)
  expect(replayState.attemptInserts).toBe(1)

  await page.getByRole('link', { name: 'Try Again' }).click()
  await recordOne(page)
  expect(attemptPosts).toBe(2)
  const retryState = await currentState(page.request)
  expect(retryState.uploads).toBe(2)
  expect(retryState.uploadedObjects).toHaveLength(2)
  expect(retryState.attempts).toHaveLength(2)
  expect(retryState.attempts.every((attempt) => attempt.status === 'done')).toBe(true)
  const retryAttempt = attemptAt(retryState, 1)
  expect(retryAttempt).toMatchObject({
    retry_of_attempt_id: firstAttempt.id,
    prompt_text: firstAttempt.prompt_text,
    prompt_id: firstAttempt.prompt_id,
    practice_mode: firstAttempt.practice_mode,
    prompt_source: firstAttempt.prompt_source,
    prompt_difficulty: firstAttempt.prompt_difficulty,
  })
  expect(lifecycleFor(retryState, retryAttempt.id)).toEqual([
    'uploading',
    'transcribing',
    'scoring',
    'done',
  ])
  await expect(page.getByLabel('Previous response comparison')).toContainText('Overall')
  await expect(page.getByRole('link', { name: 'View previous response' })).toHaveCount(0)
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Performance overview' })).toBeVisible()
  const progressOverall = page.getByRole('button', {
    name: 'View Overall Score response history',
  })
  await expect(progressOverall).not.toContainText(/responses from oldest to latest/i)
  await progressOverall.click()
  await expect(
    page.getByRole('region', { name: 'Overall Score response history' }).getByRole('link'),
  ).toHaveCount(2)
  await page.goto('/history')
  await page.getByLabel('Show responses').selectOption('retry')
  await expect(page.getByText(/Interview · Library prompt · Retry/)).toBeVisible()
  const deleteButton = page.getByRole('button', { name: 'Delete response' }).first()
  await deleteButton.click()
  const confirm = page.getByRole('button', { name: 'Confirm delete' })
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(deleteButton).toBeFocused()
  await deleteButton.click()
  await confirm.click()
  await expect(page.getByText(/Interview · Library prompt · Retry/)).toHaveCount(0)
  const deletedState = await currentState(page.request)
  expect(deletedState.attempts).toHaveLength(1)
  expect(deletedState.uploadedObjects).toHaveLength(1)
  expect(uploadedObjectAt(deletedState, 0).name).toBe(firstAttempt.metrics.upload.storage_path)

  await page.getByRole('link', { name: 'FlowSense' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.locator(`a[href="/attempts/${retryAttempt.id}"]`)).toHaveCount(0)
  await expect(page.locator(`a[href="/attempts/${firstAttempt.id}"]`)).toHaveCount(0)

  await page.getByRole('link', { name: 'Progress' }).click()
  await expect(
    page.getByRole('button', { name: 'View Overall Score response history' }),
  ).toContainText('One response. Add another to see a trend.')
  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.locator(`a[href="/attempts/${retryAttempt.id}"]`)).toHaveCount(0)
  await expect(page.locator(`a[href="/attempts/${firstAttempt.id}"]`)).toBeVisible()
})

test('provider failure persists explicit not-checked content metrics', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page, true)
  await logIn(page)
  await page.goto('/record?prompt=10000000-0000-4000-8000-000000000001')
  await recordOne(page)
  await expect(page.getByRole('region', { name: 'Result summary' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Overall score' })).toHaveCount(0)
  await expect(page.getByText('Overall unavailable')).toBeVisible()
  const whatYouSaid = page.getByRole('region', { name: 'What You Said' })
  await expect(whatYouSaid.getByText(/^Not checked \/ /)).toHaveCount(6)
  const failureState = await currentState(page.request)
  expect(failureState.attempts).toHaveLength(1)
  const failedAttempt = attemptAt(failureState, 0)
  expect(failedAttempt).toMatchObject({ status: 'done', score: null })
  expect(lifecycleFor(failureState, failedAttempt.id)).toEqual([
    'uploading',
    'transcribing',
    'scoring',
    'done',
  ])
  expect(
    Object.values(failedAttempt.section_scores?.sections.what_you_said.metrics ?? {}).filter(
      (metric) => metric.status === 'not_checked',
    ),
  ).toHaveLength(6)
})

test('structured lessons retry thresholds without reducing durable progress', async ({
  page,
  request,
  context,
}) => {
  test.slow()
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page, { scores: [64, 74, 86, 72, 92, 68, 73] })
  await logIn(page)

  const firstLesson = '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1'
  await page.goto(firstLesson)
  await expect(page).toHaveURL(/interviews-beginner-01-skill-1\/record$/)
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson not passed' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveCount(0)

  const failedState = await currentState(request)
  const failedAttempt = attemptAt(failedState, 0)
  expect(failedAttempt).toMatchObject({ score: 64, lesson_id: expect.any(String) })
  if (!failedAttempt.lesson_id) throw new Error('Structured attempt is missing its lesson id.')
  expect(lessonBest(failedState, failedAttempt.lesson_id)).toMatchObject({
    best_score: 64,
    best_attempt_id: failedAttempt.id,
  })
  expect(failedState.practiceActivityDays).toHaveLength(1)

  await page.goto('/home')
  await expect(
    page.getByRole('img', { name: "1 day streak. Today's practice complete." }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  const interviewsCard = page.getByRole('link', { name: 'View Interviews track' }).locator('..')
  await expect(interviewsCard.getByText('Lesson 1 of 10', { exact: true })).toBeVisible()
  await interviewsCard.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/record\?retry=/)

  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await expect(page.getByText('Best: 74')).toBeVisible()
  await expect(page.getByText('Lesson 2 is available.')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Beginner lesson 1', exact: true })).toHaveCount(0)
  await expect(page.getByText('Your prompt', { exact: true })).toHaveCount(0)
  await expect(page.getByText('What You Said', { exact: true })).toHaveCount(1)
  await expect(page.getByText('How You Sounded', { exact: true })).toHaveCount(1)

  const passedState = await currentState(request)
  const passedAttempt = attemptAt(passedState, 1)
  expect(passedAttempt).toMatchObject({
    score: 74,
    lesson_id: failedAttempt.lesson_id,
    retry_of_attempt_id: failedAttempt.id,
  })
  expect(lessonBest(passedState, failedAttempt.lesson_id)).toMatchObject({
    best_score: 74,
    best_attempt_id: passedAttempt.id,
  })
  expect(passedState.practiceActivityDays).toHaveLength(1)

  await expect(page.getByRole('heading', { name: 'Previous attempts' })).toBeVisible()
  await expect(
    page.locator(`a[href="/attempts/${failedAttempt.id}"]`).filter({ hasText: '64 / 100' }),
  ).toBeVisible()

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    const summaryBox = await page.getByRole('region', { name: 'Result summary' }).boundingBox()
    const historyBox = await page.getByRole('region', { name: 'Previous attempts' }).boundingBox()
    const recordingBox = await page
      .getByRole('heading', { name: 'Recording' })
      .locator('..')
      .boundingBox()
    expect(summaryBox).not.toBeNull()
    expect(historyBox).not.toBeNull()
    expect(recordingBox).not.toBeNull()
    if (!summaryBox || !historyBox || !recordingBox) continue
    if (viewport.width >= 1024) {
      expect(Math.abs(summaryBox.y - historyBox.y)).toBeLessThan(4)
      expect(historyBox.x).toBeGreaterThan(summaryBox.x + summaryBox.width)
    } else {
      expect(Math.abs(summaryBox.x - historyBox.x)).toBeLessThan(4)
      expect(historyBox.y).toBeGreaterThan(recordingBox.y + recordingBox.height)
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
  }

  await page.goto('/practice/paths/interviews')
  const completedLesson = page.getByRole('link', { name: /Lesson 1.*View Best Result/s }).first()
  await expect(completedLesson).toHaveAttribute('href', `/attempts/${passedAttempt.id}`)
  await completedLesson.click()
  await expect(page).toHaveURL(new RegExp(`/attempts/${passedAttempt.id}$`))
  await expect(page.getByRole('heading', { name: 'Previous attempts' })).toBeVisible()

  await page
    .locator(`a[href="/attempts/${failedAttempt.id}"]`)
    .filter({ hasText: '64 / 100' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/attempts/${failedAttempt.id}$`))
  await expect(page.getByRole('heading', { name: 'Previous attempts' })).toBeVisible()
  await expect(
    page.locator(`a[href="/attempts/${passedAttempt.id}"]`).filter({ hasText: '74 / 100' }),
  ).toBeVisible()

  await page.goto('/home')
  const interviewsHomeCard = page.getByRole('link', { name: 'View Interviews track' }).locator('..')
  await expect(interviewsHomeCard.getByText('Lesson 2 of 10', { exact: true })).toBeVisible()
  await expect(page.getByText('Beginner lesson 2', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/\d+ \/ 30 lessons passed/)).toHaveCount(0)
  await interviewsHomeCard.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/interviews-beginner-02-skill-2\/record$/)
  await expect(page.getByText('Give a clear response for beginner lesson 2.')).toBeVisible()

  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Performance overview' })).toBeVisible()
  await expect(page.getByText(/track progress|lessons passed|stars/i)).toHaveCount(0)
  await page.goto('/history')
  await expect(page.getByText('Give a clear response for beginner lesson 1.')).toHaveCount(2)
  await expect(page.getByText('Beginner · Lesson 1', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Passed', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Not passed', { exact: true })).toHaveCount(1)

  await page.locator(`a[href="/attempts/${passedAttempt.id}"]`).click()
  await expect(page.getByRole('heading', { name: 'Previous attempts' })).toBeVisible()
  await expect(
    page.locator(`a[href="/attempts/${failedAttempt.id}"]`).filter({ hasText: '64 / 100' }),
  ).toBeVisible()

  await page.goto(firstLesson)
  await expect(page).toHaveURL(new RegExp(`/attempts/${passedAttempt.id}$`))
  await page.getByRole('link', { name: 'Retry for 3 stars' }).click()
  await recordOne(page)
  await expect(page.getByText('Best: 86')).toBeVisible()
  await expect(page.getByLabel('2 of 3 stars').first()).toBeVisible()
  await page.getByRole('link', { name: 'Retry for 3 stars' }).click()
  await recordOne(page)
  await expect(page.getByText('Best: 86')).toBeVisible()

  const lowerRetryState = await currentState(request)
  const attempt86 = attemptAt(lowerRetryState, 2)
  const attempt72 = attemptAt(lowerRetryState, 3)
  expect(attempt72).toMatchObject({
    score: 72,
    lesson_id: failedAttempt.lesson_id,
    retry_of_attempt_id: attempt86.id,
  })
  expect(lessonBest(lowerRetryState, failedAttempt.lesson_id)).toMatchObject({
    best_score: 86,
    best_attempt_id: attempt86.id,
  })
  await page.goto('/practice/paths/interviews')
  await expect(
    page.getByRole('link', { name: /Lesson 1.*View Best Result/s }).first(),
  ).toHaveAttribute('href', `/attempts/${attempt86.id}`)
  await page.goto(`/attempts/${attempt72.id}`)
  await page.getByRole('link', { name: 'Retry for 3 stars' }).click()
  await recordOne(page)
  await expect(page.getByText('Best: 92')).toBeVisible()
  await expect(page.getByLabel('3 of 3 stars').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try Again' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retry for 3 stars' })).toHaveCount(0)

  const upgradedRetryState = await currentState(request)
  const attempt92 = attemptAt(upgradedRetryState, 4)
  expect(attempt92).toMatchObject({
    score: 92,
    lesson_id: failedAttempt.lesson_id,
    retry_of_attempt_id: attempt72.id,
  })
  expect(lessonBest(upgradedRetryState, failedAttempt.lesson_id)).toMatchObject({
    best_score: 92,
    best_attempt_id: attempt92.id,
  })
  expect(upgradedRetryState.practiceActivityDays).toHaveLength(1)

  await page.goto('/practice/paths/interviews')
  await expect(
    page.getByRole('link', { name: /Lesson 1.*View Best Result/s }).first(),
  ).toHaveAttribute('href', `/attempts/${attempt92.id}`)

  await page.goto('/history')
  await expect(page.getByText('Beginner · Lesson 1', { exact: true })).toHaveCount(5)
  await expect(page.getByText('Passed', { exact: true })).toHaveCount(4)
  await expect(page.getByText('Not passed', { exact: true })).toHaveCount(1)

  const bestHistoryRow = page.locator('li').filter({
    has: page.locator(`a[href="/attempts/${attempt92.id}"]`),
  })
  await bestHistoryRow.getByRole('button', { name: 'Delete response' }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.locator(`a[href="/attempts/${attempt92.id}"]`)).toHaveCount(0)
  await expect(page.locator(`a[href="/attempts/${failedAttempt.id}"]`)).toBeVisible()

  const deletionState = await currentState(request)
  expect(deletionState.practiceActivityDays).toHaveLength(1)
  expect(lessonBest(deletionState, failedAttempt.lesson_id)).toMatchObject({
    best_score: 86,
    best_attempt_id: attempt86.id,
  })
  await page.goto('/home')
  await expect(
    page.getByRole('img', { name: "1 day streak. Today's practice complete." }),
  ).toBeVisible()
  const homeInterviewsCard = page.getByRole('link', { name: 'View Interviews track' }).locator('..')
  await expect(homeInterviewsCard.getByText('Lesson 2 of 10', { exact: true })).toBeVisible()
  await expect(homeInterviewsCard.getByRole('img', { name: '0 of 3 stars' })).toBeVisible()
  await expect(page.getByText('Beginner lesson 2', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/\d+ \/ 90 stars/)).toHaveCount(0)

  await reset(request, true, { pathSlug: 'interviews', passedLessons: 9 })
  await page.goto('/practice/paths/interviews/lessons/interviews-beginner-10-skill-10')
  await expect(page).toHaveURL(/interviews-beginner-10-skill-10\/record$/)
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson not passed' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveCount(0)

  const failedCheckpointState = await currentState(request)
  const attempt68 = attemptAt(failedCheckpointState, 0)
  if (!attempt68.lesson_id) throw new Error('Structured checkpoint is missing its lesson id.')
  expect(attempt68.score).toBe(68)
  expect(lessonBest(failedCheckpointState, attempt68.lesson_id)?.best_score).toBe(68)

  await page.getByRole('link', { name: 'Try Again' }).click()
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await page.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/interviews-intermediate-01-skill-1\/record$/)
  await expect(page.getByText('Give a clear response for intermediate lesson 1.')).toBeVisible()

  const passedCheckpointState = await currentState(request)
  const attempt73 = attemptAt(passedCheckpointState, 1)
  expect(attempt73).toMatchObject({
    score: 73,
    lesson_id: attempt68.lesson_id,
    retry_of_attempt_id: attempt68.id,
  })
  expect(lessonBest(passedCheckpointState, attempt68.lesson_id)).toMatchObject({
    best_score: 73,
    best_attempt_id: attempt73.id,
  })
})

test('later checkpoints unlock the next chapter and finish the path', async ({
  page,
  request,
  context,
}) => {
  test.slow()
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page, { scores: [68, 73, 74] })
  await reset(request, true, { pathSlug: 'interviews', passedLessons: 19 })
  await logIn(page)

  const intermediateCheckpoint =
    '/practice/paths/interviews/lessons/interviews-intermediate-10-skill-10'
  await page.goto(intermediateCheckpoint)
  await expect(page).toHaveURL(/interviews-intermediate-10-skill-10\/record$/)
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson not passed' })).toBeVisible()
  await page.goto('/practice/paths/interviews/lessons/interviews-advanced-01-skill-1')
  await expect(page.getByRole('heading', { name: 'Lesson locked' })).toBeVisible()

  await page.goto(intermediateCheckpoint)
  await page.getByRole('link', { name: 'Try Again' }).click()
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await page.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/interviews-advanced-01-skill-1\/record$/)
  await expect(page.getByText('Give a clear response for advanced lesson 1.')).toBeVisible()

  await reset(request, true, { pathSlug: 'interviews', passedLessons: 29 })
  await page.goto('/practice/paths/interviews/lessons/interviews-advanced-10-skill-10')
  await expect(page).toHaveURL(/interviews-advanced-10-skill-10\/record$/)
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await expect(page.getByText('Path complete', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Path' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveCount(0)

  await page.goto('/home')
  const completedInterviewsCard = page
    .getByRole('link', { name: 'View Interviews track' })
    .locator('..')
  await expect(completedInterviewsCard.getByText('Path complete', { exact: true })).toBeVisible()
  await expect(page.getByText(/\d+ \/ 30 lessons passed/)).toHaveCount(0)
  await expect(completedInterviewsCard.getByRole('link', { name: 'View Path' })).toBeVisible()
})

test('structured provider-neutral retry counts activity without changing progress', async ({
  page,
  request,
  context,
}) => {
  test.slow()
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page, { scores: [64] })
  await logIn(page)

  const firstLesson = '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1'
  await page.goto(firstLesson)
  await expect(page).toHaveURL(/interviews-beginner-01-skill-1\/record$/)
  await recordOne(page)
  const scoredState = await currentState(request)
  const scoredAttempt = attemptAt(scoredState, 0)
  if (!scoredAttempt.lesson_id) throw new Error('Structured attempt is missing its lesson id.')
  expect(lessonBest(scoredState, scoredAttempt.lesson_id)?.best_score).toBe(64)

  await page.unroute('**/api/transcribe')
  await page.unroute('**/api/score')
  await processingMocks(page, true)
  await page.getByRole('link', { name: 'Try Again' }).click()
  await recordOne(page)

  await expect(page.getByRole('heading', { name: 'Result unavailable' })).toBeVisible()
  await expect(page.getByText('Best: 64')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try Again' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Result summary' }).getByText('/ 100', { exact: false }),
  ).toHaveCount(0)

  const neutralState = await currentState(request)
  const neutralAttempt = attemptAt(neutralState, 1)
  expect(neutralAttempt).toMatchObject({ score: null, lesson_id: scoredAttempt.lesson_id })
  expect(lessonBest(neutralState, scoredAttempt.lesson_id)).toMatchObject({
    best_score: 64,
    best_attempt_id: scoredAttempt.id,
  })
  expect(neutralState.practiceActivityDays).toHaveLength(1)

  await page.goto('/home')
  await expect(
    page.getByRole('img', { name: "1 day streak. Today's practice complete." }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('link', { name: 'View Interviews track' })
      .locator('..')
      .getByText('Lesson 1 of 10', { exact: true }),
  ).toBeVisible()
  await page.goto('/practice/paths/interviews/lessons/interviews-beginner-02-skill-2')
  await expect(page.getByRole('heading', { name: 'Lesson locked' })).toBeVisible()
})

test('Settings omits track controls and preserves prior path progress', async ({
  page,
  request,
}) => {
  await reset(request, true, { pathSlug: 'interviews', passedLessons: 1, score: 74 })
  await logIn(page)
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await expect(
    page
      .getByRole('link', { name: 'View Interviews track' })
      .locator('..')
      .getByText('Lesson 2 of 10', { exact: true }),
  ).toBeVisible()

  await page.goto('/settings')
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByText('Starting track')).toHaveCount(0)
  await expect(page.getByText('Additional paths')).toHaveCount(0)
  await page.getByLabel('Display name').fill('River')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved.')

  await page.goto('/home')
  await expect(
    page
      .getByRole('link', { name: 'View Interviews track' })
      .locator('..')
      .getByText('Lesson 2 of 10', { exact: true }),
  ).toBeVisible()

  const state = await currentState(request)
  expect(state.lessonProgress).toHaveLength(1)
  expect(state.lessonProgress[0]?.best_score).toBe(74)
  expect(state.profile.display_name).toBe('River')
})

test('Settings deletion controls fit the requested responsive widths', async ({ page }) => {
  await logIn(page)

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/settings')

    for (const action of [
      { trigger: 'Reset progress', dialog: 'Reset all progress?', label: 'Type RESET to continue' },
      {
        trigger: 'Delete account',
        dialog: 'Delete your FlowSense account?',
        label: 'Type DELETE to continue',
      },
    ]) {
      await page.getByRole('button', { name: action.trigger }).click()
      const dialog = page.getByRole('alertdialog', { name: action.dialog })
      await expect(dialog).toBeVisible()
      await expect(page.getByLabel(action.label)).toBeFocused()
      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  }
})

test('Home advances each Track from its durable curriculum progress', async ({
  page,
  request,
  context,
}) => {
  await reset(request)
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page, { scores: [74, 74] })
  await logIn(page)
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()

  await page.goto('/practice/paths/interviews/lessons/interviews-beginner-01-skill-1/record')
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await page.goto('/home')
  await expect(
    page
      .getByRole('link', { name: 'View Interviews track' })
      .locator('..')
      .getByText('Lesson 2 of 10', { exact: true }),
  ).toBeVisible()

  await page.goto('/practice/paths/presentations/lessons/presentations-beginner-01-skill-1/record')
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()

  await page.goto('/home')
  await expect(
    page
      .getByRole('link', { name: 'View Presentations track' })
      .locator('..')
      .getByText('Lesson 2 of 10', { exact: true }),
  ).toBeVisible()
})

test('@mobile mobile navigation exposes all primary destinations and account menu', async ({
  page,
}) => {
  await logIn(page)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tracks', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'History' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Progress' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practice', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'More options' }).click()
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
})

test('@mobile Home stays readable through the lesson boundary', async ({ page }) => {
  await logIn(page)
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(page.getByText('Primary path')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Interview Practice' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Enter a custom prompt' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.goto('/practice/paths/interviews')
  await expect(page.getByRole('heading', { name: 'Interviews', exact: true })).toBeVisible()
  await expect(page.getByText('Track', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Practice path', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Current chapter', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Lesson 1 of 10', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Lesson 1', exact: true })).toHaveCount(3)
  await expect(page.getByText('Checkpoint', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Chapter locked', { exact: true })).toHaveCount(2)
  await expect(page.getByText(/checkpoint to unlock this chapter/i)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
