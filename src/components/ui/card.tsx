import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Compact section heading, subordinate to the page prompt. */
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 {...props} className={cn('text-foreground text-lg font-semibold', className)} />
}

/** A quiet grouped surface shared by every product area. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('border-border bg-surface shadow-card rounded-card border p-6', className)}
    />
  )
}
