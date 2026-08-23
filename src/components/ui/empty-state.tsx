import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  children?: ReactNode
}

/** Quiet and inviting. Never a dashed box or a shrug. */
export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground text-base font-medium">{title}</p>
      <p className="text-muted text-sm">{description}</p>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}
