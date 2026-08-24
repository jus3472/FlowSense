import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function AttemptLoading() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-4 w-3/4" />

      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-[72px]" />
        <Skeleton className="h-14 w-[160px]" />
        <Skeleton className="h-4 w-[240px]" />
        <Skeleton className="h-1 w-full rounded-full" />
      </div>

      <Card className="flex flex-col gap-3">
        {['w-full', 'w-full', 'w-11/12', 'w-2/3'].map((width, index) => (
          <Skeleton key={index} className={`h-5 ${width}`} />
        ))}
      </Card>

      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <Skeleton className="h-5 w-[140px]" />
            <Skeleton className="h-4 w-[56px]" />
          </div>
          <Card className="flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-[180px]" />
                <Skeleton className="h-4 w-[48px]" />
              </div>
            ))}
          </Card>
        </div>
      ))}

      <Skeleton className="h-14 w-full rounded-full" />
    </div>
  )
}
