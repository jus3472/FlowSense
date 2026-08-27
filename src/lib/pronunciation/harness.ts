import { parsePronunciationEvaluation } from '@/lib/pronunciation/contracts'

export interface PronunciationHarnessFixture {
  id: string
  expected: Record<string, unknown>
  response: unknown
}

export interface PronunciationHarnessCaseResult {
  id: string
  passed: boolean
  checks: readonly string[]
}

export interface PronunciationHarnessResult {
  passed: boolean
  cases: readonly PronunciationHarnessCaseResult[]
}

function expectedText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Runs only local normalized fixtures. It makes no provider or network call. */
export function runPronunciationHarness(
  fixtures: readonly PronunciationHarnessFixture[],
): PronunciationHarnessResult {
  const cases = fixtures.map((fixture) => {
    const checks: string[] = []
    const parsed = parsePronunciationEvaluation(fixture.response)
    const expectedParse = expectedText(fixture.expected.parse)
    checks.push(parsed.ok === (expectedParse === 'ok') ? 'parse' : 'parse mismatch')
    if (!parsed.ok) {
      const expectedError = expectedText(fixture.expected.error)
      if (expectedError)
        checks.push(parsed.error.code === expectedError ? 'error' : 'error mismatch')
    } else {
      const first = parsed.value.words[0]
      const expectedLexical = expectedText(fixture.expected.lexicalOutcome)
      const expectedStatus = expectedText(fixture.expected.status)
      const expectedIntelligibility = expectedText(fixture.expected.intelligibility)
      const expectedSupport = expectedText(fixture.expected.phonemeAvailability)
      const expectedError = expectedText(fixture.expected.error)
      if (expectedLexical)
        checks.push(first?.lexicalOutcome === expectedLexical ? 'lexical' : 'lexical mismatch')
      if (expectedStatus)
        checks.push(parsed.value.status === expectedStatus ? 'status' : 'status mismatch')
      if (expectedIntelligibility)
        checks.push(
          first?.intelligibility === expectedIntelligibility
            ? 'intelligibility'
            : 'intelligibility mismatch',
        )
      if (expectedSupport)
        checks.push(
          first?.stressProsody.availability === expectedSupport
            ? 'phoneme support'
            : 'phoneme support mismatch',
        )
      if (expectedError)
        checks.push(parsed.value.error?.code === expectedError ? 'error' : 'error mismatch')
      if (fixture.expected.deductible === false)
        checks.push(
          parsed.value.eligibleForDeductions === false ? 'non-deductible' : 'deduction mismatch',
        )
    }
    return { id: fixture.id, passed: checks.every((check) => !check.endsWith('mismatch')), checks }
  })
  return { passed: cases.every((result) => result.passed), cases }
}
