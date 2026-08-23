'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { StepFrame } from '@/components/onboarding/step-frame'
import { Button, ButtonLink } from '@/components/ui/button'

type Status = 'idle' | 'requesting' | 'granted' | 'denied' | 'missing' | 'unsupported'

export function MicrophoneStep() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    let cancelled = false

    // Runs off the effect body so the first render is always the neutral ask,
    // which is also what the server rendered.
    const detect = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus('unsupported')
        return
      }

      try {
        // Skip past the ask if the browser already remembers a yes.
        const result = await navigator.permissions?.query({
          name: 'microphone' as PermissionName,
        })
        if (cancelled || !result) return
        if (result.state === 'granted') setStatus('granted')
        if (result.state === 'denied') setStatus('denied')
      } catch {
        // Firefox and Safari do not expose the microphone permission. Ask instead.
      }
    }

    void detect()

    return () => {
      cancelled = true
    }
  }, [])

  const requestAccess = async () => {
    setStatus('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Release the microphone straight away. Holding the stream open would
      // leave the recording indicator lit through the rest of onboarding.
      for (const track of stream.getTracks()) track.stop()
      setStatus('granted')
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      setStatus(name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'missing' : 'denied')
    }
  }

  if (status === 'denied') {
    return (
      <StepFrame step={1} title="Microphone access is blocked">
        <div className="flex flex-col gap-4">
          <p className="text-muted text-base">
            Your browser is set to block the microphone for this site. You can change it in 3 steps.
          </p>
          <ol className="flex flex-col gap-3">
            {[
              'Open the site settings from the icon at the left of the address bar.',
              'Set Microphone to Allow.',
              'Reload this page and try again.',
            ].map((line, index) => (
              <li key={line} className="flex items-start gap-3">
                <span className="numeric text-accent text-sm font-medium">{index + 1}</span>
                <span className="text-muted text-base">{line}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-3">
            <Button size="lg" fullWidth onClick={requestAccess}>
              Try again
            </Button>
            <ButtonLink href="/onboarding/focus" variant="ghost" fullWidth>
              Continue without it for now
            </ButtonLink>
          </div>
        </div>
      </StepFrame>
    )
  }

  if (status === 'missing' || status === 'unsupported') {
    return (
      <StepFrame step={1} title="No microphone available">
        <div className="flex flex-col gap-4">
          <p className="text-muted text-base">
            {status === 'missing'
              ? 'Your browser cannot find a microphone. Connect one, then try again.'
              : 'This browser does not support microphone access. Open FlowSense in Chrome, Safari, Edge, or Firefox.'}
          </p>
          <div className="flex flex-col gap-3">
            <Button size="lg" fullWidth onClick={requestAccess}>
              Try again
            </Button>
            <ButtonLink href="/onboarding/focus" variant="ghost" fullWidth>
              Continue without it for now
            </ButtonLink>
          </div>
        </div>
      </StepFrame>
    )
  }

  if (status === 'granted') {
    return (
      <StepFrame step={1} title="Microphone access is on">
        <div className="flex flex-col gap-4">
          <p className="text-muted text-base">
            FlowSense only listens while you are answering a prompt.
          </p>
          <Button size="lg" fullWidth onClick={() => router.push('/onboarding/focus')}>
            Continue
          </Button>
        </div>
      </StepFrame>
    )
  }

  return (
    <StepFrame step={1} title="Turn on your microphone">
      <div className="flex flex-col gap-4">
        <p className="text-muted text-base">
          FlowSense needs your microphone to hear the answers you speak.
        </p>
        <p className="text-muted text-base">
          Recordings stay in your account and you can delete any of them.
        </p>
        <Button
          size="lg"
          fullWidth
          onClick={requestAccess}
          loading={status === 'requesting'}
          loadingLabel="Waiting for your browser"
        >
          Allow microphone access
        </Button>
      </div>
    </StepFrame>
  )
}
