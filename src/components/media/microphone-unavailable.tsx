'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { UnsupportedReason } from '@/lib/recording/support'

/** No device attached, as distinct from a browser that cannot record at all. */
export type UnavailableReason = UnsupportedReason | 'missing'

const BROWSERS = 'Open FlowSense in Chrome, Safari, Edge, or Firefox.'

const COPY: Record<UnavailableReason, { title: string; body: string }> = {
  missing: {
    title: 'No microphone available',
    body: 'Your browser cannot find a microphone. Connect one, then try again.',
  },
  'no-capture': {
    title: 'This browser cannot use the microphone',
    body: `This browser does not support microphone access. ${BROWSERS}`,
  },
  'no-recorder': {
    title: 'This browser cannot record audio',
    body: `This browser does not support audio recording. ${BROWSERS}`,
  },
  'no-format': {
    title: 'This browser cannot record audio',
    body: `This browser offers no audio format FlowSense can record. ${BROWSERS}`,
  },
}

export function titleForUnavailable(reason: UnavailableReason): string {
  return COPY[reason].title
}

interface MicrophoneUnavailableProps {
  reason: UnavailableReason
  onRetry?: () => void
  children?: ReactNode
}

export function MicrophoneUnavailable({ reason, onRetry, children }: MicrophoneUnavailableProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-base">{COPY[reason].body}</p>
      <div className="flex flex-col gap-3">
        {onRetry ? (
          <Button size="lg" fullWidth onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  )
}
