/** Static marketing sample. It does not read or calculate result data. */

interface Segment {
  text: string
  highlight?: boolean
}

const SAMPLE_TRANSCRIPT: Segment[] = [
  { text: 'I think the main thing is that', highlight: true },
  {
    text: ' I like problems where the answer is not obvious at the start. You have to sit with it. ',
  },
  { text: 'So basically what I would say is', highlight: true },
  { text: ' I like the part before anyone knows the shape of the answer.' },
]

const SAMPLE_SCORE = 74

const SAMPLE_CATEGORIES = ['Fluency', 'Clarity', 'Vocabulary', 'Grammar', 'Structure', 'Delivery']

export function ResultMock() {
  return (
    <section className="flex flex-col gap-6 py-12">
      <h2 className="section-label text-muted">What you get back</h2>

      <div className="rounded-card bg-surface flex flex-col gap-8 p-8">
        <p className="text-foreground text-lg leading-loose">
          {SAMPLE_TRANSCRIPT.map((segment, index) =>
            segment.highlight ? (
              <mark key={index} className="rounded-input bg-highlight text-highlight-fg px-1">
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>

        <div className="flex flex-col gap-4">
          <p className="text-muted text-sm">Sample Interview result</p>
          <div className="flex items-baseline gap-2">
            <span className="numeric text-foreground text-2xl font-medium">{SAMPLE_SCORE}</span>
            <span className="numeric text-muted text-sm">/ 100</span>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-muted text-sm">Response categories</p>
            <ul
              aria-label="Sample result categories"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            >
              {SAMPLE_CATEGORIES.map((category) => (
                <li
                  key={category}
                  className="rounded-input bg-surface-sunken text-foreground px-3 py-2 text-sm"
                >
                  {category}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <p className="text-muted text-sm">
        Your result uses your response. Marked spans point to specific evidence behind a deduction.
      </p>
    </section>
  )
}
