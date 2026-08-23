'use client'

import { cn } from '@/lib/utils'

interface ChipProps {
  label: string
  selected: boolean
  onToggle: () => void
}

/** Multi select option. Selected state is a soft fill plus a ring, never text on accent-soft. */
export function Chip({ label, selected, onToggle }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        'min-h-11 rounded-full px-6 text-sm font-medium transition duration-150 ease-out',
        selected
          ? 'bg-accent-soft text-foreground ring-accent ring-2 ring-inset'
          : 'bg-surface-sunken text-foreground hover:bg-accent-soft',
      )}
    >
      {label}
    </button>
  )
}
