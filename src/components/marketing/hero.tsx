import { ButtonLink } from '@/components/ui/button'

export function Hero() {
  return (
    <section className="flex flex-col gap-6 py-12">
      <h1 className="text-foreground text-2xl font-semibold sm:text-3xl">
        Say it well the first time.
      </h1>
      <p className="text-muted text-base">
        You answer one prompt out loud. FlowSense shows you exactly where your point landed and
        where it went soft.
      </p>
      <div>
        <ButtonLink href="/login" size="lg">
          Get started
        </ButtonLink>
      </div>
    </section>
  )
}
