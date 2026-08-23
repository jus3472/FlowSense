import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

interface ErrorStateProps {
  title: string
  description: string
  children?: ReactNode
}

/** Plain language, a specific message, and a retry wherever retrying helps. */
export function ErrorState({ title, description, children }: ErrorStateProps) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        <p className="text-muted text-sm">{description}</p>
      </div>
      {children}
    </Card>
  )
}
