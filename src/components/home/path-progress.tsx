import Link from 'next/link'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScoreProgress } from '@/components/ui/score-progress'
import type { HomeCurriculumModel } from '@/lib/home/progression'

export function HomePrimaryPath({ primary }: { primary: HomeCurriculumModel['primary'] }) {
  return (
    <section aria-labelledby="primary-path-heading">
      <Card className="flex min-w-0 flex-col gap-6 sm:p-8">
        <div className="flex min-w-0 flex-col gap-2">
          <h2
            id="primary-path-heading"
            className="prompt-display text-foreground text-xl break-words"
          >
            {primary.heading}
          </h2>
        </div>

        {primary.pathComplete ? (
          <p className="text-positive text-base font-medium">Path complete</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            {primary.transitionLabel ? (
              <p className="text-positive text-sm font-medium">{primary.transitionLabel}</p>
            ) : null}
            <p className="text-muted text-sm">{primary.chapterLabel}</p>
            <p className="numeric text-muted text-sm">{primary.lessonStatus}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <ScoreProgress
            label={`${primary.heading} lesson progress`}
            value={primary.passedLessons}
            max={primary.totalLessons}
            size="section"
          />
          <div className="text-muted flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span className="numeric">
              {primary.passedLessons} / {primary.totalLessons} lessons passed
            </span>
            <span className="numeric">
              {primary.earnedStars} / {primary.maximumStars} stars
            </span>
          </div>
        </div>

        <ButtonLink href={primary.action.href} size="lg" fullWidth>
          {primary.action.label}
        </ButtonLink>
      </Card>
    </section>
  )
}

export function HomeSecondaryPaths({ paths }: { paths: HomeCurriculumModel['secondary'] }) {
  if (paths.length === 0) return null

  return (
    <section aria-labelledby="secondary-paths-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="secondary-paths-heading" className="prompt-display text-foreground text-xl">
        Your other paths
      </h2>
      <div className="flex min-w-0 flex-col gap-3">
        {paths.map((path) => (
          <Link
            key={path.id}
            href={path.href}
            className="border-border bg-surface shadow-card rounded-card hover:bg-surface-sunken flex min-h-14 min-w-0 items-center justify-between gap-4 border p-4 transition duration-150 ease-out"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-foreground text-sm font-medium break-words">{path.title}</span>
              <span className="numeric text-muted text-xs">{path.status}</span>
            </span>
            <span className="text-accent shrink-0 text-sm font-medium">View</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
