import type { ReactNode } from 'react'

interface StepFrameProps {
  step: 1 | 2
  title: string
  children: ReactNode
}

export function StepFrame({ step, title, children }: StepFrameProps) {
  return (
    <div className="flex flex-col gap-6">
      <p className="numeric text-muted text-xs font-medium">Step {step} of 2</p>
      <h1 className="text-foreground text-xl font-semibold">{title}</h1>
      {children}
    </div>
  )
}
