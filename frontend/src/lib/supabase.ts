import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DEMO, demoClient } from './demo'

// publishableキーは公開前提の値なのでフォールバックを直書きしてOK
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://mqnbptyufvbktlirzzrr.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_lg_RRTGRh_aT-eTT_hydeA_U07NQAqi'

// /demo ではインメモリのモックに差し替える（demo.tsはこのファイルから型のみimportなので循環しない）
export const supabase = DEMO
  ? (demoClient as unknown as SupabaseClient)
  : createClient(SUPABASE_URL, SUPABASE_KEY)

// 有効なOAuthプロバイダを問い合わせる。未設定のプロバイダに遷移すると
// Supabaseが素のJSONエラーを返して戻れなくなるため、事前に確認して出し分ける
export const isProviderEnabled = async (provider: string) => {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
    const settings = await res.json()
    return settings?.external?.[provider] === true
  } catch {
    return false
  }
}

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
  plan_video: string | null // 動画提出のファイル名（あれば提出扱い）
  breaks?: Break[]
}

export type Break = {
  id: string
  attendance_id: string
  started_at: string
  ended_at: string | null
  note: string | null
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
  status: 'proposed' | 'confirmed' | 'declined'
  proposed_by: string | null // 最後に提案した人
  to_member_id: string | null // 提案の宛先（承認・修正できるのはこの人だけ）
}

export type Report = {
  id: string
  member_id: string
  work_date: string
  body: string
  video: string | null // 動画提出のファイル名（あれば提出扱い）
  submitted_at: string
}

export const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD ローカル日付
