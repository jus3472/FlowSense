export type DataOutcome<T> =
  { status: 'ready'; data: T } | { status: 'empty' } | { status: 'failure' }

export function dataReady<T>(data: T): DataOutcome<T> {
  return { status: 'ready', data }
}

export function dataEmpty<T>(): DataOutcome<T> {
  return { status: 'empty' }
}

export function dataFailure<T>(): DataOutcome<T> {
  return { status: 'failure' }
}
