import { MinimalHeader } from '@/components/layout/minimal-header'
import { ButtonLink } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MinimalHeader />
      <main className="max-w-column mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-12">
        <p className="numeric text-muted text-sm font-medium">404</p>
        <h1 className="text-foreground text-xl font-semibold">This page does not exist</h1>
        <p className="text-muted text-base">
          The link may be out of date, or the page may have moved.
        </p>
        <div>
          <ButtonLink href="/" size="lg">
            Go to the start
          </ButtonLink>
        </div>
      </main>
    </div>
  )
}
