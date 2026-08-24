'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { logOut } from '@/actions/auth'
import { useTheme } from '@/components/theme/use-theme'

const ITEM_CLASS =
  'flex min-h-11 w-full items-center justify-between gap-4 rounded-input px-4 text-left text-sm text-foreground transition duration-150 ease-out hover:bg-surface-sunken'

export function OverflowMenu() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { theme, toggleTheme } = useTheme()

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false)
      if (returnFocus) triggerRef.current?.focus()
    },
    [setOpen],
  )

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[data-menuitem]')?.focus()
  }, [open])

  const moveFocus = (step: number) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-menuitem]') ?? [],
    )
    if (items.length === 0) return
    const current = items.findIndex((item) => item === document.activeElement)
    const next = items[(current + step + items.length) % items.length]
    next?.focus()
  }

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="text-foreground hover:bg-surface-sunken flex size-11 items-center justify-center rounded-full transition duration-150 ease-out"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5" fill="currentColor">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="rounded-card bg-surface shadow-float absolute top-full right-0 z-10 mt-2 w-[220px] p-2"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={theme === 'dark'}
            data-menuitem
            onClick={toggleTheme}
            className={ITEM_CLASS}
          >
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
            <span
              aria-hidden="true"
              className={`flex h-6 w-12 items-center rounded-full p-1 transition duration-150 ease-out ${
                theme === 'dark' ? 'bg-accent' : 'bg-surface-sunken'
              }`}
            >
              <span
                className={`bg-surface block size-4 rounded-full transition duration-150 ease-out ${
                  theme === 'dark' ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </span>
          </button>

          <Link href="/settings" role="menuitem" data-menuitem className={ITEM_CLASS}>
            Settings
          </Link>

          <form action={logOut}>
            <button type="submit" role="menuitem" data-menuitem className={ITEM_CLASS}>
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
