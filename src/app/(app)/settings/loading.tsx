import { Skeleton } from '@/components/ui/skeleton'

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-8 w-[140px]" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-[120px]" />
        <Skeleton className="h-11 w-full" />
      </div>
      <Skeleton className="h-14 w-[180px] rounded-full" />
    </div>
  )
}
