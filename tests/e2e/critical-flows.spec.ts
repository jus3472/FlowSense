import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MIN_PROCESSABLE_RECORDING_MS } from '../../src/lib/recording/capture-readiness'

const MOCK = 'http://127.0.0.1:54321'
const APP = 'http://127.0.0.1:3100'

interface E2EAttempt {
  id: string
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
    categories: Record<string, { status: string }>
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
  await page.getByRole('button', { name: "I'm ready" }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible({ timeout: 10_000 })
  // This is an intentional capture duration, not a wait for UI state.
  await page.waitForTimeout(MIN_PROCESSABLE_RECORDING_MS + 150)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Transcribing' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Scoring' })).toBeVisible()
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
  await page.getByRole('group', { name: 'Primary path' }).getByText('Interviews').click()
  await page.getByRole('group', { name: 'Additional paths' }).getByText('Presentations').click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: 'Continue Interviews' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your other paths' })).toBeVisible()
  await expect(page.getByText('Presentations', { exact: true })).toBeVisible()

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
  await page.getByRole('button', { name: "I'm ready" }).click()
  await expect(page.getByRole('heading', { name: 'Microphone access is blocked' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible()
})

test('selects library and custom prompts through real screens', async ({ page }) => {
  await logIn(page)
  await page.goto('/practice')
  await page.getByRole('link', { name: 'Interview Free Practice', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible()
  await page.getByRole('link', { name: 'Choose this prompt' }).first().click()
  await expect(page.getByRole('button', { name: "I'm ready" })).toBeVisible()
  await page.goto('/practice/custom')
  await page.getByLabel('Prompt or question').fill('Explain a choice you made today.')
  await page.getByLabel('Practice mode').selectOption('conversation')
  await page.getByLabel(/Additional context/).fill('Keep the answer private and concise.')
  await page.getByRole('button', { name: 'Continue to record' }).click()
  await expect(page.getByRole('button', { name: "I'm ready" })).toBeVisible()
})

test('history and progress start empty after an isolated reset', async ({ page }) => {
  await logIn(page)
  await page.goto('/history')
  await expect(page.getByText('No responses yet')).toBeVisible()
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Path progress' })).toBeVisible()
  await expect(page.getByText('No practice results yet')).toBeVisible()
})

test('records once, shows processing and v2 results, retries, compares, filters, and deletes', async ({
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
  await expect(page.getByText('Overall result')).toBeVisible()
  for (const category of ['Fluency', 'Clarity', 'Vocabulary', 'Grammar', 'Structure', 'Delivery'])
    await expect(page.getByText(category, { exact: true })).toBeVisible()
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
  await expect(page.getByRole('link', { name: 'View previous response' })).toBeVisible()
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Overall trend' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent retries' })).toBeVisible()
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
  await expect(page.locator(`a[href="/attempts/${firstAttempt.id}"]`)).toBeVisible()

  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('menuitem', { name: 'Progress' }).click()
  await expect(page.getByRole('heading', { name: 'Recent retries' })).toHaveCount(0)
  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.locator(`a[href="/attempts/${retryAttempt.id}"]`)).toHaveCount(0)
  await expect(page.locator(`a[href="/attempts/${firstAttempt.id}"]`)).toBeVisible()
})

