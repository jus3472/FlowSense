import type { ComponentType, SVGProps } from 'react'
import type { PathSlug } from '@/lib/curriculum/contracts'
import { TRACK_IDENTITIES, type TrackIconName } from '@/lib/curriculum/track-identity'
import { cn } from '@/lib/utils'

type TrackIconComponent = ComponentType<SVGProps<SVGSVGElement>>

function IconFrame({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

function GeneralSpeakingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconFrame {...props}>
      <path d="M7.5 9.5v5a4.5 4.5 0 0 0 9 0v-5a4.5 4.5 0 0 0-9 0Z" />
      <path d="M5 14.5a7 7 0 0 0 14 0M12 21.5v-3" />
    </IconFrame>
  )
}

function InterviewsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconFrame {...props}>
      <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M4.5 7h15A1.5 1.5 0 0 1 21 8.5v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9A1.5 1.5 0 0 1 4.5 7Z" />
      <path d="M3 12.5c2.8 1.2 5.8 1.8 9 1.8s6.2-.6 9-1.8M10.5 13.8v1.5h3v-1.5" />
    </IconFrame>
  )
}

function PresentationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconFrame {...props}>
      <path d="M4 4.5h16v11H4zM8 20l4-4.5 4 4.5M12 4.5V2.5" />
      <path d="m7.5 12 2.8-3 2.4 2 3.8-4" />
    </IconFrame>
  )
}

function ConversationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconFrame {...props}>
      <path d="M4 5.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4.5 3v-3.2A2 2 0 0 1 2 12.5v-5a2 2 0 0 1 2-2Z" />
      <path d="M17 9.5h3a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5V20l-3.5-2.5h-3a2 2 0 0 1-1.9-1.4" />
    </IconFrame>
  )
}

const TRACK_ICONS: Record<TrackIconName, TrackIconComponent> = {
  microphone: GeneralSpeakingIcon,
  briefcase: InterviewsIcon,
  presentation: PresentationsIcon,
  conversation: ConversationsIcon,
}

export function TrackIcon({ slug, className }: { slug: PathSlug; className?: string }) {
  const Icon = TRACK_ICONS[TRACK_IDENTITIES[slug].icon]
  return <Icon data-track-icon={slug} className={cn('size-6', className)} />
}
