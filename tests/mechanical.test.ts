import { describe, expect, it } from 'vitest'
import { analyseEnergy, correctOctaves } from '@/lib/scoring/energy'
import { analysePace, paceComponent } from '@/lib/scoring/pace'
import { analysePauses } from '@/lib/scoring/pauses'
import { computeMechanical, pauseBurden, pauseSeverity } from '@/lib/scoring/mechanical'
import { analyseTimeToFirstWord } from '@/lib/scoring/time-to-first-word'
import { ramp } from '@/lib/scoring/scale'
import { repeatedPhrases } from '@/lib/scoring/statistics'
import { amplitudeTimeline, pitchTimeline, tokensFrom } from './helpers/transcript'

const SPEECH = 0.1

describe('pause severity', () => {
  it('charges nothing under a second, which is ordinary rhythm', () => {
    expect(pauseSeverity(800)).toBe(0)
    expect(pauseSeverity(999)).toBe(0)
  })

  it('charges half severity at 1.75 seconds', () => {
    expect(pauseSeverity(1750)).toBeCloseTo(0.5, 6)
  })

  it('charges full severity from 2.5 seconds', () => {
    expect(pauseSeverity(2500)).toBe(1)
    expect(pauseSeverity(9000)).toBe(1)
  })

  it('ramps linearly between the bounds', () => {
    expect(pauseSeverity(1000)).toBeCloseTo(0, 6)
    expect(pauseSeverity(2200)).toBeCloseTo(0.8, 6)
  })
})

describe('pause burden', () => {
  it('normalizes severity per minute', () => {
    const pauses = [
      {
        start_ms: 0,
        end_ms: 0,
        duration_ms: 2500,
        kind: 'mid_sentence' as const,
        preceding_word: 'the',
        after_filler: false,
      },
      {
        start_ms: 0,
        end_ms: 0,
        duration_ms: 2500,
        kind: 'mid_sentence' as const,
        preceding_word: 'the',
        after_filler: false,
      },
    ]
    expect(pauseBurden(pauses, 60_000)).toBeCloseTo(2, 6)
    expect(pauseBurden(pauses, 120_000)).toBeCloseTo(1, 6)
  })

  it('earns everything at or below 0.4 per minute and nothing at 3.4', () => {
    expect(ramp(0.4, 0.4, 3.4)).toBe(1)
    expect(ramp(0.2, 0.4, 3.4)).toBe(1)
    expect(ramp(3.4, 0.4, 3.4)).toBe(0)
    expect(ramp(1.9, 0.4, 3.4)).toBeCloseTo(0.5, 6)
  })
})

