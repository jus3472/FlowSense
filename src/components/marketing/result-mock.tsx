/**
 * MOCK. Every value below is hardcoded sample content with no data source
 * behind it. The real result view arrives in a later prompt and replaces this
 * file wholesale, so nothing here should be treated as a data shape.
 */

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

const SAMPLE_SECTIONS = [
  { label: 'What you said', points: 38, outOf: 50 },
  { label: 'How you sounded', points: 36, outOf: 50 },
]

export function ResultMock() {
  return (
    <section className="flex flex-col gap-4 py-12">
      <h2 className="text-foreground text-lg font-semibold">What you get back</h2>

      <div className="rounded-card bg-surface flex flex-col gap-6 p-6">
        <p className="text-foreground text-base">
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
          <div className="flex items-baseline gap-2">
            <span className="numeric text-foreground text-2xl font-medium">{SAMPLE_SCORE}</span>
            <span className="numeric text-muted text-sm">/ 100</span>
          </div>

          <dl className="flex flex-col gap-3">
            {SAMPLE_SECTIONS.map((section) => (
              <div key={section.label} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted text-sm">{section.label}</dt>
                  <dd className="numeric text-foreground text-sm">
                    {section.points} / {section.outOf}
                  </dd>
                </div>
                <div
                  aria-hidden="true"
                  className="bg-surface-sunken h-1 overflow-hidden rounded-full"
                >
                  <div
                    className="bg-accent h-full rounded-full"
                    style={{ width: `${(section.points / section.outOf) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="text-muted text-xs">
        A sample result. Yours uses your own words. Marked spans are where the point went soft, not
        mistakes.
      </p>
    </section>
  )
}
