import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function HomeLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-[180px]" />
        <Skeleton className="h-4 w-[240px]" />
      </div>

      <Skeleton className="h-14 w-full rounded-full" />

      {[0, 1].map((index) => (
        <Card key={index} className="flex flex-col gap-4">
          <Skeleton className="h-4 w-[96px]" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
      ))}
    </div>
  )
}
