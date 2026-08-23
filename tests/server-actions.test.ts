import { describe, expect, it } from 'vitest'
import { readSourceFiles } from './helpers/source-files'

const serverActionFiles = readSourceFiles().filter((file) =>
  /^\s*['"]use server['"]/.test(file.contents),
)

describe('server action modules', () => {
  it('finds the action modules', () => {
    expect(serverActionFiles.length).toBeGreaterThan(0)
  })

  /**
   * Next rejects a "use server" module that exports anything other than an
   * async function, and it does so at request time rather than at build time.
   * A stray `export const` therefore ships green and fails in the browser.
   */
  it.each(serverActionFiles.map((file) => file.path))('%s exports only async functions', (path) => {
    const file = serverActionFiles.find((candidate) => candidate.path === path)
    const badExports =
      file?.contents.match(/^export\s+(?!async function|type |interface )\S.*$/gm) ?? []
    expect(badExports).toEqual([])
  })
})
