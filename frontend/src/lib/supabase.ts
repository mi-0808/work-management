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
  hourly_rate: number // 時給（円）。0は給与制＝請求書フロー対象外
}

export type Invoice = {
  id: string
  member_id: string
  month: string // "YYYY-MM"
  minutes: number // 発行時の実働合計スナップショット
  hourly_rate: number
  expenses: { label: string; amount: number }[]
  status: 'issued' | 'paid'
  issued_at: string
  paid_at: string | null
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
  google_event_id?: string | null // Googleカレンダー同期済みイベントID（nullなら未同期）
  meet_url?: string | null
}

export type Report = {
  id: string
  member_id: string
  work_date: string
  body: string
  video: string | null // 動画提出のファイル名（あれば提出扱い）
  submitted_at: string
  // 稼働予定（シフト的な予定）とやること。未来日はこの3つだけでbody空の行になる
  plan: string | null
  planned_start: string | null // "HH:MM"
  planned_end: string | null
  confirmed: boolean // 本人が「確定」ボタンで固定した日。ponytail: 権限制御（管理者のみ解除等）はdocs/backlog.md

}

export type Goal = {
  id: string
  company_id: string
  member_id: string
  period_type: 'week' | 'month' | 'custom'
  due_date: string // YYYY-MM-DD
  title: string
  body: string | null
  status: 'open' | 'active' | 'done' | 'dropped' // open=未着手, active=実行中
  self_review: string | null
  reviewed_at: string | null
  google_event_id: string | null
  created_at: string
}

export type Announcement = {
  id: string
  company_id: string
  author_member_id: string
  body: string
  created_at: string
}

export type NextAction = {
  id: string
  company_id: string
  member_id: string
  title: string
  status: 'todo' | 'doing' | 'done' // 未着手・進行中・完了
  due_date: string | null
  note: string | null
  done_at: string | null
  google_event_id: string | null
  created_at: string
}

export type GoalEvaluation = {
  id: string
  goal_id: string
  evaluator_member_id: string
  rating: number | null // 1〜5
  comment: string
  created_at: string
}

export type FeedbackPost = {
  id: string
  company_id: string
  target_member_id: string
  author_member_id: string
  body: string
  created_at: string
}

export type MoneyProfile = {
  id: string
  member_id: string
  stance: 'president' | 'sole_proprietor' | 'part_time' | 'employee'
  wall_amount: number | null // 扶養の壁（年収の上限目安・円）。nullは未設定または対象外
  created_at: string
}

export type MoneyIncome = {
  id: string
  company_id: string
  member_id: string
  month: string // YYYY-MM
  label: string
  amount: number
  created_at: string
}

export type MoneyExpense = {
  id: string
  company_id: string
  member_id: string
  scope: 'company' | 'personal' // 会社に提出する経費 / 個人の出費
  occurred_on: string // YYYY-MM-DD
  label: string
  amount: number
  receipt_path: string | null // receiptsバケット内のパス（署名URLで閲覧）
  invoice_id: string | null // 稼働と請求への紐付け（任意）
  status: 'submitted' | 'approved' | 'rejected' // 会社提出分の承認状態（個人はapproved固定）
  store: string | null // OCRで読んだ店名
  address: string | null
  lat: number | null // マップ表示用（住所をジオコーディング）
  lng: number | null
  recurring_id: string | null // 固定費から自動生成された行
  created_at: string
}

export type MoneyRecurring = {
  id: string
  company_id: string
  member_id: string
  scope: 'company' | 'personal'
  label: string
  amount: number
  day_of_month: number // 1-28
  active: boolean
  created_at: string
}

export const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD ローカル日付
