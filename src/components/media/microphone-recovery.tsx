'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export const MICROPHONE_BLOCKED_TITLE = 'Microphone access is blocked'

const STEPS = [
  'Open the site settings from the icon at the left of the address bar.',
  'Set Microphone to Allow.',
  'Reload this page and try again.',
]

interface MicrophoneRecoveryProps {
  onRetry: () => void
  retrying?: boolean
  /** Optional secondary action, so neither flow dead ends. */
  children?: ReactNode
}

/**
 * Shared between onboarding and the record flow. Renders the body only, so each
 * caller can place the title inside its own frame.
 */
export function MicrophoneRecovery({ onRetry, retrying, children }: MicrophoneRecoveryProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-base">
        Your browser is set to block the microphone for this site. You can change it in 3 steps.
      </p>
      <ol className="flex flex-col gap-3">
        {STEPS.map((line, index) => (
          <li key={line} className="flex items-start gap-3">
            <span className="numeric text-accent text-sm font-medium">{index + 1}</span>
            <span className="text-muted text-base">{line}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          onClick={onRetry}
          loading={retrying}
          loadingLabel="Waiting for your browser"
        >
          Try again
        </Button>
        {children}
      </div>
    </div>
  )
}
