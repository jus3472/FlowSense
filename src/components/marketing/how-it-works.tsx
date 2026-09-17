const STEPS = [
  {
    title: 'Choose a track',
    body: 'Choose General Speaking, Interviews, Presentations, or Conversations, or write a custom prompt.',
  },
  {
    title: 'Answer out loud',
    body: 'Speak for up to 60 seconds. The result measures this response.',
  },
  {
    title: 'See what shaped your result',
    body: 'Review what you said, how you sounded, and the evidence behind each measurement.',
  },
  {
    title: 'Try Again',
    body: 'Record the same prompt again when you want another take.',
  },
]

export function HowItWorks() {
  return (
    <section className="border-border flex flex-col gap-8 border-t py-16">
      <h2 className="section-label text-muted">How it works</h2>
      <ol className="grid gap-6 md:grid-cols-2">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="border-border bg-surface shadow-card rounded-card grid grid-cols-[32px_minmax(0,1fr)] gap-4 border p-6"
          >
            <span className="numeric bg-accent text-accent-fg flex size-8 items-center justify-center rounded-full text-sm font-medium">
              {index + 1}
            </span>
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
