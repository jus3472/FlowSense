import { describe, expect, it } from 'vitest'
import { contrastRatio, readThemeTokens } from './helpers/contrast'

const light = readThemeTokens(':root')
const dark = readThemeTokens("[data-theme='dark']")

/** Every pair where one token renders text on top of the other. */
const TEXT_PAIRS: Array<[string, string]> = [
  ['foreground', 'background'],
  ['foreground', 'surface'],
  ['foreground', 'surface-sunken'],
  ['foreground', 'accent-soft'],
  ['muted', 'background'],
  ['muted', 'surface'],
  ['muted', 'surface-sunken'],
  ['accent', 'background'],
  ['accent', 'surface'],
  ['accent', 'surface-sunken'],
  ['accent-fg', 'accent'],
  ['highlight-fg', 'highlight'],
  ['positive', 'background'],
  ['positive', 'surface-sunken'],
  ['negative', 'background'],
  ['negative', 'surface-sunken'],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, tokens) => {
  it('declares every color token', () => {
    const required = [
      'background',
      'surface',
      'surface-sunken',
      'border',
      'foreground',
      'muted',
      'subtle',
      'accent',
      'accent-soft',
      'accent-fg',
      'score-track',
      'score-fill-start',
      'score-fill-end',
      'highlight',
      'highlight-fg',
      'positive',
      'negative',
    ]
    expect(Object.keys(tokens).sort()).toEqual(required.sort())
  })

  it.each(TEXT_PAIRS)('%s on %s clears 4.5:1', (foreground, background) => {
    const value = tokens[foreground]
    const surface = tokens[background]
    expect(value, `missing --${foreground}`).toBeDefined()
    expect(surface, `missing --${background}`).toBeDefined()
    expect(contrastRatio(value as string, surface as string)).toBeGreaterThanOrEqual(4.5)
  })
})
