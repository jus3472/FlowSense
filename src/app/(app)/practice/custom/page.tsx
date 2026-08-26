import { beginCustomPractice } from '@/actions/custom-practice'
import { Button } from '@/components/ui/button'

export default async function CustomPracticePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const error = (await searchParams).error === 'invalid'
  return (
    <form action={beginCustomPractice} className="flex flex-col gap-6 pt-4">
      <div>
        <p className="section-label text-muted">Custom practice</p>
        <h1 className="prompt-display text-foreground text-2xl">Practice your own prompt</h1>
      </div>
      {error ? (
        <p role="alert" className="text-negative text-sm">
          Check the prompt, mode, and target duration.
        </p>
      ) : null}
      <label className="flex flex-col gap-2 text-sm font-medium">
        Prompt or question
        <textarea
          name="prompt"
          required
          maxLength={1000}
          className="bg-surface border-border rounded-card text-foreground min-h-28 border p-3"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Practice mode
        <select
          name="mode"
          defaultValue="practice"
          className="bg-surface border-border rounded-card text-foreground border p-3"
        >
          <option value="practice">General Practice</option>
          <option value="interview">Interviews</option>
          <option value="presentation">Presentations</option>
          <option value="conversation">Conversations</option>
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Additional context <span className="text-muted font-normal">Optional</span>
        <textarea
          name="additional_context"
          maxLength={1000}
          className="bg-surface border-border rounded-card text-foreground min-h-24 border p-3"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Target duration <span className="text-muted font-normal">15 to 60 seconds</span>
        <input
          name="target_duration_seconds"
          type="number"
          min="15"
          max="60"
          defaultValue="60"
          className="bg-surface border-border rounded-card text-foreground border p-3"
        />
      </label>
      <Button type="submit" size="lg" fullWidth>
        Continue to record
      </Button>
    </form>
  )
}
