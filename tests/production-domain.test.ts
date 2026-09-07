import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ACTIVE_PRODUCTION_DOMAIN = 'https://flowsense-web.vercel.app'
const RETIRED_PRODUCTION_DOMAIN = 'flowsense-gold.vercel.app'

describe('Production domain documentation', () => {
  it('names the active user-facing domain in current deployment guidance', () => {
    for (const document of ['README.md', 'docs/RELEASE.md']) {
      const contents = readFileSync(document, 'utf8')
      expect(contents).toContain(ACTIVE_PRODUCTION_DOMAIN)
      expect(contents).not.toContain(RETIRED_PRODUCTION_DOMAIN)
    }
  })

  it('documents the Supabase Auth URL configuration required for the active origin', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toMatch(/Supabase Auth Site URL/i)
    expect(readme).toMatch(/Redirect URL allowlist/i)
  })
})
