'use client'

import { useEffect, useRef, useState } from 'react'
import { Disclosure } from '@/components/ui/disclosure'
import { Button } from '@/components/ui/button'
import { countWords } from '@/lib/scoring/content'

interface TighterVersionProps {
  original: string
  tightened: string
}

export function TighterVersion({ original, tightened }: TighterVersionProps) {
  const [feedback, setFeedback] = useState<'copied' | 'blocked' | null>(null)
  const resetTimer = useRef<number | null>(null)
  const attempt = useRef(0)

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    }
  }, [])

  const copy = async () => {
    attempt.current += 1
    const currentAttempt = attempt.current

    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    setFeedback(null)

    try {
      await navigator.clipboard.writeText(tightened)
      if (currentAttempt !== attempt.current) return

      setFeedback('copied')
      resetTimer.current = window.setTimeout(() => {
        setFeedback(null)
        resetTimer.current = null
      }, 2000)
    } catch {
      if (currentAttempt === attempt.current) setFeedback('blocked')
    }
  }

  return (
    <Disclosure
      summary="A tighter version"
      hint={`${countWords(original)} to ${countWords(tightened)} words`}
    >
      <p className="text-foreground text-base">{tightened}</p>
      <div>
        <Button variant="secondary" onClick={copy}>
          {feedback === 'copied' ? 'Copied' : 'Copy'}
        </Button>
        {feedback === 'blocked' ? (
          <p className="text-muted mt-2 text-sm">
            Copying is blocked. You can select the text instead.
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {feedback === 'copied' ? 'Tighter version copied.' : ''}
        </p>
      </div>
    </Disclosure>
  )
}
