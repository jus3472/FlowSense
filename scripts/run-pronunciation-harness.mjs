import { readFileSync } from 'node:fs'

const fixturePath = new URL('../fixtures/pronunciation/provider-fixtures.json', import.meta.url)
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))
let failed = false

for (const fixture of fixtures) {
  const response = fixture.response
  const expected = fixture.expected
  const valid =
    response &&
    response.contractVersion === 'v1' &&
    response.provider &&
    typeof response.provider.id === 'string' &&
    typeof response.provider.model === 'string' &&
    typeof response.provider.version === 'string' &&
    typeof response.provider.locale === 'string' &&
    Array.isArray(response.words) &&
    response.eligibleForDeductions === false
  const firstWord = response?.words?.[0]
  const checks = [
    ['parse', expected.parse === 'ok' ? valid : !valid],
    ['lexical', !expected.lexicalOutcome || firstWord?.lexicalOutcome === expected.lexicalOutcome],
    ['status', !expected.status || response?.status === expected.status],
    [
      'intelligibility',
      !expected.intelligibility || firstWord?.intelligibility === expected.intelligibility,
    ],
    ['non-deductible', expected.deductible !== false || response?.eligibleForDeductions === false],
  ]
  const passed = checks.every(([, check]) => check)
  console.log(
    `${passed ? 'PASS' : 'FAIL'} ${fixture.id}: ${checks
      .filter(([, check]) => check)
      .map(([name]) => name)
      .join(', ')}`,
  )
  failed ||= !passed
}

if (failed) process.exitCode = 1
