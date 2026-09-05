import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type Width = 'form' | 'column' | 'reading' | 'page'

const WIDTHS: Record<Width, string> = {
  form: 'max-w-form',
  column: 'max-w-column',
  reading: 'max-w-reading',
  page: 'max-w-page',
}

/** Consistent page rhythm without forcing every screen into the same width. */
export function PageShell({
  width = 'page',
  className,
  ...props
}: ComponentProps<'div'> & { width?: Width }) {
  return (
    <div
      {...props}
      className={cn(
        'mx-auto flex w-full min-w-0 flex-col gap-12 pt-4 pb-16',
        WIDTHS[width],
        className,
      )}
    />
  )
}
