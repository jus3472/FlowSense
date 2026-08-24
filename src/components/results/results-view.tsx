'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { AudioPlayer } from '@/components/record/audio-player'
import { ContentSection } from '@/components/results/content-section'
import { DeliverySection } from '@/components/results/delivery-section'
import { ScoreHeader } from '@/components/results/score-header'
import { StatisticsSection } from '@/components/results/statistics-section'
import { TighterVersion } from '@/components/results/tighter-version'
import { TranscriptPanel } from '@/components/results/transcript-panel'
import { ButtonLink } from '@/components/ui/button'
import { buildSegments } from '@/lib/results/highlights'
import { disputeFinding } from '@/lib/results/api'
import type { AttemptView } from '@/lib/results/types'
import { scoreAttempt } from '@/lib/recording/api'
import { recomputeScore } from '@/lib/scoring/assemble'
import { CHECK_NAMES, applyDisputes, type CheckName, type Dispute } from '@/lib/scoring/content'

const SPAN_NOTE = 'word_choice_span'

export function ResultsView({
  attempt,
  initialDisputes,
}: {
  attempt: AttemptView
  initialDisputes: Dispute[]
}) {
  const router = useRouter()
  const [disputes, setDisputes] = useState<Dispute[]>(initialDisputes)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Recomputed locally so the score moves the moment a finding is kept, then
  // persisted. The mechanical half never changes.
  const adjusted = useMemo(
    () => recomputeScore(attempt.content, attempt.sections.delivery.metrics, disputes),
    [attempt.content, attempt.sections.delivery.metrics, disputes],
  )

  // Highlights follow the deductions, so a kept finding stops being marked.
  const marked = useMemo(
    () => applyDisputes(attempt.content, disputes),
    [attempt.content, disputes],
  )

  const segments = useMemo(
    () =>
      buildSegments({
        transcript: attempt.transcript,
        words: attempt.words,
        countedItems: attempt.statistics.counted_items,
        pauses: attempt.pauses,
        extraSpans: marked.extra_spans,
        checks: marked.checks,
        repeatedPhrases: attempt.statistics.repeated_phrases,
        timeToFirstWordMs: attempt.metrics.time_to_first_word.raw * 1000,
      }),
    [attempt, marked],
  )

  const disputedChecks = new Set(
    disputes
      .map((dispute) => dispute.note_type)
      .filter((name): name is CheckName => (CHECK_NAMES as readonly string[]).includes(name)),
  )
  const disputedSpans = new Set(
    disputes
      .filter((dispute) => dispute.note_type === SPAN_NOTE)
      .map((dispute) => dispute.quote ?? ''),
  )

  const dispute = async (noteType: string, quote: string | null) => {
    setError(null)
    const entry: Dispute = { note_type: noteType, quote }
    setDisputes((current) => [...current, entry])

    try {
      await disputeFinding(attempt.id, noteType, quote)
    } catch (thrown) {
      setDisputes((current) => current.filter((item) => item !== entry))
      setError(thrown instanceof Error ? thrown.message : 'That could not be saved.')
    }
  }

  const retry = async () => {
    setRetrying(true)
    setError(null)
    try {
      await scoreAttempt(attempt.id)
      router.refresh()
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'The checks could not be run.')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      <p className="prompt-display text-muted text-lg">{attempt.promptText}</p>

      <ScoreHeader
        score={adjusted.score}
        contentEarned={adjusted.section_scores.content.earned}
        deliveryEarned={adjusted.section_scores.delivery.earned}
      />

      <TranscriptPanel segments={segments} />

      {/*
        Display comes from the original findings so a kept one dims in place
        rather than vanishing. The points come from the adjusted score.
      */}
      <ContentSection
        content={attempt.content}
        points={adjusted.section_scores.content.checks}
        earned={adjusted.section_scores.content.earned}
        max={adjusted.section_scores.content.max}
        disputedChecks={disputedChecks}
        disputedSpans={disputedSpans}
        onDisputeCheck={(name) => void dispute(name, attempt.content.checks[name].quote)}
        onDisputeSpan={(text) => void dispute(SPAN_NOTE, text)}
        onRetry={() => void retry()}
        retrying={retrying}
      />

      {error ? (
        <p role="alert" className="text-negative text-sm">
          {error}
        </p>
      ) : null}

      <DeliverySection
        metrics={attempt.metrics}
        statistics={attempt.statistics}
        pauses={attempt.pauses}
        earned={adjusted.section_scores.delivery.earned}
        max={adjusted.section_scores.delivery.max}
      />

      <div className="flex flex-col gap-6">
        {adjusted.content_result.tightened ? (
          <TighterVersion
            original={attempt.transcript}
            tightened={adjusted.content_result.tightened}
          />
        ) : null}

        <StatisticsSection statistics={attempt.statistics} />
      </div>

      {attempt.audioUrl ? (
        <AudioPlayer src={attempt.audioUrl} durationMs={attempt.durationMs} />
      ) : null}

      <ButtonLink href="/record" size="lg" fullWidth>
        {"Start today's response"}
      </ButtonLink>
    </div>
  )
}
