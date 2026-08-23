export function StreakDisplay({ streak }: { streak: number }) {
  if (streak === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-foreground text-lg font-semibold">Start a streak today</p>
        <p className="text-muted text-sm">One response a day is enough to keep it going.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground text-lg font-semibold">
        <span className="numeric">{streak}</span> day streak
      </p>
      <p className="text-muted text-sm">Answer today to keep it going.</p>
    </div>
  )
}
