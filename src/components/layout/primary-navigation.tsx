'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS: ReadonlyArray<{
  label: string
  href: Route
  active: (pathname: string) => boolean
}> = [
  {
    label: 'Home',
    href: '/home',
    active: (pathname) =>
      pathname === '/home' ||
      pathname.startsWith('/home/') ||
      pathname === '/practice' ||
      pathname.startsWith('/practice/'),
  },
  {
    label: 'Progress',
    href: '/progress',
    active: (pathname) => pathname === '/progress' || pathname.startsWith('/progress/'),
  },
  {
    label: 'History',
    href: '/history',
    active: (pathname) => pathname === '/history' || pathname.startsWith('/history/'),
  },
]

const BASE_CLASS =
  'flex min-h-11 items-center justify-center rounded-input px-2 text-xs font-medium transition duration-150 ease-out sm:px-3 sm:text-sm'

export function PrimaryNavigation() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="col-span-3 row-start-2 flex min-w-0 items-center justify-between gap-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end"
    >
      {ITEMS.map((item) => {
        const active = item.active(pathname)
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`${BASE_CLASS} ${
              active ? 'bg-accent-soft text-accent-ink' : 'text-foreground hover:bg-surface-sunken'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
