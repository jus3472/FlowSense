/**
 * Hand written to match `supabase/migrations`. The scoring payloads stay `Json`
 * on purpose: `metrics`, `section_scores`, and `content_result` are jsonb so the
 * scoring model can change during tuning without a migration each time. Later
 * prompts add narrow parsed types on top of these columns.
 *
 * These are type aliases rather than interfaces on purpose. Supabase constrains
 * each row to `Record<string, unknown>`, and only type aliases pick up the
 * implicit index signature that satisfies it. As interfaces, every query
 * resolves to `never`.
 */

import type { PracticeMode, PromptDifficulty, PromptSource } from '@/lib/practice/contracts'
import type { AttemptStatus } from '@/lib/attempts/lifecycle'

export type { PracticeMode, PromptDifficulty, PromptSource } from '@/lib/practice/contracts'

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type ProfileRow = {
  id: string
  display_name: string | null
  focus_areas: string[]
  timezone: string | null
  created_at: string
}

export type PromptRow = {
  id: string
  text: string
  active: boolean
  mode: PracticeMode
  difficulty: PromptDifficulty
  target_duration_seconds: number
  collection_id: string | null
  free_practice_visible: boolean
  created_at: string
}

export type PracticePathRow = {
  id: string
  slug: string
  title: string
  mode: PracticeMode
  position: number
  active: boolean
  created_at: string
}

export type PracticeChapterRow = {
  id: string
  path_id: string
  level: PromptDifficulty
  title: string
  position: number
  active: boolean
  created_at: string
}

export type PracticeLessonRow = {
  id: string
  chapter_id: string
  slug: string
  title: string
  skill_focus: string
  position: number
  checkpoint: boolean
  prompt_id: string
  active: boolean
  created_at: string
}

export type AttemptRow = {
  id: string
  user_id: string
  prompt_id: string | null
  lesson_id: string | null
  prompt_text: string
  audio_path: string | null
  transcript: string | null
  duration_ms: number | null
  score: number | null
  section_scores: Json | null
  metrics: Json | null
  content_result: Json | null
  practice_mode: PracticeMode | null
  prompt_source: PromptSource | null
  prompt_difficulty: PromptDifficulty | null
  rubric_version: string | null
  retry_of_attempt_id: string | null
  status: AttemptStatus
  status_changed_at: string
  finished_at: string | null
  failure_code: string | null
  client_request_id: string | null
  created_at: string
}

export type NoteFeedbackRow = {
  id: string
  user_id: string
  attempt_id: string
  note_type: string
  quote: string | null
  created_at: string
}

export type ProfilePathPreferenceRow = {
  user_id: string
  path_id: string
  rank: number
  created_at: string
  updated_at: string
}

export type LessonProgressRow = {
  user_id: string
  lesson_id: string
  best_score: number
  best_attempt_id: string | null
  created_at: string
  updated_at: string
}

export type PracticeActivityDayRow = {
  user_id: string
  local_date: string
  timezone: string
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: Partial<Omit<ProfileRow, 'id'>> & { id: string }
        Update: Partial<Omit<ProfileRow, 'id' | 'created_at'>>
        Relationships: []
      }
      prompts: {
        Row: PromptRow
        Insert: Partial<Omit<PromptRow, 'text'>> & { text: string }
        Update: Partial<Omit<PromptRow, 'id' | 'created_at'>>
        Relationships: []
      }
      practice_paths: {
        Row: PracticePathRow
        Insert: Partial<Omit<PracticePathRow, 'id' | 'slug' | 'title' | 'mode' | 'position'>> & {
          id: string
          slug: string
          title: string
          mode: PracticeMode
          position: number
        }
        Update: Partial<Omit<PracticePathRow, 'id' | 'created_at'>>
        Relationships: []
      }
      practice_chapters: {
        Row: PracticeChapterRow
        Insert: Partial<
          Omit<PracticeChapterRow, 'id' | 'path_id' | 'level' | 'title' | 'position'>
        > & {
          id: string
          path_id: string
          level: PromptDifficulty
          title: string
          position: number
        }
        Update: Partial<Omit<PracticeChapterRow, 'id' | 'created_at'>>
        Relationships: []
      }
      practice_lessons: {
        Row: PracticeLessonRow
        Insert: Partial<
          Omit<
            PracticeLessonRow,
            'id' | 'chapter_id' | 'slug' | 'title' | 'skill_focus' | 'position' | 'prompt_id'
          >
        > & {
          id: string
          chapter_id: string
          slug: string
          title: string
          skill_focus: string
          position: number
          prompt_id: string
        }
        Update: Partial<Omit<PracticeLessonRow, 'id' | 'created_at'>>
        Relationships: []
      }
      attempts: {
        Row: AttemptRow
        Insert: Partial<Omit<AttemptRow, 'user_id' | 'prompt_text'>> & {
          user_id: string
          prompt_text: string
        }
        Update: Partial<Omit<AttemptRow, 'id' | 'user_id' | 'created_at'>>
        Relationships: []
      }
      note_feedback: {
        Row: NoteFeedbackRow
        Insert: Partial<Omit<NoteFeedbackRow, 'user_id' | 'attempt_id' | 'note_type'>> & {
          user_id: string
          attempt_id: string
          note_type: string
        }
        Update: Partial<Omit<NoteFeedbackRow, 'id' | 'user_id' | 'created_at'>>
        Relationships: []
      }
      profile_path_preferences: {
        Row: ProfilePathPreferenceRow
        Insert: Partial<Omit<ProfilePathPreferenceRow, 'user_id' | 'path_id' | 'rank'>> & {
          user_id: string
          path_id: string
          rank: number
        }
        Update: Partial<Omit<ProfilePathPreferenceRow, 'user_id' | 'path_id' | 'created_at'>>
        Relationships: []
      }
      lesson_progress: {
        Row: LessonProgressRow
        Insert: Partial<Omit<LessonProgressRow, 'user_id' | 'lesson_id' | 'best_score'>> & {
          user_id: string
          lesson_id: string
          best_score: number
        }
        Update: Partial<Omit<LessonProgressRow, 'user_id' | 'lesson_id' | 'created_at'>>
        Relationships: []
      }
      practice_activity_days: {
        Row: PracticeActivityDayRow
        Insert: Partial<Omit<PracticeActivityDayRow, 'user_id' | 'local_date'>> & {
          user_id: string
          local_date: string
        }
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      replace_profile_path_preferences: {
        Args: { path_ids: string[] }
        Returns: undefined
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
