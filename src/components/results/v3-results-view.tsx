import type { Route } from 'next'
import { CurriculumStars } from '@/components/curriculum/stars'
import { AudioPlayer } from '@/components/record/audio-player'
import { TranscriptPanel } from '@/components/results/transcript-panel'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import type { RetryComparison } from '@/lib/results/retry-comparison'
import {
  type V3MetricDetailView,
  type V3MetricFindingView,
  type V3MetricMeasurementView,
  v3MetricDetails,
  v3MetricHasDetails,
  v3MetricResult,
  v3MetricStatus,
  v3MetricSummary,
  v3SectionViews,
  v3TranscriptSegments,
} from '@/lib/results/v3'
import {
  V3_LEGACY_SCORE_PAYLOAD_VERSION,
  V3_METRIC_LABELS,
  type StoredV3MetricId,
  type StoredV3ScorePayload,
} from '@/lib/scoring/v3/contracts'

interface V3ResultsViewProps {
  attemptId: string
  promptText: string
  additionalContext: string | null
  transcript: string
  durationMs: number
  audioUrl: string | null
  audioUnavailable?: boolean
  payload: StoredV3ScorePayload
  comparison?: RetryComparison | null
  previousAttemptId?: string | null
  curriculumResult?: StructuredLessonResultModel | null
}

function sectionScore(value: number | null): string {
  return value === null ? 'Unavailable / 50' : `${value} / 50`
}

function lessonStateTitle(result: StructuredLessonResultModel): string {
  if (result.state === 'neutral') return 'Result unavailable'
  return result.state === 'passed' ? 'Lesson complete' : 'Lesson not passed'
}

