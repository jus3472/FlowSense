import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Separation comes from the surface color, not from a border. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('rounded-card bg-surface p-6', className)} />
}
