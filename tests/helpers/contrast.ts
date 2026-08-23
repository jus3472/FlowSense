import { readFileSync } from 'node:fs'

export type Tokens = Record<string, string>

function channel(value: number): number {
  const srgb = value / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Pulls the token values straight out of the stylesheet, so the test tracks it. */
export function readThemeTokens(selector: string, path = 'src/app/globals.css'): Tokens {
  const css = readFileSync(path, 'utf8')
  const index = css.indexOf(selector)
  if (index === -1) throw new Error(`Selector ${selector} not found in ${path}`)

  const start = css.indexOf('{', index)
  const end = css.indexOf('}', start)
  const block = css.slice(start + 1, end)

  const tokens: Tokens = {}
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    const [, name, value] = match
    if (name && value) tokens[name] = value
  }
  return tokens
}
