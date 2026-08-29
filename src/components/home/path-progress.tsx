import Link from 'next/link'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { HomeCurriculumModel } from '@/lib/home/progression'

export function HomePrimaryPath({ primary }: { primary: HomeCurriculumModel['primary'] }) {
  return (
    <section aria-labelledby="primary-path-heading">
      <Card className="shadow-float flex min-w-0 flex-col gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="section-label text-muted">Primary path</p>
          <h1
            id="primary-path-heading"
            className="prompt-display text-foreground text-xl break-words"
          >
            {primary.heading}
          </h1>
        </div>

        {primary.pathComplete ? (
          <p className="text-positive text-base font-medium">Path complete</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            {primary.transitionLabel ? (
              <p className="text-positive text-sm font-medium">{primary.transitionLabel}</p>
            ) : null}
            <p className="text-muted text-sm">{primary.chapterLabel}</p>
            <p className="text-foreground text-lg font-medium break-words">{primary.lessonTitle}</p>
            <p className="numeric text-muted text-sm">{primary.lessonStatus}</p>
          </div>
        )}

        <div className="border-border text-muted flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-sm">
          <span className="numeric">
            {primary.passedLessons} / {primary.totalLessons} lessons passed
          </span>
          <span className="numeric">
            {primary.earnedStars} / {primary.maximumStars} stars
          </span>
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
      <h2 id="secondary-paths-heading" className="text-foreground text-lg font-semibold">
        Your other paths
      </h2>
      <div className="flex min-w-0 flex-col gap-3">
        {paths.map((path) => (
          <Link
            key={path.id}
            href={path.href}
            className="rounded-card bg-surface hover:bg-surface-sunken flex min-h-11 min-w-0 items-center justify-between gap-4 p-4 transition duration-150 ease-out"
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

export function HomeOtherPractice() {
  return (
    <section aria-labelledby="other-practice-heading" className="flex flex-col gap-4">
      <h2 id="other-practice-heading" className="text-foreground text-lg font-semibold">
        Practice something else
      </h2>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Link
          href="/practice/practice"
          className="rounded-card bg-surface-sunken text-foreground hover:bg-accent-soft flex min-h-11 items-center p-4 text-sm font-medium transition duration-150 ease-out"
        >
          Free Practice
        </Link>
        <Link
          href="/practice/custom"
          className="rounded-card bg-surface-sunken text-foreground hover:bg-accent-soft flex min-h-11 items-center p-4 text-sm font-medium transition duration-150 ease-out"
        >
          Custom Prompt
        </Link>
      </div>
    </section>
  )
}
