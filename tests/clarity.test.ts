import { describe, expect, it } from 'vitest'
import { analyseClarity } from '@/lib/scoring/v2/clarity'
const capture = { amplitude: [{}] } as never
const words = (...confidence: Array<number | undefined>) => confidence.map((value, i) => ({ word: `word${i}`, start: i, end: i + 0.2, ...(value === undefined ? {} : { confidence: value }) }))
describe('clarity evidence', () => {
  it('scores clear recognition and scattered uncertainty', () => { expect(analyseClarity(words(.95,.9,.92), capture).component).toBe(1); expect(analyseClarity(words(.95,.4,.9,.9), capture).component).toBe(.75) })
  it('withholds global, empty, and legacy evidence', () => { expect(analyseClarity(words(.2,.3,.4), capture).status).toBe('not_checked'); expect(analyseClarity(words(.9), capture).status).toBe('not_checked'); expect(analyseClarity(words(undefined,undefined,undefined), capture).status).toBe('not_checked') })
  it('rejects malformed confidence and unavailable audio', () => { expect(analyseClarity(words(.9, 2, .8), capture).measurements.confidence_word_count).toBe(2); expect(analyseClarity(words(.9,.9,.9), null).status).toBe('unavailable') })
})
