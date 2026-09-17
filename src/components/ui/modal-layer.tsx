import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Shared viewport layer for focused dialogs. Dialog semantics and focus behavior stay with callers. */
export function ModalLayer({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'bg-foreground/20 fixed inset-0 z-50 flex items-center justify-center p-4',
        className,
      )}
    />
  )
}
