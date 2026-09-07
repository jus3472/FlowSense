import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageShell } from '@/components/ui/page-shell'

export default function HomeLoading() {
  return (
    <PageShell>
      <Skeleton className="h-12 w-[180px]" />
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="flex min-w-0 flex-col gap-6 sm:p-8">
            <Skeleton className="h-7 w-44 max-w-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-full" />
            </div>
            <Skeleton className="rounded-input h-11 w-full" />
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="rounded-input h-11 w-52 max-w-full" />
      </Card>
    </PageShell>
  )
}
