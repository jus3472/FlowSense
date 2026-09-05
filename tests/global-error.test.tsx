// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { fireEvent, render, screen } from '@testing-library/react'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { GlobalErrorContent } from '@/app/global-error'

describe('global error boundary', () => {
  it('keeps a valid root document shell', () => {
    const source = readFileSync('src/app/global-error.tsx', 'utf8')
    const result = ts.transpileModule(source, {
      fileName: 'global-error.tsx',
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    })
    const errors = (result.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )

    expect(errors).toEqual([])
    expect(source.match(/<html\b/g)).toHaveLength(1)
    expect(source.match(/<body\b/g)).toHaveLength(1)
    expect(source).toContain('<GlobalErrorContent reset={reset} />')
  })

  it('renders one error panel and invokes reset from Reload', () => {
    const reset = vi.fn()
    const { container } = render(<GlobalErrorContent reset={reset} />)

    expect(screen.getByRole('heading', { name: 'FlowSense did not load', level: 1 })).toBeVisible()
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('main > div')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reset).toHaveBeenCalledOnce()
  })
})
