import { ButtonLink } from '@/components/ui/button'

export function Hero() {
  return (
    <section className="max-w-reading flex flex-col gap-6 py-16">
      <span
        aria-hidden="true"
        className="from-score-fill-start to-score-fill-end h-1 w-16 rounded-full bg-linear-to-r"
      />
      <h1 className="prompt-display text-foreground text-3xl sm:text-4xl">
        Speak more clearly, one response at a time.
      </h1>
      <p className="text-muted max-w-column text-lg">
        Choose a prompt, answer out loud, and see concrete measurements for that response. Try the
        same prompt again when you want another take.
      </p>
      <div className="pt-2">
        <ButtonLink href="/login" size="lg">
          Get started
        </ButtonLink>
      </div>
    </section>
  )
}
