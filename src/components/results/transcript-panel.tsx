'use client'

import { useState } from 'react'
import type { Segment } from '@/lib/results/segments'

/**
 * Amber marks a specific issue, including one that does not cost points. Every mark is a tint behind the
 * speaker's own words rather than coloured text, so marked words stay as
 * readable as the rest. No check name appears in the transcript itself, only in
 * the popover, and there is no legend to decode.
 *
 * The marks are <mark> rather than <button> so a span running over several
 * lines wraps like the text around it instead of reflowing as one block. They
 * carry a tabindex and a button role, so they stay keyboard reachable.
 */
export function TranscriptPanel({
  segments,
  heading,
}: {
  segments: readonly Segment[]
  heading?: string
}) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section className="flex flex-col gap-3">
      {heading ? <h2 className="prompt-display text-foreground text-xl">{heading}</h2> : null}
      <div className="border-border bg-surface shadow-card rounded-card border p-6 sm:p-8">
        <p className="text-foreground max-w-reading text-lg leading-loose">
          {segments.map((segment, index) => {
            if (segment.type === 'text') return <span key={index}>{segment.text}</span>

            const isMarker = segment.type === 'marker'
            const details = segment.details ?? [segment.label]
            const toggle = () => setOpen((current) => (current === index ? null : index))

            return (
              <span key={index} className="relative">
                <mark
                  role="button"
                  tabIndex={0}
                  aria-label={`${segment.text}. ${details.join(' ')}`}
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
                    className="bg-surface text-foreground shadow-float rounded-card fixed inset-x-6 bottom-6 z-20 px-3 py-2 text-xs leading-normal sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:z-10 sm:mb-2 sm:w-max sm:max-w-[240px]"
                  >
                    {details.map((detail) => (
                      <span key={detail} className="block [&+&]:mt-1">
                        {detail}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            )
          })}
        </p>
      </div>
    </section>
  )
}
