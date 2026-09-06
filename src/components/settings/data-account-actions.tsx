'use client'

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { deleteAccount, resetProgress } from '@/actions/account'
import { Button } from '@/components/ui/button'
import { FIELD_CONTROL_CLASS } from '@/components/ui/text-field'
import { initialDestructiveActionFormState, type DestructiveActionFormState } from '@/lib/forms'

interface DestructiveActionProps {
  action: (
    state: DestructiveActionFormState,
    formData: FormData,
  ) => Promise<DestructiveActionFormState>
  triggerLabel: string
  triggerVariant: 'secondary' | 'destructive'
  title: string
  description: string
  confirmation: 'RESET' | 'DELETE'
  pendingLabel: string
}

function TypedDestructiveAction({
  action,
  triggerLabel,
  triggerVariant,
  title,
  description,
  confirmation: requiredConfirmation,
  pendingLabel,
}: DestructiveActionProps) {
  const titleId = useId()
  const descriptionId = useId()
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [state, formAction, pending] = useActionState(action, initialDestructiveActionFormState)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const handledSuccessRef = useRef<DestructiveActionFormState | null>(null)

  const close = () => {
    if (pending) return
    setOpen(false)
    setConfirmation('')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (state.status !== 'success' || handledSuccessRef.current === state) return
    handledSuccessRef.current = state
    setOpen(false)
    setConfirmation('')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [state])

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return

    const controls = [inputRef.current, cancelRef.current, submitRef.current].filter(
      (control): control is HTMLInputElement | HTMLButtonElement =>
        control !== null && !control.disabled,
    )
    if (controls.length === 0) return
    const currentIndex = controls.indexOf(
      document.activeElement as HTMLInputElement | HTMLButtonElement,
    )
    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault()
      controls.at(-1)?.focus()
    } else if (!event.shiftKey && currentIndex === controls.length - 1) {
      event.preventDefault()
      controls[0]?.focus()
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        ref={triggerRef}
        type="button"
        variant={triggerVariant}
        onClick={() => {
          setConfirmation('')
          setOpen(true)
        }}
      >
        {triggerLabel}
      </Button>

      {state.status === 'success' && state.message ? (
        <p role="status" className="text-muted text-sm">
          {state.message}
        </p>
      ) : null}

      {open ? (
        <div
          className="bg-foreground/20 fixed inset-0 z-50 flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            aria-busy={pending || undefined}
            onKeyDown={onDialogKeyDown}
            className="border-border bg-surface shadow-float rounded-card max-w-form flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-6 overflow-y-auto border p-6 sm:p-8"
          >
            <div className="flex flex-col gap-2">
              <h3 id={titleId} className="prompt-display text-foreground text-lg">
                {title}
              </h3>
              <p id={descriptionId} className="text-muted text-sm">
                {description}
              </p>
            </div>

            <form action={formAction} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label htmlFor={inputId} className="text-foreground text-sm font-medium">
                  Type {requiredConfirmation} to continue
                </label>
                <input
                  ref={inputRef}
                  id={inputId}
                  name="confirmation"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  disabled={pending}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className={FIELD_CONTROL_CLASS}
                />
              </div>

              {state.status === 'error' && state.message ? (
                <p
                  role="alert"
                  className="bg-negative-soft text-negative rounded-input px-4 py-3 text-sm"
                >
                  {state.message}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  ref={cancelRef}
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button
                  ref={submitRef}
                  type="submit"
                  variant="destructive"
                  disabled={confirmation !== requiredConfirmation || pending}
                  loading={pending}
                  loadingLabel={pendingLabel}
                >
                  {triggerLabel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function DataAndAccountActions() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-foreground text-base font-medium">Reset progress</h3>
          <p className="text-muted text-sm">
            Delete all practice data and start over while keeping your account.
          </p>
        </div>
        <TypedDestructiveAction
          action={resetProgress}
          triggerLabel="Reset progress"
          triggerVariant="secondary"
          title="Reset all progress?"
          description="This permanently deletes all of your responses, recordings, scores, streaks, History, Progress, stars, and lesson progress. Your FlowSense account and settings will remain."
          confirmation="RESET"
          pendingLabel="Resetting progress"
        />
      </div>

      <div className="border-negative flex flex-col gap-4 border-t pt-8">
        <div className="flex flex-col gap-1">
          <h3 className="text-foreground text-base font-medium">Delete account</h3>
          <p className="text-muted text-sm">
            Permanently delete your FlowSense account and all associated data.
          </p>
        </div>
        <TypedDestructiveAction
          action={deleteAccount}
          triggerLabel="Delete account"
          triggerVariant="destructive"
          title="Delete your FlowSense account?"
          description="This permanently deletes your account, responses, recordings, scores, History, Progress, streaks, and settings. This cannot be undone."
          confirmation="DELETE"
          pendingLabel="Deleting account"
        />
      </div>
    </div>
  )
}
