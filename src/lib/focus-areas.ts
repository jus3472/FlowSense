export interface FocusArea {
  id: string
  label: string
  /** Reads naturally after "how you sound". Used by empty state copy. */
  phrase: string
}

export const FOCUS_AREAS: readonly FocusArea[] = [
  { id: 'interviews', label: 'Interviews', phrase: 'in interviews' },
  { id: 'meetings', label: 'Meetings', phrase: 'in meetings' },
  { id: 'presentations', label: 'Presentations', phrase: 'in presentations' },
  { id: 'class', label: 'Class and seminars', phrase: 'in class' },
  {
    id: 'difficult-conversations',
    label: 'Difficult conversations',
    phrase: 'in a difficult conversation',
  },
  {
    id: 'speaking-english',
    label: 'Speaking English more fluently',
    phrase: 'when you speak English live',
  },
  { id: 'confidence', label: 'General confidence', phrase: 'when you are put on the spot' },
]

const BY_ID = new Map(FOCUS_AREAS.map((area) => [area.id, area]))

export function isFocusAreaId(value: string): boolean {
  return BY_ID.has(value)
}

/** Drops anything that is not a known area, so stored data cannot widen. */
export function sanitizeFocusAreas(values: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (isFocusAreaId(value)) seen.add(value)
  }
  return FOCUS_AREAS.filter((area) => seen.has(area.id)).map((area) => area.id)
}

/** The phrase for the first selected area, or a neutral fallback. */
export function focusPhrase(selected: readonly string[]): string {
  for (const id of selected) {
    const area = BY_ID.get(id)
    if (area) return area.phrase
  }
  return 'under pressure'
}
