import { ButtonLink } from '@/components/ui/button'

export function Hero() {
  return (
    <section className="flex flex-col gap-6 py-12 sm:py-16">
      <span aria-hidden="true" className="bg-accent h-1 w-16" />
      <h1 className="prompt-display text-foreground text-2xl sm:text-3xl">
        Practice one response at a time.
      </h1>
      <p className="text-muted max-w-[34rem] text-base">
        Choose a prompt, answer out loud, and see concrete measurements for that response. Try the
        same prompt again when you want another take.
      </p>
      <div className="pt-2">
        <ButtonLink href="/login" size="lg" fullWidth>
          Get started
        </ButtonLink>
      </div>
    </section>
  )
}
