import { beginCustomPractice } from '@/actions/custom-practice'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import { FIELD_CONTROL_CLASS } from '@/components/ui/text-field'

export default async function CustomPracticePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error: errorCode } = await searchParams
  const error = errorCode === 'invalid'
  const tooLarge = errorCode === 'too-large'
  return (
    <PageShell width="column">
      <div className="flex flex-col gap-2">
        <p className="section-label text-muted">Custom practice</p>
        <PageTitle>Practice your own prompt</PageTitle>
      </div>
      <Card className="sm:p-8">
        <form action={beginCustomPractice} className="flex flex-col gap-6">
          {error || tooLarge ? (
            <p
              role="alert"
              className="bg-negative-soft text-negative rounded-input px-4 py-3 text-sm"
            >
              {tooLarge
                ? 'Your prompt and context are too long. Shorten them and try again.'
                : 'Check the prompt, mode, and target duration.'}
            </p>
          ) : null}
          <label className="text-foreground flex flex-col gap-2 text-sm font-medium">
            Prompt or question
            <textarea
              name="prompt"
              required
              maxLength={1000}
              className={`${FIELD_CONTROL_CLASS} min-h-28 py-3`}
            />
          </label>
          <label className="text-foreground flex flex-col gap-2 text-sm font-medium">
            Practice mode
            <select name="mode" defaultValue="practice" className={FIELD_CONTROL_CLASS}>
              <option value="practice">General Practice</option>
              <option value="interview">Interviews</option>
              <option value="presentation">Presentations</option>
              <option value="conversation">Conversations</option>
            </select>
          </label>
          <label className="text-foreground flex flex-col gap-2 text-sm font-medium">
            <span>
              Additional context <span className="text-muted font-normal">Optional</span>
            </span>
            <textarea
              name="additional_context"
              maxLength={1000}
              className={`${FIELD_CONTROL_CLASS} min-h-24 py-3`}
            />
          </label>
          <label className="text-foreground flex flex-col gap-2 text-sm font-medium">
            <span>
              Target duration <span className="text-muted font-normal">15 to 60 seconds</span>
            </span>
            <input
              name="target_duration_seconds"
              type="number"
              min="15"
              max="60"
              defaultValue="60"
              className={FIELD_CONTROL_CLASS}
            />
          </label>
          <Button type="submit" size="lg" fullWidth>
            Continue to record
          </Button>
        </form>
      </Card>
    </PageShell>
  )
}
