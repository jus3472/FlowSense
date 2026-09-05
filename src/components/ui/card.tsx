import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** A quiet grouped surface shared by every product area. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('border-border bg-surface shadow-card rounded-card border p-6', className)}
    />
  )
}
