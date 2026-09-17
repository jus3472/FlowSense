import { CustomPromptForm } from '@/components/practice/custom-prompt-form'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'

export default async function CustomPracticePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error: errorCode } = await searchParams
  return (
    <PageShell width="column">
      <div className="flex flex-col gap-2">
        <p className="section-label text-muted">Custom practice</p>
        <PageTitle>Practice your own prompt</PageTitle>
      </div>
      <Card className="sm:p-8">
        <CustomPromptForm errorCode={errorCode} />
      </Card>
    </PageShell>
  )
}
