import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageShell } from '@/components/ui/page-shell'

export default function HomeLoading() {
  return (
    <PageShell width="column" className="gap-8">
      <Skeleton className="h-12 w-[180px]" />
      <Card className="flex flex-col gap-4 sm:p-8">
        <Skeleton className="h-8 w-[240px]" />
        <Skeleton className="h-4 w-[180px]" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="rounded-input h-14 w-full" />
      </Card>
    </PageShell>
  )
}
