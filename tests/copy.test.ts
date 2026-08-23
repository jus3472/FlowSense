import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSourceFiles } from './helpers/source-files'

const MIGRATIONS = 'supabase/migrations'

const sources = readSourceFiles().map((file) => ({ path: file.path, contents: file.contents }))
const migrations = readdirSync(MIGRATIONS).map((name) => ({
  path: join(MIGRATIONS, name),
  contents: readFileSync(join(MIGRATIONS, name), 'utf8'),
}))
const everything = [...sources, ...migrations]

describe('copy rules', () => {
  it('uses no em dash or en dash anywhere', () => {
    const offenders = everything
      .filter((file) => /[—–]/.test(file.contents))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('never says AI in user facing text', () => {
    const offenders = sources
      .filter((file) => /\bAI\b/.test(file.contents))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('seeds 20 prompts', () => {
    const seed = migrations.find((file) => file.path.includes('seed_prompts'))
    expect(seed).toBeDefined()
    const lines = seed?.contents.match(/^\s{4}\('.+'\),?$/gm) ?? []
    expect(lines).toHaveLength(20)
  })
})
