import { logOut } from '@/actions/auth'
import { SubmitButton } from '@/components/ui/submit-button'

export function LogoutForm({ failed = false }: { failed?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {failed ? (
        <p role="alert" className="text-negative text-sm">
          You&apos;re still logged in. Try again.
        </p>
      ) : null}
      <form action={logOut}>
        <SubmitButton variant="secondary" loadingLabel="Logging out">
          {failed ? 'Try logging out again' : 'Log out'}
        </SubmitButton>
      </form>
    </div>
  )
}
