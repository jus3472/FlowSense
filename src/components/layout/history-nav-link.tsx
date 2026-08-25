'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const BASE_CLASS =
  'flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition duration-150 ease-out'

export function HistoryNavLink() {
  const pathname = usePathname()
  const isActive = pathname === '/history' || pathname.startsWith('/history/')

  return (
    <Link
      href="/history"
      aria-current={isActive ? 'page' : undefined}
      className={`${BASE_CLASS} ${
        isActive ? 'bg-accent-soft text-accent' : 'text-foreground hover:bg-surface-sunken'
      }`}
    >
      History
    </Link>
  )
}
