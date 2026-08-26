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

  it('requires versioning for v2 attempts while preserving authoritative legacy snapshots', () => {
    for (const document of documents) {
      expect(document.contents).toMatch(/new v2-scored attempt[\s\S]*rubric and score version/i)
      expect(document.contents).toMatch(/legacy attempts[\s\S]*(null or\s+legacy metadata)/i)
      expect(document.contents).toMatch(/stored snapshots remain authoritative/i)
    }
  })

  it('labels the v1 score implementation separately from the v2 category architecture', () => {
    const project = documents.find((document) => document.path === 'PROJECT.md')?.contents ?? ''
    const agents = documents.find((document) => document.path === 'AGENTS.md')?.contents ?? ''

    expect(project).toMatch(/50\/50, ten-metric score[\s\S]*legacy v1 implementation/i)
    expect(project).toMatch(/does not define the v2 category architecture/i)
    expect(agents).toMatch(/50\/50, ten-metric scoring[\s\S]*legacy v1 implementation/i)
    expect(agents).toMatch(/Do not treat them as the v2 category architecture/i)
  })
})
