import { describe, expect, it } from 'vitest'
import { isClientFile, readSourceFiles } from './helpers/source-files'

const files = readSourceFiles()

const TAILWIND_PALETTES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|')

const COLOR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'from',
  'via',
  'to',
  'fill',
  'stroke',
  'outline',
  'decoration',
  'divide',
  'shadow',
  'accent',
  'caret',
  'placeholder',
].join('|')

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/
const COLOR_SCALE = new RegExp(
  `\\b(?:${COLOR_PREFIXES})-(?:(?:${TAILWIND_PALETTES})-\\d{2,3}|white|black)\\b`,
)
const SPACING =
  /\b(?:px|py|pt|pr|pb|pl|gap-x|gap-y|space-x|space-y|p|m|mx|my|mt|mr|mb|ml|gap)-(\d+)\b/g
const ALLOWED_SPACING = new Set([0, 1, 2, 3, 4, 6, 8, 12, 16])

function offenders(pattern: RegExp) {
  return files.filter((file) => pattern.test(file.contents)).map((file) => file.path)
}

describe('design system', () => {
  /**
   * A gauge implies a target, and this app has no benchmark and no comparison to
   * anyone else. A short bar on a low score is the honest picture.
   */
  it('draws the score bar as a literal proportion of 100', () => {
    const header = files.find((file) => file.path.endsWith('results/score-header.tsx'))
    expect(header).toBeDefined()
    expect(header?.contents).toMatch(/score \/ 100/)
    expect(header?.contents).toMatch(/scaleX\(\$\{fill\}\)/)
  })

  it('has no hex color in any component', () => {
    expect(offenders(HEX)).toEqual([])
  })

  it('has no Tailwind color scale class in any component', () => {
    expect(offenders(COLOR_SCALE)).toEqual([])
  })

  it('never puts text on the subtle token, which does not clear 4.5:1', () => {
    expect(offenders(/\btext-subtle\b/)).toEqual([])
  })

  it('only uses spacing on the 4 8 12 16 24 32 48 64 scale', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const match of file.contents.matchAll(SPACING)) {
        const step = Number(match[1])
        if (!ALLOWED_SPACING.has(step)) violations.push(`${file.path}: ${match[0]}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('uses defined responsive score type tokens on the v2 result screen', () => {
    const v2Results = files.find((file) => file.path.endsWith('results/v2-results-view.tsx'))
    expect(v2Results?.contents).toContain('text-3xl')
    expect(v2Results?.contents).toContain('sm:text-4xl')
    expect(v2Results?.contents).not.toMatch(/text-5xl|text-6xl/)
  })
})

describe('server only keys', () => {
  const SECRETS = [
    'SUPABASE_SECRET_KEY',
    'DEEPGRAM_API_KEY',
    'DEEPSEEK_API_KEY',
    'AZURE_SPEECH_KEY',
  ]
  const SERVER_ONLY_CONFIGURATION = [...SECRETS, 'AZURE_SPEECH_ENDPOINT']

  it('reads the secrets in exactly one module', () => {
    const readers = files
      .filter((file) => SECRETS.some((name) => file.contents.includes(`process.env.${name}`)))
      .map((file) => file.path)
    expect(readers).toEqual(['src/lib/env/server.ts'])
  })

  it('keeps client components away from the server env and the admin client', () => {
    const leaks = files
      .filter(isClientFile)
      .filter(
        (file) =>
          file.contents.includes('@/lib/env/server') ||
          file.contents.includes('@/lib/supabase/admin') ||
          SERVER_ONLY_CONFIGURATION.some((name) => file.contents.includes(name)),
      )
      .map((file) => file.path)
    expect(leaks).toEqual([])
  })
})
