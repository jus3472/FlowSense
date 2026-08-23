'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import type { ComponentProps } from 'react'

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, 'type' | 'loading'>

/** Mirrors the pending state of the form it sits in. One per form. */
export function SubmitButton(props: SubmitButtonProps) {
  const { pending } = useFormStatus()
  return <Button {...props} type="submit" loading={pending} />
}