describe('pause detection and classification', () => {
  /** Speech, a gap after a function word, then speech again. */
  const timeline = amplitudeTimeline(12_000, [
    { from_ms: 1000, to_ms: 3000, rms: SPEECH },
    { from_ms: 5000, to_ms: 12_000, rms: SPEECH },
  ])

  it('classifies a gap after a function word as mid-sentence', () => {
    const words = [
      { word: 'i', start: 1.0, end: 1.4 },
      { word: 'the', start: 1.5, end: 2.9 },
      { word: 'park', start: 5.1, end: 5.6 },
    ]
    const result = analysePauses(timeline, words, 12_000)
    expect(result.mid_sentence).toHaveLength(1)
    expect(result.mid_sentence[0]?.preceding_word).toBe('the')
  })

  it('classifies a gap after a content word as clean when it is short', () => {
    const shortGap = amplitudeTimeline(9000, [
      { from_ms: 1000, to_ms: 3000, rms: SPEECH },
      { from_ms: 3800, to_ms: 9000, rms: SPEECH },
    ])
    const words = [
      { word: 'park', start: 1.0, end: 2.9 },
      { word: 'yesterday', start: 3.9, end: 4.5 },
    ]
    const result = analysePauses(shortGap, words, 9000)
    expect(result.clean).toHaveLength(1)
    expect(result.mid_sentence).toHaveLength(0)
  })

  /** A three second silence is a stall wherever it lands. */
  it('treats a 4 second gap after a content word as mid-sentence', () => {
    const longGap = amplitudeTimeline(12_000, [
      { from_ms: 1000, to_ms: 3000, rms: SPEECH },
      { from_ms: 7000, to_ms: 12_000, rms: SPEECH },
    ])
    const words = [
      { word: 'park', start: 1.0, end: 2.9 },
      { word: 'yesterday', start: 7.1, end: 7.6 },
    ]
    const result = analysePauses(longGap, words, 12_000)
    expect(result.mid_sentence).toHaveLength(1)
    expect(result.mid_sentence[0]?.duration_ms).toBeGreaterThanOrEqual(3000)
    expect(result.mid_sentence[0]?.preceding_word).toBe('park')
  })

  it('excludes leading silence from classification but keeps it in total silence', () => {
    const words = [
      { word: 'i', start: 1.0, end: 1.4 },
      { word: 'the', start: 1.5, end: 2.9 },
      { word: 'park', start: 5.1, end: 5.6 },
    ]
    const result = analysePauses(timeline, words, 12_000)

    expect(result.leading_silence_ms).toBeGreaterThan(0)
    expect(result.pauses.every((pause) => pause.preceding_word.length > 0)).toBe(true)
    expect(result.mid_sentence.some((pause) => pause.start_ms === 0)).toBe(false)
    expect(result.total_silence_ms).toBeGreaterThan(result.leading_silence_ms)
  })

  it('ignores gaps shorter than 350ms', () => {
    const brief = amplitudeTimeline(6000, [
      { from_ms: 500, to_ms: 2000, rms: SPEECH },
      { from_ms: 2200, to_ms: 6000, rms: SPEECH },
    ])
    const words = [
      { word: 'the', start: 0.5, end: 1.9 },
      { word: 'park', start: 2.15, end: 2.8 },
    ]
    expect(analysePauses(brief, words, 6000).pauses).toHaveLength(0)
  })
})

describe('pace', () => {
  /** Articulation rate: 91 words spoken across 38 seconds of actual speech. */
  it('reports roughly 144 wpm for 91 words over 57 seconds with 19 seconds of silence', () => {
    const result = analysePace(91, 57_000, 19_000)
    expect(Math.round(result.words_per_minute)).toBe(144)
    expect(result.component).toBe(1)
  })

  it('is computed over speaking time, not wall clock', () => {
    const overSpeaking = analysePace(91, 57_000, 19_000)
    const overWallClock = analysePace(91, 57_000, 0)
    expect(Math.round(overWallClock.words_per_minute)).toBe(96)
    expect(overSpeaking.words_per_minute).toBeGreaterThan(overWallClock.words_per_minute)
  })

  it('holds full points across the comfortable band', () => {
    expect(paceComponent(120)).toBe(1)
    expect(paceComponent(150)).toBe(1)
    expect(paceComponent(175)).toBe(1)
  })

  it('ramps down when slow', () => {
    expect(paceComponent(80)).toBeCloseTo(0.25, 6)
    expect(paceComponent(100)).toBeCloseTo(0.625, 6)
    expect(paceComponent(40)).toBeCloseTo(0.25, 6)
  })

  it('ramps down when fast', () => {
    expect(paceComponent(220)).toBeCloseTo(0.35, 6)
    expect(paceComponent(300)).toBeCloseTo(0.35, 6)
    expect(paceComponent(197.5)).toBeCloseTo(0.675, 2)
  })
})

