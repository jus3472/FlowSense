const CASES = [
  'You have an interview coming up and you want your answers to land.',
  'You go quiet when someone asks for your take in a meeting.',
  'You have a presentation and you want to sound steady.',
  'You read and write English well and want your speaking to catch up.',
  'You know your material and you want it to come out clean.',
]

export function WhoItsFor() {
  return (
    <section className="flex flex-col gap-4 py-12">
      <h2 className="text-foreground text-lg font-semibold">
        For anyone who sounds sharper on paper
      </h2>
      <ul className="flex flex-col gap-3">
        {CASES.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="bg-accent-soft ring-accent mt-2 size-2 shrink-0 rounded-full ring-2"
            />
            <span className="text-muted text-base">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
