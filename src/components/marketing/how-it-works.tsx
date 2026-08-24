const STEPS = [
  {
    title: 'A prompt appears',
    body: 'One everyday question. No preparation time and nothing to look up.',
  },
  {
    title: 'You answer out loud',
    body: 'Speak for up to 60 seconds. No script and no second take.',
  },
  {
    title: 'You see how you sounded',
    body: 'A score out of 100, your words marked up, and a tighter version of your answer.',
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
