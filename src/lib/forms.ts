/**
 * Form state shapes and their initial values.
 *
 * These live outside the action modules because a `"use server"` file may only
 * export async functions. Exporting a plain object from one throws at runtime,
 * not at build time, so it is worth keeping the boundary obvious.
 */

export interface AuthFormState {
  formError: string | null
  notice: string | null
  fieldErrors: { email?: string; password?: string }
}

export const initialAuthFormState: AuthFormState = {
  formError: null,
  notice: null,
  fieldErrors: {},
}

export interface ProfileFormState {
  status: 'idle' | 'saved' | 'error'
  message: string | null
  displayNameError: string | null
}

export const initialProfileFormState: ProfileFormState = {
  status: 'idle',
  message: null,
  displayNameError: null,
}
