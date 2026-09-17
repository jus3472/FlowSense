import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-input font-medium transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-60'

const VARIANTS: Record<Variant, string> = {
  /**
   * Pale blue fills use dark labels. Brightening on hover preserves contrast.
   */
  primary: 'bg-accent text-accent-fg hover:brightness-110',
  secondary:
    'border-border bg-surface text-foreground border hover:bg-surface-sunken active:bg-accent-soft',
  ghost: 'text-foreground hover:bg-surface-sunken',
  destructive: 'bg-negative text-negative-fg hover:brightness-90 dark:hover:brightness-110',
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
  /** Adds progress feedback and blocks input while an action is in flight. */
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
  const stableLoadingLabel =
    loading && typeof children === 'string' && props['aria-label'] === undefined
      ? children
      : props['aria-label']

  return (
    <button
      {...props}
      type={type}
      disabled={Boolean(disabled || loading)}
      aria-busy={loading || undefined}
      aria-label={stableLoadingLabel}
      className={buttonClasses({ variant, size, fullWidth, className })}
    >
      {loading ? (
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          data-loading-spinner="true"
          className="size-4 shrink-0 animate-spin"
          fill="none"
        >
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
          <path
            d="M10 3a7 7 0 0 1 7 7"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      ) : null}
      {children}
      {loading && loadingLabel ? (
        <span role="status" aria-live="polite" className="sr-only">
          {loadingLabel}
        </span>
      ) : null}
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
