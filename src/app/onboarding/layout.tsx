import type { ReactNode } from 'react'
import { MinimalHeader } from '@/components/layout/minimal-header'

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <MinimalHeader />
      <main className="max-w-column mx-auto w-full flex-1 px-4 py-12 sm:px-8 sm:py-16">
        {children}
      </main>
    </div>
  )
}
