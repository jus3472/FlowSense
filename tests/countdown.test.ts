import { describe, expect, it } from 'vitest'
import {
  MAX_COUNTDOWN_SECONDS,
  MIN_COUNTDOWN_SECONDS,
  countWords,
  countdownSecondsFor,
} from '@/lib/recording/countdown'

const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ')

describe('countWords', () => {
  it('is 0 for empty and whitespace', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n ')).toBe(0)
  })

  it('collapses runs of whitespace', () => {
    expect(countWords('  describe   your ideal weekend  ')).toBe(4)
  })
})

describe('countdownSecondsFor', () => {
  it('gives a 10 word prompt 6 seconds', () => {
    expect(countdownSecondsFor(words(10))).toBe(6)
  })

  it('scales with prompt length', () => {
    expect(countdownSecondsFor(words(5))).toBe(4)
    expect(countdownSecondsFor(words(12))).toBe(6.8)
  })

  it('clamps short prompts up to the 3 second floor', () => {
    expect(countdownSecondsFor('Why?')).toBe(MIN_COUNTDOWN_SECONDS)
    expect(countdownSecondsFor(words(2))).toBe(MIN_COUNTDOWN_SECONDS)
    expect(countdownSecondsFor('')).toBe(MIN_COUNTDOWN_SECONDS)
  })

  it('clamps long prompts down to the 8 second ceiling', () => {
    expect(countdownSecondsFor(words(20))).toBe(MAX_COUNTDOWN_SECONDS)
    expect(countdownSecondsFor(words(200))).toBe(MAX_COUNTDOWN_SECONDS)
  })

  it('lands exactly on each bound without crossing it', () => {
    // 2 + 0.4 * 2.5 is the floor, 2 + 0.4 * 15 is the ceiling.
    expect(countdownSecondsFor(words(3))).toBe(3.2)
    expect(countdownSecondsFor(words(15))).toBe(MAX_COUNTDOWN_SECONDS)
    expect(countdownSecondsFor(words(16))).toBe(MAX_COUNTDOWN_SECONDS)
  })

  it('never returns a value outside the bounds', () => {
    for (let count = 0; count <= 60; count += 1) {
      const seconds = countdownSecondsFor(words(count))
      expect(seconds).toBeGreaterThanOrEqual(MIN_COUNTDOWN_SECONDS)
      expect(seconds).toBeLessThanOrEqual(MAX_COUNTDOWN_SECONDS)
    }
  })

  it('measures real prompts from the seed list', () => {
    expect(countdownSecondsFor('Describe your ideal weekend.')).toBe(3.6)
    expect(countdownSecondsFor('Describe your hometown to someone who has never been there.')).toBe(
      6,
    )
  })
})
