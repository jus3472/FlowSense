'use client'

import { CheckRow } from '@/components/results/check-row'
import { Button } from '@/components/ui/button'
import { CHECK_LABEL, listedSpans } from '@/lib/results/summary'
import { CHECK_NAMES, CONTENT_POINTS, type CheckName } from '@/lib/scoring/content'
import type { StoredContentResult } from '@/lib/scoring/assemble'

interface ContentSectionProps {
  content: StoredContentResult
  points: Record<CheckName, number>
  earned: number
  max: number
  disputedChecks: ReadonlySet<CheckName>
  disputedSpans: ReadonlySet<string>
  onDisputeCheck: (name: CheckName) => void
  onDisputeSpan: (text: string) => void
  onRetry: () => void
  retrying: boolean
}

export function ContentSection({
  content,
  points,
  earned,
  max,
  disputedChecks,
  disputedSpans,
  onDisputeCheck,
  onDisputeSpan,
  onRetry,
  retrying,
}: ContentSectionProps) {
  const notChecked = content.status !== 'checked'
  // A span already on screen as the Word choice quote is not listed again below.
  const spans = listedSpans(content.extra_spans, content.checks.word_choice)

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="prompt-display text-foreground text-xl">What you said</h2>
        <p className="numeric text-muted text-sm">
          {earned} / {max}
        </p>
      </div>

      {notChecked ? (
        <p className="text-muted text-sm">
          These checks did not run this time, so all {max} points are yours.
        </p>
      ) : null}

      <ul className="bg-surface rounded-card flex flex-col">
        {CHECK_NAMES.map((name) => (
          <CheckRow
            key={name}
            label={CHECK_LABEL[name]}
            points={points[name]}
            maxPoints={CONTENT_POINTS[name]}
            finding={content.checks[name]}
            disputed={disputedChecks.has(name)}
            notChecked={notChecked}
            onDispute={() => onDisputeCheck(name)}
          />
        ))}

        {/*
          The grouped span list sits after the individual findings and carries
          its own framing line. A framing line never appears above a quote, and
          when every span is already shown as a quote there is no list at all.
        */}
        {!notChecked && spans.length > 0 ? (
          <li className="border-border flex flex-col gap-3 border-t px-6 py-4">
            <p className="text-muted text-xs">Spans that read the same with them removed:</p>
            <ul className="flex flex-col gap-3">
              {spans.map((span) => {
                const kept = disputedSpans.has(span.text)
                return (
                  <li
                    key={`${span.text}-${span.category}`}
                    className={`flex items-center justify-between gap-4 ${kept ? 'opacity-60' : ''}`}
                  >
                    <span className="flex flex-col gap-1">
                      <span className="text-foreground text-base font-medium">{`"${span.text}"`}</span>
                      <span className="text-muted text-xs">{span.category}</span>
                    </span>
                    {kept ? (
                      <span className="text-muted shrink-0 text-xs">Kept</span>
                    ) : (
                      <Button variant="ghost" onClick={() => onDisputeSpan(span.text)}>
                        {"I'd keep it"}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </li>
        ) : null}
      </ul>

      {notChecked ? (
        <div>
          <Button variant="secondary" onClick={onRetry} loading={retrying} loadingLabel="Checking">
            Run the checks
          </Button>
        </div>
      ) : null}
    </section>
  )
}
