import type { Metadata } from 'next'
import { TextLink } from '@/components/ui/text-link'

export const metadata: Metadata = {
  title: 'History',
}

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-foreground text-xl font-semibold">History is coming next</h1>
      <p className="text-muted text-base">
        Every response you record will be listed here with its score and transcript.
      </p>
      <p className="text-muted text-base">
        <TextLink href="/home">Back to home</TextLink>
      </p>
    </div>
  )
}
