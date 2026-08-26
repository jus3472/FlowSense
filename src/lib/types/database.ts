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

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type PracticeMode = 'practice' | 'interview' | 'presentation' | 'conversation'
export type PromptDifficulty = 'beginner' | 'intermediate' | 'advanced'
export type PromptSource = 'library' | 'custom'

export type ProfileRow = {
  id: string
  display_name: string | null
  focus_areas: string[]
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
  created_at: string
}

export type AttemptRow = {
  id: string
  user_id: string
  prompt_id: string | null
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
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
