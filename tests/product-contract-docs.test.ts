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

  it('requires current versioning and fail-closed non-current results', () => {
    for (const document of documents) {
      expect(document.contents).toMatch(/rubric `v3`[\s\S]*`v3\.score\.2`/i)
      expect(document.contents).toMatch(
        /(other|unknown)[\s\S]*formats?[\s\S]*fail closed|unsupported/i,
      )
      expect(document.contents).toMatch(/resultless terminal attempts?/i)
    }
  })

  it('defines v3.2 as the only application runtime result generation', () => {
    const readme = documents.find((document) => document.path === 'README.md')?.contents ?? ''
    const project = documents.find((document) => document.path === 'PROJECT.md')?.contents ?? ''
    const agents = documents.find((document) => document.path === 'AGENTS.md')?.contents ?? ''

    expect(readme).toMatch(/payload `v3\.score\.2`/i)
    expect(project).toMatch(/payload `v3\.score\.2`/i)
    expect(agents).toMatch(/runtime supports only[\s\S]*`v3\.score\.2`/i)
  })
})