function DetailRows({
  heading,
  rows,
}: {
  heading: string
  rows: readonly V3MetricMeasurementView[]
}) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-foreground text-sm font-medium">{heading}</h4>
      <dl className="border-border divide-border divide-y border-y">
        {rows.map((row) => (
          <div
            key={`${row.label}:${row.value}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2.5 text-sm"
          >
            <dt className="text-muted min-w-0">
              <span>{row.label}</span>
              {row.help ? <span className="mt-0.5 block text-xs">{row.help}</span> : null}
            </dt>
            <dd className="numeric text-foreground text-right font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Finding({ metric, finding }: { metric: StoredV3MetricId; finding: V3MetricFindingView }) {
  const suggestionLead =
    metric === 'word_choice' ? 'More precise:' : metric === 'grammar' ? 'Clearer form:' : 'Try:'
  return (
    <li className="border-border flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
      {finding.label ? (
        <p className="text-foreground text-xs font-medium">{finding.label}</p>
      ) : null}
      {finding.quotes.map((quote) => (
        <p key={quote} className="text-foreground text-sm font-medium break-words">
          “{quote}”
        </p>
      ))}
      <p className="text-muted text-sm">{finding.observation}</p>
      {finding.suggestion ? (
        <p className="text-foreground text-sm">
          {suggestionLead} {finding.suggestion}
        </p>
      ) : null}
    </li>
  )
}

function MetricDetails({
  metric,
  details,
}: {
  metric: StoredV3MetricId
  details: V3MetricDetailView
}) {
  return (
    <div className="flex flex-col gap-6">
      {details.overview ? <p className="text-muted text-sm">{details.overview}</p> : null}
      <DetailRows heading="Detected patterns" rows={details.counts} />
      <DetailRows heading="Measurements" rows={details.measurements} />
      {details.findings.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-foreground text-sm font-medium">
            {metric === 'conciseness' ? 'Examples' : 'What affected this score'}
          </h4>
          <ul className="flex flex-col gap-3">
            {details.findings.map((finding) => (
              <Finding key={finding.key} metric={metric} finding={finding} />
            ))}
          </ul>
        </section>
      ) : null}
      {details.evidence.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-foreground text-sm font-medium">Evidence</h4>
          <ul className="text-muted flex flex-col gap-2 text-sm">
            {details.evidence.map((item) => (
              <li key={item.key}>{item.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {details.warnings.map((warning) => (
        <p key={warning} className="text-muted text-xs">
          {warning}
        </p>
      ))}
    </div>
  )
}

export function V3ResultsView({
  attemptId,
  promptText,
  additionalContext,
  transcript,
  durationMs,
  audioUrl,
  audioUnavailable = false,
  payload,
  comparison = null,
  previousAttemptId = null,
  curriculumResult = null,
}: V3ResultsViewProps) {
  const complete = payload.total_earned_points !== null
  const transcriptSegments = v3TranscriptSegments(transcript, payload)
  const sectionViews = v3SectionViews(payload)

  return (
    <div className="flex flex-col gap-8 pb-12">
      <header className="flex flex-col gap-1">
        <h1 className="prompt-display text-foreground text-2xl break-words">{promptText}</h1>
        {additionalContext ? (
          <p className="text-muted text-xs">Context: {additionalContext}</p>
        ) : null}
      </header>

      <section aria-label="Result summary" className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <div>
            {complete ? (
              <p className="numeric text-foreground text-4xl font-semibold">
                {payload.total_earned_points}
                <span className="text-muted text-xl"> / 100</span>
              </p>
            ) : (
              <p className="text-foreground text-xl font-semibold">Overall unavailable</p>
            )}
          </div>

          {curriculumResult ? (
            <div className="border-border flex flex-col gap-3 border-t pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-foreground text-lg font-semibold">
                    {lessonStateTitle(curriculumResult)}
                  </h2>
                </div>
                {curriculumResult.currentStars > 0 ? (
                  <CurriculumStars stars={curriculumResult.currentStars} />
                ) : null}
              </div>

              {curriculumResult.state === 'neutral' ? (
                <p className="text-muted text-sm">
                  Some checks could not be completed, so this attempt does not affect your lesson
                  progress.
                </p>
              ) : null}

              {curriculumResult.bestScore !== null ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-foreground">
                    Best: <span className="numeric">{curriculumResult.bestScore}</span>
                  </span>
                  <CurriculumStars stars={curriculumResult.bestStars} />
                  {curriculumResult.personalBest ? (
                    <span className="text-accent font-medium">Personal best</span>
                  ) : null}
                </div>
              ) : null}

              {curriculumResult.state === 'not_passed' ? (
                <p className="text-muted text-sm">Need 70 to continue.</p>
              ) : null}
              {curriculumResult.state === 'passed' ? (
                curriculumResult.pathComplete ? (
                  <p className="text-foreground font-medium">Path complete</p>
                ) : null
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>

      <section aria-label="Recommendation" className="flex flex-col gap-3">
        <Card>
          {payload.recommendation ? (
            <div className="flex flex-col gap-2">
              <p className="text-foreground text-base">{payload.recommendation.text}</p>
              {payload.version === V3_LEGACY_SCORE_PAYLOAD_VERSION ? (
                <p className="text-muted text-xs">
                  Based on {V3_METRIC_LABELS[payload.recommendation.strongest_metric]} and{' '}
                  {V3_METRIC_LABELS[payload.recommendation.weakest_metric]}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted text-sm">
              A recommendation is unavailable because some metrics were not scored.
            </p>
          )}
        </Card>
      </section>

      <TranscriptPanel heading="Transcript" segments={transcriptSegments} />

      {sectionViews.map((section) => {
        const storedSection = payload.sections[section.id]
        return (
          <section
            key={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="flex flex-col gap-4"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 id={`${section.id}-heading`} className="text-foreground text-xl font-semibold">
                {section.label}
              </h2>
              <p className="numeric text-muted text-sm">
                {sectionScore(storedSection.earned_points)}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {section.metrics.map((metric) => {
                const result = v3MetricResult(payload, metric)
                const status = v3MetricStatus(result)
                const label = V3_METRIC_LABELS[metric]
                const summary = v3MetricSummary(metric, result, payload.mode)
                const details = v3MetricDetails(metric, result, payload.mode)
                const hasDetails = v3MetricHasDetails(metric, result, details)
                const cardHeader = (
                  <span className="flex w-full items-start justify-between gap-4">
                    <span role="heading" aria-level={3} className="text-foreground font-medium">
                      {label}
                    </span>
                    <span className="numeric text-muted shrink-0 text-sm">{status.score}</span>
                  </span>
                )

                if (hasDetails) {
                  return (
                    <Disclosure
                      key={metric}
                      summary={cardHeader}
                      hint={summary}
                      showLabel={`Show ${label} details`}
                      hideLabel={`Hide ${label} details`}
                      buttonClassName="items-start py-6"
                      contentClassName="border-border border-t pt-6"
                    >
                      <MetricDetails metric={metric} details={details} />
                    </Disclosure>
                  )
                }

                return (
                  <Card key={metric}>
                    {cardHeader}
                    <p className="text-muted mt-2 text-sm">{summary}</p>
                  </Card>
                )
              })}
            </div>
          </section>
        )
      })}

      <section aria-labelledby="recording-heading" className="flex flex-col gap-4">
        <h2 id="recording-heading" className="text-foreground text-xl font-semibold">
          Recording
        </h2>
        {audioUrl ? <AudioPlayer src={audioUrl} durationMs={durationMs} /> : null}
        {audioUnavailable || !audioUrl ? (
          <p role="status" className="text-muted text-sm">
            Audio playback is unavailable for this response.
          </p>
        ) : null}

        {comparison ? (
          <Card className="flex flex-col gap-3" aria-label="Previous response comparison">
            <p className="text-foreground font-medium">Previous response</p>
            <ul className="text-muted flex flex-col gap-2 text-sm">
              {comparison.rows.slice(0, 4).map((row) => (
                <li key={row.category}>
                  {row.label} {row.previousPoints} → {row.currentPoints}
                </li>
              ))}
            </ul>
            {previousAttemptId ? (
              <ButtonLink href={`/attempts/${previousAttemptId}` as Route} variant="secondary">
                View previous response
              </ButtonLink>
            ) : null}
          </Card>
        ) : previousAttemptId ? (
          <ButtonLink href={`/attempts/${previousAttemptId}` as Route} variant="secondary">
            View previous response
          </ButtonLink>
        ) : null}

        {curriculumResult ? (
          <div className="flex flex-col gap-2">
            <ButtonLink href={curriculumResult.primaryAction.href} size="lg" fullWidth>
              {curriculumResult.primaryAction.label}
            </ButtonLink>
            {curriculumResult.secondaryAction ? (
              <ButtonLink
                href={curriculumResult.secondaryAction.href}
                variant="secondary"
                fullWidth
              >
                {curriculumResult.secondaryAction.label}
              </ButtonLink>
            ) : null}
          </div>
        ) : (
          <ButtonLink href={`/record?retry=${attemptId}`} size="lg" fullWidth>
            Try Again
          </ButtonLink>
        )}
      </section>
    </div>
  )
}
