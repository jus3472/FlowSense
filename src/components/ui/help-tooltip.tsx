'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Small, non-interactive help available by hover, keyboard focus, or touch. */
export function HelpTooltip({
  label,
  children,
  className,
  active,
}: {
  label: string
  children: ReactNode
  className: string
  active?: boolean
}) {
  const container = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const open = !dismissed && (hovered || focused || pinned)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setPinned(false)
        setFocused(false)
        setHovered(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDismissed(true)
        setPinned(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <span
      ref={container}
      className="relative inline-flex"
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return
        setHovered(true)
        setDismissed(false)
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        data-today-active={active === undefined ? undefined : String(active)}
        className={className}
        onFocus={() => {
          setFocused(true)
          setDismissed(false)
        }}
        onBlur={() => {
          setFocused(false)
          setHovered(false)
          setPinned(false)
        }}
        onClick={() => {
          setFocused(false)
          setPinned(!pinned)
          setDismissed(pinned)
        }}
      >
        {children}
      </button>
      {open ? (
        <span
          role="tooltip"
          className="border-border bg-surface text-foreground shadow-float rounded-card absolute top-full right-0 z-50 w-52 border p-3 text-sm leading-relaxed"
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
