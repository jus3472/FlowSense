'use client'

import { Button } from '@/components/ui/button'
import type { CheckFinding } from '@/lib/scoring/content'

interface CheckRowProps {
  label: string
  points: number
  maxPoints: number
  finding: CheckFinding
  disputed: boolean
  notChecked: boolean
  onDispute: () => void
}

function PassMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="text-positive size-4"
      fill="currentColor"
    >
      <path d="M7.6 13.4 4.2 10l-1.2 1.2 4.6 4.6 9.4-9.4-1.2-1.2z" />
    </svg>
  )
}

/**
 * All five checks render every time. Seeing the whole list tells the user what
 * is being looked at, so a failure reads as missing one of five rather than the
 * app hunting for faults.
 *
 * Inside a failing check the speaker's own words come first and heaviest. The
 * app's commentary is never visually above their quote.
 */
export function CheckRow({
  label,
  points,
  maxPoints,
  finding,
  disputed,
  notChecked,
  onDispute,
}: CheckRowProps) {
  const failing = !notChecked && !finding.passed && !disputed

  return (
    <li className="border-border flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{label}</span>
          {notChecked ? null : finding.passed || disputed ? <PassMark /> : null}
        </span>
        <span className="numeric text-foreground shrink-0 text-sm">
          {notChecked ? '-' : `${points} / ${maxPoints}`}
        </span>
      </div>

      {failing ? (
        <div className="flex flex-col gap-2">
          {finding.quote ? (
            <p className="text-foreground text-base font-medium">{`"${finding.quote}"`}</p>
          ) : null}
          {finding.observation ? <p className="text-muted text-sm">{finding.observation}</p> : null}
          {finding.suggestion ? (
            <p className="text-accent text-sm">Try: {finding.suggestion}</p>
          ) : null}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onDispute}>
              {"I'd keep it"}
            </Button>
          </div>
        </div>
      ) : null}

    </li>
  )
}
