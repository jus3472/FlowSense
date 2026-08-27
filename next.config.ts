import type { NextConfig } from 'next'

const baselineSecurityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]

function shouldEmitHsts(): boolean {
  const vercelEnvironment = process.env.VERCEL_ENV
  return vercelEnvironment === undefined
    ? process.env.NODE_ENV === 'production'
    : vercelEnvironment === 'production'
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactStrictMode: true,
  async headers() {
    const headers = [...baselineSecurityHeaders]
    if (shouldEmitHsts()) {
      // Preload is intentionally omitted because it is a long-lived external commitment.
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' })
    }

    return [{ source: '/:path*', headers }]
  },
}

export default nextConfig
