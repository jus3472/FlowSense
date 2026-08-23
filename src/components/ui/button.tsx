import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-60'

const VARIANTS: Record<Variant, string> = {
  /**
   * Hover shifts brightness instead of swapping in a second blue. It darkens in
   * the light theme and lightens in the dark one, so the label contrast rises in
   * both directions rather than drifting under 4.5:1.
   */
  primary: 'bg-accent text-accent-fg hover:brightness-90 dark:hover:brightness-110',
  secondary: 'bg-surface-sunken text-foreground hover:bg-accent-soft',
  ghost: 'text-foreground hover:bg-surface-sunken',
}

/** Both sizes clear the 44px minimum tap target. */
const SIZES: Record<Size, string> = {
  md: 'min-h-11 px-6 text-sm',
  lg: 'min-h-14 px-8 text-base',
}

interface StyleOptions {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  className?: string
}

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: StyleOptions = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)
}

interface ButtonProps extends ComponentProps<'button'>, StyleOptions {
  /** Swaps the label and blocks input while a server action is in flight. */
  loading?: boolean
  loadingLabel?: string
  children: ReactNode
}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  loading = false,
  loadingLabel,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
    >
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
}

interface ButtonLinkProps extends ComponentProps<typeof Link>, StyleOptions {
  children: ReactNode
}

export function ButtonLink({
  variant,
  size,
  fullWidth,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link {...props} className={buttonClasses({ variant, size, fullWidth, className })}>
      {children}
    </Link>
  )
}
