import { spawnSync } from 'node:child_process'

// The calibration core is TypeScript and uses the app's path aliases, so the
// checked Vitest runner is the local CLI host. It never writes fixture data.
const result = spawnSync('npx', ['vitest', 'run', 'tests/scoring-calibration.test.ts'], {
  stdio: 'inherit',
})
process.exitCode = result.status ?? 1
