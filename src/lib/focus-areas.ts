import type { PracticeMode } from '@/lib/practice/contracts'

export interface FocusArea {
  id: string
  label: string
  phrase: string
  mode: PracticeMode
}

/** Stable practice preferences. They guide prompt selection only, never scoring. */
export const FOCUS_AREAS: readonly FocusArea[] = [
  { id: 'interviews', label: 'Interviews', phrase: 'in interviews', mode: 'interview' },
  { id: 'presentations', label: 'Presentations', phrase: 'in presentations', mode: 'presentation' },
  {
    id: 'meetings-conversations',
    label: 'Meetings and conversations',
    phrase: 'in conversations',
    mode: 'conversation',
  },
  {
    id: 'difficult-conversations',
    label: 'Difficult conversations',
    phrase: 'in difficult conversations',
    mode: 'conversation',
  },
  {
    id: 'speaking-on-the-spot',
    label: 'Speaking on the spot',
    phrase: 'on the spot',
    mode: 'practice',
  },
  {
    id: 'general-speaking',
    label: 'General speaking ability',
    phrase: 'in everyday speaking',
    mode: 'practice',
  },
]
const LEGACY_IDS: Readonly<Record<string, string>> = {
  interviews: 'interviews',
  presentations: 'presentations',
  meetings: 'meetings-conversations',
  'difficult-conversations': 'difficult-conversations',
  confidence: 'speaking-on-the-spot',
  'speaking-english': 'general-speaking',
  class: 'general-speaking',
}
const BY_ID = new Map(FOCUS_AREAS.map((area) => [area.id, area]))
export function isFocusAreaId(value: string): boolean {
  return BY_ID.has(value)
}
/** Migrates old stored IDs, removes unknown values, and gives forms a stable order. */
export function sanitizeFocusAreas(values: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const id = LEGACY_IDS[value] ?? (isFocusAreaId(value) ? value : null)
    if (id) seen.add(id)
  }
  return FOCUS_AREAS.filter((area) => seen.has(area.id)).map((area) => area.id)
}
export function focusPhrase(selected: readonly string[]): string {
  const first = sanitizeFocusAreas(selected)[0]
  return (first && BY_ID.get(first)?.phrase) ?? 'in everyday speaking'
}
/** The first ordered preference chooses a fast-start mode; general practice is safe by default. */
export function defaultPracticeMode(selected: readonly string[]): PracticeMode {
  const first = sanitizeFocusAreas(selected)[0]
  return first ? (BY_ID.get(first)?.mode ?? 'practice') : 'practice'
}
/** Ordered mode priority lets server prompt selection stay deterministic and neutral. */
export function practiceModePriority(selected: readonly string[]): readonly PracticeMode[] {
  const modes = sanitizeFocusAreas(selected)
    .map((id) => BY_ID.get(id)?.mode)
    .filter((mode): mode is PracticeMode => Boolean(mode))
  return [...new Set<PracticeMode>([...modes, 'practice'])]
}
