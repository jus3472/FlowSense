export type Segment =
  | { type: 'text'; text: string }
  | {
      type: 'highlight'
      text: string
      label: string
      details?: readonly string[]
    }
  | { type: 'marker'; text: string; label: string; details?: readonly string[] }
