const CASES = [
  'You want general practice with an everyday question.',
  'You want to rehearse an interview response.',
  'You want to practice a presentation out loud.',
  'You want to prepare for a meeting or conversation.',
  'You want to write a custom prompt for a specific response.',
]

export function WhoItsFor() {
  return (
    <section className="flex flex-col gap-6 py-12">
      <h2 className="prompt-display text-foreground text-xl">Choose what you want to practice</h2>
      <ul className="flex flex-col gap-4">
        {CASES.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <span aria-hidden="true" className="text-accent mt-0.5 shrink-0 text-lg" />
            <span className="text-foreground text-base">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
