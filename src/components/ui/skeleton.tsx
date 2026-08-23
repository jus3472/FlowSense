import { cn } from '@/lib/utils'

/**
 * A block that matches the shape of the content it stands in for. Loading
 * states compose these into the real layout rather than showing a spinner.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-skeleton rounded-input bg-surface-sunken', className)}
    />
  )
}
