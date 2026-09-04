import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const documents = ['README.md', 'PROJECT.md', 'AGENTS.md'].map((path) => ({
  path,
  contents: readFileSync(path, 'utf8'),
}))

describe('v3 product contract documentation', () => {
  it('defines the shared modes and response-level measurement', () => {
    for (const document of documents) {
      expect(document.contents).toContain('General Practice')
      expect(document.contents).toContain('Interviews')
      expect(document.contents).toContain('Presentations')
      expect(document.contents).toContain('Conversations')
      expect(document.contents).toMatch(/built-in[\s\S]*custom|custom[\s\S]*built-in/i)
      expect(document.contents).toMatch(/never a permanent rating of\s+(the\s+)?person/)
      expect(document.contents).toMatch(/Answered the Prompt[\s\S]*Specificity[\s\S]*Conciseness/)
      expect(document.contents).toMatch(/Pace[\s\S]*Paused\s+Time[\s\S]*Articulation[\s\S]*Energy/)
      expect(document.contents).toMatch(/10 visible\s+metrics|same 10 metrics/)
      expect(document.contents).toMatch(/unrelated\s+scoring system|one\s+scoring system/)
    }
  })

  it('keeps concrete language feedback, no-double-charging, and accent safeguards', () => {
    for (const document of documents) {
      expect(document.contents).toMatch(/concrete[\s\S]*response-level choice/)
      expect(document.contents).toMatch(/(speech|spoken)\s+span[\s\S]*one\s+check or metric/)
      expect(document.contents).toMatch(/never (judges|assess) accent|never assess accent/i)
      expect(document.contents).toMatch(/intelligibility or phoneme accuracy/)
      expect(document.contents).toMatch(/never whether someone sounds native/)
    }
  })

  it('requires versioning for v3 attempts while preserving authoritative legacy snapshots', () => {
    for (const document of documents) {
      expect(document.contents).toMatch(/new v3-scored attempt[\s\S]*rubric and score version/i)
      expect(document.contents).toMatch(
        /(legacy|historical) v1 and v2 attempts[\s\S]*(null or\s+older metadata|older or null metadata)/i,
      )
      expect(document.contents).toMatch(/stored snapshots remain authoritative/i)
    }
  })

  it('labels the v1 and v2 implementations separately from the v3 architecture', () => {
    const project = documents.find((document) => document.path === 'PROJECT.md')?.contents ?? ''
    const agents = documents.find((document) => document.path === 'AGENTS.md')?.contents ?? ''

    expect(project).toMatch(/50\/50, ten-metric score[\s\S]*legacy v1 implementation/i)
    expect(project).toMatch(/does not define the v2 category architecture/i)
    expect(agents).toMatch(/six-category v2[\s\S]*ten-metric v1[\s\S]*v3\.score\.1/i)
    expect(agents).toMatch(/current 10-metric `v3\.score\.2` architecture/i)
  })
})
