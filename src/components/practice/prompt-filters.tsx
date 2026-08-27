import Link from 'next/link'
import { PROMPT_DIFFICULTIES, type PracticeMode } from '@/lib/practice/contracts'
import { collectionLabel, practiceBrowseHref } from '@/lib/practice/navigation'
import type { PromptCollection } from '@/lib/prompts/selection'
import { cn } from '@/lib/utils'

const FILTER_CLASSES =
  'flex min-h-11 items-center rounded-full px-6 text-sm font-medium transition-colors'

function filterClasses(selected: boolean): string {
  return cn(
    FILTER_CLASSES,
    selected
      ? 'bg-accent text-accent-fg'
      : 'bg-surface-sunken text-foreground hover:bg-accent-soft',
  )
}

interface PromptFiltersProps {
  mode: PracticeMode
  difficulty?: (typeof PROMPT_DIFFICULTIES)[number]
  collectionId?: string
  collections: readonly PromptCollection[]
}

export function PromptFilters({ mode, difficulty, collectionId, collections }: PromptFiltersProps) {
  const selectedCollectionIsListed = collections.some(
    (collection) => collection.id === collectionId,
  )

  return (
    <div className="flex flex-col gap-6">
      <nav aria-labelledby="difficulty-heading" className="flex flex-col gap-3">
        <h2 id="difficulty-heading" className="section-label text-muted">
          Difficulty
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href={practiceBrowseHref(mode, { collectionId })}
            aria-current={difficulty === undefined ? 'page' : undefined}
            className={filterClasses(difficulty === undefined)}
          >
            All levels
          </Link>
          {PROMPT_DIFFICULTIES.map((option) => {
            const selected = difficulty === option
            return (
              <Link
                key={option}
                href={practiceBrowseHref(mode, { difficulty: option, collectionId })}
                aria-current={selected ? 'page' : undefined}
                className={filterClasses(selected)}
              >
                {option.slice(0, 1).toUpperCase() + option.slice(1)}
              </Link>
            )
          })}
        </div>
      </nav>

      {collections.length > 0 || collectionId ? (
        <nav aria-labelledby="collections-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h2 id="collections-heading" className="section-label text-muted">
              Collections
            </h2>
            {collectionId ? (
              <Link
                href={practiceBrowseHref(mode, { difficulty })}
                className="text-accent min-h-11 py-3 text-sm font-medium hover:underline"
              >
                Clear collection
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={practiceBrowseHref(mode, { difficulty })}
              aria-current={collectionId === undefined ? 'page' : undefined}
              className={filterClasses(collectionId === undefined)}
            >
              All collections
            </Link>
            {collectionId && !selectedCollectionIsListed ? (
              <Link
                href={practiceBrowseHref(mode, { difficulty, collectionId })}
                aria-current="page"
                className={filterClasses(true)}
              >
                {collectionLabel(collectionId)}
              </Link>
            ) : null}
            {collections.map((collection) => {
              const selected = collectionId === collection.id
              return (
                <Link
                  key={collection.id}
                  href={practiceBrowseHref(mode, {
                    difficulty,
                    collectionId: collection.id,
                  })}
                  aria-current={selected ? 'page' : undefined}
                  className={filterClasses(selected)}
                >
                  {collectionLabel(collection.id)}
                </Link>
              )
            })}
          </div>
        </nav>
      ) : null}
    </div>
  )
}
