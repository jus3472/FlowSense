import { CurriculumStars } from '@/components/curriculum/stars'
import { AudioPlayer } from '@/components/record/audio-player'
import { TranscriptPanel } from '@/components/results/transcript-panel'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import type { RetryComparison } from '@/lib/results/retry-comparison'
import {
  V3_SECTION_VIEWS,
  v3EvidenceViews,
  v3MeasurementDetails,
  v3MetricResult,
  v3MetricStatus,
  v3PrimaryMeasurement,
  v3TranscriptSegments,
} from '@/lib/results/v3'
import { V3_METRIC_LABELS, type V3ScorePayload } from '@/lib/scoring/v3/contracts'

interface V3ResultsViewProps {
  attemptId: string
  promptText: string
  additionalContext: string | null
  transcript: string
  durationMs: number
  audioUrl: string | null
  audioUnavailable?: boolean
  payload: V3ScorePayload
  comparison?: RetryComparison | null
  previousAttemptId?: string | null
  curriculumResult?: StructuredLessonResultModel | null
}

function sectionScore(value: number | null): string {
  return value === null ? 'Unavailable / 50' : `${value} / 50`
}

function lessonStatus(result: StructuredLessonResultModel): string {
  if (result.state === 'neutral') return 'This attempt does not change your lesson progress.'
  if (result.state === 'passed') return 'This lesson is complete.'
  return 'You need 70 to continue.'
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

  return (
    <div className="flex flex-col gap-8 pb-12">
      <section aria-labelledby="overall-score-heading" className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <div>
            <h1 id="overall-score-heading" className="text-muted text-sm">
              Overall score
            </h1>
            {complete ? (
              <p className="numeric text-foreground text-4xl font-semibold">
                {payload.total_earned_points}
                <span className="text-muted text-xl"> / 100</span>
              </p>
            ) : (
              <p className="text-foreground text-xl font-semibold">Overall unavailable</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="bg-surface-sunken rounded-card p-4">
              <p className="text-muted text-sm">What You Said</p>
              <p className="numeric text-foreground mt-1 text-lg font-semibold">
                {sectionScore(payload.sections.what_you_said.earned_points)}
              </p>
            </div>
            <div className="bg-surface-sunken rounded-card p-4">
              <p className="text-muted text-sm">How You Sounded</p>
              <p className="numeric text-foreground mt-1 text-lg font-semibold">
                {sectionScore(payload.sections.how_you_sounded.earned_points)}
              </p>
            </div>
          </div>

          {curriculumResult ? (
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {curriculumResult.lesson.title}
                </p>
                <p className="text-muted mt-1 text-sm">{lessonStatus(curriculumResult)}</p>
              </div>
              {curriculumResult.currentStars > 0 ? (
                <CurriculumStars stars={curriculumResult.currentStars} />
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="recommendation-heading" className="flex flex-col gap-3">
        <h2 id="recommendation-heading" className="text-foreground text-xl font-semibold">
          Recommendation
        </h2>
        <Card>
          {payload.recommendation ? (
            <div className="flex flex-col gap-2">
              <p className="text-foreground text-base">{payload.recommendation.text}</p>
              <p className="text-muted text-xs">
                Based on {V3_METRIC_LABELS[payload.recommendation.strongest_metric]} and{' '}
                {V3_METRIC_LABELS[payload.recommendation.weakest_metric]}.
              </p>
            </div>
          ) : (
            <p className="text-muted text-sm">
              A recommendation is unavailable because some metrics were not scored.
            </p>
          )}
        </Card>
        <div className="flex flex-col gap-1">
          <p className="text-muted text-xs">Your prompt</p>
          <p className="text-foreground text-sm">{promptText}</p>
          {additionalContext ? (
            <p className="text-muted text-xs">Context: {additionalContext}</p>
          ) : null}
        </div>
      </section>

      <TranscriptPanel heading="Transcript" segments={transcriptSegments} />

      {V3_SECTION_VIEWS.map((section) => {
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
                const primaryMeasurement = v3PrimaryMeasurement(metric, result)
                const measurements = v3MeasurementDetails(result)
                const evidence = v3EvidenceViews(result)
                const hasMore =
                  measurements.length > 0 || evidence.length > 0 || result.warnings.length > 0
                return (
                  <Card key={metric}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-foreground font-medium">{V3_METRIC_LABELS[metric]}</h3>
                        {primaryMeasurement ? (
                          <p className="numeric text-foreground mt-1 text-lg">
                            {primaryMeasurement}
                          </p>
                        ) : null}
                      </div>
                      <p className="numeric text-muted shrink-0 text-sm">{status.score}</p>
                    </div>

                    {result.explanation ? (
                      <p className="text-muted mt-3 text-sm">{result.explanation}</p>
                    ) : status.description ? (
                      <p className="text-muted mt-3 text-sm">{status.description}</p>
                    ) : null}

                    {hasMore ? (
                      <details className="mt-4">
                        <summary className="text-foreground cursor-pointer text-sm font-medium">
                          Review evidence
                        </summary>
                        <div className="mt-3 flex flex-col gap-3">
                          {measurements.length > 0 ? (
                            <ul className="text-muted flex flex-col gap-1 text-xs">
                              {measurements.map((measurement) => (
                                <li key={measurement}>{measurement}</li>
                              ))}
                            </ul>
                          ) : null}
                          {evidence.length > 0 ? (
                            <ul className="text-muted flex flex-col gap-2 text-sm">
                              {evidence.map((item) => (
                                <li key={item.key}>{item.text}</li>
                              ))}
                            </ul>
                          ) : null}
                          {result.warnings.map((warning) => (
                            <p key={warning} className="text-muted text-xs">
                              {warning}
                            </p>
                          ))}
                        </div>
                      </details>
                    ) : null}
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
              <ButtonLink href={`/attempts/${previousAttemptId}`} variant="secondary">
                View previous response
              </ButtonLink>
            ) : null}
          </Card>
        ) : previousAttemptId ? (
          <ButtonLink href={`/attempts/${previousAttemptId}`} variant="secondary">
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
