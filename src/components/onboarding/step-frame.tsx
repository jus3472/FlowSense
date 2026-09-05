import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

interface StepFrameProps {
  step: 1 | 2
  title: string
  children: ReactNode
}

export function StepFrame({ step, title, children }: StepFrameProps) {
  return (
    <Card className="flex flex-col gap-6 sm:p-8">
      <p className="numeric text-muted text-xs font-medium">Step {step} of 2</p>
      <h1 className="prompt-display text-foreground text-2xl">{title}</h1>
      {children}
    </Card>
  )
}
