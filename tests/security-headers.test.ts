import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function configuredHeaders(environment: string): Promise<Map<string, string>> {
  vi.stubEnv('NODE_ENV', environment)
  const rules = await nextConfig.headers?.()
  expect(rules).toHaveLength(1)
  expect(rules?.[0]?.source).toBe('/:path*')
  return new Map(rules?.[0]?.headers.map(({ key, value }) => [key, value]))
}

describe('security response headers', () => {
  it('applies anti-framing and content-type protection to every route', async () => {
    const headers = await configuredHeaders('development')

    expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('adds HSTS only in production without a preload commitment', async () => {
    const production = await configuredHeaders('production')
    expect(production.get('Strict-Transport-Security')).toBe('max-age=31536000')
    expect(production.get('Strict-Transport-Security')).not.toContain('preload')

    const development = await configuredHeaders('development')
    const test = await configuredHeaders('test')
    expect(development.has('Strict-Transport-Security')).toBe(false)
    expect(test.has('Strict-Transport-Security')).toBe(false)
  })
})
