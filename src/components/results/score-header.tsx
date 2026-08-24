import type { CSSProperties } from 'react'

interface ScoreHeaderProps {
  score: number
  contentEarned: number
  deliveryEarned: number
}

/**
 * The score, and nothing that ranks it. No comparison to previous attempts
 * appears anywhere on this screen, and no message changes with the number.
 */
export function ScoreHeader({ score, contentEarned, deliveryEarned }: ScoreHeaderProps) {
  const fill = Math.max(0, Math.min(1, score / 100))
  const fillStyle = {
    '--fill': fill,
    transform: `scaleX(${fill})`,
  } as CSSProperties

  return (
    <section className="flex flex-col gap-6">
      <h1 className="section-label text-muted">Clarity</h1>

      <div className="flex items-baseline gap-2">
        <span className="prompt-display text-foreground text-3xl sm:text-4xl">{score}</span>
        <span className="numeric text-muted text-lg">/ 100</span>
      </div>

      <div aria-hidden="true" className="bg-score-track h-2 w-full overflow-hidden rounded-full">
        <div
          className="from-score-fill-start to-score-fill-end animate-score-fill h-full origin-left rounded-full bg-linear-to-r"
          style={fillStyle}
        />
      </div>

      <p className="text-muted text-base">
        <span className="numeric">{contentEarned}</span> for what you said,{' '}
        <span className="numeric">{deliveryEarned}</span> for how you sounded
      </p>
    </section>
  )
}
