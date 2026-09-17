import type { ComponentProps } from 'react'
import { FIELD_CONTROL_CLASS } from '@/components/ui/text-field'
import { cn } from '@/lib/utils'

export const SELECT_CONTROL_CLASS = `${FIELD_CONTROL_CLASS} w-full cursor-pointer appearance-none pr-12`

export function SelectControl({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select {...props} className={cn(SELECT_CONTROL_CLASS, className)}>
        {children}
      </select>
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="text-muted pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2"
        fill="currentColor"
      >
        <path d="M5.3 7.3 10 12l4.7-4.7-1.4-1.4L10 9.2 6.7 5.9z" />
      </svg>
    </div>
  )
}
