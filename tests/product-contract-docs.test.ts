import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const documents = ['README.md', 'PROJECT.md', 'AGENTS.md'].map((path) => ({
  path,
  contents: readFileSync(path, 'utf8'),
}))

describe('v2 product contract documentation', () => {
  it('defines the shared modes and response-level measurement', () => {
    for (const document of documents) {
      expect(document.contents).toContain('General Practice')
      expect(document.contents).toContain('Interviews')
      expect(document.contents).toContain('Presentations')
      expect(document.contents).toContain('Conversations')
      expect(document.contents).toMatch(/built-in[\s\S]*custom|custom[\s\S]*built-in/i)
      expect(document.contents).toMatch(/never a permanent rating of (the )?person/)
      expect(document.contents).toMatch(
        /fluency, clarity, vocabulary, grammar,\s*structure, and delivery/,
      )
      expect(document.contents).toMatch(/unrelated scoring system|one scoring system/)
    }
  })

  it('keeps concrete language feedback, no-double-charging, and accent safeguards', () => {
    for (const document of documents) {
      expect(document.contents).toMatch(/concrete[\s\S]*response-level choice/)
      expect(document.contents).toMatch(/(speech|spoken) span[\s\S]*one check or metric/)
      expect(document.contents).toMatch(/never (judges|assess) accent|never assess accent/i)
      expect(document.contents).toMatch(/intelligibility or phoneme accuracy/)
      expect(document.contents).toMatch(/never whether someone sounds native/)
    }
  })

  it('requires historical results and snapshots to remain versioned', () => {
    for (const document of documents) {
      expect(document.contents).toMatch(/rubric[\s\S]*score version|version[\s\S]*rubric[\s\S]*score/i)
      expect(document.contents).toMatch(/historical.*attempts|past attempts|rewrite history/i)
      expect(document.contents).toMatch(/snapshot/i)
    }
  })
})
