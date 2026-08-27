import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function configuredHeaders(
  nodeEnvironment: string,
  vercelEnvironment?: string,
): Promise<Map<string, string>> {
  vi.stubEnv('NODE_ENV', nodeEnvironment)
  vi.stubEnv('VERCEL_ENV', vercelEnvironment)
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

  it('adds HSTS only to Vercel production without a preload commitment', async () => {
    const production = await configuredHeaders('production', 'production')
    expect(production.get('Strict-Transport-Security')).toBe('max-age=31536000')
    expect(production.get('Strict-Transport-Security')).not.toContain('preload')

    const preview = await configuredHeaders('production', 'preview')
    const vercelDevelopment = await configuredHeaders('production', 'development')
    expect(preview.has('Strict-Transport-Security')).toBe(false)
    expect(vercelDevelopment.has('Strict-Transport-Security')).toBe(false)
  })

  it('retains production HSTS for non-Vercel hosts', async () => {
    const production = await configuredHeaders('production')
    const development = await configuredHeaders('development')

    expect(production.get('Strict-Transport-Security')).toBe('max-age=31536000')
    expect(development.has('Strict-Transport-Security')).toBe(false)
  })
})
