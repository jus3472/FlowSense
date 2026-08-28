import type { Route } from 'next'
import type { PathSlug } from '@/lib/curriculum/contracts'

export function curriculumPathHref(pathSlug: PathSlug): Route {
  return `/practice/paths/${pathSlug}` as Route
}

export function curriculumLessonHref(pathSlug: PathSlug, lessonSlug: string): Route {
  return `/practice/paths/${pathSlug}/lessons/${encodeURIComponent(lessonSlug)}` as Route
}