describe('energy', () => {
  it('scores a monotone reading at zero', () => {
    const result = analyseEnergy(pitchTimeline(Array.from({ length: 80 }, () => 120)))
    expect(result.enough_audio).toBe(true)
    expect(result.semitones).toBeCloseTo(0, 6)
    expect(result.component).toBe(0)
    expect(result.descriptor).toBe('flat')
  })

  it('scores a varied reading at full', () => {
    const values = Array.from({ length: 80 }, (_value, index) => (index % 2 === 0 ? 100 : 145))
    const result = analyseEnergy(pitchTimeline(values))
    expect(result.semitones).toBeGreaterThan(2.8)
    expect(result.component).toBe(1)
    expect(result.descriptor).toBe('animated')
  })

  /** One doubled frame is a 12 semitone outlier if it is left alone. */
  it('snaps an octave doubled frame back to the median octave', () => {
    expect(correctOctaves([120, 120, 120, 240])).toEqual([120, 120, 120, 120])
    expect(correctOctaves([120, 120, 120, 60])).toEqual([120, 120, 120, 120])
  })

  it('does not let octave errors inflate the value', () => {
    const clean = Array.from({ length: 60 }, () => 120)
    const withOctaves = [...clean]
    for (let i = 0; i < 10; i += 1) withOctaves[i * 5] = 240

    const cleanResult = analyseEnergy(pitchTimeline(clean))
    const noisyResult = analyseEnergy(pitchTimeline(withOctaves))
    expect(noisyResult.semitones).toBeCloseTo(cleanResult.semitones, 6)
    expect(noisyResult.descriptor).toBe('flat')
  })

  it('awards full points and says so when there is too little voiced audio', () => {
    const result = analyseEnergy(pitchTimeline(Array.from({ length: 20 }, () => 120)))
    expect(result.enough_audio).toBe(false)
    expect(result.component).toBe(1)
    expect(result.descriptor).toBe('Not enough voiced audio')
  })

  it('names each band', () => {
    // MAD is scaled by 1.4826, so the raw deviation has to be divided by it to
    // land on a target spread.
    const at = (semitoneSpread: number) => {
      const deviation = semitoneSpread / 1.4826
      const ratio = 2 ** (deviation / 12)
      const values = Array.from({ length: 80 }, (_v, i) =>
        i % 2 === 0 ? 120 / ratio : 120 * ratio,
      )
      return analyseEnergy(pitchTimeline(values)).descriptor
    }
    expect(at(0.4)).toBe('flat')
    expect(at(1.9)).toBe('steady')
    expect(at(2.5)).toBe('varied')
    expect(at(4)).toBe('animated')
  })
})

