import type { ReactNode } from 'react'

/** Shared prompt hierarchy across completed, processing, and unavailable results. */
export function ResultPrompt({ children }: { children: ReactNode }) {
  return <h1 className="prompt-display text-foreground text-xl break-words">{children}</h1>
}
