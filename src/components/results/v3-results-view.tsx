import { CurriculumStars } from '@/components/curriculum/stars'
import { AudioPlayer } from '@/components/record/audio-player'
import { PreviousAttempts } from '@/components/results/previous-attempts'
import { TranscriptPanel } from '@/components/results/transcript-panel'
import { ButtonLink } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { ResultPrompt } from '@/components/results/result-prompt'
import { Disclosure } from '@/components/ui/disclosure'
import { ScoreProgress } from '@/components/ui/score-progress'
import type { Route } from 'next'
import type { ReactNode } from 'react'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import type { LessonAttemptHistoryItem } from '@/lib/results/lesson-attempt-history'
import {
  metricChecks,
  type MetricCheck,
  type MetricCheckFinding,
  type MetricChecksView,
} from '@/lib/results/metric-checks'
import { resultOverview } from '@/lib/results/overview'
import {
  v3MetricResult,
  v3MetricStatus,
  v3SectionViews,
  v3TranscriptSegments,
} from '@/lib/results/v3'
import { V3_METRIC_LABELS, type V3ScorePayload } from '@/lib/scoring/v3/contracts'
import { UTC_TIMEZONE } from '@/lib/timezone'
import { cn } from '@/lib/utils'

interface V3ResultsViewProps {
  promptText: string
  additionalContext: string | null
  transcript: string
  words?: readonly TranscriptWord[]
  durationMs: number
  audioUrl: string | null
  audioUnavailable?: boolean
  payload: V3ScorePayload
  previousAttempts?: readonly LessonAttemptHistoryItem[]
  timezone?: string
  curriculumResult?: StructuredLessonResultModel | null
  retryHref?: Route | null
  deleteControl?: ReactNode
}

function scoreLabel(value: number | null, max: number): string {
  return value === null ? `Unavailable / ${max}` : `${value} / ${max}`
}

function lessonStateTitle(result: StructuredLessonResultModel, unavailableTitle: string): string {
  if (result.state === 'neutral') return unavailableTitle
  return result.state === 'passed' ? 'Lesson passed' : 'Not passed yet'
}

interface UnavailableResultMessage {
  title: string
  description: string
}

function unavailableResultMessage(
  payload: V3ScorePayload,
  transcript: string,
): UnavailableResultMessage {
  if (transcript.trim().length === 0) {
    return {
      title: 'Transcript unavailable',
      description: "We couldn't produce a usable transcript. Try again and speak a little longer.",
    }
  }

  const contentUnavailable = Object.values(payload.sections.what_you_said.metrics).some(
    (metric) => metric.status === 'not_checked',
  )
  if (contentUnavailable) {
    return {
      title: 'Result unavailable',
      description:
        "We couldn't complete every check, so this response could not be evaluated. Try again in a moment.",
    }
  }

  const speechEvidenceUnavailable = Object.values(payload.sections.how_you_sounded.metrics).some(
    (metric) => metric.status === 'unavailable',
  )
  if (speechEvidenceUnavailable) {
    return {
      title: 'More speech needed',
      description:
        "There wasn't enough speech to measure every sound metric. Try again with two complete sentences.",
    }
  }

  return {
    title: 'Result unavailable',
    description:
      "We couldn't complete every check, so this response could not be evaluated. Try again.",
  }
}

function Finding({ finding }: { finding: MetricCheckFinding }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <p className="text-muted text-sm">{finding.observation}</p>
      {finding.quotes.length > 0 ? (
        <p className="text-foreground text-sm break-words">
          {finding.quotesLabel ? <span className="font-medium">{finding.quotesLabel} </span> : null}
          {finding.quotes.map((quote) => `“${quote}”`).join(' · ')}
        </p>
      ) : null}
      {finding.suggestion ? (
        <p className="text-foreground text-sm">
          <span className="font-medium">Try: </span>
          {finding.suggestion}
        </p>
      ) : null}
    </li>
  )
}

