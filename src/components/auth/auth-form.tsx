'use client'

import { useActionState, useState, type FormEvent } from 'react'
import { authenticate } from '@/actions/authenticate'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { initialAuthFormState } from '@/lib/forms'
import { cn } from '@/lib/utils'
import { validateEmail, validatePassword, type AuthMode } from '@/lib/validation'

type FieldErrors = { email?: string; password?: string }

const COPY: Record<AuthMode, { heading: string; body: string; submit: string; pending: string }> = {
  signup: {
    heading: 'Create your account',
    body: 'Two short steps, then your first prompt.',
    submit: 'Create account',
    pending: 'Creating account',
  },
  login: {
    heading: 'Log in',
    body: 'Pick up where you left off.',
    submit: 'Log in',
    pending: 'Logging in',
  },
}

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('signup')
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})
  const [state, formAction, pending] = useActionState(authenticate, initialAuthFormState)

  const copy = COPY[mode]
  const errors: FieldErrors = { ...state.fieldErrors, ...clientErrors }

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setClientErrors({})
  }

  // The server action validates too. This pass only exists so the first
  // failure is instant instead of a round trip.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')

    const next: FieldErrors = {}
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password, mode)
    if (emailError) next.email = emailError
    if (passwordError) next.password = passwordError

    setClientErrors(next)
    if (next.email || next.password) {
      event.preventDefault()
      const target = next.email ? 'email' : 'password'
      form.querySelector<HTMLInputElement>(`#${target}`)?.focus()
    }
  }

  const clearFieldError = (field: keyof FieldErrors) => {
    setClientErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="group"
        aria-label="Sign up or log in"
        className="bg-surface-sunken flex gap-1 rounded-full p-1"
      >
        {(['signup', 'login'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => switchMode(value)}
            className={cn(
              'min-h-11 flex-1 rounded-full px-4 text-sm font-medium transition duration-150 ease-out',
              mode === value ? 'bg-accent text-accent-fg' : 'text-foreground hover:bg-accent-soft',
            )}
          >
            {value === 'signup' ? 'Sign up' : 'Log in'}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h1 className="prompt-display text-foreground text-xl">{copy.heading}</h1>
        <p className="text-muted text-base">{copy.body}</p>
      </div>

      <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <input type="hidden" name="mode" value={mode} />

        <TextField
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@example.com"
          error={errors.email ?? null}
          onChange={() => clearFieldError('email')}
        />

        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
          error={errors.password ?? null}
          onChange={() => clearFieldError('password')}
        />

        {state.formError ? (
          <p role="alert" className="text-negative text-sm">
            {state.formError}
          </p>
        ) : null}

        {state.notice ? (
          <p role="status" className="text-muted text-sm">
            {state.notice}
          </p>
        ) : null}

        <Button type="submit" size="lg" fullWidth loading={pending} loadingLabel={copy.pending}>
          {copy.submit}
        </Button>
      </form>
    </div>
  )
}
