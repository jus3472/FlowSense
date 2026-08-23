import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/auth-form'
import { MinimalHeader } from '@/components/layout/minimal-header'

export const metadata: Metadata = {
  title: 'Log in to FlowSense',
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MinimalHeader />
      <main className="max-w-column mx-auto w-full flex-1 px-4 py-12">
        <AuthForm />
      </main>
    </div>
  )
}