test('provider failure persists explicit not-checked categories', async ({ page, context }) => {
  await context.grantPermissions(['microphone'], { origin: APP })
  await processingMocks(page, true)
  await logIn(page)
  await page.goto('/record?prompt=10000000-0000-4000-8000-000000000001')
  await recordOne(page)
  await expect(page.getByText('Some checks are not available')).toBeVisible()
  await expect(page.getByText('Not checked', { exact: true })).toHaveCount(3)
  await expect(page.getByText('100')).toHaveCount(0)
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
    Object.values(failedAttempt.section_scores?.categories ?? {}).filter(
      (category) => category.status === 'not_checked',
    ),
  ).toHaveLength(3)
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
  await page.getByRole('link', { name: 'Start Lesson' }).click()
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
  await expect(page.getByText('1 day streak', { exact: true })).toBeVisible()
  await expect(page.getByText("Today's practice complete", { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Continue Interviews' })).toBeVisible()
  await expect(page.getByText('Best: 64 · Need 70 to continue', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Try Again' }).click()
  await expect(page).toHaveURL(new RegExp(`${firstLesson}$`))
  await page.getByRole('link', { name: 'Try Again' }).click()
  await expect(page).toHaveURL(/\/record\?retry=/)

  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await expect(page.getByText('Best: 74')).toBeVisible()

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

  await page.goto('/home')
  await expect(page.getByText('1 / 30 lessons passed', { exact: true })).toBeVisible()
  await expect(page.getByText('Beginner lesson 2', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/interviews-beginner-02-skill-2$/)
  await expect(page.getByRole('heading', { name: 'Beginner lesson 2' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start Lesson' })).toBeVisible()

  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Path progress' })).toBeVisible()
  await expect(page.getByText('1 / 30', { exact: true }).first()).toBeVisible()
  await page.goto('/history')
  await expect(page.getByText('Beginner · Beginner lesson 1', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Passed', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Not passed', { exact: true })).toHaveCount(1)

  await page.goto(firstLesson)
  await page.getByRole('link', { name: 'Practice Again' }).click()
  await recordOne(page)
  await expect(page.getByText('Best: 86')).toBeVisible()
  await expect(page.getByLabel('2 of 3 stars').first()).toBeVisible()
  await page.getByRole('link', { name: 'Retry for 3 stars' }).click()
  await recordOne(page)
  await expect(page.getByText('Best: 86')).toBeVisible()
  await page.getByRole('link', { name: 'Retry for 3 stars' }).click()
  await recordOne(page)
  await expect(page.getByText('Best: 92')).toBeVisible()
  await expect(page.getByLabel('3 of 3 stars').first()).toBeVisible()

  const upgradedRetryState = await currentState(request)
  const attempt86 = attemptAt(upgradedRetryState, 2)
  const attempt72 = attemptAt(upgradedRetryState, 3)
  const attempt92 = attemptAt(upgradedRetryState, 4)
  expect(attempt72).toMatchObject({
    score: 72,
    lesson_id: failedAttempt.lesson_id,
    retry_of_attempt_id: attempt86.id,
  })
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

  await page.goto('/history')
  await expect(page.getByText('Beginner · Beginner lesson 1', { exact: true })).toHaveCount(5)
  await expect(page.getByText('Passed', { exact: true })).toHaveCount(4)
  await expect(page.getByText('Not passed', { exact: true })).toHaveCount(1)

  const bestHistoryRow = page.locator('li').filter({
    has: page.locator(`a[href="/attempts/${attempt92.id}"]`),
  })
  await bestHistoryRow.getByRole('button', { name: 'Delete response' }).click()
  await bestHistoryRow.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.locator(`a[href="/attempts/${attempt92.id}"]`)).toHaveCount(0)
  await expect(page.locator(`a[href="/attempts/${failedAttempt.id}"]`)).toBeVisible()

  const deletionState = await currentState(request)
  expect(deletionState.practiceActivityDays).toHaveLength(1)
  expect(lessonBest(deletionState, failedAttempt.lesson_id)).toMatchObject({
    best_score: 92,
    best_attempt_id: null,
  })
  await page.goto('/home')
  await expect(page.getByText('1 day streak', { exact: true })).toBeVisible()
  await expect(page.getByText('Beginner lesson 2', { exact: true })).toBeVisible()
  await expect(page.getByText('3 / 90 stars', { exact: true })).toBeVisible()

  await reset(request, true, { pathSlug: 'interviews', passedLessons: 9 })
  await page.goto('/practice/paths/interviews/lessons/interviews-beginner-10-skill-10')
  await page.getByRole('link', { name: 'Start Lesson' }).click()
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
  await expect(page).toHaveURL(/interviews-intermediate-01-skill-1$/)
  await expect(page.getByRole('heading', { name: 'Intermediate lesson 1' })).toBeVisible()

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
  await page.getByRole('link', { name: 'Start Lesson' }).click()
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson not passed' })).toBeVisible()
  await page.goto('/practice/paths/interviews/lessons/interviews-advanced-01-skill-1')
  await expect(page.getByRole('heading', { name: 'Lesson locked' })).toBeVisible()

  await page.goto(intermediateCheckpoint)
  await page.getByRole('link', { name: 'Try Again' }).click()
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await page.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/interviews-advanced-01-skill-1$/)
  await expect(page.getByRole('heading', { name: 'Advanced lesson 1' })).toBeVisible()

  await reset(request, true, { pathSlug: 'interviews', passedLessons: 29 })
  await page.goto('/practice/paths/interviews/lessons/interviews-advanced-10-skill-10')
  await page.getByRole('link', { name: 'Start Lesson' }).click()
  await recordOne(page)
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible()
  await expect(page.getByText('Path complete', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Path' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveCount(0)

  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible()
  await expect(page.getByText('Path complete', { exact: true })).toBeVisible()
  await expect(page.getByText('30 / 30 lessons passed', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Path' })).toBeVisible()
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
  await page.getByRole('link', { name: 'Start Lesson' }).click()
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
  await expect(page.getByText('/ 100', { exact: false })).toHaveCount(0)

  const neutralState = await currentState(request)
  const neutralAttempt = attemptAt(neutralState, 1)
  expect(neutralAttempt).toMatchObject({ score: null, lesson_id: scoredAttempt.lesson_id })
  expect(lessonBest(neutralState, scoredAttempt.lesson_id)).toMatchObject({
    best_score: 64,
    best_attempt_id: scoredAttempt.id,
  })
  expect(neutralState.practiceActivityDays).toHaveLength(1)

  await page.goto('/home')
  await expect(page.getByText('1 day streak', { exact: true })).toBeVisible()
  await expect(page.getByText("Today's practice complete", { exact: true })).toBeVisible()
  await expect(page.getByText('Best: 64 · Need 70 to continue', { exact: true })).toBeVisible()
  await page.goto('/practice/paths/interviews/lessons/interviews-beginner-02-skill-2')
  await expect(page.getByRole('heading', { name: 'Lesson locked' })).toBeVisible()
})

test('existing user can change Home priority without losing prior path progress', async ({
  page,
  request,
}) => {
  await reset(request, true, { pathSlug: 'interviews', passedLessons: 1, score: 74 })
  await logIn(page)
  await expect(page.getByRole('heading', { name: 'Continue Interviews' })).toBeVisible()
  await expect(page.getByText('1 / 30 lessons passed', { exact: true })).toBeVisible()

  await page.goto('/settings')
  await page.getByRole('group', { name: 'Primary path' }).getByText('Presentations').click()
  await page.getByRole('group', { name: 'Additional paths' }).getByText('Interviews').click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved.')

  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Continue Presentations' })).toBeVisible()
  const otherPaths = page.getByRole('region', { name: 'Your other paths' })
  await expect(otherPaths.getByText('Interviews', { exact: true })).toBeVisible()
  await expect(otherPaths.getByText('Beginner · 1 / 10 passed', { exact: true })).toBeVisible()

  await page.goto('/progress')
  const interviewCard = page
    .locator('section[aria-labelledby="curriculum-progress-heading"]')
    .getByText('Interviews', { exact: true })
  await expect(interviewCard).toBeVisible()
  await expect(page.getByText('1 / 30', { exact: true })).toBeVisible()

  const state = await currentState(request)
  expect(state.lessonProgress).toHaveLength(1)
  expect(state.lessonProgress[0]?.best_score).toBe(74)
})

test('@mobile mobile navigation exposes practice, history, and account menu', async ({ page }) => {
  await logIn(page)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practice', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'History' })).toBeVisible()
  await page.getByRole('button', { name: 'More options' }).click()
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
})

test('@mobile structured Practice stays readable through the lesson boundary', async ({ page }) => {
  await logIn(page)
  await page.goto('/practice')
  await expect(page.getByRole('heading', { name: 'Your paths' })).toBeVisible()
  await expect(page.getByText('Primary path')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Interview Free Practice' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Enter a custom prompt' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.getByRole('link', { name: 'Start' }).first().click()
  await expect(page.getByRole('heading', { name: 'Beginner lesson 1' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start Lesson' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.getByRole('link', { name: 'Interviews' }).click()
  await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible()
  await expect(page.getByText('Checkpoint').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
