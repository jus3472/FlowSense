'use client'

import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ModalLayer } from '@/components/ui/modal-layer'
import { deleteAttempt } from '@/lib/results/api'
import { cn } from '@/lib/utils'

export function DeleteResponseControl({
  attemptId,
  fullWidth = false,
}: {
  attemptId: string
  fullWidth?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const deletingRef = useRef(false)

  const close = useCallback(() => {
    if (busy) return
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [busy])

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, close, open])

  useEffect(() => {
    if (open && error && !busy) deleteRef.current?.focus()
  }, [busy, error, open])

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const cancel = cancelRef.current
    const remove = deleteRef.current
    if (!cancel || !remove) return

    if (busy) {
      event.preventDefault()
      cancel.focus()
      return
    }

    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault()
      remove.focus()
    } else if (!event.shiftKey && document.activeElement === remove) {
      event.preventDefault()
      cancel.focus()
    }
  }

  const remove = async () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const outcome = await deleteAttempt(attemptId)
      router.replace(outcome.redirectTo)
      router.refresh()
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'The response could not be deleted.')
      deletingRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col items-start gap-2', fullWidth && 'w-full')}>
      <Button
        ref={triggerRef}
        variant={fullWidth ? 'secondary' : 'ghost'}
        size={fullWidth ? 'lg' : 'md'}
        fullWidth={fullWidth}
        className="text-negative"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        Delete response
      </Button>

      {error && !open ? (
        <p role="alert" className="text-negative text-sm">
          {error}
        </p>
      ) : null}

      {open ? (
        <ModalLayer>
          <Card
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-response-title"
            aria-describedby="delete-response-description"
            aria-busy={busy || undefined}
            onKeyDown={trapFocus}
            className="shadow-float max-w-form flex w-full flex-col gap-6"
          >
            <div className="flex flex-col gap-2">
              <h2 id="delete-response-title" className="text-foreground text-lg font-semibold">
                Delete this response?
              </h2>
              <p id="delete-response-description" className="text-muted text-sm">
                This response, its recording, and its score will be permanently deleted. Your
                Progress, streak, stars, and lesson unlocks may change.
              </p>
            </div>
            {error ? (
              <p
                role="alert"
                className="bg-negative-soft text-negative rounded-input px-4 py-3 text-sm"
              >
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                ref={cancelRef}
                variant="secondary"
                aria-disabled={busy || undefined}
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                ref={deleteRef}
                variant="destructive"
                aria-disabled={busy || undefined}
                loading={busy}
                loadingLabel="Deleting response"
                onClick={() => void remove()}
              >
                Delete response
              </Button>
            </div>
          </Card>
        </ModalLayer>
      ) : null}
    </div>
  )
}
