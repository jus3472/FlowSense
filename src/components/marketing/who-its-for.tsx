const CASES = [
  'You want to practice with an everyday question.',
  'You want to rehearse an interview response.',
  'You want to practice a presentation out loud.',
  'You want to prepare for a meeting or conversation.',
  'You want to write a custom prompt for a specific response.',
]

export function WhoItsFor() {
  return (
    <section className="border-border flex flex-col gap-8 border-t py-16">
      <h2 className="prompt-display text-foreground text-xl">Choose what you want to practice</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {CASES.map((item) => (
          <li
            key={item}
            className="border-border bg-surface rounded-card flex items-start gap-3 border p-4"
          >
            <span aria-hidden="true" className="bg-accent mt-2 size-2 shrink-0 rounded-full" />
            <span className="text-foreground text-sm">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
