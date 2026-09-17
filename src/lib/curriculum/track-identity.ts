import { PATH_SLUGS, type PathSlug } from '@/lib/curriculum/contracts'

export type TrackIconName = 'microphone' | 'briefcase' | 'presentation' | 'conversation'

export interface TrackIdentity {
  title: string
  description: string
  icon: TrackIconName
}

export const TRACK_IDENTITIES: Readonly<Record<PathSlug, TrackIdentity>> = Object.freeze({
  'general-speaking': {
    title: 'General Speaking',
    description: 'Build clear, focused responses for everyday speaking.',
    icon: 'microphone',
  },
  interviews: {
    title: 'Interviews',
    description: 'Answer questions directly with specific support.',
    icon: 'briefcase',
  },
  presentations: {
    title: 'Presentations',
    description: 'Structure ideas for a clear spoken delivery.',
    icon: 'presentation',
  },
  conversations: {
    title: 'Conversations',
    description: 'Respond naturally and keep ideas moving.',
    icon: 'conversation',
  },
})

export const TRACK_IDENTITY_LIST = Object.freeze(
  PATH_SLUGS.map((slug) => ({
    slug,
    ...TRACK_IDENTITIES[slug],
  })),
)
