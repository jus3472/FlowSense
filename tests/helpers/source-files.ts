import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const SRC_ROOT = 'src'

export interface SourceFile {
  path: string
  contents: string
}

/** Every TypeScript and TSX file under a directory, depth first. */
export function readSourceFiles(root: string = SRC_ROOT): SourceFile[] {
  const files: SourceFile[] = []

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
        files.push({ path, contents: readFileSync(path, 'utf8') })
      }
    }
  }

  walk(root)
  return files
}

export function isClientFile(file: SourceFile): boolean {
  return /^\s*['"]use client['"]/.test(file.contents)
}
