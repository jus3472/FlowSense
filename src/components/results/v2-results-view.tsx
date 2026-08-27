import { AudioPlayer } from '@/components/record/audio-player'
import type { Route } from 'next'
import { TranscriptPanel } from '@/components/results/transcript-panel'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  formatV2Measurements,
  formatV2Feedback,
  priorityV2Category,
  strongestV2Category,
  v2CategoryViews,
  v2ModeFeedback,
  v2OverallTakeaway,
  v2TranscriptSegments,
} from '@/lib/results/v2'
import type { V2ScorePayload } from '@/lib/scoring/v2/assemble'
import type { RetryComparison } from '@/lib/results/retry-comparison'

interface V2ResultsViewProps {
  attemptId: string
  promptText: string
  additionalContext: string | null
  transcript: string
  durationMs: number
  audioUrl: string | null
  payload: V2ScorePayload
  comparison?: RetryComparison | null
  previousAttemptId?: string | null
}

export function V2ResultsView({
  attemptId,
  promptText,
  additionalContext,
  transcript,
  durationMs,
  audioUrl,
  payload,
  comparison = null,
  previousAttemptId = null,
}: V2ResultsViewProps) {
  const strongest = strongestV2Category(payload)
  const priority = priorityV2Category(payload)
  const complete = payload.total_earned_points !== null
  const segments = v2TranscriptSegments(transcript, payload)
  const takeaway = v2OverallTakeaway(payload)

  return (
    <div className="flex flex-col gap-8 pb-12">
      <header className="flex flex-col gap-3">
        <p className="text-muted text-sm">Your prompt</p>
        <h1 className="text-foreground text-xl font-semibold">{promptText}</h1>
        {additionalContext ? (
          <p className="text-muted text-sm">Context: {additionalContext}</p>
        ) : null}
      </header>

      <Card className="flex flex-col gap-4">
        {complete ? (
          <div>
            <p className="text-muted text-sm">Overall result</p>
            <p className="numeric text-foreground text-3xl font-semibold sm:text-4xl">
              {payload.total_earned_points}
              <span className="text-muted text-xl"> / 100</span>
            </p>
          </div>
        ) : (
          <div>
            <p className="text-foreground text-lg font-semibold">Some checks are not available</p>
            <p className="text-muted text-sm">The available categories are shown below.</p>
          </div>
        )}
        <p className="text-muted text-sm">{v2ModeFeedback(payload.mode)}</p>
        <p className="text-muted text-sm">{takeaway}</p>
      </Card>

      <section className="flex flex-col gap-3" aria-label="Category results">
        {v2CategoryViews(payload).map(({ category, label, result }) => {
          const measurements = formatV2Measurements(result.measurements)
          const feedback = formatV2Feedback(result)
          const status =
            result.status === 'scored'
              ? `${result.earned_points} / ${result.max_points}`
              : result.status === 'not_checked'
                ? 'Not checked'
                : 'Unavailable'
          return (
            <Card key={category} className="p-4">
              <details>
                <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  <span>{label}</span>
                  <span className="numeric text-muted text-sm">{status}</span>
                </summary>
                <div className="mt-4 flex flex-col gap-3">
                  {result.warnings.map((warning) => (
                    <p key={warning} className="text-muted text-sm">
                      {warning}
                    </p>
                  ))}
                  {measurements.length > 0 ? (
                    <ul className="text-muted flex flex-col gap-2 text-sm">
                      {measurements.map((measurement) => (
                        <li key={measurement}>{measurement}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted text-sm">No concrete measurement is available.</p>
                  )}
                  {feedback.length > 0 ? (
                    <ul className="text-muted flex flex-col gap-2 text-sm">
                      {feedback.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
            </Card>
          )
        })}
      </section>

      <Card className="flex flex-col gap-3">
        <p className="text-foreground font-medium">What to use next</p>
        {strongest ? (
          <p className="text-muted text-sm">
            Your strongest scored area is {strongest.label.toLowerCase()}.
          </p>
        ) : (
          <p className="text-muted text-sm">No single strongest scored area is available.</p>
        )}
        {priority ? (
          <p className="text-muted text-sm">Focus next on {priority.label.toLowerCase()}.</p>
        ) : (
          <p className="text-muted text-sm">No single scored focus area is available.</p>
        )}
      </Card>

      {comparison || previousAttemptId ? (
        <Card className="flex flex-col gap-3" aria-label="Previous response comparison">
          {comparison ? <p className="text-foreground font-medium">Previous response</p> : null}
          {comparison ? (
            <ul className="text-muted flex flex-col gap-2 text-sm">
              {comparison.rows.map((row) => (
                <li key={row.category}>
                  {row.label} {row.previousPoints} → {row.currentPoints}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-sm">Open the previous response to review it.</p>
          )}
          {previousAttemptId ? (
            <ButtonLink href={`/attempts/${previousAttemptId}` as Route} variant="secondary">
              View previous response
            </ButtonLink>
          ) : null}
        </Card>
      ) : null}

      {transcript ? <TranscriptPanel segments={segments} /> : null}
      {audioUrl ? <AudioPlayer src={audioUrl} durationMs={durationMs} /> : null}
      <ButtonLink href={`/record?retry=${attemptId}`} size="lg" fullWidth>
        Try Again
      </ButtonLink>
    </div>
  )
}
