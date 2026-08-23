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
    <section className="flex flex-col gap-4 py-12">
      <h2 className="text-foreground text-lg font-semibold">How it works</h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-card bg-surface flex flex-col gap-2 p-6">
            <span className="numeric text-accent text-sm font-medium">{index + 1}</span>
            <h3 className="text-foreground text-base font-medium">{step.title}</h3>
            <p className="text-muted text-sm">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
