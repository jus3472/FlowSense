'use client'

import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DisclosureProps {
  summary: ReactNode
  hint?: ReactNode
  summarySupplement?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  showLabel?: string
  hideLabel?: string
  variant?: 'card' | 'row'
  className?: string
  buttonClassName?: string
  contentClassName?: string
}

/** Collapsed by default, keyboard reachable, with a visible focus ring. */
export function Disclosure({
  summary,
  hint,
  summarySupplement,
  children,
  defaultOpen = false,
  showLabel,
  hideLabel,
  variant = 'card',
  className,
  buttonClassName,
  contentClassName,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  const row = variant === 'row'

  return (
    <div className={cn(row ? 'flex flex-col' : 'bg-surface rounded-card flex flex-col', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? hideLabel : showLabel}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          row
            ? 'rounded-input flex items-center justify-between gap-4 py-4 text-left'
            : 'rounded-card flex items-center justify-between gap-4 px-6 pt-6 pb-4 text-left',
          buttonClassName,
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-foreground text-sm font-medium">{summary}</span>
          {hint ? <span className="text-muted text-xs">{hint}</span> : null}
        </span>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`text-muted size-4 shrink-0 transition-transform duration-150 ease-out ${open ? 'rotate-180' : ''}`}
          fill="currentColor"
        >
          <path d="M5.3 7.3 10 12l4.7-4.7-1.4-1.4L10 9.2 6.7 5.9z" />
        </svg>
      </button>
      {summarySupplement ? (
        <div className={row ? 'pb-4' : 'px-6 pb-4'}>{summarySupplement}</div>
      ) : null}
      {open ? (
        <div
          id={id}
          className={cn(
            row ? 'flex flex-col gap-4 py-4' : 'flex flex-col gap-4 px-6 pt-3 pb-6',
            contentClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
