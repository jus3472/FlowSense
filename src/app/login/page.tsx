import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/auth-form'
import { MinimalHeader } from '@/components/layout/minimal-header'
import { Card } from '@/components/ui/card'
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
      <main className="max-w-form mx-auto flex w-full flex-1 items-start px-4 py-12 sm:px-0 sm:py-16">
        <Card className="w-full p-6 sm:p-8">
          <AuthForm initialMode={initialMode} />
        </Card>
      </main>
    </div>
  )
}
