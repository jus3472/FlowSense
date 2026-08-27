import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const MOCK = 'http://127.0.0.1:54321'
const APP = 'http://127.0.0.1:3100'

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

async function reset(request: APIRequestContext, onboarded = true) {
  await request.post(`${MOCK}/__e2e/reset`, { data: { onboarded } })
}

async function logIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Sign up or log in').getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('Email').fill('speaker@example.test')
  await page.getByLabel('Password').fill('safe-test-password')
  await page.locator('form').getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/home$/)
}

async function processingMocks(page: Page, failure = false) {
  await page.route('**/api/transcribe', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"wordCount":13}' })
  })
  await page.route('**/api/score', async (route) => {
    const input = route.request().postDataJSON() as { attemptId: string }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const response = await page.request.post(`${MOCK}/__e2e/process/${input.attemptId}`, {
      data: { failure },
    })
    const result = await response.json()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
}

async function recordOne(page: Page) {
  await page.getByRole('button', { name: "I'm ready" }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Transcribing' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Scoring' })).toBeVisible()
  await expect(page).toHaveURL(/\/attempts\//, { timeout: 15_000 })
}

test.beforeEach(async ({ page, request }) => {
  await reset(request)
  await blockExternalNetwork(page)
})

test('sign up completes microphone and six-goal onboarding', async ({ page, request, context }) => {
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
  await expect(page.getByRole('heading', { name: 'What do you want to practice?' })).toBeVisible()
  for (const label of [
    'Interviews',
    'Presentations',
    'Meetings and conversations',
    'Difficult conversations',
    'Speaking on the spot',
    'General speaking ability',
  ]) {
    await expect(page.getByRole('button', { name: label })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Interviews' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
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
  await page.getByRole('link', { name: /Interviews/ }).click()
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
  const firstState = (await (await page.request.get(`${MOCK}/__e2e/state`)).json()) as {
    uploads: number
  }
  expect(firstState.uploads).toBe(1)
  await page.getByRole('link', { name: 'Try Again' }).click()
  await recordOne(page)
  expect(attemptPosts).toBe(2)
  const retryState = (await (await page.request.get(`${MOCK}/__e2e/state`)).json()) as {
    uploads: number
  }
  expect(retryState.uploads).toBe(2)
  await expect(page.getByLabel('Previous response comparison')).toContainText('Overall')
  await expect(page.getByRole('link', { name: 'View previous response' })).toBeVisible()
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
})

test('@mobile mobile navigation exposes practice, history, and account menu', async ({ page }) => {
  await logIn(page)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practice', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'History' })).toBeVisible()
  await page.getByRole('button', { name: 'More options' }).click()
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
})
