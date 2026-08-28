import type { Stars } from '@/lib/curriculum/contracts'

export function CurriculumStars({ stars }: { stars: Stars }) {
  return (
    <span className="inline-flex whitespace-nowrap" aria-label={`${stars} of 3 stars`} role="img">
      <span aria-hidden="true" className="text-accent">
        {'★'.repeat(stars)}
      </span>
      <span aria-hidden="true" className="text-muted">
        {'☆'.repeat(3 - stars)}
      </span>
    </span>
  )
}
