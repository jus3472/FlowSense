const CASES = [
  'You have an interview coming up and you want your answers to land.',
  'You go quiet when someone asks for your take in a meeting.',
  'You have a presentation and you want to sound steady.',
  'You read and write English well and want your speaking to catch up.',
  'You know your material and you want it to come out clean.',
]

export function WhoItsFor() {
  return (
    <section className="flex flex-col gap-6 py-12">
      <h2 className="prompt-display text-foreground text-xl">
        For anyone who sounds sharper on paper
      </h2>
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
