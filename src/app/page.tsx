import { MarketingHeader } from '@/components/layout/marketing-header'
import { Hero } from '@/components/marketing/hero'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { ResultMock } from '@/components/marketing/result-mock'
import { WhoItsFor } from '@/components/marketing/who-its-for'

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />
      <main className="max-w-column mx-auto w-full flex-1 px-6">
        <Hero />
        <HowItWorks />
        <ResultMock />
        <WhoItsFor />
      </main>
      <MarketingFooter />
    </div>
  )
}
