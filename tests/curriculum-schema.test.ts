import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/migrations/20260828000100_curriculum_schema.sql', 'utf8')
const seed = readFileSync('supabase/migrations/20260828000200_curriculum_seed.sql', 'utf8')
const backfill = readFileSync(
  'supabase/migrations/20260828000300_path_preferences_backfill.sql',
  'utf8',
)
const activity = readFileSync('supabase/migrations/20260828000400_practice_activity.sql', 'utf8')

const NAMESPACE = 'c8f6a2e4-2d9b-5a1c-8e73-1f4b6d9a2057'

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll('-', ''), 'hex')
}

function uuidV5(name: string): string {
  const digest = createHash('sha1')
    .update(Buffer.concat([uuidBytes(NAMESPACE), Buffer.from(name)]))
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const hex = digest.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

function required(value: string | undefined): string {
  if (value === undefined) throw new Error('Curriculum seed row did not match its schema.')
  return value
}

const pathRows = [
  ...seed.matchAll(
    /^  \('([0-9a-f-]+)'::uuid, '(general-speaking|interviews|presentations|conversations)', '([^']+)', '(practice|interview|presentation|conversation)', ([1-4]), true\),?$/gm,
  ),
].map(([, id, slug, title, mode, position]) => ({
  id: required(id),
  slug: required(slug),
  title: required(title),
  mode: required(mode),
  position: Number(required(position)),
}))

const chapterRows = [
  ...seed.matchAll(
    /^  \('([0-9a-f-]+)'::uuid, '([0-9a-f-]+)'::uuid, '(beginner|intermediate|advanced)', '([^']+)', ([1-3]), true\),?$/gm,
  ),
].map(([, id, pathId, level, title, position]) => ({
  id: required(id),
  pathId: required(pathId),
  level: required(level),
  title: required(title),
  position: Number(required(position)),
}))

const promptRows = [
  ...seed.matchAll(
    /^  \('([0-9a-f-]+)'::uuid, '(.+)', true, '(practice|interview|presentation|conversation)', '(beginner|intermediate|advanced)', (30|45|60), null, false\),?$/gm,
  ),
].map(([, id, text, mode, level, duration]) => ({
  id: required(id),
  text: required(text),
  mode: required(mode),
  level: required(level),
  duration: Number(required(duration)),
}))

const lessonRows = [
  ...seed.matchAll(
    /^  \('([0-9a-f-]+)'::uuid, '([0-9a-f-]+)'::uuid, '([^']+)', '([^']+)', '([^']+)', (\d+), (true|false), '([0-9a-f-]+)'::uuid, true\),?$/gm,
  ),
].map(([, id, chapterId, slug, title, skillFocus, position, checkpoint, promptId]) => ({
  id: required(id),
  chapterId: required(chapterId),
  slug: required(slug),
  title: required(title),
  skillFocus: required(skillFocus),
  position: Number(required(position)),
  checkpoint: checkpoint === 'true',
  promptId: required(promptId),
}))

