import type { ReactNode } from 'react'
import { AppHeader } from '@/components/layout/app-header'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="max-w-column mx-auto w-full flex-1 px-6 py-8 sm:py-12">{children}</main>
    </div>
  )
}
