import { MinimalHeader } from '@/components/layout/minimal-header'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageTitle } from '@/components/ui/page-title'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MinimalHeader />
      <main className="max-w-column mx-auto flex w-full flex-1 px-4 py-12 sm:px-8 sm:py-16">
        <Card className="flex w-full flex-col gap-6 sm:p-8">
          <p className="numeric text-muted text-sm font-medium">404</p>
          <PageTitle>This page does not exist</PageTitle>
          <p className="text-muted text-base">
            The link may be out of date, or the page may have moved.
          </p>
          <div>
            <ButtonLink href="/" size="lg">
              Go to the start
            </ButtonLink>
          </div>
        </Card>
      </main>
    </div>
  )
}
