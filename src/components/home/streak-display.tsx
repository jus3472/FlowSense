export function StreakDisplay({ streak }: { streak: number }) {
  if (streak === 0) {
    return (
      <div className="flex flex-col gap-6">
        <p className="section-label text-muted">No days recorded yet</p>
        <p className="prompt-display text-foreground text-2xl">One prompt, 60 seconds</p>
        <p className="text-muted text-base">One response a day is enough to keep it going.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="section-label text-muted">
        <span className="numeric">{streak}</span> day{streak === 1 ? '' : 's'} in a row
      </p>
      <p className="prompt-display text-foreground text-2xl">One prompt, 60 seconds</p>
      <p className="text-muted text-base">Answer today to keep it going.</p>
    </div>
  )
}
