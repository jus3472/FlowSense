import Link from 'next/link'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Inline link. Accent text on the page background, never on an accent fill. */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cn(
        'rounded-input text-accent underline-offset-4 transition duration-150 ease-out hover:underline',
        className,
      )}
    />
  )
}
