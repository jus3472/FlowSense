import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/auth-form'
import { MinimalHeader } from '@/components/layout/minimal-header'
import { Card } from '@/components/ui/card'
import type { AuthMode } from '@/lib/validation'

interface LoginPageProps {
  searchParams: Promise<{ mode?: string | string[]; oauth?: string | string[] }>
}

function authMode(requestedMode: string | string[] | undefined): AuthMode {
  return requestedMode === 'login' ? 'login' : 'signup'
}

export async function generateMetadata({ searchParams }: LoginPageProps): Promise<Metadata> {
  const initialMode = authMode((await searchParams).mode)
  return {
    title: initialMode === 'login' ? 'Log in to FlowSense' : 'Create your FlowSense account',
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams
  const initialMode = authMode(query.mode)
  const initialOAuthError = query.oauth === 'failed'

  return (
    <div className="flex min-h-dvh flex-col">
      <MinimalHeader />
      <main className="max-w-form mx-auto flex w-full flex-1 items-start px-4 py-12 sm:px-0 sm:py-16">
        <Card className="w-full p-6 sm:p-8">
          <AuthForm initialMode={initialMode} initialOAuthError={initialOAuthError} />
        </Card>
      </main>
    </div>
  )
}
