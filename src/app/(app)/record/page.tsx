import type { Metadata } from 'next'
import { TextLink } from '@/components/ui/text-link'

export const metadata: Metadata = {
  title: 'Record',
}

export default function RecordPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-foreground text-xl font-semibold">Recording is coming next</h1>
      <p className="text-muted text-base">
        This is where a prompt appears, a countdown runs, and you answer out loud for up to 60
        seconds.
      </p>
      <p className="text-muted text-base">
        <TextLink href="/home">Back to home</TextLink>
      </p>
    </div>
  )
}
