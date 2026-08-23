import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TextFieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
}

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
          'rounded-input bg-surface-sunken text-foreground min-h-11 px-4 text-base',
          'placeholder:text-muted transition duration-150 ease-out',
          'focus-visible:ring-accent ring-inset focus:outline-none focus-visible:ring-2',
          error && 'ring-negative ring-2',
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
