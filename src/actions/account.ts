'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  isRecentAccountAuthentication,
  logRecordingCleanupRequired,
  logUserDataDeletionFailure,
  parseResetProgressReceipt,
  prepareOwnedRecordingCleanup,
  removeOwnedRecordings,
} from '@/lib/account/deletion'
import { markAccountClientStateForDeletion } from '@/lib/auth/account-deletion-cookie'
import type { DestructiveActionFormState } from '@/lib/forms'
import { clearCustomPracticeHandoffCookie } from '@/lib/practice/custom-handoff-cookie'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const RESET_CONFIRMATION = 'RESET'
const DELETE_CONFIRMATION = 'DELETE'

function errorState(message: string): DestructiveActionFormState {
  return { status: 'error', message }
}

function revalidatePracticeSurfaces(): void {
  revalidatePath('/home')
  revalidatePath('/history')
  revalidatePath('/progress')
  revalidatePath('/practice')
  revalidatePath('/attempts/[id]', 'page')
  revalidatePath('/settings')
}

export async function resetProgress(
  _previous: DestructiveActionFormState,
  formData: FormData,
): Promise<DestructiveActionFormState> {
  if (formData.get('confirmation') !== RESET_CONFIRMATION) {
    return errorState('Type RESET to continue.')
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return errorState('Your session ended. Log in and try again.')
  }

  const guard = await supabase.rpc('assert_my_data_deletion_safe')
  if (guard.error) {
    logUserDataDeletionFailure('reset_progress_safety_check', guard.error)
    return errorState('Your progress could not be reset. Try again.')
  }

  const admin = createAdminClient()
  const plan = await prepareOwnedRecordingCleanup(admin, user.id)
  if (plan.status === 'failure') {
    return errorState('Your saved recordings could not be verified. Your progress is unchanged.')
  }
  const { data, error } = await supabase.rpc('reset_my_progress')
  if (error) {
    logUserDataDeletionFailure('reset_progress_transaction', error)
    return errorState('Your progress could not be reset. Try again.')
  }

  const receipt = parseResetProgressReceipt(data, user.id)

  try {
    await clearCustomPracticeHandoffCookie()
  } catch (handoffError) {
    logUserDataDeletionFailure('clear_reset_progress_handoff', handoffError)
  }
  revalidatePracticeSurfaces()

  if (!receipt) {
    logUserDataDeletionFailure('parse_reset_progress_receipt')
    return errorState(
      'Your progress was reset, but recording cleanup could not be verified. Try Reset progress again.',
    )
  }

  const recordingPaths = [...new Set([...plan.paths, ...receipt.recordingPaths])]
  const recordings = await removeOwnedRecordings(admin, user.id, recordingPaths)
  if (recordings.status === 'failure') {
    return errorState(
      'Your progress was reset, but a recording could not be removed. Try Reset progress again.',
    )
  }

  return { status: 'success', message: 'Your progress was reset.' }
}

export async function deleteAccount(
  _previous: DestructiveActionFormState,
  formData: FormData,
): Promise<DestructiveActionFormState> {
  if (formData.get('confirmation') !== DELETE_CONFIRMATION) {
    return errorState('Type DELETE to continue.')
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return errorState('Your session ended. Log in and try again.')
  }
  if (!isRecentAccountAuthentication(user.last_sign_in_at)) {
    return errorState('Log out and log in again before deleting your account.')
  }

  const guard = await supabase.rpc('assert_my_data_deletion_safe')
  if (guard.error) {
    logUserDataDeletionFailure('delete_account_safety_check', guard.error)
    return errorState('Your account could not be deleted. Try again.')
  }

  const admin = createAdminClient()
  const plan = await prepareOwnedRecordingCleanup(admin, user.id)
  if (plan.status === 'failure') {
    return errorState('Your saved recordings could not be verified. Your account is unchanged.')
  }
  const recordings = await removeOwnedRecordings(admin, user.id, plan.paths)
  if (recordings.status === 'failure') {
    return errorState('Your recordings could not be deleted. Your account is unchanged.')
  }

  const { error: deletionError } = await admin.auth.admin.deleteUser(user.id, false)
  if (deletionError) {
    logUserDataDeletionFailure('delete_auth_user', deletionError)
    return errorState(
      'Your account was not deleted. Some recordings may already be removed. Try again.',
    )
  }

  const trailingPlan = await prepareOwnedRecordingCleanup(admin, user.id)
  if (trailingPlan.status === 'ready' && trailingPlan.paths.length > 0) {
    const trailingCleanup = await removeOwnedRecordings(admin, user.id, trailingPlan.paths)
    if (trailingCleanup.status === 'failure') {
      const retryCleanup = await removeOwnedRecordings(admin, user.id, trailingPlan.paths)
      if (retryCleanup.status === 'failure') {
        logRecordingCleanupRequired(user.id, trailingPlan.paths)
      }
    }
  } else if (trailingPlan.status === 'failure') {
    logUserDataDeletionFailure('verify_deleted_account_recordings')
    logRecordingCleanupRequired(user.id, [])
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
  if (signOutError) logUserDataDeletionFailure('clear_deleted_account_session', signOutError)
  try {
    await clearCustomPracticeHandoffCookie()
  } catch (error) {
    logUserDataDeletionFailure('clear_deleted_account_handoff', error)
  }
  try {
    await markAccountClientStateForDeletion()
  } catch (error) {
    logUserDataDeletionFailure('mark_deleted_account_client_state', error)
  }

  revalidatePath('/', 'layout')
  redirect('/')
}
