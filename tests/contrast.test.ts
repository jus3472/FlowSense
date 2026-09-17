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
  ['accent-ink', 'background'],
  ['accent-ink', 'surface'],
  ['accent-ink', 'surface-sunken'],
  ['accent-ink', 'accent-soft'],
  ['accent-fg', 'accent'],
  ['highlight-fg', 'highlight'],
  ['positive', 'background'],
  ['positive', 'surface-sunken'],
  ['negative', 'background'],
  ['negative', 'surface-sunken'],
  ['negative-fg', 'negative'],
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
      'accent-visual',
      'accent-ink',
      'accent-soft',
      'accent-fg',
      'score-track',
      'score-content',
      'score-delivery',
      'score-overall',
      'score-fill-start',
      'score-fill-end',
      'highlight',
      'highlight-fg',
      'positive',
      'negative',
      'negative-fg',
      'negative-soft',
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

  it.each(['score-content', 'score-delivery', 'score-overall'])(
    '%s stays distinct from the empty track',
    (fill) => {
      // The original pale gradient supplements an explicit numeric score label.
      expect(contrastRatio(tokens[fill]!, tokens['score-track']!)).toBeGreaterThanOrEqual(1.5)
    },
  )

  it('keeps chart and icon accents distinct from their surfaces', () => {
    expect(contrastRatio(tokens['accent-visual']!, tokens['score-track']!)).toBeGreaterThanOrEqual(
      3,
    )
  })

  it('blends the two equal sections into the overall hue', () => {
    expect(tokens['score-fill-start']).toBe(tokens['score-content'])
    expect(tokens['score-fill-end']).toBe(tokens['score-delivery'])
    expect(
      new Set([tokens['score-content'], tokens['score-overall'], tokens['score-delivery']]).size,
    ).toBe(3)
    for (const offset of [1, 3, 5]) {
      const component = (key: string) => Number.parseInt(tokens[key]!.slice(offset, offset + 2), 16)
      expect(component('score-overall')).toBe(
        Math.round((component('score-content') + component('score-delivery')) / 2),
      )
    }
  })
})