describe('curriculum schema and stable seed', () => {
  it('creates the normalized additive schema without storing derived progression state', () => {
    for (const table of [
      'practice_paths',
      'practice_chapters',
      'practice_lessons',
      'profile_path_preferences',
      'lesson_progress',
    ]) {
      expect(schema).toContain(`create table public.${table}`)
      expect(schema).toContain(`alter table public.${table} enable row level security`)
    }
    expect(schema).toContain(
      'add column if not exists free_practice_visible boolean not null default true',
    )
    expect(schema).toMatch(
      /add column if not exists lesson_id uuid\s+references public\.practice_lessons/,
    )
    expect(schema).not.toMatch(/\b(stars|passed|unlocked|chapter_totals)\b/)
  })

  it('seeds four paths, twelve chapters, and exactly ten lessons per chapter', () => {
    expect(pathRows).toHaveLength(4)
    expect(chapterRows).toHaveLength(12)
    expect(promptRows).toHaveLength(120)
    expect(lessonRows).toHaveLength(120)
    expect(new Set(lessonRows.map((row) => row.slug)).size).toBe(120)
    expect(new Set(lessonRows.map((row) => row.promptId)).size).toBe(120)

    for (const chapter of chapterRows) {
      const lessons = lessonRows.filter((lesson) => lesson.chapterId === chapter.id)
      expect(lessons.map((lesson) => lesson.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect(
        lessons.filter((lesson) => lesson.checkpoint).map((lesson) => lesson.position),
      ).toEqual([10])
    }
  })

  it('uses the frozen slugs, modes, levels, durations, and UUIDv5 names', () => {
    expect(pathRows.map(({ slug, mode }) => [slug, mode])).toEqual([
      ['general-speaking', 'practice'],
      ['interviews', 'interview'],
      ['presentations', 'presentation'],
      ['conversations', 'conversation'],
    ])

    const pathById = new Map(pathRows.map((path) => [path.id, path]))
    const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]))
    const promptById = new Map(promptRows.map((prompt) => [prompt.id, prompt]))
    for (const path of pathRows) {
      expect(path.id).toBe(uuidV5(`flowsense:curriculum:v1:path:${path.slug}`))
    }
    for (const chapter of chapterRows) {
      const path = pathById.get(chapter.pathId)
      expect(path).toBeDefined()
      expect(chapter.id).toBe(
        uuidV5(`flowsense:curriculum:v1:chapter:${path?.slug}:${chapter.level}`),
      )
    }
    for (const lesson of lessonRows) {
      const chapter = chapterById.get(lesson.chapterId)
      const path = chapter ? pathById.get(chapter.pathId) : undefined
      const prompt = promptById.get(lesson.promptId)
      expect(path).toBeDefined()
      expect(prompt).toBeDefined()
      const number = String(lesson.position).padStart(2, '0')
      expect(lesson.slug).toMatch(
        new RegExp(`^${path?.slug}-${chapter?.level}-${number}-[a-z0-9-]+$`),
      )
      expect(lesson.id).toBe(
        uuidV5(
          `flowsense:curriculum:v1:lesson:${path?.slug}:${chapter?.level}:${number}:${lesson.slug}`,
        ),
      )
      expect(lesson.promptId).toBe(
        uuidV5(
          `flowsense:curriculum:v1:prompt:${path?.slug}:${chapter?.level}:${number}:${lesson.slug}`,
        ),
      )
      expect(prompt?.mode).toBe(path?.mode)
      expect(prompt?.level).toBe(chapter?.level)
      expect([30, 45, 60]).toContain(prompt?.duration)
      expect(lesson.title.trim()).not.toBe('')
      expect(lesson.skillFocus.trim()).not.toBe('')
      expect(prompt?.text.trim()).not.toBe('')
    }
  })

  it('keeps seed and backfill repeat-safe and curriculum prompts out of Free Practice', () => {
    expect(seed.match(/on conflict \(id\) do update set/g)).toHaveLength(4)
    expect(seed).toContain('free_practice_visible = excluded.free_practice_visible')
    expect(promptRows.every((prompt) => prompt.text.length > 0)).toBe(true)
    expect(backfill).toContain('where not exists (')
    expect(backfill).toContain('on conflict (user_id, path_id) do nothing')
    expect(backfill).not.toMatch(/update public\.profiles|set focus_areas/)
  })

  it('keeps progress and preference mutation behind trusted boundaries', () => {
    expect(schema).toContain('create or replace function public.replace_profile_path_preferences')
    expect(schema).toContain('path_count < 1 or path_count > 4')
    expect(schema).toContain('create or replace function public.raise_lesson_progress_from_attempt')
    expect(schema).toContain(
      'create or replace function public.is_valid_v2_score_payload_for_attempt',
    )
    expect(schema).toContain("payload ->> 'version' is distinct from 'v2.score.1'")
    expect(schema).toContain("(item.value ->> 'max_points')::numeric <> expected_max")
    expect(schema).toContain('earned <> round(component * expected_max)')
    expect(schema).toContain('category_count <> 6')
    expect(schema).toContain('new.section_scores,')
    expect(activity).toContain('public.is_valid_v2_score_payload_for_attempt(')
    expect(activity).toContain('attempt_score,')
    expect(activity).toContain('false')
    expect(schema).toMatch(
      /update of status, score, section_scores, practice_mode, prompt_id, lesson_id, rubric_version/,
    )
    expect(schema).toContain('new.best_score < old.best_score')
    expect(schema).toContain('excluded.best_attempt_id > lesson_progress.best_attempt_id')
    expect(schema).toContain('references public.attempts (id) on delete set null')
    expect(schema).toContain('revoke insert, update, delete on public.lesson_progress')
    expect(schema).toContain('create policy "lesson_progress_select_own"')
    expect(schema).not.toContain('create policy "lesson_progress_insert_own"')
    expect(schema).toContain('practice_paths_enforce_identity')
    expect(schema).toContain('practice_chapters_enforce_identity')
    expect(schema).toContain('practice_lessons_enforce_identity')
  })

  it('maps legacy focus areas in canonical order and gives future users General Speaking', () => {
    for (const focus of [
      'interviews',
      'presentations',
      'meetings',
      'meetings-conversations',
      'difficult-conversations',
      'confidence',
      'speaking-english',
      'class',
    ]) {
      expect(backfill).toContain(`'${focus}'`)
    }
    expect(backfill).toContain("when cardinality(profile.focus_areas) = 0 then array['']::text[]")
    expect(backfill).toContain('order by deduplicated.canonical_position')
    expect(backfill).toContain("where path.slug = 'general-speaking' and path.active")
  })
})
