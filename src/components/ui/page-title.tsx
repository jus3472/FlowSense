import type { ReactNode } from 'react'

export function PageTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h1 id={id} className="prompt-display text-foreground max-w-[18ch] text-2xl">
      {children}
    </h1>
  )
}
