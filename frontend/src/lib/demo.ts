// /demo 用のインメモリSupabaseモック。リロードで初期化される
import type { Attendance, Break, Member, Report, Schedule } from './supabase'

export const DEMO = location.pathname.startsWith('/demo')

const today = () => new Date().toLocaleDateString('sv-SE')
const dayOffset = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE')
}
const at = (date: string, h: number, m = 0) => {
  const d = new Date(date + 'T00:00:00')
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const COMPANY = { id: 'c1', name: 'ひまわり事務機', icon: '🌻', join_code: 'DEMO01' }

export const DEMO_MEMBERS: Member[] = [
  { id: 'm1', company_id: 'c1', user_id: 'u1', name: '高橋 誠', email: 'takahashi@example.com', member_type: 'internal', role: 'admin', status: 'active', work_start: '09:00:00', work_end: '18:00:00' },
  { id: 'm2', company_id: 'c1', user_id: 'u2', name: '佐藤 美咲', email: 'sato@example.com', member_type: 'internal', role: 'member', status: 'active', work_start: '09:00:00', work_end: '18:00:00' },
  { id: 'm3', company_id: 'c1', user_id: 'u3', name: '田中 健太', email: 'tanaka@example.com', member_type: 'internal', role: 'member', status: 'active', work_start: '10:00:00', work_end: '19:00:00' },
  { id: 'm4', company_id: 'c1', user_id: 'u4', name: '鈴木 花子', email: 'suzuki@example.com', member_type: 'external', role: 'member', status: 'active', work_start: '09:30:00', work_end: '16:30:00' },
  { id: 'm5', company_id: 'c1', user_id: null, name: '山本 大輔', email: 'yamamoto@example.com', member_type: 'internal', role: 'member', status: 'invited', work_start: '09:00:00', work_end: '18:00:00' },
]

let seq = 0
const uid = () => `demo-${++seq}`

const PLANS = ['見積書の作成、14時から取引先訪問', '在庫棚卸しと発注処理', '新規顧客リストの整理', '月次請求書の発行', '倉庫の入荷検品']

const attendances: Attendance[] = []
const breaks: Break[] = []
// 過去5営業日 + 今日（今日は勤務中の人と未出勤の人を混ぜる）
for (const [mi, m] of DEMO_MEMBERS.slice(0, 4).entries()) {
  for (let i = 5; i >= 1; i--) {
    const d = dayOffset(-i)
    if (new Date(d + 'T00:00:00').getDay() % 6 === 0) continue // 土日スキップ
    const a: Attendance = {
      id: uid(), member_id: m.id, work_date: d,
      clock_in: at(d, 9 + (mi % 2), (mi * 7) % 30),
      clock_out: at(d, 18, (mi * 11) % 45),
      auto_in: i === 3 && mi === 2, auto_out: false,
      plan: PLANS[(mi + i) % PLANS.length],
    }
    attendances.push(a)
    if (i % 2 === 0) breaks.push({ id: uid(), attendance_id: a.id, started_at: at(d, 12), ended_at: at(d, 13), note: null })
  }
}
// 今日: 高橋・佐藤は勤務中、田中は中抜け中
for (const [mi, m] of DEMO_MEMBERS.slice(0, 3).entries()) {
  const a: Attendance = {
    id: uid(), member_id: m.id, work_date: today(),
    clock_in: at(today(), 9, mi * 5), clock_out: null,
    auto_in: false, auto_out: false, plan: PLANS[mi],
  }
  attendances.push(a)
  if (mi === 2) breaks.push({ id: uid(), attendance_id: a.id, started_at: new Date(Date.now() - 20 * 60000).toISOString(), ended_at: null, note: null })
}

const daily_reports: Report[] = DEMO_MEMBERS.slice(0, 4).flatMap((m, mi) =>
  [3, 2, 1].map((i) => ({
    id: uid(), member_id: m.id, work_date: dayOffset(-i),
    body: `${PLANS[(mi + i) % PLANS.length]}を完了。特に問題なし。`,
    submitted_at: at(dayOffset(-i), 18, 30),
  })))

const schedules: Schedule[] = [
  { id: uid(), company_id: 'c1', member_id: 'm1', title: '定例MTG', starts_at: at(today(), 10), ends_at: at(today(), 11), kind: 'event', with_meet: true },
  { id: uid(), company_id: 'c1', member_id: 'm2', title: '取引先訪問', starts_at: at(today(), 14), ends_at: at(today(), 16), kind: 'event', with_meet: false },
  { id: uid(), company_id: 'c1', member_id: 'm3', title: '1on1', starts_at: at(dayOffset(1), 15), ends_at: at(dayOffset(1), 15, 30), kind: 'event', with_meet: true },
  { id: uid(), company_id: 'c1', member_id: 'm1', title: '採用面接', starts_at: at(dayOffset(2), 13), ends_at: at(dayOffset(2), 14), kind: 'event', with_meet: true },
]

const tables: Record<string, Record<string, unknown>[]> = {
  companies: [COMPANY],
  members: DEMO_MEMBERS as unknown as Record<string, unknown>[],
  attendances: attendances as unknown as Record<string, unknown>[],
  breaks: breaks as unknown as Record<string, unknown>[],
  daily_reports: daily_reports as unknown as Record<string, unknown>[],
  schedules: schedules as unknown as Record<string, unknown>[],
}

type Row = Record<string, unknown>
type Op = { kind: 'select' } | { kind: 'insert'; values: Row } | { kind: 'update'; patch: Row } | { kind: 'upsert'; values: Row; conflict: string[] }

// 本アプリで使うチェーンだけ実装した最小クエリビルダ
class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: ((r: Row) => boolean)[] = []
  private orderBy: { col: string; asc: boolean } | null = null
  private limitN: number | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private embedBreaks = false
  private op: Op = { kind: 'select' }

  private table: string
  constructor(table: string) { this.table = table }

  select(cols = '*') { this.embedBreaks = cols.includes('breaks'); return this }
  insert(values: Row) { this.op = { kind: 'insert', values }; return this }
  update(patch: Row) { this.op = { kind: 'update', patch }; return this }
  upsert(values: Row, opts?: { onConflict?: string }) {
    this.op = { kind: 'upsert', values, conflict: (opts?.onConflict ?? 'id').split(',') }
    return this
  }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this }
  is(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this }
  gte(col: string, v: string) { this.filters.push((r) => String(r[col]) >= v); return this }
  lt(col: string, v: string) { this.filters.push((r) => String(r[col]) < v); return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending !== false }; return this }
  limit(n: number) { this.limitN = n; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }

  private run(): { data: unknown; error: null } {
    const rows = tables[this.table] ?? []
    const match = (r: Row) => this.filters.every((f) => f(r))

    if (this.op.kind === 'insert') {
      const row: Row = { id: uid(), auto_in: false, auto_out: false, note: null, ...this.op.values }
      if (this.table === 'breaks') row.started_at ??= new Date().toISOString()
      if (this.table === 'breaks') row.ended_at ??= null
      rows.push(row)
      return { data: row, error: null }
    }
    if (this.op.kind === 'update') {
      for (const r of rows) if (match(r)) Object.assign(r, this.op.patch)
      return { data: null, error: null }
    }
    if (this.op.kind === 'upsert') {
      const { values, conflict } = this.op
      const hit = rows.find((r) => conflict.every((c) => r[c] === values[c]))
      if (hit) Object.assign(hit, values)
      else rows.push({ id: uid(), auto_in: false, auto_out: false, ...values })
      return { data: null, error: null }
    }

    let out = rows.filter(match).map((r) => ({ ...r }))
    if (this.embedBreaks && this.table === 'attendances') {
      for (const a of out) a.breaks = tables.breaks.filter((b) => b.attendance_id === a.id).map((b) => ({ ...b }))
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN)
    if (this.mode !== 'many') return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }

  then<T1 = unknown, T2 = never>(
    onfulfilled?: ((v: { data: never; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ) {
    return Promise.resolve(this.run() as { data: never; error: null }).then(onfulfilled, onrejected)
  }
}

// アプリが触るAPI面だけを持つ疑似クライアント
export const demoClient = {
  from: (table: string) => new Query(table),
  rpc: async () => ({ data: null, error: null }),
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getUserIdentities: async () => ({ data: { identities: [] }, error: null }),
    updateUser: async () => ({ data: null, error: null }),
    signOut: async () => { location.href = '/' },
    signInWithPassword: async () => ({ error: null }),
    signInWithOAuth: async () => ({ error: null }),
    linkIdentity: async () => ({ error: null }),
    unlinkIdentity: async () => ({ error: null }),
  },
}
