'use client'

import { useState } from 'react'
import type { Segment } from '@/lib/results/highlights'

/**
 * Amber means one thing: this cost points. Every mark is a tint behind the
 * speaker's own words rather than coloured text, so marked words stay as
 * readable as the rest. No check name appears in the transcript itself, only in
 * the popover, and there is no legend to decode.
 *
 * The marks are <mark> rather than <button> so a span running over several
 * lines wraps like the text around it instead of reflowing as one block. They
 * carry a tabindex and a button role, so they stay keyboard reachable.
 */
export function TranscriptPanel({ segments }: { segments: readonly Segment[] }) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <div className="bg-surface rounded-card p-8">
        <p className="text-foreground text-lg leading-loose">
          {segments.map((segment, index) => {
            if (segment.type === 'text') return <span key={index}>{segment.text}</span>

            const isMarker = segment.type === 'marker'
            const toggle = () => setOpen((current) => (current === index ? null : index))

            return (
              <span key={index} className="relative">
                <mark
                  role="button"
                  tabIndex={0}
                  aria-label={`${segment.text}. ${segment.label}`}
                  aria-expanded={open === index}
                  onPointerEnter={() => setOpen(index)}
                  onPointerLeave={() => setOpen((current) => (current === index ? null : current))}
                  onFocus={() => setOpen(index)}
                  onBlur={() => setOpen(null)}
                  onClick={toggle}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setOpen(null)
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggle()
                    }
                  }}
                  className={
                    isMarker
                      ? 'numeric bg-highlight text-highlight-fg rounded-input mx-1 px-1 text-sm'
                      : 'bg-highlight text-highlight-fg rounded-input px-1'
                  }
                >
                  {segment.text}
                </mark>

                {open === index ? (
                  <span
                    role="tooltip"
                    className="bg-surface text-foreground shadow-float rounded-card absolute bottom-full left-0 z-10 mb-2 w-max max-w-[240px] px-3 py-2 text-xs leading-normal"
                  >
                    {segment.label}
                  </span>
                ) : null}
              </span>
            )
          })}
        </p>
      </div>
      <p className="text-muted text-xs">Anything marked cost points. Hover to see which check.</p>
    </section>
  )
}
