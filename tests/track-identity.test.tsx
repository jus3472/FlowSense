// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrackIcon } from '@/components/curriculum/track-identity'
import { PATH_SLUGS } from '@/lib/curriculum/contracts'
import { TRACK_IDENTITIES, TRACK_IDENTITY_LIST } from '@/lib/curriculum/track-identity'

describe('Track identity', () => {
  it('provides one canonical ordered identity for every Track', () => {
    expect(TRACK_IDENTITY_LIST.map((track) => track.slug)).toEqual(PATH_SLUGS)
    expect(TRACK_IDENTITY_LIST.map((track) => track.title)).toEqual([
      'General Speaking',
      'Interviews',
      'Presentations',
      'Conversations',
    ])
    for (const track of TRACK_IDENTITY_LIST) {
      expect(track).toMatchObject(TRACK_IDENTITIES[track.slug])
      expect(track.description.length).toBeGreaterThan(0)
    }
  })

  it('renders one decorative icon for each canonical Track', () => {
    const { container } = render(
      <div>
        {PATH_SLUGS.map((slug) => (
          <TrackIcon key={slug} slug={slug} />
        ))}
      </div>,
    )

    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4)
    for (const slug of PATH_SLUGS) {
      expect(container.querySelector(`[data-track-icon="${slug}"]`)).toBeInTheDocument()
    }
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
