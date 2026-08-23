import { Skeleton } from '@/components/ui/skeleton'

const CHIP_WIDTHS = [
  'w-[112px]',
  'w-[96px]',
  'w-[140px]',
  'w-[128px]',
  'w-[176px]',
  'w-[208px]',
  'w-[152px]',
]

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-8 w-[140px]" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-[120px]" />
        <Skeleton className="h-11 w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-[100px]" />
        <div className="flex flex-wrap gap-2">
          {CHIP_WIDTHS.map((width) => (
            <Skeleton key={width} className={`h-11 rounded-full ${width}`} />
          ))}
        </div>
      </div>
      <Skeleton className="h-14 w-[180px] rounded-full" />
    </div>
  )
}
