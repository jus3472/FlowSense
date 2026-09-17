import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TextFieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
}

export const FIELD_CONTROL_CLASS =
  'border-border bg-surface text-foreground rounded-input min-h-11 border px-4 text-base placeholder:text-muted transition duration-150 ease-out focus-visible:ring-accent-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted'

export function TextField({ id, label, hint, error, className, ...props }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-foreground text-sm font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-muted text-xs">
          {hint}
        </p>
      ) : null}
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          FIELD_CONTROL_CLASS,
          error && 'border-negative ring-negative ring-1',
          className,
        )}
      />
      {error ? (
        <p id={errorId} className="text-negative text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}
