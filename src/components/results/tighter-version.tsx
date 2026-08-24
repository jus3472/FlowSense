'use client'

import { useState } from 'react'
import { Disclosure } from '@/components/ui/disclosure'
import { Button } from '@/components/ui/button'
import { countWords } from '@/lib/scoring/content'

interface TighterVersionProps {
  original: string
  tightened: string
}

export function TighterVersion({ original, tightened }: TighterVersionProps) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tightened)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be blocked. The text is on screen either way.
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
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Disclosure>
  )
}
