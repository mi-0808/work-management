import { createClient } from '@supabase/supabase-js'

// publishableキーは公開前提の値なのでフォールバックを直書きしてOK
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'https://mqnbptyufvbktlirzzrr.supabase.co',
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_lg_RRTGRh_aT-eTT_hydeA_U07NQAqi',
)

export type Member = {
  id: string
  company_id: string
  user_id: string | null
  name: string
  email: string
  member_type: 'internal' | 'external'
  role: 'admin' | 'member'
  status: 'invited' | 'active' | 'disabled'
  work_start: string // "HH:MM:SS"
  work_end: string
}

export type Attendance = {
  id: string
  member_id: string
  work_date: string
  clock_in: string | null
  clock_out: string | null
  auto_in: boolean
  auto_out: boolean
  plan: string | null
}

export type Schedule = {
  id: string
  company_id: string
  member_id: string | null
  title: string
  starts_at: string
  ends_at: string
  kind: 'shift' | 'event'
  with_meet: boolean
}

export type Report = {
  id: string
  member_id: string
  work_date: string
  body: string
  submitted_at: string
}

export const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD ローカル日付
