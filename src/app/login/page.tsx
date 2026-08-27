import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/auth-form'
import { MinimalHeader } from '@/components/layout/minimal-header'
import type { AuthMode } from '@/lib/validation'

export const metadata: Metadata = {
  title: 'Log in to FlowSense',
}

interface LoginPageProps {
  searchParams: Promise<{ mode?: string | string[] }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const requestedMode = (await searchParams).mode
  const initialMode: AuthMode = requestedMode === 'login' ? 'login' : 'signup'

  return (
    <div className="flex min-h-dvh flex-col">
      <MinimalHeader />
      <main className="max-w-column mx-auto w-full flex-1 px-6 py-12">
        <AuthForm initialMode={initialMode} />
      </main>
    </div>
  )
}
