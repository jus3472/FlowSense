import { CurriculumStars } from '@/components/curriculum/stars'
import { AudioPlayer } from '@/components/record/audio-player'
import { PreviousAttempts } from '@/components/results/previous-attempts'
import { TranscriptPanel } from '@/components/results/transcript-panel'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { ScoreProgress } from '@/components/ui/score-progress'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import type { RetryComparison } from '@/lib/results/retry-comparison'
import type { LessonAttemptHistoryItem } from '@/lib/results/lesson-attempt-history'
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
import { cn } from '@/lib/utils'

interface V3ResultsViewProps {
  attemptId: string
  promptText: string
  additionalContext: string | null
  transcript: string
  words?: readonly TranscriptWord[]
  durationMs: number
  audioUrl: string | null
  audioUnavailable?: boolean
  payload: StoredV3ScorePayload
  comparison?: RetryComparison | null
  previousAttempts?: readonly LessonAttemptHistoryItem[]
  curriculumResult?: StructuredLessonResultModel | null
}

function scoreLabel(value: number | null, max: number): string {
  return value === null ? `Unavailable / ${max}` : `${value} / ${max}`
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
  words = [],
  durationMs,
  audioUrl,
  audioUnavailable = false,
  payload,
  comparison = null,
  previousAttempts = [],
  curriculumResult = null,
}: V3ResultsViewProps) {
  const complete = payload.total_earned_points !== null
  const transcriptSegments = v3TranscriptSegments(transcript, payload, words)
  const sectionViews = v3SectionViews(payload)
  const hasPreviousAttempts = previousAttempts.length > 0

  return (
    <div
      data-result-layout="responsive"
      className="grid grid-cols-1 items-start gap-12 pb-12 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]"
    >
      <section
        aria-label="Result summary"
        className={cn(
          'flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1',
          !hasPreviousAttempts && 'lg:col-span-2',
        )}
      >
        <header className="flex flex-col gap-1">
          <h1 className="prompt-display text-muted text-lg break-words">{promptText}</h1>
          {additionalContext ? (
            <p className="text-muted text-xs">Context: {additionalContext}</p>
          ) : null}
        </header>

        <div className="flex flex-col gap-6">
          <div className="flex items-baseline gap-2">
            {complete ? (
              <p className="numeric text-foreground text-4xl font-normal">
                {payload.total_earned_points}
                <span className="text-muted text-lg"> / {payload.total_max_points}</span>
              </p>
            ) : (
              <p className="text-foreground text-xl font-semibold">Overall unavailable</p>
            )}
          </div>

          <ScoreProgress
            label="Overall score"
            value={payload.total_earned_points}
            max={payload.total_max_points}
            size="overall"
          />
        </div>

        {curriculumResult ? (
          <Card className="flex flex-col gap-3 sm:p-8">
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
          </Card>
        ) : null}
      </section>

      <section
        aria-label="Recommendation"
        className="flex min-w-0 flex-col gap-3 lg:col-span-2 lg:row-start-2"
      >
        <Card className="sm:p-8">
          {payload.recommendation ? (
            <div className="max-w-reading flex flex-col gap-2">
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

      <div data-result-region="transcript" className="min-w-0 lg:col-span-2 lg:row-start-3">
        <TranscriptPanel heading="Transcript" segments={transcriptSegments} />
      </div>

      <div
        data-result-layout="score-sections"
        className="grid min-w-0 grid-cols-1 items-start gap-8 lg:col-span-2 lg:row-start-4 lg:grid-cols-2"
      >
        {sectionViews.map((section) => {
          const storedSection = payload.sections[section.id]
          return (
            <section
              key={section.id}
              aria-labelledby={`${section.id}-heading`}
              className="flex min-w-0 flex-col"
            >
              <Card className="flex min-w-0 flex-col gap-6 sm:p-8">
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2
                      id={`${section.id}-heading`}
                      className="prompt-display text-foreground text-lg sm:text-xl"
                    >
                      {section.label}
                    </h2>
                    <p className="numeric text-muted shrink-0 text-sm">
                      {scoreLabel(storedSection.earned_points, storedSection.max_points)}
                    </p>
                  </div>
                  <ScoreProgress
                    label={`${section.label} score`}
                    value={storedSection.earned_points}
                    max={storedSection.max_points}
                    size="section"
                    emptyText={
                      storedSection.status === 'not_checked' ? 'Not checked' : 'Unavailable'
                    }
                  />
                </div>

                <div className="divide-border flex min-w-0 flex-col divide-y">
                  {section.metrics.map((metric) => {
                    const result = v3MetricResult(payload, metric)
                    const status = v3MetricStatus(result)
                    const label = V3_METRIC_LABELS[metric]
                    const summary = v3MetricSummary(metric, result, payload.mode)
                    const details = v3MetricDetails(metric, result, payload.mode)
                    const hasDetails = v3MetricHasDetails(metric, result, details)
                    const progress = (
                      <ScoreProgress
                        label={`${label} score`}
                        value={result.earned_points}
                        max={result.max_points}
                        emptyText={result.status === 'not_checked' ? 'Not checked' : 'Unavailable'}
                      />
                    )
                    const cardHeader = (
                      <span className="flex w-full items-start justify-between gap-4">
                        <span
                          role="heading"
                          aria-level={3}
                          className="text-foreground min-w-0 font-medium"
                        >
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
                          summarySupplement={progress}
                          showLabel={`Show ${label} details`}
                          hideLabel={`Hide ${label} details`}
                          variant="row"
                          buttonClassName="items-start"
                          contentClassName="border-border min-w-0 border-t"
                        >
                          <MetricDetails metric={metric} details={details} />
                        </Disclosure>
                      )
                    }

                    return (
                      <div key={metric} className="flex min-w-0 flex-col gap-3 py-4">
                        {cardHeader}
                        <p className="text-muted text-sm break-words">{summary}</p>
                        {progress}
                      </div>
                    )
                  })}
                </div>
              </Card>
            </section>
          )
        })}
      </div>

      <section
        aria-labelledby="recording-heading"
        className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-5"
      >
        <h2 id="recording-heading" className="prompt-display text-foreground text-xl">
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
          </Card>
        ) : null}
      </section>

      <PreviousAttempts attempts={previousAttempts} className="lg:col-start-2 lg:row-start-1" />

      <div className="flex min-w-0 flex-col gap-2 lg:col-start-2 lg:row-start-5 lg:pt-12">
        {curriculumResult ? (
          <>
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
          </>
        ) : (
          <ButtonLink href={`/record?retry=${attemptId}`} size="lg" fullWidth>
            Try Again
          </ButtonLink>
        )}
      </div>
    </div>
  )
}
