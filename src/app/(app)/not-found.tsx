import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'

export default function AppNotFound() {
  return (
    <PageShell width="column">
      <Card className="flex flex-col gap-6 sm:p-8">
        <p className="numeric text-muted text-sm font-medium">404</p>
        <PageTitle>This page does not exist</PageTitle>
        <p className="text-muted text-base">
          The link may be out of date, or the page may have moved.
        </p>
        <div>
          <ButtonLink href="/home" size="lg">
            Go to home
          </ButtonLink>
        </div>
      </Card>
    </PageShell>
  )
}