describe('time to first word', () => {
  it('uses the transcript when the two sources agree', () => {
    const result = analyseTimeToFirstWord([{ word: 'so', start: 1.2, end: 1.4 }], 1250)
    expect(result.source).toBe('transcript')
    expect(result.seconds).toBeCloseTo(1.2, 6)
  })

  it('prefers the amplitude timeline when they disagree by more than 200ms', () => {
    const result = analyseTimeToFirstWord([{ word: 'so', start: 3.0, end: 3.2 }], 1400)
    expect(result.source).toBe('amplitude')
    expect(result.seconds).toBeCloseTo(1.4, 6)
  })

  it('scores full at or below 2.5 seconds and zero at 12', () => {
    expect(analyseTimeToFirstWord([{ word: 'a', start: 2.5, end: 2.6 }], 2500).component).toBe(1)
    expect(analyseTimeToFirstWord([{ word: 'a', start: 1.0, end: 1.1 }], 1000).component).toBe(1)
    expect(analyseTimeToFirstWord([{ word: 'a', start: 12, end: 12.1 }], 12_000).component).toBe(0)
    expect(
      analyseTimeToFirstWord([{ word: 'a', start: 7.25, end: 7.3 }], 7250).component,
    ).toBeCloseTo(0.5, 6)
  })

  /** A 250ms floor once masked a broken calculation for weeks. */
  it('never clamps, and warns instead when the value is implausible', () => {
    const result = analyseTimeToFirstWord([{ word: 'a', start: 0.01, end: 0.2 }], 10)
    expect(result.seconds).toBeCloseTo(0.01, 6)
    expect(result.warning).toMatch(/implausibly low/)
  })

  it('varies with the input rather than returning a constant', () => {
    const values = [0.4, 1.1, 2.8, 5.5].map(
      (start) =>
        analyseTimeToFirstWord([{ word: 'a', start, end: start + 0.2 }], start * 1000).seconds,
    )
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('pause detection from word timings', () => {
  /**
   * Three deliberate gaps between clauses. Amplitude alone missed these on real
   * recordings whenever room tone sat above the calibrated threshold.
   */
  const words = [
    { word: 'i', start: 0.5, end: 0.9 },
    { word: 'went', start: 0.9, end: 1.3 },
    // gap 1: 1.5s
    { word: 'to', start: 2.8, end: 3.1 },
    { word: 'the', start: 3.1, end: 3.4 },
    // gap 2: 1.5s
    { word: 'park', start: 4.9, end: 5.3 },
    { word: 'yesterday', start: 5.3, end: 5.9 },
    // gap 3: 1.5s
    { word: 'alone', start: 7.4, end: 7.9 },
  ]

  const speechSpans = [
    { from_ms: 500, to_ms: 1300, rms: 0.2 },
    { from_ms: 2800, to_ms: 3400, rms: 0.2 },
    { from_ms: 4900, to_ms: 5900, rms: 0.2 },
    { from_ms: 7400, to_ms: 7900, rms: 0.2 },
  ]

  it('detects three pauses from three 1.5 second gaps', () => {
    const samples = amplitudeTimeline(9000, speechSpans, 0.0005)
    const result = analysePauses(samples, words, 9000)
    expect(result.pauses).toHaveLength(3)
    for (const pause of result.pauses) {
      expect(pause.duration_ms).toBeGreaterThanOrEqual(1000)
      expect(pause.duration_ms).toBeLessThanOrEqual(2000)
    }
  })

  /**
   * The exact failure from a real 35 second recording: the quietest tenth of the
   * opening seconds was near digital silence, so the old absolute threshold sat
   * far below the room tone between words and no frame ever fell under it.
   */
  it('still detects them when room tone sits above the old threshold', () => {
    const roomTone = 0.02
    const samples = amplitudeTimeline(9000, speechSpans, roomTone)
    // A moment of true silence at the very start drags the old floor down.
    for (const sample of samples.slice(0, 4)) sample.rms = 0.00001

    const result = analysePauses(samples, words, 9000)
    const oldThreshold = 0.00001 * 2.5
    expect(roomTone).toBeGreaterThan(oldThreshold)
    expect(result.speech_threshold).toBeGreaterThan(roomTone)
    expect(result.pauses).toHaveLength(3)
  })

  it('sets the threshold from the speech level in a quiet room', () => {
    const quiet = analysePauses(amplitudeTimeline(9000, speechSpans, 0.0005), words, 9000)
    expect(quiet.speech_level).toBeGreaterThan(0.1)
    // 0.15 of the speech level clears 2.5 times this floor, so it decides.
    expect(quiet.speech_threshold).toBeCloseTo(quiet.speech_level * 0.15, 6)
  })

  it('lets the noise floor take over in a loud room', () => {
    const noisy = analysePauses(amplitudeTimeline(9000, speechSpans, 0.02), words, 9000)
    // 2.5 times this floor is above 0.15 of the speech level, so it decides.
    expect(noisy.speech_threshold).toBeCloseTo(noisy.noise_floor * 2.5, 6)
    expect(noisy.speech_threshold).toBeGreaterThan(noisy.speech_level * 0.15)
  })

  it('keeps classifying by the preceding word', () => {
    const result = analysePauses(amplitudeTimeline(9000, speechSpans, 0.0005), words, 9000)
    // "went" is a content word, "the" is a function word.
    expect(result.pauses[0]?.preceding_word).toBe('went')
    expect(result.pauses[0]?.kind).toBe('clean')
    expect(result.pauses[1]?.preceding_word).toBe('the')
    expect(result.pauses[1]?.kind).toBe('mid_sentence')
  })

  it('excludes leading and trailing silence from the classified pauses', () => {
    const result = analysePauses(amplitudeTimeline(9000, speechSpans, 0.0005), words, 9000)
    expect(result.leading_silence_ms).toBeGreaterThan(0)
    expect(result.trailing_silence_ms).toBeGreaterThan(0)
    expect(result.total_silence_ms).toBeGreaterThan(
      result.pauses.reduce((sum, pause) => sum + pause.duration_ms, 0),
    )
  })

  /** A metric that silently returns a perfect score is worse than one that errors. */
  it('warns when a long recording reports implausibly little silence', () => {
    const packed = Array.from({ length: 90 }, (_value, index) => ({
      word: 'word',
      start: index * 0.333,
      end: index * 0.333 + 0.333,
    }))
    const samples = amplitudeTimeline(30_000, [{ from_ms: 0, to_ms: 30_000, rms: 0.2 }], 0.2)
    const result = analysePauses(samples, packed, 30_000)

    expect(result.total_silence_ms / 30_000).toBeLessThan(0.03)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/implausible for natural speech/)
    expect(result.warnings[0]).toMatch(/noise floor/)
    expect(result.warnings[0]).toMatch(/speech level/)
    expect(result.warnings[0]).toMatch(/threshold/)
  })

  it('does not warn on a short recording or a normally paced one', () => {
    const samples = amplitudeTimeline(9000, speechSpans, 0.0005)
    expect(analysePauses(samples, words, 9000).warnings).toHaveLength(0)
  })
})

describe('repeated phrases', () => {
  const noisy =
    'I went to the city I like. It was a pretty place. I went to the city I like again. ' +
    'It was a pretty spot. The same problem kept coming back. The same problem was annoying.'

  const phrases = repeatedPhrases(tokensFrom(noisy)).map((entry) => entry.phrase)

  /** A clause fragment, not a phrase a listener would notice. */
  it('rejects a fragment that ends on a pronoun', () => {
    expect(phrases).not.toContain('city i')
  })

  it('rejects a determiner and a generic adjective with no noun or verb', () => {
    expect(phrases).not.toContain('a pretty')
    expect(phrases).not.toContain('the different')
  })

  it('accepts a genuine repeated noun phrase', () => {
    expect(phrases).toContain('the same problem')
  })

  it('never lets a phrase cross a sentence boundary', () => {
    const across = 'I saw the dog. The dog ran. I saw the dog. The dog ran.'
    for (const entry of repeatedPhrases(tokensFrom(across))) {
      // "dog the" would only exist by spanning the full stop between them.
      expect(entry.phrase).not.toMatch(/dog the/)
    }
  })

  it('reports at most five', () => {
    expect(repeatedPhrases(tokensFrom(noisy)).length).toBeLessThanOrEqual(5)
  })
})

describe('pauses after a hesitation', () => {
  const transcript = 'I would probably, uh, spend time there. Good question. I went home.'
  const words = [
    { word: 'i', start: 0.5, end: 0.7 },
    { word: 'would', start: 0.7, end: 1.0 },
    { word: 'probably', start: 1.0, end: 1.4 },
    { word: 'uh', start: 1.4, end: 1.7 },
    // 1.8s gap straight after a filler
    { word: 'spend', start: 3.5, end: 3.8 },
    { word: 'time', start: 3.8, end: 4.1 },
    { word: 'there', start: 4.1, end: 4.5 },
    { word: 'good', start: 4.5, end: 4.8 },
    { word: 'question', start: 4.8, end: 5.4 },
    // 1.8s gap after a content word that ends a sentence
    { word: 'i', start: 7.2, end: 7.4 },
    { word: 'went', start: 7.4, end: 7.7 },
    { word: 'home', start: 7.7, end: 8.1 },
  ]

  const capture = {
    mime_type: 'audio/webm;codecs=opus',
    started_at: new Date().toISOString(),
    duration_ms: 8500,
    sample_interval_ms: 50,
    amplitude: amplitudeTimeline(
      8500,
      [
        { from_ms: 500, to_ms: 1700, rms: 0.2 },
        { from_ms: 3500, to_ms: 5400, rms: 0.2 },
        { from_ms: 7200, to_ms: 8100, rms: 0.2 },
      ],
      0.0005,
    ),
    pitch: pitchTimeline(Array.from({ length: 60 }, () => 120)),
  }

  const result = computeMechanical(capture, words, transcript)

  it('finds both gaps', () => {
    expect(result.pauses).toHaveLength(2)
  })

  /** The speaker was audibly still assembling the sentence. */
  it('classifies the pause after "probably, uh," as mid-sentence', () => {
    const pause = result.pauses[0]
    expect(pause?.after_filler).toBe(true)
    expect(pause?.kind).toBe('mid_sentence')
    // Classified against the last word that carried meaning, not the filler.
    expect(pause?.preceding_word).toBe('probably')
  })

  it('leaves the pause after "question." clean', () => {
    const pause = result.pauses[1]
    expect(pause?.after_filler).toBe(false)
    expect(pause?.preceding_word).toBe('question')
    expect(pause?.kind).toBe('clean')
  })

  it('charges the hesitation pause and not the clean one', () => {
    expect(result.statistics.mid_sentence_pause_count).toBe(1)
    expect(result.statistics.clean_pause_count).toBe(1)
  })
})
