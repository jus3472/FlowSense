import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'
import { OfflineBanner } from '@/components/system/offline-banner'
import { ThemeScript } from '@/components/theme/theme-script'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'FlowSense',
  description:
    'Answer one prompt out loud. FlowSense shows you where your point landed and where it went soft.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The head script mutates data-theme before React hydrates, which is a
    // deliberate mismatch with what the server rendered.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${inter.variable} ${jetBrainsMono.variable} bg-background min-h-dvh`}>
        <OfflineBanner />
        {children}
      </body>
    </html>
  )
}
