import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'

export default function SettingsLoading() {
  return (
    <PageShell width="column" className="gap-8">
      <Skeleton className="h-12 w-[180px]" />
      <Card className="flex flex-col gap-6 sm:p-8">
        <Skeleton className="h-8 w-[140px]" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-11 w-full" />
        </div>
        <Skeleton className="rounded-input h-14 w-[180px]" />
      </Card>
    </PageShell>
  )
}
