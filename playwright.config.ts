import { defineConfig, devices } from '@playwright/test'

const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'e2e-fake-publishable-key',
  SUPABASE_SECRET_KEY: 'e2e-fake-secret-key',
  DEEPGRAM_API_KEY: 'e2e-never-used',
  DEEPSEEK_API_KEY: 'e2e-never-used',
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node tests/support/mock-supabase.mjs',
      url: 'http://127.0.0.1:54321/__e2e/state',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
      url: 'http://127.0.0.1:3100/login',
      reuseExistingServer: !process.env.CI,
      env: appEnv,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
      grepInvert: /@mobile/,
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
})