function CheckSymbol({ status }: { status: MetricCheck['status'] }) {
  const labels = {
    clear: 'No issue found',
    deduction: 'Affected the score',
    issue: 'Issue found, no points lost',
    unavailable: 'Not checked',
  }
  return (
    <span
      role="img"
      aria-label={labels[status]}
      title={labels[status]}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center',
        status === 'clear'
          ? 'text-positive'
          : status === 'deduction'
            ? 'text-negative'
            : status === 'issue'
              ? 'text-accent-ink'
              : 'text-muted',
      )}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-4"
      >
        {status === 'clear' ? (
          <path d="m4 10 4 4 8-8" />
        ) : status === 'deduction' ? (
          <path d="M10 3v13m-5-5 5 5 5-5" />
        ) : status === 'issue' ? (
          <circle cx="10" cy="10" r="5.5" />
        ) : (
          <path d="M5 10h10" />
        )}
      </svg>
    </span>
  )
}

function MetricDetails({ label, details }: { label: string; details: MetricChecksView }) {
  return (
    <div role="region" aria-label={`${label} details`} className="flex min-w-0 flex-col gap-4">
      {details.checks.map((check) => (
        <section key={check.label} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <CheckSymbol status={check.status} />
            <h4 className="text-foreground text-sm font-semibold">{check.label}</h4>
          </div>
          <ul className="flex min-w-0 flex-col gap-3">
            {check.findings.map((finding) => (
              <Finding key={finding.key} finding={finding} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function V3ResultsView({
  promptText,
  additionalContext,
  transcript,
  words = [],
  durationMs,
  audioUrl,
  audioUnavailable = false,
  payload,
  previousAttempts = [],
  timezone = UTC_TIMEZONE,
  curriculumResult = null,
  retryHref = null,
  deleteControl = null,
}: V3ResultsViewProps) {
  const complete = payload.total_earned_points !== null
  const transcriptSegments = v3TranscriptSegments(transcript, payload, words)
  const sectionViews = v3SectionViews(payload)
  const overview = resultOverview(payload)
  const hasPreviousAttempts = previousAttempts.length > 0
  const unavailable = complete ? null : unavailableResultMessage(payload, transcript)
  const resultActions = curriculumResult ? (
    <>
      <ButtonLink href={curriculumResult.primaryAction.href} size="lg" fullWidth>
        {curriculumResult.primaryAction.label}
      </ButtonLink>
      {curriculumResult.secondaryAction ? (
        <ButtonLink
          href={curriculumResult.secondaryAction.href}
          variant="secondary"
          size="lg"
          fullWidth
        >
          {curriculumResult.secondaryAction.label}
        </ButtonLink>
      ) : null}
      {curriculumResult.tertiaryAction ? (
        <ButtonLink
          href={curriculumResult.tertiaryAction.href}
          variant="secondary"
          size="lg"
          fullWidth
        >
          {curriculumResult.tertiaryAction.label}
        </ButtonLink>
      ) : null}
    </>
  ) : retryHref ? (
    <ButtonLink href={retryHref} size="lg" fullWidth>
      Try Again
    </ButtonLink>
  ) : null

  return (
    <div
      data-result-layout="responsive"
      className="grid grid-cols-1 items-start gap-12 pb-12 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]"
    >
      <section
        aria-label="Result summary"
        className={cn(
          'flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1 lg:self-stretch',
          !hasPreviousAttempts && 'lg:col-span-2',
        )}
      >
        <header className="flex flex-col gap-1">
          <ResultPrompt>{promptText}</ResultPrompt>
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
              <div className="max-w-reading flex flex-col gap-2">
                <p className="text-foreground text-xl font-semibold">{unavailable?.title}</p>
                {!curriculumResult ? (
                  <p className="text-muted text-sm">{unavailable?.description}</p>
                ) : null}
              </div>
            )}
          </div>

          <ScoreProgress
            label="Overall score"
            value={payload.total_earned_points}
            max={payload.total_max_points}
            size="overall"
          />
        </div>
      </section>

      <section
        aria-label="Response review"
        className={cn(
          'grid min-w-0 grid-cols-1 items-stretch gap-6 lg:col-span-2 lg:row-start-2',
          curriculumResult && 'lg:grid-cols-2',
        )}
      >
        {curriculumResult ? (
          <Card
            data-result-review-card="lesson"
            className="flex h-full min-w-0 flex-col gap-4 sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>
                  {lessonStateTitle(curriculumResult, unavailable?.title ?? 'Result unavailable')}
                </CardTitle>
              </div>
              {curriculumResult.currentStars > 0 ? (
                <CurriculumStars stars={curriculumResult.currentStars} />
              ) : null}
            </div>

            {curriculumResult.state === 'neutral' ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted text-base">{unavailable?.description}</p>
                <p className="text-muted text-base">
                  This attempt does not pass or fail the lesson and does not change your progress.
                </p>
              </div>
            ) : null}

            {curriculumResult.bestScore !== null ? (
              <div className="flex flex-wrap items-center gap-3 text-base">
                <span className="text-foreground">
                  Best: <span className="numeric">{curriculumResult.bestScore}</span>
                </span>
                <CurriculumStars stars={curriculumResult.bestStars} />
                {curriculumResult.personalBest ? (
                  <span className="text-accent-ink font-medium">Personal best</span>
                ) : null}
              </div>
            ) : null}

            {curriculumResult.state === 'not_passed' ? (
              <p className="text-muted text-base">
                You need 70 to pass. Try this lesson again when you are ready.
              </p>
            ) : null}
            {curriculumResult.state === 'passed' ? (
              curriculumResult.pathComplete ? (
                <p className="text-foreground font-medium">Track complete</p>
              ) : (
                <p className="text-muted text-base">The next lesson is ready.</p>
              )
            ) : null}
          </Card>
        ) : null}

        <Card
          data-result-review-card="recording"
          className="flex h-full min-w-0 flex-col gap-4 sm:p-6"
        >
          <CardTitle id="recording-heading">Recording</CardTitle>
          {audioUrl ? <AudioPlayer src={audioUrl} durationMs={durationMs} /> : null}
          {audioUnavailable || !audioUrl ? (
            <p role="status" className="text-muted text-sm">
              Audio playback is unavailable for this response.
            </p>
          ) : null}
        </Card>
      </section>

      <PreviousAttempts
        attempts={previousAttempts}
        timezone={timezone}
        className="lg:col-start-2 lg:row-start-1 lg:self-stretch"
      />

      <section
        aria-label="Recommendation"
        className="flex min-w-0 flex-col gap-3 lg:col-span-2 lg:row-start-3"
      >
        <Card className="sm:p-8">
          {overview ? (
            <div className="max-w-reading flex flex-col gap-2">
              <p className="text-foreground text-base">{overview}</p>
            </div>
          ) : (
            <p className="text-muted text-sm">
              A recommendation is unavailable because some metrics were not scored.
            </p>
          )}
        </Card>
      </section>

      <div data-result-region="transcript" className="min-w-0 lg:col-span-2 lg:row-start-4">
        <TranscriptPanel heading="Transcript" segments={transcriptSegments} />
      </div>

      <div
        data-result-layout="score-sections"
        className="grid min-w-0 grid-cols-1 items-stretch gap-8 lg:col-span-2 lg:row-start-5 lg:grid-cols-2"
      >
        {sectionViews.map((section) => {
          const storedSection = payload.sections[section.id]
          return (
            <section
              key={section.id}
              aria-labelledby={`${section.id}-heading`}
              className="flex h-full min-w-0 flex-col gap-4"
            >
              <Card className="flex min-w-0 flex-1 flex-col gap-6 sm:p-8">
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
                    tone={section.id === 'what_you_said' ? 'content' : 'delivery'}
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
                    const details = metricChecks(metric, result, payload.mode)
                    const progress = (
                      <ScoreProgress
                        label={`${label} score`}
                        tone={section.id === 'what_you_said' ? 'content' : 'delivery'}
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
                          className="text-foreground min-w-0 text-base font-medium"
                        >
                          {label}
                        </span>
                        <span className="numeric text-muted shrink-0 text-sm">{status.score}</span>
                      </span>
                    )

                    return (
                      <Disclosure
                        key={metric}
                        summary={cardHeader}
                        hint={<span className="mt-1 block text-sm">{details.summary}</span>}
                        summarySupplement={progress}
                        showLabel={`Show ${label} details`}
                        hideLabel={`Hide ${label} details`}
                        variant="row"
                        buttonClassName="items-start"
                        contentClassName="border-accent/30 bg-background rounded-input mb-4 min-w-0 border-l-2 px-4 py-4"
                      >
                        <MetricDetails label={label} details={details} />
                      </Disclosure>
                    )
                  })}
                </div>
              </Card>
              {section.id === 'how_you_sounded' && (resultActions || deleteControl) ? (
                <div
                  role="group"
                  aria-label="Result actions"
                  data-result-actions
                  className="flex flex-col gap-3"
                >
                  {resultActions}
                  {deleteControl}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
