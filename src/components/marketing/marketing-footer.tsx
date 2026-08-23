import { ButtonLink } from '@/components/ui/button'
import { TextLink } from '@/components/ui/text-link'
import { Wordmark } from '@/components/layout/wordmark'

export function MarketingFooter() {
  return (
    <footer className="bg-surface mt-12">
      <div className="max-w-column mx-auto flex w-full flex-col gap-6 px-4 py-12">
        <h2 className="text-foreground text-lg font-semibold">Answer one prompt today</h2>
        <div>
          <ButtonLink href="/login" size="lg">
            Answer your first prompt
          </ButtonLink>
        </div>

        <p className="text-muted text-sm">
          Your recordings stay in your account and you can delete any of them.
        </p>
        <p className="text-muted text-sm">
          FlowSense measures how a response lands. It never comments on your accent, your grammar,
          or the words you choose.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <Wordmark />
          <p className="text-muted text-sm">
            Already have an account? <TextLink href="/login">Log in</TextLink>
          </p>
        </div>
      </div>
    </footer>
  )
}
