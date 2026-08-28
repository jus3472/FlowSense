import Link from 'next/link'
import { CurriculumStars } from '@/components/curriculum/stars'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import { curriculumPathHref } from '@/lib/curriculum/routes'

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function stateTitle(result: StructuredLessonResultModel): string {
  if (result.state === 'neutral') return 'Result unavailable'
  return result.state === 'passed' ? 'Lesson complete' : 'Lesson not passed'
}

function progressionMessage(result: StructuredLessonResultModel): string {
  if (result.pathComplete) {
    return `You passed every lesson in ${result.path.title}.`
  }
  if (!result.nextLesson) return 'Your path progress is up to date.'
  if (result.nextLesson.level !== result.chapter.level) {
    return `${titleCase(result.nextLesson.level)} lesson 1 is available.`
  }
  return `Lesson ${result.nextLesson.position} is available.`
}

export function LessonResultSummary({ result }: { result: StructuredLessonResultModel }) {
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Lesson result">
      <header className="flex min-w-0 flex-col gap-2">
        <Link
          href={curriculumPathHref(result.path.slug)}
          className="text-accent inline-flex min-h-11 w-fit items-center text-sm hover:underline"
        >
          {result.path.title}
        </Link>
        <p className="text-muted text-sm">
          {result.chapter.title} · Lesson {result.lesson.position} of 10
        </p>
        <h1 className="prompt-display text-foreground text-2xl break-words">
          {result.lesson.title}
        </h1>
      </header>

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-foreground text-lg font-semibold">{stateTitle(result)}</h2>
          {result.state === 'neutral' ? (
            <p className="text-muted text-sm">
              Some checks could not be completed, so this attempt does not affect your lesson
              progress.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="numeric text-foreground text-3xl font-semibold">
                {result.currentScore}
                <span className="text-muted text-xl"> / 100</span>
              </p>
              <CurriculumStars stars={result.currentStars} />
            </div>
          )}
        </div>

        {result.bestScore !== null ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-foreground">
              Best: <span className="numeric">{result.bestScore}</span>
            </span>
            <CurriculumStars stars={result.bestStars} />
            {result.personalBest ? (
              <span className="text-accent font-medium">Personal best</span>
            ) : null}
          </div>
        ) : null}

        {result.state === 'not_passed' ? (
          <p className="text-muted text-sm">Need 70 to continue.</p>
        ) : null}
        {result.state === 'passed' ? (
          <div className="flex flex-col gap-1">
            {result.pathComplete ? (
              <p className="text-foreground font-medium">Path complete</p>
            ) : null}
            <p className="text-muted text-sm">{progressionMessage(result)}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <ButtonLink href={result.primaryAction.href} size="lg" fullWidth>
            {result.primaryAction.label}
          </ButtonLink>
          {result.secondaryAction ? (
            <ButtonLink href={result.secondaryAction.href} variant="secondary" fullWidth>
              {result.secondaryAction.label}
            </ButtonLink>
          ) : null}
        </div>
      </Card>
    </section>
  )
}
