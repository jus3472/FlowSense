import type { Metadata } from 'next'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { PRACTICE_MODE_OPTIONS } from '@/lib/practice/navigation'

export const metadata: Metadata = {
  title: 'Practice',
}

export default function PracticePage() {
  return (
    <div className="flex flex-col gap-8 pt-4 pb-12">
      <div className="flex flex-col gap-2">
        <h1 className="prompt-display text-foreground text-2xl">Choose a practice</h1>
        <p className="text-muted text-base">Pick a format, then choose a prompt that fits.</p>
      </div>

      <div className="flex flex-col gap-4">
        {PRACTICE_MODE_OPTIONS.map((option) => (
          <Link key={option.mode} href={`/practice/${option.mode}`} className="rounded-card">
            <Card className="hover:bg-surface-sunken flex flex-col gap-2 transition duration-150 ease-out">
              <h2 className="text-foreground text-lg font-medium">{option.label}</h2>
              <p className="text-muted text-sm">{option.description}</p>
            </Card>
          </Link>
        ))}
        <Link href="/practice/custom" className="rounded-card">
          <Card className="hover:bg-surface-sunken flex flex-col gap-2 transition duration-150 ease-out">
            <h2 className="text-foreground text-lg font-medium">Custom Prompt</h2>
            <p className="text-muted text-sm">Practice with a prompt you bring.</p>
          </Card>
        </Link>
      </div>
    </div>
  )
}
