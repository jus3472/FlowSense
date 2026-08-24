/**
 * Lets a script import the app's own modules by their `@/` path.
 *
 * Node strips the types itself, so the only thing missing is the alias the
 * bundler resolves. Without this an inspection script would have to keep its own
 * copy of rules that live in `src`, and a second copy is a second answer.
 */
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const SUFFIXES = ['.ts', '.tsx', '/index.ts', '']

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context)

  const base = resolvePath(ROOT, 'src', specifier.slice(2))
  const found = SUFFIXES.map((suffix) => `${base}${suffix}`).find((path) => existsSync(path))
  if (!found) return nextResolve(specifier, context)

  return nextResolve(pathToFileURL(found).href, context)
}
