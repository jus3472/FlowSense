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
import { deleteAttempt } from '@/lib/results/api'

export function DeleteResponseControl({ attemptId }: { attemptId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    if (busy) return
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [busy])

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, close, open])

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const cancel = cancelRef.current
    const remove = deleteRef.current
    if (!cancel || !remove) return

    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault()
      remove.focus()
    } else if (!event.shiftKey && document.activeElement === remove) {
      event.preventDefault()
      cancel.focus()
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await deleteAttempt(attemptId)
      router.replace(outcome.redirectTo)
      router.refresh()
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'The response could not be deleted.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        ref={triggerRef}
        variant="ghost"
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
        <div className="bg-foreground/20 fixed inset-0 z-50 flex items-center justify-center p-4">
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
        </div>
      ) : null}
    </div>
  )
}
