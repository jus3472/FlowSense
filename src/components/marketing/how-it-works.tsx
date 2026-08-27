const STEPS = [
  {
    title: 'Choose your practice',
    body: 'Pick General Practice, Interviews, Presentations, or Conversations. Start with a library prompt or write a custom prompt.',
  },
  {
    title: 'Answer out loud',
    body: 'Speak for up to 60 seconds. The result measures this response.',
  },
  {
    title: 'Review the result',
    body: 'See Fluency, Clarity, Vocabulary, Grammar, Structure, and Delivery with concrete evidence when it is available.',
  },
  {
    title: 'Try Again',
    body: 'Record the same prompt again when you want another take.',
  },
]

export function HowItWorks() {
  return (
    <section className="flex flex-col gap-6 py-12">
      <h2 className="section-label text-muted">How it works</h2>
      <ol className="flex flex-col gap-6">
        {STEPS.map((step, index) => (
          <li key={step.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-4">
            <span className="numeric text-accent text-sm">{index + 1}</span>
            <span className="flex flex-col gap-1">
              <h3 className="text-foreground text-base font-medium">{step.title}</h3>
              <p className="text-muted text-sm">{step.body}</p>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
