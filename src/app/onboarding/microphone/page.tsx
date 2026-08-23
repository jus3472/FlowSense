import type { Metadata } from 'next'
import { MicrophoneStep } from '@/components/onboarding/microphone-step'

export const metadata: Metadata = {
  title: 'Microphone access',
}

export default function MicrophonePage() {
  return <MicrophoneStep />
}
