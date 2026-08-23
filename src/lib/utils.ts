type ClassValue = string | false | null | undefined

/** Joins class names, dropping anything falsy. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}

/** One item at random, or undefined when there is nothing to choose from. */
export function pickRandom<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(Math.random() * items.length)]
}
