import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isProviderEnabled, supabase, today } from './lib/supabase'
import { DEMO, DEMO_MEMBERS } from './lib/demo'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Attendance, Break, FeedbackPost, Goal, GoalEvaluation, Invoice, Member, MoneyExpense, MoneyIncome, MoneyProfile, MoneyRecurring, NextAction, Report as ReportRow, Schedule as ScheduleRow } from './lib/supabase'

type Tab = 'home' | 'report' | 'schedule' | 'profile'

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—'
const isoHm = (iso: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '')
// "HH:MM" → 今日のその時刻のISO
const hmToIso = (t: string) => {
  const d = new Date()
  const [h, m] = t.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const hm = (t: string) => t.slice(0, 5) // "09:00:00" → "09:00"
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// 休憩の合計（分）。終了していない休憩は今まで経過した分を数える
const breakMinutes = (breaks: Break[] = [], now = Date.now()) =>
  breaks.reduce((sum, b) => {
    const end = b.ended_at ? new Date(b.ended_at).getTime() : now
    return sum + Math.max(0, end - new Date(b.started_at).getTime())
  }, 0) / 60000

// 実働 = 退勤 - 出勤 - 休憩合計
const workedMinutes = (a: Attendance, now = Date.now()) => {
  if (!a.clock_in) return 0
  const end = a.clock_out ? new Date(a.clock_out).getTime() : now
  const gross = (end - new Date(a.clock_in).getTime()) / 60000
  return Math.max(0, gross - breakMinutes(a.breaks, now))
}

const asHm = (min: number) => `${Math.floor(min / 60)}時間${String(Math.round(min % 60)).padStart(2, '0')}分`
const workedLabel = (a: Attendance) => asHm(workedMinutes(a))

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

// 動画をアップロードして公開URLを返す（本番はSupabase Storage、デモはblob URL）
const uploadVideo = async (memberId: string, file: File) => {
  const path = `${memberId}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('videos').upload(path, file)
  if (error) throw new Error(error.message)
  return supabase.storage.from('videos').getPublicUrl(path).data.publicUrl
}

// URLとして再生できる値か（旧データはファイル名だけが入っている）
const playable = (v: string | null): v is string => !!v && v.includes(':')

// 会社のMyHood投稿先URL（管理者が名簿タブで設定。未設定ならnull）
function useMyhood(companyId: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    supabase.from('companies').select('myhood_url').eq('id', companyId).maybeSingle()
      .then(({ data }) => setUrl((data as { myhood_url?: string | null } | null)?.myhood_url ?? null))
  }, [companyId])
  return url
}

/* ---------- 認証 ---------- */
// カレンダー同期用にrefresh_tokenが必要なので、offline + consent + カレンダーscopeを常に要求
const googleOAuthOptions = {
  redirectTo: location.origin,
  scopes: 'https://www.googleapis.com/auth/calendar.events',
  queryParams: { access_type: 'offline', prompt: 'consent' },
}

// 予定をGoogleカレンダーへ同期（fire-and-forget。失敗しても予定保存は成立している）
const gcalSync = (schedule_id: string, action: 'upsert' | 'delete' = 'upsert') => {
  supabase.functions.invoke('gcal-sync', { body: { schedule_id, action } }).catch(() => {})
}

// 目標・ネクストアクションの期日をGoogleカレンダーの終日イベントへ同期（fire-and-forget）
const dueSync = (kind: 'goal' | 'next_action', id: string, action: 'upsert' | 'delete' = 'upsert') =>
  supabase.functions.invoke('due-sync', { body: { kind, id, action } }).catch(() => {})

// Meetバッジ。同期済みでリンクがあればそのまま参加できる
const MeetBadge = ({ e }: { e: ScheduleRow }) => !e.with_meet ? null : e.meet_url
  ? <a className="badge badge-blue" href={e.meet_url} target="_blank" rel="noreferrer">Meet</a>
  : <span className="badge badge-blue">Meet</span>

// DayDeedのブランドマーク: 編み込まれるDD+青の打刻点(ダーク角丸バッジ)
const DayDeedLogo = ({ size = 34 }: { size?: number }) => (
  <svg viewBox="0 0 360 360" width={size} height={size} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect width="360" height="360" rx="84" fill="#12211D" />
    <g transform="translate(180 180) scale(0.76) translate(-190 -160)">
      <path d="M 64 70 L 64 250" stroke="#FFFFFF" strokeWidth="34" />
      <path d="M 64 70 C 156 70, 208 108, 208 160 C 208 212, 156 250, 64 250" stroke="#FFFFFF" strokeWidth="34" />
      <path d="M 172 70 L 172 250" stroke="#63E6BD" strokeWidth="34" />
      <path d="M 172 70 C 264 70, 316 108, 316 160 C 316 212, 264 250, 172 250" stroke="#63E6BD" strokeWidth="34" />
      <path d="M 140 71 C 168 73, 190 84, 202 106" stroke="#FFFFFF" strokeWidth="34" />
      <circle cx="244" cy="160" r="20" fill="#6FA0F2" />
    </g>
  </svg>
)

const GoogleLogo = () => (
  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6z" />
    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.900l-7.1 5.5C8.1 40.6 15.4 46 24 46z" />
    <path fill="#FBBC05" d="M11.5 27.7c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 16.3 2 20 2 23.2s.9 6.9 2.4 10l7.1-5.5z" />
    <path fill="#EA4335" d="M24 9.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.3 29.9 1 24 1 15.4 1 8.1 6.4 4.4 13.2l7.1 5.5C13.3 13.3 18.2 9.5 24 9.5z" />
  </svg>
)

// Supabaseのエラーを日本語に
const authError = (message: string) => {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'メールアドレスまたはパスワードが違います'
  if (m.includes('email not confirmed')) return 'メールアドレスが未確認です。確認メールのリンクを開いてください'
  if (m.includes('user already registered')) return 'このメールアドレスは既に登録されています'
  if (m.includes('password should be at least')) return 'パスワードは8文字以上にしてください'
  if (m.includes('rate limit') || m.includes('too many')) return '試行回数が多すぎます。しばらく待ってから再度お試しください'
  if (m.includes('provider is not enabled')) return 'Googleログインは未設定です。管理者に連絡してください'
  return message
}

type AuthMode = 'signin' | 'signup' | 'reset'

function Auth() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleOk, setGoogleOk] = useState(false)

  useEffect(() => { isProviderEnabled('google').then(setGoogleOk) }, [])

  const reset = (next: AuthMode) => { setMode(next); setErr(''); setInfo('') }

  // OAuth・メールリンクの失敗はURL（?query か #hash）に載って戻ってくる
  useEffect(() => {
    const params = new URLSearchParams(location.search || location.hash.replace(/^#/, ''))
    const code = params.get('error')
    if (!code) return
    const desc = params.get('error_description') ?? ''
    setErr(
      code === 'server_error' && desc.toLowerCase().includes('provider')
        ? 'Googleログインがまだ有効になっていません（Supabaseの設定が必要です）'
        : desc ? authError(desc) : `ログインに失敗しました（${code}）`,
    )
    history.replaceState(null, '', location.pathname)
  }, [])

  const google = async () => {
    setErr('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: googleOAuthOptions,
    })
    if (error) setErr(authError(error.message))
  }

  const submit = async () => {
    setErr(''); setInfo(''); setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setErr(authError(error.message))
        return
      }
      if (mode === 'signup') {
        if (password.length < 8) return setErr('パスワードは8文字以上にしてください')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: location.origin },
        })
        if (error) return setErr(authError(error.message))
        // 既存ユーザーの再登録はidentitiesが空で返る（存在を漏らさないSupabaseの仕様）
        if (data.user && data.user.identities?.length === 0) {
          return setErr('このメールアドレスは既に登録されています。ログインしてください')
        }
        if (!data.session) setInfo('確認メールを送信しました。メール内のリンクを開くと登録が完了します')
        return
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
      if (error) return setErr(authError(error.message))
      setInfo('パスワード再設定用のメールを送信しました')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    !!email && (mode === 'reset' || password.length >= (mode === 'signup' ? 8 : 1)) &&
    (mode !== 'signup' || !!name)

  return (
    <div className="auth">
      <div className="card">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 4 }}>
          <DayDeedLogo /><span>Day<span style={{ color: '#0e9f78' }}>Deed</span></span>
        </div>
        <p className="auth-lead">
          {mode === 'signin' ? 'アカウントにログイン'
            : mode === 'signup' ? '新しいアカウントを作成'
            : 'パスワードを再設定します'}
        </p>

        {mode !== 'reset' && googleOk && (
          <>
            <button className="btn-google" onClick={google}>
              <GoogleLogo />Google で{mode === 'signup' ? '登録' : 'ログイン'}
            </button>
            <div className="auth-divider"><span>または</span></div>
          </>
        )}

        <form onSubmit={(e) => { e.preventDefault(); submit() }}>
          {mode === 'signup' && (
            <>
              <label htmlFor="au-name">名前</label>
              <input id="au-name" type="text" autoComplete="name" placeholder="山田 太郎"
                value={name} onChange={(e) => setName(e.target.value)} />
            </>
          )}
          <label htmlFor="au-email">メールアドレス</label>
          <input id="au-email" type="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          {mode !== 'reset' && (
            <>
              <label htmlFor="au-pw">パスワード</label>
              <input id="au-pw" type="password" placeholder={mode === 'signup' ? '8文字以上' : ''}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          )}

          {err && <div className="notice warn">{err}</div>}
          {info && <div className="notice">{info}</div>}

          <button className="btn-primary" style={{ width: '100%' }} disabled={!canSubmit || busy}>
            {busy ? '処理中…'
              : mode === 'signin' ? 'ログイン'
              : mode === 'signup' ? 'アカウントを作成'
              : '再設定メールを送信'}
          </button>
        </form>

        <div className="auth-links">
          {mode === 'signin' && (
            <>
              <button onClick={() => reset('reset')}>パスワードを忘れた</button>
              <button onClick={() => reset('signup')}>アカウントを作成</button>
            </>
          )}
          {mode === 'signup' && <button onClick={() => reset('signin')}>ログインに戻る</button>}
          {mode === 'reset' && <button onClick={() => reset('signin')}>ログインに戻る</button>}
        </div>
        <div className="auth-links">
          <a href="/demo">アカウントなしでデモを見る</a>
        </div>
      </div>
    </div>
  )
}

/* ---------- パスワード再設定（メールのリンクから戻ってきた直後） ---------- */
function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  const save = async () => {
    if (password.length < 8) return setErr('パスワードは8文字以上にしてください')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return setErr(authError(error.message))
    onDone()
  }

  return (
    <div className="auth">
      <div className="card">
        <h2>新しいパスワードを設定</h2>
        <label htmlFor="np-pw">新しいパスワード</label>
        <input id="np-pw" type="password" autoComplete="new-password" placeholder="8文字以上"
          value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {err && <div className="notice warn">{err}</div>}
        <button className="btn-primary" style={{ width: '100%' }}
          disabled={password.length < 8} onClick={save}>パスワードを変更</button>
      </div>
    </div>
  )
}

/* ---------- 会社作成オンボーディング ---------- */
function Onboarding({ email, onDone }: { email: string; onDone: () => void }) {
  // 「会社を作る＝管理者になる」ことが伝わらないと、従業員が自分の会社を量産してしまう
  const [choice, setChoice] = useState<'none' | 'create' | 'invited'>('none')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    const { error } = await supabase.from('companies').insert({ name })
    if (error) return setErr(error.message)
    onDone()
  }

  const join = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc('join_company', { code })
    setBusy(false)
    if (error) return setErr(error.message)
    onDone()
  }

  if (choice === 'none') return (
    <div className="auth">
      <div className="card">
        <h2>ようこそ</h2>
        <p className="onb-lead">
          <b>{email}</b> でログインしました。<br />
          どちらの立場か選んでください。
        </p>
        <button className="onb-choice" onClick={() => setChoice('create')}>
          <div className="onb-choice-title">会社を新しく作る</div>
          <div className="onb-choice-desc">
            あなたが<b>管理者</b>になります。メンバーの招待、権限や勤務時間の管理ができます
          </div>
        </button>
        <button className="onb-choice" onClick={() => setChoice('invited')}>
          <div className="onb-choice-title">会社に招待されている</div>
          <div className="onb-choice-desc">
            従業員として参加します。管理者に名簿へ登録してもらう必要があります
          </div>
        </button>
      </div>
    </div>
  )

  if (choice === 'invited') return (
    <div className="auth">
      <div className="card">
        <h2>会社に参加</h2>
        <p className="onb-lead">管理者から共有された参加コードを入力してください。</p>
        <label htmlFor="onb-code">参加コード</label>
        <input id="onb-code" className="code-input" type="text" placeholder="ABC123" autoFocus
          maxLength={6} value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr('') }} />
        {err && <div className="notice warn">{err}</div>}
        <button className="btn-primary" style={{ width: '100%' }}
          disabled={code.length < 6 || busy} onClick={join}>
          {busy ? '参加中…' : '参加する'}
        </button>
        <div className="notice">
          コードが分からない場合は、管理者に <b>{email}</b> で名簿へ登録してもらってから、このページを再読み込みしても参加できます
        </div>
        <div className="auth-links">
          <button onClick={() => setChoice('none')}>戻る</button>
          <button onClick={() => supabase.auth.signOut()}>ログアウト</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="auth">
      <div className="card">
        <h2>会社を作成</h2>
        <p className="onb-lead">作成すると、あなたがこの会社の管理者になります。</p>
        <label>会社名</label>
        <input type="text" placeholder="例: 株式会社サンプル" autoFocus
          value={name} onChange={(e) => setName(e.target.value)} />
        {err && <div className="notice warn">{err}</div>}
        <button className="btn-primary" style={{ width: '100%' }} disabled={!name} onClick={create}>
          作成して始める
        </button>
        <div className="auth-links">
          <button onClick={() => setChoice('none')}>戻る</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- 今日のミーティング（予定タブのカレンダーから当日の確定分だけ） ---------- */
function TodayMeetings({ me }: { me: Member }) {
  const [events, setEvents] = useState<ScheduleRow[]>([])
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('schedules').select('*')
        .eq('company_id', me.company_id).eq('status', 'confirmed')
      const t = today()
      setEvents(((data as ScheduleRow[]) ?? [])
        .filter((e) => new Date(e.starts_at).toLocaleDateString('sv-SE') === t)
        .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)))
    })()
  }, [me.company_id])
  const hm2 = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
  return (
    <div className="card">
      <h2>今日のミーティング</h2>
      {events.length === 0 ? <div className="empty">今日の予定はありません</div> : (
        <div className="list">
          {events.map((e) => (
            <div key={e.id} className="list-item">
              <div className="when">{hm2(e.starts_at)}–{hm2(e.ends_at)}</div>
              <div className="title">{e.title}</div>
              <MeetBadge e={e} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- 今週の予定（天気予報風ストリップ＋選択日の詳細） ---------- */
function WeekPlan({ me }: { me: Member }) {
  const [events, setEvents] = useState<ScheduleRow[]>([])
  const [plans, setPlans] = useState<ReportRow[]>([])
  const [sel, setSel] = useState(today())

  useEffect(() => {
    (async () => {
      const until = new Date(); until.setDate(until.getDate() + 14)
      const [{ data: ev }, { data: reps }] = await Promise.all([
        supabase.from('schedules').select('*')
          .eq('company_id', me.company_id).eq('status', 'confirmed'),
        supabase.from('daily_reports').select('*').eq('member_id', me.id)
          .gte('work_date', today()).lt('work_date', until.toLocaleDateString('sv-SE')),
      ])
      setEvents(((ev as ScheduleRow[]) ?? []).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)))
      setPlans((reps as ReportRow[]) ?? [])
    })()
  }, [me.company_id, me.id])

  const hm2 = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
  const evDay = (e: ScheduleRow) => new Date(e.starts_at).toLocaleDateString('sv-SE')
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i)
    const date = d.toLocaleDateString('sv-SE')
    const rep = plans.find((r) => r.work_date === date)
    const dow = d.getDay()
    // 稼働時間: 稼働予定表に書いてあればそれ。なければ平日は所定、土日は休み扱い
    const range = rep?.planned_start && rep?.planned_end
      ? `${rep.planned_start.slice(0, 5).replace(/^0/, '')}–${rep.planned_end.slice(0, 5).replace(/^0/, '')}`
      : (dow === 0 || dow === 6) ? null
      : `${hm(me.work_start).replace(/^0/, '')}–${hm(me.work_end).replace(/^0/, '')}`
    return { date, d, rep, range, meetings: events.filter((e) => evDay(e) === date) }
  })
  const selDay = days.find((x) => x.date === sel) ?? days[0]

  return (
    <div className="card">
      <h2>今週の予定</h2>
      <div className="week-strip" role="tablist" aria-label="日付を選択">
        {days.map((x, i) => (
          <button key={x.date} role="tab" aria-selected={x.date === sel}
            className={`ws-day ${x.date === sel ? 'sel' : ''} ${x.range ? '' : 'off'}`}
            onClick={() => setSel(x.date)}>
            <span className="ws-dow">{i === 0 ? '今日' : '日月火水木金土'[x.d.getDay()]}</span>
            <span className="ws-date">{x.d.getMonth() + 1}/{x.d.getDate()}</span>
            <span className="ws-range">{x.range ?? '休み'}</span>
            <span className="ws-dots" aria-label={`予定${x.meetings.length}件`}>
              {x.meetings.length ? '●'.repeat(Math.min(x.meetings.length, 3)) : '–'}
            </span>
          </button>
        ))}
      </div>
      <div className="week-detail">
        <div className="wd-head">
          {selDay.d.getMonth() + 1}/{selDay.d.getDate()}({'日月火水木金土'[selDay.d.getDay()]}) の詳細
          <span className="tag">{selDay.range ? `稼働 ${selDay.range}` : '休み'}</span>
        </div>
        {selDay.meetings.map((e) => (
          <div key={e.id} className="wd-row">
            <b>{hm2(e.starts_at)}–{hm2(e.ends_at)}</b>
            <span>{e.title}</span>
            <MeetBadge e={e} />
          </div>
        ))}
        {selDay.meetings.length === 0 && <div className="wd-row empty-inline">ミーティングはありません</div>}
        {selDay.rep?.plan && <div className="wd-plan">やること: {selDay.rep.plan}</div>}
      </div>
    </div>
  )
}

/* ---------- 今日のミーティング⇄今週の予定の切り替え表示 ---------- */
function MeetingsWeek({ me }: { me: Member }) {
  const [view, setView] = useState<'today' | 'week'>('today')
  return (
    <>
      <div className="seg-row" role="tablist" aria-label="予定の切り替え">
        <button role="tab" aria-selected={view === 'today'}
          className={`preset-chip ${view === 'today' ? 'sel' : ''}`}
          onClick={() => setView('today')}>今日</button>
        <button role="tab" aria-selected={view === 'week'}
          className={`preset-chip ${view === 'week' ? 'sel' : ''}`}
          onClick={() => setView('week')}>今週</button>
      </div>
      {view === 'today' ? <TodayMeetings me={me} /> : <WeekPlan me={me} />}
    </>
  )
}

/* ---------- 出勤・退勤 ---------- */
function Home({ me }: { me: Member }) {
  const now = useClock()
  const [att, setAtt] = useState<Attendance | null>(null)
  const [plan, setPlan] = useState('')
  const [err, setErr] = useState('')
  // 押し忘れ修正用: ボタン内で時刻を直接編集する（'in' | 'out' | 中抜けのid | 編集中でなければnull）
  const [editing, setEditing] = useState<string | null>(null)
  const [editTime, setEditTime] = useState('')
  const [editTime2, setEditTime2] = useState('') // 中抜けの終了時刻用

  const load = useCallback(async () => {
    const [{ data }, { data: reps }] = await Promise.all([
      supabase
        .from('attendances')
        .select('*, breaks(*)')
        .eq('member_id', me.id)
        .order('work_date', { ascending: false })
        .limit(7),
      supabase.from('daily_reports').select('*').eq('member_id', me.id)
        .order('work_date', { ascending: false }).limit(7),
    ])
    // 前日以前の退勤し忘れは、その日の24:00で自動退勤にする（auto_outで「自動補完」表示）
    const stale = (data ?? []).find((a) => a.work_date < today() && a.clock_in && !a.clock_out)
    if (stale) {
      await supabase.from('attendances').update({
        clock_out: new Date(stale.work_date + 'T23:59:59').toISOString(), auto_out: true,
      }).eq('id', stale.id)
      return load()
    }
    const t = (data ?? []).find((a) => a.work_date === today()) ?? null
    setAtt(t)
    setPlan(((reps as ReportRow[]) ?? []).find((r) => r.work_date === today())?.plan ?? '')
  }, [me.id])

  useEffect(() => { load() }, [load])

  const openBreak = att?.breaks?.find((b) => !b.ended_at) ?? null
  const status = openBreak ? '中抜け中'
    : att?.clock_out ? '退勤済み'
    : att?.clock_in ? '勤務中' : '未出勤'

  // 保存は必ず結果を確認する。黙って失敗すると打刻が消えたように見えるため
  const save = async (patch: Partial<Attendance>) => {
    setErr('')
    const { error } = await supabase.from('attendances').upsert(
      { member_id: me.id, work_date: today(), plan, ...patch },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`保存できませんでした（${error.message}）。ログインし直してもう一度お試しください`)
    setEditing(null)
    load()
  }

  const punchIn = () => save({ clock_in: new Date().toISOString() })

  // 退勤のみ → 出勤を所定開始時刻で自動補完
  const punchOut = (clockOut = new Date().toISOString()) => {
    const patch: Partial<Attendance> = { clock_out: clockOut }
    if (!att?.clock_in) {
      const d = new Date()
      const [h, m] = hm(me.work_start).split(':').map(Number)
      d.setHours(h, m, 0, 0)
      patch.clock_in = d.toISOString()
      patch.auto_in = true
    }
    return save(patch)
  }

  // ボタン内の時刻エディタを開く（現在の記録があればそれを初期値に）
  const openEdit = (key: 'in' | 'out') => {
    setEditing(key)
    setEditTime(isoHm(key === 'in' ? att?.clock_in ?? null : att?.clock_out ?? null))
  }

  const openBreakEdit = (b: Break) => {
    setEditing(b.id)
    setEditTime(isoHm(b.started_at))
    setEditTime2(isoHm(b.ended_at))
  }

  // 時刻を指定して中抜けを追加（付け忘れの後入力用）
  const openNewBreak = () => {
    setEditing('newbreak')
    setEditTime(isoHm(new Date().toISOString()))
    setEditTime2('')
  }

  const commitEdit = async () => {
    if (!editing) return
    if (editing === 'in') {
      if (editTime) save({ clock_in: hmToIso(editTime), auto_in: false })
      return setEditing(null)
    }
    if (editing === 'out') {
      if (editTime) punchOut(hmToIso(editTime))
      return setEditing(null)
    }
    setErr('')
    if (editing === 'newbreak') {
      if (!att || !editTime) return setEditing(null)
      const { error } = await supabase.from('breaks').insert({
        attendance_id: att.id,
        started_at: hmToIso(editTime),
        ended_at: editTime2 ? hmToIso(editTime2) : null,
      })
      if (error) return setErr(`中抜けを追加できませんでした（${error.message}）`)
      setEditing(null)
      return load()
    }
    // 中抜け: 開始・終了をまとめて更新（終了を空にすると「中抜け中」に戻る）
    const { error } = await supabase.from('breaks').update({
      ...(editTime ? { started_at: hmToIso(editTime) } : {}),
      ended_at: editTime2 ? hmToIso(editTime2) : null,
    }).eq('id', editing)
    if (error) return setErr(`休憩時刻を変更できませんでした（${error.message}）`)
    setEditing(null)
    load()
  }



  // 間違えて作った中抜けを削除
  const deleteBreak = async (id: string) => {
    setErr('')
    const { error } = await supabase.from('breaks').delete().eq('id', id)
    if (error) return setErr(`中抜けを削除できませんでした（${error.message}）`)
    setEditing(null)
    load()
  }

  // 退勤後にまた稼働する場合。退勤時刻を消して勤務中に戻す
  const resume = () => save({ clock_out: null })

  // 中抜け（ランチ・私用など）。1日に何回でも
  const startBreak = async () => {
    if (!att) return
    setErr('')
    const { error } = await supabase.from('breaks').insert({ attendance_id: att.id })
    if (error) return setErr(`休憩を開始できませんでした（${error.message}）`)
    load()
  }

  const endBreak = async () => {
    if (!openBreak) return
    setErr('')
    const { error } = await supabase.from('breaks')
      .update({ ended_at: new Date().toISOString() }).eq('id', openBreak.id)
    if (error) return setErr(`休憩を終了できませんでした（${error.message}）`)
    load()
  }


  return (
    <>
      <div className="hero">
        <div className="date">
          {now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
          {' · '}<b>{status}</b>
        </div>
        {att?.clock_in ? (
          // 出勤後は現在時刻ではなく実働時間を主役に（休憩・中抜けは除いてリアルタイムに進む）
          (() => {
            const sec = Math.max(0, Math.floor(workedMinutes(att, now.getTime()) * 60))
            return (
              <div className="clock">
                {Math.floor(sec / 3600)}:{String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}
                <span className="sec">:{String(sec % 60).padStart(2, '0')} 実働</span>
              </div>
            )
          })()
        ) : (
          <div className="clock">
            {now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            <span className="sec">:{String(now.getSeconds()).padStart(2, '0')}</span>
          </div>
        )}
        {err && <div className="notice warn">{err}</div>}
        <div className="punch-row">
          {editing === 'in' ? (
            <div className="btn btn-in btn-editing">
              <span>出勤</span>
              <input type="time" autoFocus aria-label="出勤時刻" value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitEdit()} />
              <button className="edit-ok" aria-label="保存" onClick={commitEdit}>✓</button>
              <button className="edit-cancel" aria-label="キャンセル" onClick={() => setEditing(null)}>✕</button>
            </div>
          ) : (
            <div className="btn-split">
              <button className="btn btn-in" disabled={!!att?.clock_in} onClick={punchIn}>
                {att?.clock_in ? `出勤 ${fmtTime(att.clock_in)}` : '出勤する'}
              </button>
              <button className="icon-btn on-in" aria-label="出勤時刻を指定・修正"
                onClick={() => openEdit('in')}>✎</button>
            </div>
          )}
          {editing === 'out' ? (
            <div className="btn btn-out btn-editing">
              <span>退勤</span>
              <input type="time" autoFocus aria-label="退勤時刻" value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitEdit()} />
              <button className="edit-ok" aria-label="保存" onClick={commitEdit}>✓</button>
              <button className="edit-cancel" aria-label="キャンセル" onClick={() => setEditing(null)}>✕</button>
            </div>
          ) : (
            <div className="btn-split">
              {att?.clock_out ? (
                <button className="btn btn-out" onClick={resume}>勤務を再開</button>
              ) : (
                <button className="btn btn-out" disabled={!!openBreak} onClick={() => punchOut()}>退勤する</button>
              )}
              <button className="icon-btn on-out" aria-label="退勤時刻を指定・修正（押し忘れの修正）"
                onClick={() => openEdit('out')}>✎</button>
            </div>
          )}
        </div>
        {att?.clock_in && (
          <div className="punch-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {(att.breaks ?? []).filter((b) => b.ended_at).map((b) =>
              editing === b.id ? (
                <div key={b.id} className="btn btn-break btn-editing">
                  <span>中抜け</span>
                  <input type="time" autoFocus aria-label="中抜け開始" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                  <span>–</span>
                  <input type="time" aria-label="中抜け終了" value={editTime2} onChange={(e) => setEditTime2(e.target.value)} />
                  <button className="edit-ok" aria-label="保存" onClick={commitEdit}>✓</button>
                  <button className="edit-cancel" aria-label="キャンセル" onClick={() => setEditing(null)}>✕</button>
                  <button className="edit-delete" onClick={() => deleteBreak(b.id)}>削除</button>
                </div>
              ) : (
                <div key={b.id} className="btn-split chip">
                  <span className="btn btn-chip">中抜け {fmtTime(b.started_at)}–{fmtTime(b.ended_at)}</span>
                  <button className="icon-btn on-chip" aria-label="この中抜けの時刻を修正"
                    onClick={() => openBreakEdit(b)}>✎</button>
                </div>
              ))}
            {!att.clock_out && (openBreak ? (
              editing === openBreak.id ? (
                <div className="btn btn-break btn-editing">
                  <span>中抜け</span>
                  <input type="time" autoFocus aria-label="中抜け開始" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                  <span>–</span>
                  <input type="time" aria-label="中抜け終了" value={editTime2} onChange={(e) => setEditTime2(e.target.value)} />
                  <button className="edit-ok" aria-label="保存" onClick={commitEdit}>✓</button>
                  <button className="edit-cancel" aria-label="キャンセル" onClick={() => setEditing(null)}>✕</button>
                  <button className="edit-delete" onClick={() => deleteBreak(openBreak.id)}>削除</button>
                </div>
              ) : (
                <div className="btn-split">
                  <button className="btn btn-break-end" onClick={endBreak}>
                    中抜けを終了（{fmtTime(openBreak.started_at)}〜）
                  </button>
                  <button className="icon-btn on-break" aria-label="中抜けの開始時刻を修正"
                    onClick={() => openBreakEdit(openBreak)}>✎</button>
                </div>
              )
            ) : editing === 'newbreak' ? (
              <div className="btn btn-break btn-editing">
                <span>中抜け</span>
                <input type="time" autoFocus aria-label="中抜け開始" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                <span>–</span>
                <input type="time" aria-label="中抜け終了（空なら中抜け中）" value={editTime2} onChange={(e) => setEditTime2(e.target.value)} />
                <button className="edit-ok" aria-label="保存" onClick={commitEdit}>✓</button>
                <button className="edit-cancel" aria-label="キャンセル" onClick={() => setEditing(null)}>✕</button>
              </div>
            ) : (
              <div className="btn-split">
                <button className="btn btn-break" onClick={startBreak}>中抜け・休憩を開始</button>
                <button className="icon-btn on-chip" aria-label="時刻を指定して中抜けを追加（付け忘れの入力）"
                  onClick={openNewBreak}>✎</button>
              </div>
            ))}
          </div>
        )}
        {att?.clock_out && (
          <div className="hero-note">退勤 {fmtTime(att.clock_out)}・実働 {workedLabel(att)}</div>
        )}
      </div>

      <MeetingsWeek me={me} />
      <PlanKintai me={me} />
    </>
  )
}

/* ---------- 稼働予定表（日報タブ内・自己管理用。月単位で切り替え） ---------- */
function PlanRows({ me }: { me: Member }) {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [month, setMonth] = useState(today().slice(0, 7)) // "YYYY-MM"
  const [err, setErr] = useState('')
  const [savedAt, setSavedAt] = useState('') // 直近保存した行のwork_date（✓表示用）

  const blank = useCallback((date: string): ReportRow => ({
    id: '', member_id: me.id, work_date: date, body: '', video: null,
    submitted_at: '', plan: '', planned_start: '', planned_end: '',
  } as ReportRow), [me.id])

  // 選択月の全日を並べ、保存済み行を重ねる（Excelの月シートのイメージ）
  const load = useCallback(async () => {
    const [y, m] = month.split('-').map(Number)
    const from = `${month}-01`
    const to = new Date(y, m, 1).toLocaleDateString('sv-SE').slice(0, 7) + '-01'
    const { data } = await supabase.from('daily_reports').select('*').eq('member_id', me.id)
      .gte('work_date', from).lt('work_date', to).order('work_date', { ascending: true })
    const merged = new Map<string, ReportRow>()
    const days = new Date(y, m, 0).getDate()
    for (let d = 1; d <= days; d++) merged.set(`${month}-${String(d).padStart(2, '0')}`, blank(`${month}-${String(d).padStart(2, '0')}`))
    for (const r of ((data as ReportRow[]) ?? [])) merged.set(r.work_date, r)
    setRows([...merged.values()].sort((a, b) => (a.work_date < b.work_date ? -1 : 1)))
  }, [me.id, month, blank])
  useEffect(() => { load() }, [load])

  const moveMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    setMonth(new Date(y, m - 1 + delta, 1).toLocaleDateString('sv-SE').slice(0, 7))
  }

  const dirty = useRef(new Set<string>()) // セルを触った行だけblur時に自動保存する
  const patch = (date: string, p: Partial<ReportRow>) => {
    dirty.current.add(date)
    setRows((rs) => rs.map((r) => (r.work_date === date ? { ...r, ...p } : r)))
  }

  const save = async (r: ReportRow) => {
    if (!dirty.current.has(r.work_date)) return
    dirty.current.delete(r.work_date)
    setErr('')
    const { error } = await supabase.from('daily_reports').upsert(
      { member_id: me.id, work_date: r.work_date, body: r.body ?? '',
        plan: r.plan, planned_start: r.planned_start || null, planned_end: r.planned_end || null,
        confirmed: r.confirmed ?? false },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`保存できませんでした（${error.message}）`)
    setSavedAt(r.work_date)
    setTimeout(() => setSavedAt((s) => (s === r.work_date ? '' : s)), 1500)
  }

  // 時刻のゆるい入力を "HH:MM" に整形。"1100"→"11:00"、"9"→"09:00"、解釈不能なら空に
  const normTime = (v: string) => {
    const d = v.replace(/[^0-9]/g, '')
    if (!d) return ''
    const [h, m] = d.length <= 2 ? [+d, 0] : [+d.slice(0, -2), +d.slice(-2)]
    if (h > 23 || m > 59) return ''
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00')
    return `${d.slice(5).replace('-', '/')}(${'日月火水木金土'[dt.getDay()]})`
  }

  const [y, m] = month.split('-').map(Number)
  return (
    <div className="card">
      <h2>
        稼働予定表
        <span className="month-nav">
          <button aria-label="前の月" onClick={() => moveMonth(-1)}>◀</button>
          <b>{y}年{m}月</b>
          <button aria-label="次の月" onClick={() => moveMonth(1)}>▶</button>
        </span>
      </h2>
      <div className="plan-table-wrap">
          <table className="plan-table">
            <thead>
              <tr><th>日付</th><th>開始</th><th>終了</th><th>やること</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                return (
                <tr key={r.work_date} className={r.work_date === today() ? 'pt-today' : ''}>
                  <td className="pt-date">{fmtDate(r.work_date)}
                    {savedAt === r.work_date && <span className="pt-saved" role="status">✓保存</span>}</td>
                  {(
                    <>
                      <td><input type="text" inputMode="numeric" placeholder="0900" className="pt-time"
                        aria-label={`${fmtDate(r.work_date)}の稼働予定開始`} value={r.planned_start ?? ''}
                        onChange={(e) => patch(r.work_date, { planned_start: e.target.value })}
                        onBlur={(e) => {
                          const v = normTime(e.target.value)
                          if (v !== (r.planned_start ?? '')) patch(r.work_date, { planned_start: v })
                          save({ ...r, planned_start: v })
                        }} /></td>
                      <td><input type="text" inputMode="numeric" placeholder="1800" className="pt-time"
                        aria-label={`${fmtDate(r.work_date)}の稼働予定終了`} value={r.planned_end ?? ''}
                        onChange={(e) => patch(r.work_date, { planned_end: e.target.value })}
                        onBlur={(e) => {
                          const v = normTime(e.target.value)
                          if (v !== (r.planned_end ?? '')) patch(r.work_date, { planned_end: v })
                          save({ ...r, planned_end: v })
                        }} /></td>
                    </>
                  )}
                  <td className="pt-plan"><textarea rows={1} placeholder="やることを自由に記入"
                    aria-label={`${fmtDate(r.work_date)}のやること`} value={r.plan ?? ''}
                    onChange={(e) => patch(r.work_date, { plan: e.target.value })}
                    onBlur={() => save(r)} /></td>
                </tr>
              )})}
            </tbody>
          </table>
      </div>
      {err && <div className="notice warn">{err}</div>}
    </div>
  )
}

/* ---------- 勤怠表（実績の詳細: 出勤・退勤・中抜け・実働・確定） ---------- */
function KintaiTable({ me }: { me: Member }) {
  const [atts, setAtts] = useState<Attendance[]>([])
  const [reps, setReps] = useState<ReportRow[]>([])
  const [month, setMonth] = useState(today().slice(0, 7))
  const [err, setErr] = useState('')
  const [savedAt, setSavedAt] = useState('')

  const load = useCallback(async () => {
    const [y, m] = month.split('-').map(Number)
    const from = `${month}-01`
    const to = new Date(y, m, 1).toLocaleDateString('sv-SE').slice(0, 7) + '-01'
    const [{ data: a }, { data: r }] = await Promise.all([
      supabase.from('attendances').select('*, breaks(*)').eq('member_id', me.id)
        .gte('work_date', from).lt('work_date', to).order('work_date', { ascending: true }),
      supabase.from('daily_reports').select('*').eq('member_id', me.id)
        .gte('work_date', from).lt('work_date', to),
    ])
    setAtts((a as Attendance[]) ?? [])
    setReps((r as ReportRow[]) ?? [])
  }, [me.id, month])
  useEffect(() => { load() }, [load])

  const moveMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    setMonth(new Date(y, m - 1 + delta, 1).toLocaleDateString('sv-SE').slice(0, 7))
  }

  const normTime = (v: string) => {
    const d = v.replace(/[^0-9]/g, '')
    if (!d) return ''
    const [h, m] = d.length <= 2 ? [+d, 0] : [+d.slice(0, -2), +d.slice(-2)]
    if (h > 23 || m > 59) return ''
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00')
    return `${d.slice(5).replace('-', '/')}(${'日月火水木金土'[dt.getDay()]})`
  }
  const toIso = (date: string, hmStr: string) => new Date(`${date}T${hmStr}:00`).toISOString()
  const flash = (date: string) => {
    setSavedAt(date)
    setTimeout(() => setSavedAt((s) => (s === date ? '' : s)), 1500)
  }
  // 出勤/退勤の修正。手で直したら自動補完フラグは下ろす
  const saveActual = async (date: string, field: 'clock_in' | 'clock_out', v: string) => {
    if (!v) return load()
    setErr('')
    const { error } = await supabase.from('attendances').upsert(
      { member_id: me.id, work_date: date, [field]: toIso(date, v),
        [field === 'clock_in' ? 'auto_in' : 'auto_out']: false },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`実績を保存できませんでした（${error.message}）`)
    flash(date)
    load()
  }
  const breakList = (a: Attendance) =>
    [...(a.breaks ?? [])].sort((p, q) => (p.started_at < q.started_at ? -1 : 1))
      .map((b) => `${fmtTime(b.started_at)}–${b.ended_at ? fmtTime(b.ended_at) : ''}`)
  const fmtBreaks = (a: Attendance) =>
    [...(a.breaks ?? [])].sort((p, q) => (p.started_at < q.started_at ? -1 : 1))
      .map((b) => `${fmtTime(b.started_at)}–${b.ended_at ? fmtTime(b.ended_at) : ''}`).join(', ')
  // 「1200-1300, 1500-1515」形式をパースしてその日のbreaksを入れ替える
  const saveBreaks = async (a: Attendance, text: string) => {
    setErr('')
    const parts = text.split(/[,、]/).map((s) => s.trim()).filter(Boolean)
    const ranges: [string, string][] = []
    for (const p of parts) {
      const [s, e] = p.split(/[-–~〜]/).map((t) => normTime(t ?? ''))
      if (!s || !e) return setErr(`中抜けは「1200-1300」の形式で入力してください（${p} が読めませんでした）`)
      ranges.push([s, e])
    }
    await supabase.from('breaks').delete().eq('attendance_id', a.id)
    for (const [s, e] of ranges) {
      const { error } = await supabase.from('breaks').insert(
        { attendance_id: a.id, started_at: toIso(a.work_date, s), ended_at: toIso(a.work_date, e) })
      if (error) return setErr(`中抜けを保存できませんでした（${error.message}）`)
    }
    flash(a.work_date)
    load()
  }
  const toggleConfirm = async (a: Attendance) => {
    const rep = reps.find((r) => r.work_date === a.work_date)
    setErr('')
    const { error } = await supabase.from('daily_reports').upsert(
      { member_id: me.id, work_date: a.work_date, confirmed: !(rep?.confirmed ?? false) },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`確定できませんでした（${error.message}）`)
    flash(a.work_date)
    load()
  }

  const [y, m] = month.split('-').map(Number)
  const days = atts.filter((a) => a.clock_in)
  return (
    <div className="card">
      <h2>
        勤怠記録 <span className="tag">出勤・退勤・中抜けの実績</span>
        <span className="month-nav">
          <button aria-label="勤怠表の前の月" onClick={() => moveMonth(-1)}>◀</button>
          <b>{y}年{m}月</b>
          <button aria-label="勤怠表の次の月" onClick={() => moveMonth(1)}>▶</button>
        </span>
      </h2>
      {days.length === 0 ? <div className="empty">この月の勤怠記録はありません</div> : (
        <div className="plan-table-wrap">
          <table className="plan-table">
            <thead>
              <tr><th>日付</th><th>出勤</th><th>退勤</th><th>中抜け</th><th>実働</th><th></th></tr>
            </thead>
            <tbody>
              {days.map((a) => {
                const confirmed = reps.find((r) => r.work_date === a.work_date)?.confirmed ?? false
                return (
                  <tr key={a.id} className={a.work_date === today() ? 'pt-today' : ''}>
                    <td className="pt-date">{fmtDate(a.work_date)}
                      {(a.auto_in || a.auto_out) && <span className="badge badge-yellow">⚠ 自動補完</span>}
                      {savedAt === a.work_date && <span className="pt-saved" role="status">✓保存</span>}</td>
                    {confirmed ? (
                      <>
                        <td className="pt-time pt-done">{fmtTime(a.clock_in)}</td>
                        <td className="pt-time pt-done">{a.clock_out ? fmtTime(a.clock_out) : ''}</td>
                        <td className="pt-time pt-done">{fmtBreaks(a)}</td>
                      </>
                    ) : (
                      <>
                        <td><input type="text" inputMode="numeric" className="pt-time" placeholder="0900"
                          key={`in-${a.id}-${a.clock_in ?? ''}`} aria-label={`${fmtDate(a.work_date)}の出勤`}
                          defaultValue={a.clock_in ? fmtTime(a.clock_in) : ''}
                          onBlur={(e) => {
                            const v = normTime(e.target.value)
                            if (v !== (a.clock_in ? fmtTime(a.clock_in) : '')) saveActual(a.work_date, 'clock_in', v)
                          }} /></td>
                        <td><input type="text" inputMode="numeric" className="pt-time" placeholder="1800"
                          key={`out-${a.id}-${a.clock_out ?? ''}`} aria-label={`${fmtDate(a.work_date)}の退勤`}
                          defaultValue={a.clock_out ? fmtTime(a.clock_out) : ''}
                          onBlur={(e) => {
                            const v = normTime(e.target.value)
                            if (v !== (a.clock_out ? fmtTime(a.clock_out) : '')) saveActual(a.work_date, 'clock_out', v)
                          }} /></td>
                        {/* 中抜けは1件1欄。✕で削除、一番下の欄に入力すると追加 */}
                        <td className="pt-breaks" key={`br-${a.id}-${fmtBreaks(a)}`}>
                          {breakList(a).map((val, i) => (
                            <div className="pt-break-row" key={`${a.id}-${i}-${val}`}>
                              <input type="text" inputMode="numeric" defaultValue={val}
                                aria-label={`${fmtDate(a.work_date)}の中抜け${i + 1}（1200-1300形式）`}
                                onBlur={(e) => {
                                  const rest = breakList(a).filter((_, j) => j !== i)
                                  const v = e.target.value.trim()
                                  const all = (v ? [...rest, v] : rest).join(', ')
                                  if (all !== fmtBreaks(a)) saveBreaks(a, all)
                                }} />
                              <button className="pt-break-del" aria-label={`中抜け${i + 1}を削除`}
                                onClick={() => saveBreaks(a, breakList(a).filter((_, j) => j !== i).join(', '))}>✕</button>
                            </div>
                          ))}
                          <input type="text" inputMode="numeric" className="pt-break-add"
                            placeholder="＋ 1200-1300 で追加"
                            aria-label={`${fmtDate(a.work_date)}に中抜けを追加（1200-1300形式）`}
                            onBlur={(e) => {
                              const v = e.target.value.trim()
                              if (!v) return
                              e.target.value = ''
                              saveBreaks(a, [...breakList(a), v].join(', '))
                            }} />
                        </td>
                      </>
                    )}
                    <td className="pt-time pt-worked-cell">{a.clock_out ? workedLabel(a) : '勤務中'}</td>
                    <td>{a.clock_out && (
                      <button className={`pt-fix-btn ${confirmed ? 'on' : ''}`} aria-pressed={confirmed}
                        onClick={() => toggleConfirm(a)}>{confirmed ? '確定済' : '確定'}</button>
                    )}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {err && <div className="notice warn">{err}</div>}
    </div>
  )
}

/* ---------- 稼働予定表⇄勤怠記録の切り替え表示 ---------- */
function PlanKintai({ me }: { me: Member }) {
  const [view, setView] = useState<'plan' | 'kintai'>('plan')
  return (
    <>
      <div className="seg-row" role="tablist" aria-label="表の切り替え">
        <button role="tab" aria-selected={view === 'plan'}
          className={`preset-chip ${view === 'plan' ? 'sel' : ''}`}
          onClick={() => setView('plan')}>稼働予定表</button>
        <button role="tab" aria-selected={view === 'kintai'}
          className={`preset-chip ${view === 'kintai' ? 'sel' : ''}`}
          onClick={() => setView('kintai')}>勤怠記録</button>
      </div>
      {view === 'plan' ? <PlanRows me={me} /> : <KintaiTable me={me} />}
    </>
  )
}

/* ---------- 日報 ---------- */
function Report({ me }: { me: Member }) {
  const [body, setBody] = useState('')
  const [history, setHistory] = useState<ReportRow[]>([])
  const [saved, setSaved] = useState(false)
  const [showReports, setShowReports] = useState(false) // 日報の記入・過去分はボタンで開く
  const [err, setErr] = useState('')
  const myhood = useMyhood(me.company_id)

  const load = useCallback(async () => {
    const { data: reports } = await supabase.from('daily_reports').select('*').eq('member_id', me.id)
      .order('work_date', { ascending: false })
    // 予定だけの未来行（body空）は日報の履歴には出さない
    setHistory((reports ?? []).filter((r) => r.body))
    const t = (reports ?? []).find((r) => r.work_date === today())
    if (t) { setBody(t.body === '動画で提出' ? '' : t.body); setSaved(true) }
  }, [me.id])

  useEffect(() => { load() }, [load])

  const todayRep = history.find((r) => r.work_date === today())

  const submit = async (video?: string) => {
    setErr('')
    const { error } = await supabase.from('daily_reports').upsert(
      { member_id: me.id, work_date: today(), body: body || '動画で提出', ...(video ? { video } : {}) },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`提出できませんでした（${error.message}）`)
    setSaved(true)
    load()
  }

  // 動画を撮る（選ぶ）とアップロードして日報を提出扱いに
  // ponytail: MyHoodのAPIが使えるようになったら、ここからMyHoodにも同時投稿する
  const submitVideo = async (file: File | undefined) => {
    if (!file) return
    try {
      submit(await uploadVideo(me.id, file))
    } catch (e) {
      setErr(`動画をアップロードできませんでした（${(e as Error).message}）`)
    }
  }

  return (
    <>
      <PlanKintai me={me} />
      {!showReports && (
        <button className="btn-outline" style={{ margin: '0 auto', display: 'block' }}
          onClick={() => setShowReports(true)}>日報を書く・過去の日報を見る</button>
      )}
      {showReports && (<>
      <div className="card">
        <h2>今日の日報 <span className="tag">{today().slice(5).replace('-', '/')}</span></h2>
        <label>業務内容（実績）</label>
        <textarea placeholder="今日行った業務を入力" value={body}
          onChange={(e) => { setBody(e.target.value); setSaved(false) }} />
        {err && <div className="notice warn">{err}</div>}
        <div className="form-actions">
          <button className="btn-primary" style={{ margin: 0 }} disabled={!body || saved} onClick={() => submit()}>
            {saved ? '提出済み ✓' : '日報を提出'}
          </button>
          {myhood && (
            <label className="btn-outline" style={{ cursor: 'pointer' }}>
              🎥 MyHood
              <input type="file" accept="video/*" capture hidden
                onChange={(e) => submitVideo(e.target.files?.[0])} />
            </label>
          )}
        </div>
        {playable(todayRep?.video ?? null) && (
          <video className="report-video" src={todayRep!.video!} controls playsInline />
        )}
        {myhood && <div className="notice">動画を撮って（選んで）アップロードすると、それだけで提出扱いになります</div>}
      </div>

      <div className="card">
        <h2>過去の日報</h2>
        {history.length === 0 ? <div className="empty">まだ日報がありません</div> : (
          <div className="list">
            {history.map((r) => (
              <div key={r.id} className="list-item">
                <div className="when">{r.work_date.slice(5).replace('-', '/')}</div>
                <div className="title">{r.body}</div>
                {playable(r.video) && <video className="report-video" src={r.video} controls playsInline />}
                <span className="badge badge-blue">{r.video ? '動画提出' : '提出済'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}
    </>
  )
}

/* ---------- スケジュール ---------- */
const TL_START = 8 * 60
const TL_END = 20 * 60
// ponytail: 固定プリセット。会社ごとに編集したくなったら companies にカラム追加
const TITLE_PRESETS = ['定例MTG', '開発', '1on1']

function Schedule({ me }: { me: Member }) {
  const base = new Date()
  const year = base.getFullYear()
  const month = base.getMonth() // 0-indexed
  const [events, setEvents] = useState<ScheduleRow[]>([])
  // 自分の目標・ネクストアクションの期日をカレンダーに重ねて表示する
  const [dueGoals, setDueGoals] = useState<Goal[]>([])
  const [dueActions, setDueActions] = useState<NextAction[]>([])
  const [selDay, setSelDay] = useState(base.getDate())
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null)
  const [title, setTitle] = useState('')
  const [meet, setMeet] = useState(true)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [err, setErr] = useState('')
  // 提案フロー: 宛先・受け取った提案のインライン修正
  const [proposeTo, setProposeTo] = useState('')
  const [colleagues, setColleagues] = useState<Member[]>([])
  const [editProp, setEditProp] = useState<ScheduleRow | null>(null)
  const [pStart, setPStart] = useState('')
  const [pEnd, setPEnd] = useState('')

  const load = useCallback(async () => {
    const from = new Date(year, month, 1).toISOString()
    const to = new Date(year, month + 1, 1).toISOString()
    const dFrom = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const dTo = new Date(year, month + 1, 1).toLocaleDateString('sv-SE')
    const [{ data }, { data: gs }, { data: nas }] = await Promise.all([
      supabase.from('schedules').select('*')
        .gte('starts_at', from).lt('starts_at', to).order('starts_at'),
      supabase.from('goals').select('*')
        .eq('member_id', me.id).gte('due_date', dFrom).lt('due_date', dTo).order('due_date'),
      supabase.from('next_actions').select('*')
        .eq('member_id', me.id).gte('due_date', dFrom).lt('due_date', dTo).order('due_date'),
    ])
    // 却下された提案は表示しない
    setEvents((data ?? []).filter((e: ScheduleRow) => e.status !== 'declined'))
    setDueGoals(((gs as Goal[] | null) ?? []).filter((g) => g.status !== 'dropped'))
    setDueActions(((nas as NextAction[] | null) ?? []))
  }, [year, month, me.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('members').select('*')
      .eq('company_id', me.company_id).eq('status', 'active')
      .then(({ data }) => setColleagues((data as Member[]) ?? []))
  }, [me.company_id])

  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const evDay = (e: ScheduleRow) => new Date(e.starts_at).getDate()
  const evStart = (e: ScheduleRow) =>
    new Date(e.starts_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const evEnd = (e: ScheduleRow) =>
    new Date(e.ends_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const isMine = (e: ScheduleRow) => e.member_id === me.id

  const dayEvents = events.filter((e) => evDay(e) === selDay)
  const otherEvents = dayEvents.filter((e) => !isMine(e))
  const dueDay = (d: string) => Number(d.slice(8, 10))
  const dayDueGoals = dueGoals.filter((g) => dueDay(g.due_date) === selDay)
  const dayDueActions = dueActions.filter((a) => a.due_date && dueDay(a.due_date) === selDay)
  const hasDue = (d: number) =>
    dueGoals.some((g) => dueDay(g.due_date) === d) ||
    dueActions.some((a) => a.due_date && dueDay(a.due_date) === d)

  const conflict =
    draft &&
    otherEvents.some((e) =>
      toMin(draft.start) < toMin(evEnd(e)) && toMin(evStart(e)) < toMin(draft.end))

  // タイムライン上の座標 → 30分スナップの分
  const posToMin = (ev: React.PointerEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect()
    const ratio = (ev.clientY - rect.top) / rect.height
    return Math.max(TL_START, Math.min(TL_END,
      Math.round((TL_START + ratio * (TL_END - TL_START)) / 30) * 30))
  }
  const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

  // 上から下へドラッグ → その範囲で予定下書き（クリックだけなら1時間）
  const dragStart = (ev: React.PointerEvent<HTMLDivElement>) => {
    const m = posToMin(ev)
    setDragFrom(m)
    setDraft({ start: fmtMin(m), end: fmtMin(Math.min(m + 60, TL_END)) })
  }
  const dragMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (dragFrom === null) return
    const m = posToMin(ev)
    if (m > dragFrom) setDraft({ start: fmtMin(dragFrom), end: fmtMin(m) })
  }
  const dragEnd = () => setDragFrom(null)

  const add = async () => {
    if (!draft) return
    const mk = (t: string) => new Date(year, month, selDay, ...t.split(':').map(Number) as [number, number]).toISOString()
    setErr('')
    const { data: created, error } = await supabase.from('schedules').insert({
      company_id: me.company_id, member_id: me.id, title,
      starts_at: mk(draft.start), ends_at: mk(draft.end), with_meet: meet,
      ...(proposeTo ? { status: 'proposed', proposed_by: me.id, to_member_id: proposeTo } : {}),
    }).select('id').single()
    if (error) return setErr(`予定を保存できませんでした（${error.message}）`)
    if (!proposeTo && created) gcalSync(created.id) // 提案は承認された時点で同期する

    setDraft(null); setTitle(''); setMeet(true); setProposeTo('')
    load()
  }

  /* 提案への応答。承認・修正・却下できるのは宛先（to_member_id）本人だけ */
  const nameOf = (id: string | null) => colleagues.find((m) => m.id === id)?.name ?? '—'
  const evDate = (e: ScheduleRow) =>
    new Date(e.starts_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  const incoming = events.filter((e) => e.status === 'proposed' && e.to_member_id === me.id)
  const outgoing = events.filter((e) => e.status === 'proposed' && e.proposed_by === me.id)

  const respond = async (e: ScheduleRow, patch: Partial<ScheduleRow>) => {
    setErr('')
    const { error } = await supabase.from('schedules').update(patch).eq('id', e.id)
    if (error) return setErr(`更新できませんでした（${error.message}）`)
    if (patch.status === 'confirmed') gcalSync(e.id)
    if (patch.status === 'declined') gcalSync(e.id, 'delete')
    setEditProp(null)
    load()
  }
  // 時刻を変えて提案し返す: proposed_by / to_member_id をスワップしてボールを相手に渡す
  const counter = (e: ScheduleRow) => {
    const mkOn = (t: string) => {
      const d = new Date(e.starts_at)
      const [h, m] = t.split(':').map(Number)
      d.setHours(h, m, 0, 0)
      return d.toISOString()
    }
    respond(e, {
      starts_at: mkOn(pStart), ends_at: mkOn(pEnd),
      proposed_by: me.id, to_member_id: e.proposed_by, status: 'proposed',
    })
  }

  const block = (s: string, e: string) => ({
    top: `${((toMin(s) - TL_START) / (TL_END - TL_START)) * 100}%`,
    height: `${((toMin(e) - toMin(s)) / (TL_END - TL_START)) * 100}%`,
  })

  return (
    <>
      <div className="card">
        <h2>{year}年{month + 1}月 <span className="tag">Googleカレンダー連携</span></h2>
        <div className="cal-grid">
          {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
            <div key={w} className="cal-wday">{w}</div>
          ))}
          {cells.map((d, i) =>
            d === null ? <div key={i} /> : (
              <button key={i}
                className={`cal-day ${d === selDay ? 'sel' : ''} ${d === base.getDate() ? 'today' : ''}`}
                onClick={() => { setSelDay(d); setDraft(null) }}>
                {d}
                <span className="cal-dots">
                  {events.filter((e) => evDay(e) === d).slice(0, 3).map((e, j) => (
                    <i key={j} className={isMine(e) ? 'dot-me' : 'dot-boss'} />
                  ))}
                  {hasDue(d) && <i className="dot-task" />}
                </span>
              </button>
            )
          )}
        </div>
      </div>

      <div className="card">
        <h2>{month + 1}月{selDay}日 <span className="tag">空き時間をタップで予定作成</span></h2>
        <div className="tl-legend">
          <span><i className="dot-me" /> 自分</span>
          <span><i className="dot-boss" /> 他のメンバー・全社</span>
          <span><i className="dot-task" /> 目標・やることの期日</span>
        </div>
        {(dayDueGoals.length > 0 || dayDueActions.length > 0) && (
          <div className="due-list">
            {dayDueGoals.map((g) => (
              <div key={g.id} className="due-row">
                <span className="badge badge-yellow">目標の期日</span>
                <span className="due-title">{g.title}</span>
                {g.status === 'done' && <span className="badge badge-blue">達成</span>}
              </div>
            ))}
            {dayDueActions.map((a) => (
              <div key={a.id} className="due-row">
                <span className="badge badge-gray">やること</span>
                <span className="due-title">{a.title}</span>
                {a.status === 'done' && <span className="badge badge-blue">完了</span>}
              </div>
            ))}
          </div>
        )}
        <div className="timeline"
          onPointerDown={dragStart} onPointerMove={dragMove}
          onPointerUp={dragEnd} onPointerLeave={dragEnd}>
          {Array.from({ length: (TL_END - TL_START) / 60 }, (_, i) => (
            <div key={i} className="tl-hour" style={{ top: `${(i / ((TL_END - TL_START) / 60)) * 100}%` }}>
              {String(8 + i).padStart(2, '0')}:00
            </div>
          ))}
          {dayEvents.map((e) => (
            <div key={e.id}
              className={`tl-block ${isMine(e) ? 'me' : 'boss'} ${e.status === 'proposed' ? 'proposed' : ''}`}
              style={block(evStart(e), evEnd(e))} onPointerDown={(ev) => ev.stopPropagation()}>
              <b>{e.title}</b> {evStart(e)}–{evEnd(e)}
              {e.with_meet && (e.meet_url
                ? <> · <a href={e.meet_url} target="_blank" rel="noreferrer">Meet</a></>
                : ' · Meet')}
              {e.status === 'proposed' && '（提案中）'}
            </div>
          ))}
          {draft && (
            <div className={`tl-block draft ${conflict ? 'conflict' : ''}`}
              style={block(draft.start, draft.end)}>
              <b>{title || '新しい予定'}</b> {draft.start}–{draft.end}
            </div>
          )}
        </div>

        {draft && (
          <div className="draft-form">
            {conflict && <div className="notice warn">⚠ 他のメンバーの予定と重なっています。別の時間帯を選んでください</div>}
            <label>タイトル</label>
            <div className="preset-row">
              {TITLE_PRESETS.map((p) => (
                <button key={p} className={`preset-chip ${title === p ? 'sel' : ''}`}
                  onClick={() => setTitle(p)}>{p}</button>
              ))}
            </div>
            <input type="text" placeholder="またはタイトルを入力" value={title}
              onChange={(e) => setTitle(e.target.value)} />
            <div className="draft-times">
              <input type="time" aria-label="開始時刻" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              <span>–</span>
              <input type="time" aria-label="終了時刻" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={meet} onChange={(e) => setMeet(e.target.checked)} style={{ width: 'auto' }} />
              Google Meet のリンクを付ける
            </label>
            <label htmlFor="sc-to">この予定の扱い</label>
            <select id="sc-to" value={proposeTo} onChange={(e) => setProposeTo(e.target.value)}>
              <option value="">すぐ確定する</option>
              {colleagues.filter((m) => m.id !== me.id).map((m) => (
                <option key={m.id} value={m.id}>{m.name}さんに提案する（承認をもらう）</option>
              ))}
            </select>
            {err && <div className="notice warn">{err}</div>}
            <button className="btn-primary" disabled={!title || !!conflict} onClick={add}>
              {proposeTo ? `${nameOf(proposeTo)}さんに提案を送る` : '追加してカレンダーに同期'}
            </button>
          </div>
        )}
        {!draft && <div className="notice">タイムラインの空き時間をタップすると、そこに予定を作成できます</div>}
      </div>

      {incoming.length > 0 && (
        <div className="card">
          <h2>あなたへの提案 <span className="tag">{incoming.length}件</span></h2>
          {incoming.map((e) => (
            <div key={e.id} className="proposal">
              <div className="proposal-title">
                <b>{e.title}</b> {evDate(e)} {evStart(e)}–{evEnd(e)}
                {e.with_meet && ' · Meet'} — {nameOf(e.proposed_by)}さんから
              </div>
              {editProp?.id === e.id ? (
                <div className="draft-times" style={{ flexWrap: 'wrap' }}>
                  <input type="time" aria-label="開始時刻" value={pStart} onChange={(ev) => setPStart(ev.target.value)} />
                  <span>–</span>
                  <input type="time" aria-label="終了時刻" value={pEnd} onChange={(ev) => setPEnd(ev.target.value)} />
                  <button className="btn-primary" style={{ margin: 0 }}
                    disabled={!pStart || !pEnd || pEnd <= pStart} onClick={() => counter(e)}>
                    この時間で再提案
                  </button>
                  <button className="btn-outline" onClick={() => setEditProp(null)}>キャンセル</button>
                </div>
              ) : (
                <div className="form-actions" style={{ marginTop: 8 }}>
                  <button className="btn-primary" style={{ margin: 0 }}
                    onClick={() => respond(e, { status: 'confirmed' })}>承認</button>
                  <button className="btn-outline"
                    onClick={() => { setEditProp(e); setPStart(isoHm(e.starts_at)); setPEnd(isoHm(e.ends_at)) }}>
                    時間を修正して再提案
                  </button>
                  <button className="btn-outline" onClick={() => respond(e, { status: 'declined' })}>却下</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="card">
          <h2>承認待ちの提案 <span className="tag">相手の返事待ち</span></h2>
          <div className="list">
            {outgoing.map((e) => (
              <div key={e.id} className="list-item">
                <div className="when">{evDate(e)} {evStart(e)}–{evEnd(e)}</div>
                <div className="title">{e.title}</div>
                <span className="badge badge-yellow">{nameOf(e.to_member_id)}さんの承認待ち</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- 稼働表CSV・請求書（名簿タブとプロフィールで共用） ---------- */
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`
const hmm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`
const monthRange = (month: string) => {
  const [y, mo] = month.split('-').map(Number)
  return { from: `${month}-01`, to: new Date(y, mo, 1).toLocaleDateString('sv-SE'), y, mo }
}

// その月の実働合計（分）。休憩を引いた workedMinutes を日ごとに合算
const monthWorkedMinutes = async (memberId: string, month: string) => {
  const { from, to } = monthRange(month)
  const { data } = await supabase.from('attendances').select('*, breaks(*)')
    .eq('member_id', memberId).gte('work_date', from).lt('work_date', to)
  return ((data as Attendance[]) ?? []).reduce((sum, a) => sum + workedMinutes(a), 0)
}

// 出勤簿CSV（現行スプレッドシートの列構成に合わせる。最初の中抜け＝ランチ扱い）
const exportKintaiCsv = async (targets: Pick<Member, 'id' | 'name'>[], month: string) => {
  const { from, to, y, mo } = monthRange(month)
  const atts: Attendance[] = []
  const reps: ReportRow[] = []
  // ponytail: メンバーごとに直列fetch。人数が増えて遅くなったらin()で一括に
  for (const m of targets) {
    const [{ data: a }, { data: r }] = await Promise.all([
      supabase.from('attendances').select('*, breaks(*)').eq('member_id', m.id)
        .gte('work_date', from).lt('work_date', to),
      supabase.from('daily_reports').select('*').eq('member_id', m.id)
        .gte('work_date', from).lt('work_date', to),
    ])
    atts.push(...((a as Attendance[]) ?? []))
    reps.push(...((r as ReportRow[]) ?? []))
  }
  const t = (iso?: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '')
  const dur = (min: number) => (min > 0 ? hmm(min) : '')
  const bMin = (b?: Break) =>
    b?.ended_at ? (new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 60000 : 0
  const rows = [[
    '氏名', '日付', '曜日', '出勤', 'ランチ入り', 'ランチ戻り', '退勤',
    '中抜け開始1', '中抜け戻り1', '中抜け開始2', '中抜け戻り2', '中抜け開始3', '中抜け戻り3',
    '総時間', '休憩', '中抜け1', '中抜け2', '実労働時間', '業務内容',
  ]]
  const days = new Date(y, mo, 0).getDate()
  for (const m of targets) {
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`
      const dow = '日月火水木金土'[new Date(y, mo - 1, d).getDay()]
      const a = atts.find((x) => x.member_id === m.id && x.work_date === date)
      const bs = [...(a?.breaks ?? [])].sort((p, q) => (p.started_at < q.started_at ? -1 : 1))
      const gross = a?.clock_in && a?.clock_out
        ? (new Date(a.clock_out).getTime() - new Date(a.clock_in).getTime()) / 60000 : 0
      const allBreaks = bs.reduce((s, b) => s + bMin(b), 0)
      const rep = reps.find((r) => r.member_id === m.id && r.work_date === date)
      rows.push([
        m.name, date, dow,
        t(a?.clock_in), t(bs[0]?.started_at), t(bs[0]?.ended_at), t(a?.clock_out),
        t(bs[1]?.started_at), t(bs[1]?.ended_at), t(bs[2]?.started_at), t(bs[2]?.ended_at),
        t(bs[3]?.started_at), t(bs[3]?.ended_at),
        dur(gross), dur(bMin(bs[0])), dur(bMin(bs[1])), dur(bMin(bs[2])),
        dur(Math.max(0, gross - allBreaks)),
        // 業務内容: 日報の実績 > 日報タブの「やること」 > 出勤時の今日の予定
        rep?.body || rep?.plan || a?.plan || '',
      ])
    }
  }
  const csv = '\uFEFF' + rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const el = document.createElement('a')
  el.href = url
  el.download = `出勤簿_${month}.csv`
  el.click()
  URL.revokeObjectURL(url)
}

const invoiceTotal = (inv: Invoice) =>
  Math.round((inv.minutes / 60) * inv.hourly_rate) +
  inv.expenses.reduce((s, e) => s + e.amount, 0)

// 印刷用の請求書ビュー（本人・管理者の両方から使う）
function InvoiceView({ inv, memberName, onClose }: { inv: Invoice; memberName: string; onClose: () => void }) {
  const [companyName, setCompanyName] = useState('')
  useEffect(() => {
    supabase.from('companies').select('name').limit(1).maybeSingle()
      .then(({ data }) => setCompanyName((data as { name?: string } | null)?.name ?? ''))
  }, [])
  const labor = Math.round((inv.minutes / 60) * inv.hourly_rate)
  return (
    <div className="invoice-page">
      <div className="form-actions no-print" style={{ marginTop: 0 }}>
        <button className="btn-outline" onClick={onClose}>← 戻る</button>
        <button className="btn-primary" style={{ margin: 0 }} onClick={() => window.print()}>印刷 / PDF保存</button>
      </div>
      <div className="invoice">
        <h1>請求書</h1>
        <div className="invoice-head">
          <div>
            <div className="invoice-to">{companyName} 御中</div>
            <div className="invoice-meta">対象期間: {inv.month.replace('-', '年')}月分</div>
            <div className="invoice-meta">発行日: {new Date(inv.issued_at).toLocaleDateString('ja-JP')}</div>
          </div>
          <div className="invoice-from">
            <div>{memberName}</div>
            {inv.status === 'paid' && <span className="badge badge-blue">支払済み</span>}
          </div>
        </div>
        <table className="invoice-table">
          <thead>
            <tr><th>項目</th><th>数量</th><th>単価</th><th>金額</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>業務委託料（実働 {hmm(inv.minutes)}）</td>
              <td>{(inv.minutes / 60).toFixed(2)} h</td>
              <td>{yen(inv.hourly_rate)}</td>
              <td>{yen(labor)}</td>
            </tr>
            {inv.expenses.map((e, i) => (
              <tr key={i}><td>{e.label}（経費）</td><td>—</td><td>—</td><td>{yen(e.amount)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="invoice-total">合計 {yen(invoiceTotal(inv))}</div>
      </div>
    </div>
  )
}

/* ---------- お金管理モード（プロフィールから入る全画面モード） ---------- */
const STANCE_LABELS: Record<MoneyProfile['stance'], string> = {
  president: '社長（会社代表）',
  sole_proprietor: '個人事業主',
  part_time: 'アルバイト',
  employee: '会社員',
}

// 扶養の壁の候補（金額円 → 短い説明）。2025年の税制改正後の目安
const WALLS: [number, string][] = [
  [1030000, '103万円: 住民税がかかり始める目安（自治体により異なる）'],
  [1060000, '106万円: 従業員51人以上の会社で週20時間以上働くと社会保険に加入'],
  [1230000, '123万円: 所得税がかかり始めるライン（2025年改正で103万円から引き上げ）'],
  [1300000, '130万円: 社会保険の扶養から外れるライン'],
  [1500000, '150万円: 配偶者特別控除が満額でなくなる目安'],
]

// Excel風の金額セル: 表示値をそのまま編集し、Enter/フォーカスアウトで確定（稼働表と同じ操作感）
function CellNum({ value, label, placeholder = '0', onCommit }: {
  value: number; label: string; placeholder?: string; onCommit: (v: number) => void
}) {
  return (
    <input type="text" inputMode="numeric" className="pt-mini" aria-label={label} placeholder={placeholder}
      key={value} defaultValue={value || ''}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }}
      onBlur={(e) => {
        const v = Math.round(Number(e.target.value.replace(/[,¥\s]/g, '')))
        if (!Number.isNaN(v) && v >= 0 && v !== value) onCommit(v)
      }} />
  )
}

// 表の最下行から直接入力して追加するExcel風の行（日付/月・項目・金額）
function TableAddRow({ dateKind, lead = 0, tail = 1, placeholder, onAdd }: {
  dateKind: 'date' | 'month'
  lead?: number // 日付と項目の間の空セル数
  tail?: number // 金額より後ろのセル数（先頭に追加ボタンを置く）
  placeholder: string
  onAdd: (date: string, label: string, amount: number) => void
}) {
  const [d, setD] = useState(dateKind === 'month' ? today().slice(0, 7) : today())
  const [l, setL] = useState('')
  const [a, setA] = useState('')
  const amt = Math.round(Number(a.replace(/[,¥\s]/g, '')))
  const ok = l.trim() !== '' && amt > 0
  const submit = () => { if (ok) { onAdd(d, l.trim(), amt); setL(''); setA('') } }
  const onKey = (e: { key: string; nativeEvent: { isComposing: boolean } }) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
  }
  return (
    <tr className="pt-add-row">
      <td className="pt-cell">
        <input type={dateKind} className="pt-mini pt-mini-date" aria-label={dateKind === 'month' ? '月' : '日付'}
          value={d} onChange={(e) => setD(e.target.value)} />
      </td>
      {Array.from({ length: lead }, (_, i) => <td key={i} className="pt-cell" />)}
      <td className="pt-cell">
        <input type="text" className="pt-mini" placeholder={placeholder} aria-label="項目"
          value={l} onChange={(e) => setL(e.target.value)} onKeyDown={onKey} />
      </td>
      <td className="pt-cell pt-yen">
        <input type="text" inputMode="numeric" className="pt-mini" placeholder="金額" aria-label="金額"
          value={a} onChange={(e) => setA(e.target.value)} onKeyDown={onKey} />
      </td>
      <td className="pt-cell" colSpan={tail}>
        <button className="link-btn" disabled={!ok} onClick={submit}>＋追加</button>
      </td>
    </tr>
  )
}

// 住所→緯度経度（OpenStreetMap Nominatim。失敗してもnullで進む）
const geocode = async (addr: string): Promise<{ lat: number; lng: number } | null> => {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`)
    const list = await res.json()
    return list?.[0] ? { lat: Number(list[0].lat), lng: Number(list[0].lon) } : null
  } catch {
    return null
  }
}

// 支出マップ（緯度経度のある経費をピン表示）
function ExpenseMap({ rows }: { rows: MoneyExpense[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const map = L.map(el).setView([rows[0]!.lat!, rows[0]!.lng!], 13)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    const group = L.featureGroup(rows.map((e) =>
      L.circleMarker([e.lat!, e.lng!], { radius: 9, color: '#00654f', fillColor: '#00654f', fillOpacity: .7 })
        .bindPopup(`${e.occurred_on.slice(5).replace('-', '/')} ${e.store ?? e.label} ${yen(e.amount)}`)
    )).addTo(map)
    map.fitBounds(group.getBounds().pad(0.3))
    return () => { map.remove() }
  }, [rows])
  return <div ref={ref} className="money-map" />
}

function MoneyMode({ me, onClose }: { me: Member; onClose: () => void }) {
  const [profile, setProfile] = useState<MoneyProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [picking, setPicking] = useState(false)
  const [stance, setStance] = useState<MoneyProfile['stance']>('employee')
  const [expenses, setExpenses] = useState<MoneyExpense[]>([])
  const [incomes, setIncomes] = useState<MoneyIncome[]>([])
  const [invs, setInvs] = useState<Invoice[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [month, setMonth] = useState(today().slice(0, 7))
  const [err, setErr] = useState('')
  // 経費フォーム
  const [date, setDate] = useState(today())
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [linkInv, setLinkInv] = useState('')
  const [busy, setBusy] = useState(false)

  const isPresident = profile?.stance === 'president' && me.role === 'admin'
  // 経費の区分はフォームのボタンで切替（初期値は立場から: 個人事業主は個人の帳簿、それ以外は会社提出）
  const [scope, setScope] = useState<MoneyExpense['scope']>('company')
  const [calDay, setCalDay] = useState('') // カレンダーで選択中の日（YYYY-MM-DD）
  const [menuOpen, setMenuOpen] = useState(false) // 経費カードの☰メニュー
  const [ocr, setOcr] = useState(false) // レシート読み取り中
  const [ocrMeta, setOcrMeta] = useState<{ store: string | null; address: string | null }>({ store: null, address: null })
  const [recurring, setRecurring] = useState<MoneyRecurring[]>([])
  const [budget, setBudget] = useState<number | null>(null) // 会社の月間経費予算
  // 固定費フォーム
  const [recLabel, setRecLabel] = useState('')
  const [recAmount, setRecAmount] = useState('')
  const [recDay, setRecDay] = useState('1')
  // カレンダー下の表示切替: 年間の収支確認 / 経費の登録
  const [moneyView, setMoneyView] = useState<'year' | 'entry'>('entry')
  // 扶養の壁QA: nullは非表示。stepを進めて最後にrec（推奨額）を出す
  const [wallQA, setWallQA] = useState<{ step: number; rec?: number | null; note?: string } | null>(null)

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('money_profiles').select('*')
      .eq('member_id', me.id).maybeSingle()
    setProfile((p as MoneyProfile | null) ?? null)
    setLoaded(true)
    if (!p) return
    setScope((p as MoneyProfile).stance === 'sole_proprietor' ? 'personal' : 'company')
    const president = (p as MoneyProfile).stance === 'president' && me.role === 'admin'
    const [{ data: exps }, { data: invRows }, { data: rows }, { data: recRows }, { data: comp }, { data: incRows }] = await Promise.all([
      // RLSで見える範囲＝自分の全経費＋（管理者なら）会社提出分
      supabase.from('money_expenses').select('*').order('occurred_on', { ascending: false }),
      president
        ? supabase.from('invoices').select('*').order('issued_at', { ascending: false })
        : supabase.from('invoices').select('*').eq('member_id', me.id).order('issued_at', { ascending: false }),
      supabase.from('members').select('id, name').eq('company_id', me.company_id),
      supabase.from('money_recurring').select('*').eq('member_id', me.id).order('created_at'),
      supabase.from('companies').select('expense_budget').eq('id', me.company_id).maybeSingle(),
      supabase.from('money_incomes').select('*').eq('member_id', me.id).order('month'),
    ])
    setIncomes((incRows as MoneyIncome[]) ?? [])
    const memberRows = (rows as Pick<Member, 'id' | 'name'>[]) ?? []
    const ids = new Set(memberRows.map((m) => m.id))
    setNames(Object.fromEntries(memberRows.map((m) => [m.id, m.name])))
    setInvs(((invRows as Invoice[]) ?? []).filter((v) => ids.has(v.member_id)))
    setRecurring((recRows as MoneyRecurring[]) ?? [])
    setBudget((comp as { expense_budget?: number | null } | null)?.expense_budget ?? null)

    // 固定費: 今月分がまだ無ければ経費行を自動生成（本人が開いたタイミングで）
    // ponytail: 複数端末で同時に開くと重複し得る。実害が出たらDB側でunique制約に
    let expList = ((exps as MoneyExpense[]) ?? []).filter((e) => e.company_id === me.company_id)
    const curMonth = today().slice(0, 7)
    const curDay = Number(today().slice(8))
    const toGen = ((recRows as MoneyRecurring[]) ?? []).filter((r) =>
      r.active && r.day_of_month <= curDay &&
      !expList.some((e) => e.recurring_id === r.id && e.occurred_on.startsWith(curMonth)))
    if (toGen.length > 0) {
      const { data: created } = await supabase.from('money_expenses').insert(toGen.map((r) => ({
        company_id: r.company_id, member_id: r.member_id, scope: r.scope,
        occurred_on: `${curMonth}-${String(r.day_of_month).padStart(2, '0')}`,
        label: r.label, amount: r.amount, receipt_path: null, invoice_id: null,
        status: r.scope === 'company' ? 'submitted' : 'approved', recurring_id: r.id,
      }))).select()
      expList = [...((created as MoneyExpense[]) ?? []), ...expList]
    }
    setExpenses(expList)
  }, [me.id, me.role, me.company_id])

  useEffect(() => { load() }, [load])

  const createProfile = async () => {
    setErr('')
    const { error } = profile
      ? await supabase.from('money_profiles').update({ stance }).eq('id', profile.id)
      : await supabase.from('money_profiles').insert({ member_id: me.id, stance })
    if (error) return setErr(`保存できませんでした（${error.message}）`)
    setPicking(false)
    load()
  }

  const addExpense = async () => {
    const amt = Number(amount)
    if (!label || !amt) return
    setErr(''); setBusy(true)
    try {
      let receipt_path: string | null = null
      if (file) {
        receipt_path = `${me.user_id}/${crypto.randomUUID()}-${file.name}`
        const { error } = await supabase.storage.from('receipts').upload(receipt_path, file)
        if (error) throw new Error(error.message)
      }
      // OCRで住所が取れていればマップ用に座標化（失敗しても登録は進める）
      const geo = ocrMeta.address ? await geocode(ocrMeta.address) : null
      const { error } = await supabase.from('money_expenses').insert({
        company_id: me.company_id, member_id: me.id, scope,
        occurred_on: date, label, amount: amt, receipt_path,
        invoice_id: linkInv || null,
        status: scope === 'company' ? 'submitted' : 'approved',
        store: ocrMeta.store, address: ocrMeta.address,
        lat: geo?.lat ?? null, lng: geo?.lng ?? null,
      })
      if (error) throw new Error(error.message)
      setLabel(''); setAmount(''); setFile(null); setLinkInv('')
      setOcrMeta({ store: null, address: null })
      load()
    } catch (e) {
      setErr(`登録できませんでした（${(e as Error).message}）`)
    } finally {
      setBusy(false)
    }
  }

  // レシート画像を選んだらClaudeで店名・金額・日付を読み取ってフォームに反映
  const pickReceipt = async (f: File | null) => {
    setFile(f)
    if (!f || !f.type.startsWith('image/')) return
    setOcr(true)
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = rej
        r.readAsDataURL(f)
      })
      const { data } = await supabase.functions.invoke('receipt-ocr', {
        body: { image: b64, media_type: f.type },
      })
      const d = data as { ok?: boolean; store?: string; amount?: number; date?: string; address?: string } | null
      if (d?.ok) {
        if (d.store && !label) setLabel(d.store)
        if (d.amount && !amount) setAmount(String(d.amount))
        if (d.date) setDate(d.date)
        setOcrMeta({ store: d.store ?? null, address: d.address ?? null })
      }
    } catch { /* 読み取れなくても手入力できるので黙ってフォールバック */ } finally {
      setOcr(false)
    }
  }

  const updateExpense = async (id: string, patch: Partial<MoneyExpense>) => {
    const { error } = await supabase.from('money_expenses').update(patch).eq('id', id)
    if (error) return setErr(`更新できませんでした（${error.message}）`)
    load()
  }

  const addRecurring = async () => {
    const amt = Number(recAmount)
    if (!recLabel || !amt) return
    const { error } = await supabase.from('money_recurring').insert({
      company_id: me.company_id, member_id: me.id, scope,
      label: recLabel, amount: amt,
      day_of_month: Math.min(28, Math.max(1, Number(recDay) || 1)),
    })
    if (error) return setErr(`固定費を追加できませんでした（${error.message}）`)
    setRecLabel(''); setRecAmount(''); setRecDay('1')
    load()
  }

  const toggleRecurring = async (r: MoneyRecurring) => {
    await supabase.from('money_recurring').update({ active: !r.active }).eq('id', r.id)
    load()
  }

  const removeRecurring = async (r: MoneyRecurring) => {
    if (!confirm(`固定費「${r.label}」を削除しますか？（生成済みの経費行は残ります）`)) return
    await supabase.from('money_recurring').delete().eq('id', r.id)
    load()
  }

  const saveBudget = async (v: string) => {
    const n = Math.max(0, Math.round(Number(v.replace(/[,¥\s]/g, '')) || 0))
    const { error } = await supabase.from('companies')
      .update({ expense_budget: n || null }).eq('id', me.company_id)
    if (error) return setErr('予算を保存できませんでした（管理者のみ変更できます）')
    setBudget(n || null)
  }

  const addIncome = async (month: string, label: string, amount: number) => {
    const { error } = await supabase.from('money_incomes').insert({
      company_id: me.company_id, member_id: me.id, month, label, amount,
    })
    if (error) return setErr(`売上を登録できませんでした（${error.message}）`)
    load()
  }

  // 年間の収支セルの直接編集: 表示合計がその値になるよう「売上」「経費」ラベルの調整行を差し替える。
  // 請求書やレシート付き経費など明細のある分は動かせないので、その分より小さい値は切り上げる
  const setMonthIncome = async (m: string, total: number, currentTotal: number) => {
    const manual = incomes.filter((i) => i.month === m && i.label === '売上').reduce((s, i) => s + i.amount, 0)
    const v = Math.max(0, total - (currentTotal - manual))
    await supabase.from('money_incomes').delete().eq('member_id', me.id).eq('month', m).eq('label', '売上')
    if (v > 0) {
      await supabase.from('money_incomes').insert({
        company_id: me.company_id, member_id: me.id, month: m, label: '売上', amount: v,
      })
    }
    load()
  }
  const setMonthExpense = async (m: string, total: number, currentTotal: number) => {
    const day1 = `${m}-01`
    const manual = expenses.filter((e) => e.member_id === me.id && e.label === '経費' && e.occurred_on === day1 && !e.receipt_path)
      .reduce((s, e) => s + e.amount, 0)
    const v = Math.max(0, total - (currentTotal - manual))
    await supabase.from('money_expenses').delete()
      .eq('member_id', me.id).eq('label', '経費').eq('occurred_on', day1).is('receipt_path', null)
    if (v > 0) {
      await supabase.from('money_expenses').insert({
        company_id: me.company_id, member_id: me.id, scope,
        occurred_on: day1, label: '経費', amount: v, receipt_path: null, invoice_id: null,
        status: scope === 'company' ? 'submitted' : 'approved',
      })
    }
    load()
  }

  // 表の最下行からの直接追加（レシートなしの簡易登録）
  const addExpenseInline = async (occurred_on: string, label: string, amount: number) => {
    const { error } = await supabase.from('money_expenses').insert({
      company_id: me.company_id, member_id: me.id, scope,
      occurred_on, label, amount, receipt_path: null, invoice_id: null,
      status: scope === 'company' ? 'submitted' : 'approved',
    })
    if (error) return setErr(`登録できませんでした（${error.message}）`)
    load()
  }

  const removeIncome = async (i: MoneyIncome) => {
    if (!confirm(`売上「${i.label}」を削除しますか？`)) return
    await supabase.from('money_incomes').delete().eq('id', i.id)
    load()
  }

  const saveWall = async (v: number | null) => {
    if (!profile) return
    const { error } = await supabase.from('money_profiles').update({ wall_amount: v }).eq('id', profile.id)
    if (error) return setErr(`保存できませんでした（${error.message}）`)
    setProfile({ ...profile, wall_amount: v })
    setWallQA(null)
  }

  const removeExpense = async (e: MoneyExpense) => {
    if (!confirm(`「${e.label}」を削除しますか？`)) return
    if (e.receipt_path) await supabase.storage.from('receipts').remove([e.receipt_path])
    await supabase.from('money_expenses').delete().eq('id', e.id)
    load()
  }

  const openReceipt = async (path: string) => {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 3600)
    if (error || !data) return setErr('レシートを開けませんでした')
    window.open(data.signedUrl, '_blank')
  }

  const markPaid = async (inv: Invoice) => {
    setErr('')
    const { error } = await supabase.from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', inv.id)
    if (error) return setErr(`更新できませんでした（${error.message}）`)
    load()
  }

  // 個人事業主向け: 年間の収入（支払済み請求書）と経費をCSVで出力
  const exportMoneyCsv = () => {
    const year = month.slice(0, 4)
    const rows = [['日付', '区分', '項目', '金額']]
    for (const v of invs.filter((v) => v.member_id === me.id && v.status === 'paid' && v.month.startsWith(year))) {
      rows.push([`${v.month}-01`, '収入', `業務委託料（${v.month.replace('-', '年')}月分）`, String(invoiceTotal(v))])
    }
    for (const i of incomes.filter((i) => i.month.startsWith(year))) {
      rows.push([`${i.month}-01`, '収入', i.label, String(i.amount)])
    }
    for (const e of expenses.filter((e) => e.member_id === me.id && e.occurred_on.startsWith(year))) {
      rows.push([e.occurred_on, '経費', e.label, String(-e.amount)])
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const el = document.createElement('a')
    el.href = url
    el.download = `お金の記録_${year}.csv`
    el.click()
    URL.revokeObjectURL(url)
  }

  const myInvs = invs.filter((v) => v.member_id === me.id)
  const monthExpenses = expenses.filter((e) => e.occurred_on.startsWith(month))
  const monthPaid = invs.filter((v) => v.month === month && v.status === 'paid')

  // 稼働管理表と同じExcel風テーブルで経費を一覧する
  const expenseTable = (rows: MoneyExpense[], showName: boolean) => (
    <div className="plan-table-wrap">
      <table className="plan-table">
        <thead>
          <tr>
            <th>日付</th>{showName && <th>メンバー</th>}<th>項目</th><th>金額</th><th>区分</th><th>状態</th><th>レシート</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const mine = e.member_id === me.id // 自分の行はセルを直接編集できる（Excel風）
            return (
            <tr key={e.id}
              onContextMenu={mine ? (ev) => { ev.preventDefault(); removeExpense(e) } : undefined}>
              <td className={mine ? 'pt-cell' : 'pt-date'}>
                {mine ? (
                  <input type="date" className="pt-mini pt-mini-date" aria-label="日付"
                    key={`d-${e.id}-${e.occurred_on}`} defaultValue={e.occurred_on}
                    onBlur={(ev) => { const v = ev.target.value; if (v && v !== e.occurred_on) updateExpense(e.id, { occurred_on: v }) }} />
                ) : e.occurred_on.slice(5).replace('-', '/')}
                {e.amount === 0 && <span className="badge badge-yellow">金額未入力</span>}
              </td>
              {showName && <td className="pt-cell">{names[e.member_id] ?? '—'}</td>}
              <td className="pt-cell">
                {mine ? (
                  <input type="text" className="pt-mini" placeholder="項目" aria-label="項目"
                    key={`l-${e.id}-${e.label}`} defaultValue={e.label}
                    onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== e.label) updateExpense(e.id, { label: v }) }} />
                ) : e.label}
              </td>
              <td className="pt-cell pt-yen">
                {mine ? (
                  <CellNum value={e.amount} label="金額" placeholder="金額"
                    onCommit={(v) => { if (v > 0) updateExpense(e.id, { amount: v }) }} />
                ) : yen(e.amount)}
              </td>
              <td className="pt-cell">
                {mine ? (
                  <select aria-label="区分" key={`s-${e.id}-${e.scope}`} className="pt-mini" defaultValue={e.scope}
                    onChange={(ev) => updateExpense(e.id, { scope: ev.target.value as MoneyExpense['scope'] })}>
                    <option value="company">会社</option>
                    <option value="personal">個人</option>
                  </select>
                ) : e.scope === 'company' ? '会社' : '個人'}
              </td>
              <td className="pt-cell">
                {e.scope !== 'company' ? '—'
                  : isPresident && e.status === 'submitted' ? (
                    <>
                      <button className="link-btn" onClick={() => updateExpense(e.id, { status: 'approved' })}>承認</button>
                      <button className="link-btn" style={{ color: 'var(--danger)' }}
                        onClick={() => updateExpense(e.id, { status: 'rejected' })}>差し戻し</button>
                    </>
                  ) : (
                    <span className={`badge ${e.status === 'approved' ? 'badge-blue' : e.status === 'rejected' ? 'badge-yellow' : 'badge-gray'}`}>
                      {e.status === 'approved' ? '承認済み' : e.status === 'rejected' ? '差し戻し' : '承認待ち'}
                    </span>
                  )}
              </td>
              <td className="pt-cell">
                {e.receipt_path && (
                  <button className="link-btn" onClick={() => openReceipt(e.receipt_path!)}>表示</button>
                )}
              </td>
              <td className="pt-cell pt-del-cell">
                {mine && (
                  <button className="link-btn pt-del" aria-label="削除" title="削除"
                    onClick={() => removeExpense(e)}>✕</button>
                )}
              </td>
            </tr>
            )
          })}
          <TableAddRow dateKind="date" lead={showName ? 1 : 0} tail={4}
            placeholder="項目（例: 交通費）" onAdd={addExpenseInline} />
        </tbody>
      </table>
    </div>
  )

  if (!loaded) return <div className="money-mode"><div className="empty">読み込み中…</div></div>

  // 初回入場 or 立場変更: お金プロフィールの作成
  if (!profile || picking) {
    return (
      <div className="money-mode">
        <div className="money-head">
          <h1>経費管理</h1>
          <button className="btn-outline" onClick={() => (picking ? setPicking(false) : onClose())}>閉じる</button>
        </div>
        <div className="card">
          <h2>お金プロフィール <span className="tag">立場に合わせて画面が変わります</span></h2>
          <div className="notice">あなたの立場を選んでください。あとから変更できます</div>
          <div className="list">
            {(Object.keys(STANCE_LABELS) as MoneyProfile['stance'][]).map((s) => (
              <label key={s} className="list-item" style={{ cursor: 'pointer' }}>
                <input type="radio" name="stance" checked={stance === s} onChange={() => setStance(s)} />
                <div className="title">{STANCE_LABELS[s]}</div>
              </label>
            ))}
          </div>
          {err && <div className="notice warn">{err}</div>}
          <button className="btn-primary" onClick={createProfile}>{profile ? '変更する' : 'はじめる'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="money-mode">
      <div className="money-head">
        <h1>経費管理</h1>
        <span className="badge badge-gray">{STANCE_LABELS[profile.stance]}</span>
        <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>✕ 閉じる</button>
      </div>

      {err && <div className="notice warn">{err}</div>}

      {/* 今月のお金: 円グラフ＋カレンダー＋収支サマリー（マップはレシートOCR対応時に追加予定） */}
      {(() => {
        const source = isPresident
          ? expenses.filter((e) => e.scope === 'company')
          : expenses.filter((e) => e.member_id === me.id)
        const [y, mo] = month.split('-').map(Number)
        const first = new Date(y, mo - 1, 1)
        const days = new Date(y, mo, 0).getDate()
        const cells: (number | null)[] = [
          ...Array(first.getDay()).fill(null),
          ...Array.from({ length: days }, (_, i) => i + 1),
        ]
        const dateOf = (d: number) => `${month}-${String(d).padStart(2, '0')}`
        const dayTotal = (d: number) =>
          source.filter((e) => e.occurred_on === dateOf(d)).reduce((s, e) => s + e.amount, 0)
        const dayRows = source.filter((e) => e.occurred_on === calDay)
        // 項目（ラベル）ごとの内訳。上位5つ＋その他にまとめる
        const monthRows = source.filter((e) => e.occurred_on.startsWith(month))
        const monthTotal = monthRows.reduce((s, e) => s + e.amount, 0)
        const sums = new Map<string, number>()
        for (const e of monthRows) sums.set(e.label, (sums.get(e.label) ?? 0) + e.amount)
        const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1])
        const groups = sorted.slice(0, 5)
        const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0)
        if (rest > 0) groups.push(['その他', rest])
        let acc = 0
        const segs = groups.map(([g, v], i) => {
          const pct = (v / monthTotal) * 100
          const seg = { g, v, pct, offset: acc, color: AVATAR_COLORS[i % AVATAR_COLORS.length] }
          acc += pct
          return seg
        })
        const moveMonth = (d: number) => {
          setMonth(new Date(y, mo - 1 + d, 1).toLocaleDateString('sv-SE').slice(0, 7))
          setCalDay('')
        }
        // 収入（社長は支払った額、それ以外は自分の請求書）
        const paidSum = monthPaid.reduce((s, v) => s + invoiceTotal(v), 0)
        const myMonthInvs = myInvs.filter((v) => v.month === month)
        const incomeSum = myMonthInvs.filter((v) => v.status === 'paid').reduce((s, v) => s + invoiceTotal(v), 0)
          + incomes.filter((i) => i.month === month).reduce((s, i) => s + i.amount, 0)
        return (
          <div className="card">
            <h2>
              お金の流れ <span className="tag">{isPresident ? '会社のお金' : '自分のお金'}</span>
              <span className="month-nav">
                <button aria-label="前の月" onClick={() => moveMonth(-1)}>◀</button>
                <b>{y}年{mo}月</b>
                <button aria-label="次の月" onClick={() => moveMonth(1)}>▶</button>
              </span>
            </h2>
            <div className="money-top">
              <svg viewBox="0 0 42 42" className="money-donut" role="img" aria-label="支出の内訳">
                {monthTotal > 0 ? segs.map((s) => (
                  <circle key={s.g} cx="21" cy="21" r="15.9155" fill="none"
                    stroke={s.color} strokeWidth="7"
                    strokeDasharray={`${s.pct} ${100 - s.pct}`}
                    strokeDashoffset={25 - s.offset} />
                )) : (
                  <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--line)" strokeWidth="7" />
                )}
                <text x="21" y="20" textAnchor="middle" className="money-donut-total">{yen(monthTotal)}</text>
                <text x="21" y="25" textAnchor="middle" className="money-donut-sub">支出</text>
              </svg>
              <div className="cal-grid money-cal">
                {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
                  <div key={w} className="cal-wday">{w}</div>
                ))}
                {cells.map((d, i) =>
                  d === null ? <div key={i} /> : (
                    <button key={i} className={`cal-day ${dateOf(d) === calDay ? 'sel' : ''}`}
                      onClick={() => setCalDay(calDay === dateOf(d) ? '' : dateOf(d))}>
                      {d}
                      <span className="cal-dots">{dayTotal(d) > 0 && <i className="dot-me" />}</span>
                    </button>
                  )
                )}
              </div>
            </div>
            {calDay && (
              dayRows.length === 0
                ? <div className="empty">{calDay.slice(5).replace('-', '/')} の支出はありません</div>
                : expenseTable(dayRows, isPresident)
            )}
            {isPresident ? (
              <>
                <div className="log-row">
                  <span className="d">支払</span>
                  <span className="t">メンバーへの支払済み {monthPaid.length}件</span>
                  <span className="dur">{yen(paidSum)}</span>
                </div>
                {/* 月間経費予算と使用状況 */}
                <div className="log-row">
                  <span className="d">予算</span>
                  <span className="t">
                    月の経費予算
                    <input type="text" inputMode="numeric" className="pt-mini" style={{ marginLeft: 8, width: 110 }}
                      key={`budget-${budget}`} defaultValue={budget ?? ''} placeholder="未設定"
                      aria-label="月の経費予算" onBlur={(ev) => saveBudget(ev.target.value)} />
                  </span>
                  {budget ? <span className="dur">残り {yen(Math.max(0, budget - monthTotal))}</span> : null}
                </div>
                {budget != null && budget > 0 && monthTotal >= budget * 0.8 && (
                  <div className="notice warn">
                    経費が予算の{Math.round((monthTotal / budget) * 100)}%に達しています（{yen(monthTotal)} / {yen(budget)}）
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="log-row">
                  <span className="d">収入</span>
                  <span className="t">
                    この月の請求書
                    {myMonthInvs.length === 0 ? ' なし'
                      : myMonthInvs.some((v) => v.status !== 'paid') ? '（支払待ちあり）' : '（支払済み）'}
                  </span>
                  <span className="dur">{yen(incomeSum)}</span>
                </div>
                {profile.stance === 'sole_proprietor' && (() => {
                  // 月次収支: 収入−経費。前月と比較
                  const prevMonth = new Date(y, mo - 2, 1).toLocaleDateString('sv-SE').slice(0, 7)
                  const prevExp = source.filter((e) => e.occurred_on.startsWith(prevMonth)).reduce((s, e) => s + e.amount, 0)
                  const prevInc = myInvs.filter((v) => v.month === prevMonth && v.status === 'paid').reduce((s, v) => s + invoiceTotal(v), 0)
                    + incomes.filter((i) => i.month === prevMonth).reduce((s, i) => s + i.amount, 0)
                  const profit = incomeSum - monthTotal
                  const prevProfit = prevInc - prevExp
                  const diff = profit - prevProfit
                  return (
                    <div className="log-row">
                      <span className="d">利益</span>
                      <span className="t">収入 − 経費（前月 {yen(prevProfit)}、{diff >= 0 ? '+' : '−'}{yen(Math.abs(diff)).slice(1)}円）</span>
                      <span className="dur">{yen(profit)}</span>
                    </div>
                  )
                })()}
              </>
            )}
            {monthTotal > 0 && (
              <details className="money-detail">
                <summary>項目別の内訳を見る</summary>
                <div className="money-legend">
                  {segs.map((s) => (
                    <div key={s.g} className="money-legend-row">
                      <i style={{ background: s.color }} />
                      <span className="g">{s.g}</span>
                      <span className="pct">{Math.round(s.pct)}%</span>
                      <span className="v">{yen(s.v)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {!isPresident && myInvs.length > 0 && (
              <details className="money-detail">
                <summary>収入の明細（請求書の支払状況）</summary>
                <div className="list">
                  {myInvs.map((v) => (
                    <div key={v.id} className="list-item">
                      <div className="when">{v.month.replace('-', '/')}</div>
                      <div className="title">{yen(invoiceTotal(v))}</div>
                      <span className={`badge ${v.status === 'paid' ? 'badge-blue' : 'badge-gray'}`}>
                        {v.status === 'paid' ? '支払済み' : '支払待ち'}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {(() => {
              const pins = monthRows.filter((e) => e.lat != null && e.lng != null)
              return pins.length > 0 && (
                <details className="money-detail">
                  <summary>支出マップ（{pins.length}件）</summary>
                  <ExpenseMap rows={pins} />
                  <div className="notice">レシート読み取りで住所が取れた経費だけ表示されます</div>
                </details>
              )
            })()}
          </div>
        )
      })()}

      {/* カレンダー下の切り替え: 年間の収支確認 / 経費の登録 */}
      <div className="seg-row money-view-toggle" role="tablist" aria-label="表示切替">
        <button role="tab" aria-selected={moneyView === 'entry'}
          className={`preset-chip ${moneyView === 'entry' ? 'sel' : ''}`}
          onClick={() => setMoneyView('entry')}>経費の登録</button>
        <button role="tab" aria-selected={moneyView === 'year'}
          className={`preset-chip ${moneyView === 'year' ? 'sel' : ''}`}
          onClick={() => setMoneyView('year')}>年間の収支</button>
      </div>

      {/* 年間の収支: 月ごとの売上・経費と扶養の壁チェック（自分個人の収支なので全立場で表示） */}
      {moneyView === 'year' && (() => {
        const year = month.slice(0, 4)
        const incomeOf = (m: string) =>
          myInvs.filter((v) => v.month === m && v.status === 'paid').reduce((s, v) => s + invoiceTotal(v), 0)
          + incomes.filter((i) => i.month === m).reduce((s, i) => s + i.amount, 0)
        const expenseOf = (m: string) =>
          expenses.filter((e) => e.member_id === me.id && e.occurred_on.startsWith(m)).reduce((s, e) => s + e.amount, 0)
        const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
        const yearIncome = months.reduce((s, m) => s + incomeOf(m), 0)
        const yearExpense = months.reduce((s, m) => s + expenseOf(m), 0)
        // 壁チェック: 今のペース＝経過月の平均×12。年をまたいで見ている場合は12ヶ月確定
        const wall = profile.wall_amount
        const monthsElapsed = year === today().slice(0, 4) ? Number(today().slice(5, 7)) : 12
        const projected = monthsElapsed > 0 ? Math.round((yearIncome / monthsElapsed) * 12) : 0
        const manYen = (v: number) => v % 10000 === 0 ? `${v / 10000}万円` : yen(v)
        const wallLabel = wall ? (WALLS.find(([a]) => a === wall)?.[1] ?? manYen(wall)).split(':')[0] : ''
        // QA: 答えに応じて推奨の壁を出す
        const qaSteps = [
          { q: '親や配偶者の扶養に入っていますか？', yes: { step: 1 }, no: { step: 9, rec: null, note: '扶養に入っていなければ、壁は気にせず稼いでOKです' } },
          { q: '学生ですか？', yes: { step: 9, rec: 1300000, note: '学生は所得税側の控除が150万円まで広がりましたが、親の社会保険の扶養から外れる130万円が先に来ます' }, no: { step: 2 } },
          { q: '勤務先は従業員51人以上で、週20時間以上働いていますか？', yes: { step: 9, rec: 1060000, note: 'この条件だと106万円前後で社会保険の加入対象になります' }, no: { step: 9, rec: 1230000, note: '所得税がかかり始める123万円が目安です（社会保険は130万円）' } },
        ]
        return (
          <div className="card">
            <h2>年間の収支 <span className="tag">{year}年 · 売上と経費の照合</span></h2>
            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead><tr><th>月</th><th>売上</th><th>経費</th><th>差引</th></tr></thead>
                <tbody>
                  {months.map((m) => {
                    const inc = incomeOf(m), exp = expenseOf(m)
                    // セルを押してそのまま入力（稼働表と同じ）。過去の月もOK
                    return (
                      <tr key={m}>
                        <td className="pt-date">{Number(m.slice(5))}月</td>
                        <td className="pt-cell pt-yen">
                          <CellNum value={inc} label={`${Number(m.slice(5))}月の売上`}
                            onCommit={(v) => setMonthIncome(m, v, inc)} />
                        </td>
                        <td className="pt-cell pt-yen">
                          <CellNum value={exp} label={`${Number(m.slice(5))}月の経費`}
                            onCommit={(v) => setMonthExpense(m, v, exp)} />
                        </td>
                        <td className="pt-cell pt-yen">{inc || exp ? yen(inc - exp) : '—'}</td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td className="pt-date"><b>合計</b></td>
                    <td className="pt-cell pt-yen"><b>{yen(yearIncome)}</b></td>
                    <td className="pt-cell pt-yen"><b>{yen(yearExpense)}</b></td>
                    <td className="pt-cell pt-yen"><b>{yen(yearIncome - yearExpense)}</b></td>
                  </tr>
                  {/* 売上（請求書以外の収入）は表の最下行から直接追加 */}
                  <TableAddRow dateKind="month" tail={1}
                    placeholder="売上項目（例: バイト代）" onAdd={addIncome} />
                </tbody>
              </table>
            </div>
            <div className="notice">請求書（支払済み）は自動で売上に入ります。それ以外の収入は表の最下行から追加してください</div>
            {incomes.filter((i) => i.month.startsWith(year)).length > 0 && (
              <details className="money-detail">
                <summary>手入力した売上（{incomes.filter((i) => i.month.startsWith(year)).length}件）</summary>
                <div className="list">
                  {incomes.filter((i) => i.month.startsWith(year)).map((i) => (
                    <div key={i.id} className="list-item">
                      <div className="when">{i.month.replace('-', '/')}</div>
                      <div className="title">{i.label}</div>
                      <span className="dur">{yen(i.amount)}</span>
                      <button className="link-btn" onClick={() => removeIncome(i)}>削除</button>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* 扶養の壁 */}
            <h2 style={{ marginTop: 16 }}>扶養の壁 <span className="tag">年収の上限チェック</span></h2>
            {wall ? (
              <>
                <div className="log-row">
                  <span className="d">壁</span>
                  <span className="t">{wallLabel}の壁（{WALLS.find(([a]) => a === wall)?.[1].split(': ')[1] ?? '手動設定'}）</span>
                  <span className="dur">{manYen(wall)}</span>
                </div>
                <div className="wall-bar" role="img" aria-label={`年収 ${yen(yearIncome)} / 壁 ${manYen(wall)}`}>
                  <i style={{ width: `${Math.min(100, (yearIncome / wall) * 100)}%`,
                    background: yearIncome >= wall ? 'var(--danger)' : projected > wall ? '#c2691c' : 'var(--brand, #00654f)' }} />
                </div>
                {yearIncome >= wall ? (
                  <div className="notice warn">{year}年の売上が{manYen(wall)}を超えています（{yen(yearIncome)}）</div>
                ) : (
                  <div className="log-row">
                    <span className="d">残り</span>
                    <span className="t">{year}年はあと稼げる額</span>
                    <span className="dur">{yen(wall - yearIncome)}</span>
                  </div>
                )}
                {yearIncome < wall && projected > wall && (
                  <div className="notice warn">
                    今のペース（月平均{yen(Math.round(yearIncome / Math.max(1, monthsElapsed)))}）だと
                    年間{yen(projected)}になり、{wallLabel}の壁を越えそうです。
                    残り{12 - monthsElapsed}ヶ月は月{yen(Math.max(0, Math.floor((wall - yearIncome) / Math.max(1, 12 - monthsElapsed))))}以内が目安です
                  </div>
                )}
                <button className="link-btn" onClick={() => setWallQA({ step: 0 })}>壁を診断し直す</button>
              </>
            ) : (
              !wallQA && (
                <>
                  <div className="notice">
                    {profile.wall_amount === null && 'いくらまで稼いでいいか、いくつかの質問で診断できます'}
                  </div>
                  <button className="btn-outline" onClick={() => setWallQA({ step: 0 })}>壁を診断する</button>
                </>
              )
            )}
            {wallQA && (wallQA.step < 9 ? (
              <div className="wall-qa">
                <div className="notice">{qaSteps[wallQA.step].q}</div>
                <div className="draft-times">
                  <button className="btn-outline" onClick={() => setWallQA(qaSteps[wallQA.step].yes)}>はい</button>
                  <button className="btn-outline" onClick={() => setWallQA(qaSteps[wallQA.step].no)}>いいえ</button>
                  <button className="link-btn" onClick={() => setWallQA(null)}>やめる</button>
                </div>
              </div>
            ) : (
              <div className="wall-qa">
                <div className="notice">
                  {wallQA.rec ? `おすすめの壁: ${manYen(wallQA.rec)}。` : ''}{wallQA.note}
                </div>
                <div className="draft-times" style={{ flexWrap: 'wrap' }}>
                  {wallQA.rec != null && (
                    <button className="btn-primary" style={{ margin: 0 }}
                      onClick={() => saveWall(wallQA.rec!)}>{manYen(wallQA.rec)}で設定</button>
                  )}
                  {wallQA.rec == null && (
                    <button className="btn-primary" style={{ margin: 0 }} onClick={() => saveWall(null)}>壁なしにする</button>
                  )}
                  <button className="link-btn" onClick={() => setWallQA(null)}>やめる</button>
                </div>
                <details className="money-detail">
                  <summary>自分で壁を選ぶ</summary>
                  <div className="list">
                    {WALLS.map(([a, desc]) => (
                      <div key={a} className="list-item">
                        <div className="title">{desc}</div>
                        <button className="link-btn" onClick={() => saveWall(a)}>設定</button>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        )
      })()}

      {/* 経費: 登録フォームと一覧をひとつのカードに */}
      {moneyView === 'entry' && <div className="card">
        <h2>
          経費 <span className="tag">{isPresident ? '会社経費の一覧と登録' : '登録と一覧'}</span>
          <span className="month-nav">
            <div className="goal-menu">
              <button className="icon-btn goal-menu-btn" aria-label="経費メニュー" aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}>☰</button>
              {menuOpen && (
                <div className="goal-menu-pop" role="menu">
                  <button role="menuitem" onClick={() => { setMenuOpen(false); exportMoneyCsv() }}>
                    {month.slice(0, 4)}年のCSVを出力
                  </button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setStance(profile.stance); setPicking(true) }}>
                    立場を変更
                  </button>
                </div>
              )}
            </div>
          </span>
        </h2>
        <div className="seg-row" role="tablist" aria-label="経費の区分">
          <button role="tab" aria-selected={scope === 'company'}
            className={`preset-chip ${scope === 'company' ? 'sel' : ''}`}
            onClick={() => setScope('company')}>会社に提出</button>
          <button role="tab" aria-selected={scope === 'personal'}
            className={`preset-chip ${scope === 'personal' ? 'sel' : ''}`}
            onClick={() => setScope('personal')}>個人の帳簿</button>
        </div>
        <div className="draft-times" style={{ flexWrap: 'wrap' }}>
          <input type="date" aria-label="日付" style={{ width: 150 }}
            value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="text" placeholder="項目（例: 交通費）" style={{ flex: 1, minWidth: 140 }}
            value={label} onChange={(e) => setLabel(e.target.value)} />
          <input type="text" inputMode="numeric" placeholder="金額" style={{ width: 90 }}
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="draft-times" style={{ flexWrap: 'wrap' }}>
          <label className="btn-outline" style={{ cursor: 'pointer', margin: 0 }}>
            {ocr ? '🔍 読み取り中…' : file ? `📎 ${file.name}` : '📷 レシートを撮影'}
            <input type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => pickReceipt(e.target.files?.[0] ?? null)} />
          </label>
          <label className="link-btn" style={{ cursor: 'pointer' }}>
            ファイルを選択
            <input type="file" accept="image/*,.pdf" hidden
              onChange={(e) => pickReceipt(e.target.files?.[0] ?? null)} />
          </label>
          {myInvs.length > 0 && (
            <select aria-label="請求書に紐付け" value={linkInv} onChange={(e) => setLinkInv(e.target.value)}>
              <option value="">請求書に紐付けない</option>
              {myInvs.map((v) => (
                <option key={v.id} value={v.id}>{v.month.replace('-', '年')}月分の請求書</option>
              ))}
            </select>
          )}
          <button className="btn-primary" style={{ margin: '0 0 0 auto' }}
            disabled={busy || !label || !Number(amount)} onClick={addExpense}>
            {busy ? '登録中…' : '登録'}
          </button>
        </div>
        <div className="notice">
          {scope === 'company'
            ? '「会社に提出」は管理者にレシートごと共有され、経費精算・請求書の裏付けになります'
            : '「個人の帳簿」は自分だけが見られる記録です（確定申告用など）'}
        </div>
        {(() => {
          const rows = isPresident
            ? monthExpenses.filter((e) => e.scope === 'company')
            : expenses.filter((e) => e.member_id === me.id)
          return rows.length === 0
            ? <div className="empty">経費はまだありません</div>
            : expenseTable(rows, isPresident)
        })()}
        <details className="money-detail">
          <summary>固定費・定期支出（毎月自動で経費に追加）{recurring.filter((r) => r.active).length > 0 && ` · ${recurring.filter((r) => r.active).length}件`}</summary>
          {recurring.length > 0 && (
            <div className="list" style={{ marginBottom: 8 }}>
              {recurring.map((r) => (
                <div key={r.id} className="list-item" style={r.active ? undefined : { opacity: .5 }}>
                  <div className="when">毎月{r.day_of_month}日</div>
                  <div className="title">{r.label}（{r.scope === 'company' ? '会社' : '個人'}）</div>
                  <span className="dur">{yen(r.amount)}</span>
                  <button className="link-btn" onClick={() => toggleRecurring(r)}>{r.active ? '停止' : '再開'}</button>
                  <button className="link-btn" onClick={() => removeRecurring(r)}>削除</button>
                </div>
              ))}
            </div>
          )}
          <div className="draft-times" style={{ flexWrap: 'wrap' }}>
            <input type="text" placeholder="項目（例: 家賃）" style={{ flex: 1, minWidth: 120 }}
              value={recLabel} onChange={(e) => setRecLabel(e.target.value)} />
            <input type="text" inputMode="numeric" placeholder="金額" style={{ width: 90 }}
              value={recAmount} onChange={(e) => setRecAmount(e.target.value)} />
            <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
              毎月
              <input type="number" min={1} max={28} style={{ width: 60 }}
                value={recDay} onChange={(e) => setRecDay(e.target.value)} />
              日
            </label>
            <button className="btn-outline" disabled={!recLabel || !Number(recAmount)} onClick={addRecurring}>追加</button>
          </div>
          <div className="notice">区分は上の「会社に提出 / 個人の帳簿」の選択が使われます。経費行はその月に入ってから自動生成されます</div>
        </details>
      </div>}

      {isPresident && (
        <div className="card">
          <h2>メンバーへの支払い <span className="tag">給与・委託報酬（請求書）</span></h2>
          {invs.length === 0 ? <div className="empty">請求書はまだありません</div> : (
            <div className="list">
              {invs.map((v) => (
                <div key={v.id} className="list-item">
                  <div className="when">{v.month.replace('-', '/')}</div>
                  <div className="title">{names[v.member_id] ?? '—'} · {yen(invoiceTotal(v))}</div>
                  {v.status === 'paid' ? (
                    <span className="badge badge-blue">支払済み</span>
                  ) : (
                    <button className="btn-primary" style={{ margin: 0 }} onClick={() => markPaid(v)}>支払済みにする</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- 名簿 ---------- */
// MyHood swatch palette（塗り専用。白文字が乗るので濃色寄りに調整）
const AVATAR_COLORS = ['#007f66', '#2F8CFF', '#7c5cd6', '#0f8a7e', '#c2447e', '#c2691c']

const BLANK_INVITE = { name: '', email: '', work_start: '09:00', work_end: '18:00' }

function Members({ me, onOpenProfile }: { me: Member; onOpenProfile?: (m: Member) => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK_INVITE)
  const [busy, setBusy] = useState(false)
  const [myhood, setMyhood] = useState('')
  const [myhoodMsg, setMyhoodMsg] = useState('')
  const [month, setMonth] = useState(today().slice(0, 7)) // "YYYY-MM"
  const [invs, setInvs] = useState<Invoice[]>([])
  const [invView, setInvView] = useState<Invoice | null>(null)
  const isAdmin = me.role === 'admin'

  const load = useCallback(async () => {
    const [{ data: rows }, { data: company }, { data: invRows }] = await Promise.all([
      supabase.from('members').select('*').eq('company_id', me.company_id).order('created_at'),
      supabase.from('companies').select('join_code, myhood_url').eq('id', me.company_id).maybeSingle(),
      supabase.from('invoices').select('*').order('issued_at', { ascending: false }),
    ])
    setMembers(rows ?? [])
    setCode(company?.join_code ?? '')
    setMyhood((company as { myhood_url?: string | null } | null)?.myhood_url ?? '')
    const ids = new Set(((rows as Member[]) ?? []).map((m) => m.id))
    setInvs(((invRows as Invoice[]) ?? []).filter((v) => ids.has(v.member_id)))
  }, [me.company_id])

  useEffect(() => { load() }, [load])

  const copyCode = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const changeHours = async (m: Member, key: 'work_start' | 'work_end', value: string) => {
    setMembers(members.map((x) => (x.id === m.id ? { ...x, [key]: value } : x)))
    const { error } = await supabase.from('members').update({ [key]: value }).eq('id', m.id)
    if (error) setErr('所定時間を変更できませんでした')
  }

  const changeRate = async (m: Member, value: string) => {
    const rate = Math.max(0, Number(value) || 0)
    setMembers(members.map((x) => (x.id === m.id ? { ...x, hourly_rate: rate } : x)))
    const { error } = await supabase.from('members').update({ hourly_rate: rate }).eq('id', m.id)
    if (error) setErr('時給を変更できませんでした')
  }

  const markPaid = async (inv: Invoice) => {
    setErr('')
    const { error } = await supabase.from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', inv.id)
    if (error) return setErr(`更新できませんでした（${error.message}）`)
    load()
  }

  const changeRole = async (m: Member, role: Member['role']) => {
    setErr('')
    const { error } = await supabase.from('members').update({ role }).eq('id', m.id)
    if (error) return setErr(error.message)
    load()
  }

  const saveMyhood = async () => {
    setMyhoodMsg('')
    const { error } = await supabase.from('companies')
      .update({ myhood_url: myhood || null }).eq('id', me.company_id)
    setMyhoodMsg(error ? '保存できませんでした（管理者のみ変更可能です）' : '保存しました')
  }

  const invite = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.from('members').insert({ company_id: me.company_id, ...form })
    setBusy(false)
    if (error) {
      return setErr(error.code === '23505'
        ? 'このメールアドレスは既に名簿に登録されています'
        : `招待できませんでした（${error.message}）`)
    }
    setForm(BLANK_INVITE)
    setOpen(false)
    load()
  }

  if (invView) {
    return <InvoiceView inv={invView}
      memberName={members.find((m) => m.id === invView.member_id)?.name ?? ''}
      onClose={() => setInvView(null)} />
  }

  return (
    <>
      <div className="card">
        <h2>
          メンバー名簿 <span className="tag">{members.length}名</span>
          {isAdmin && !open && (
            <button className="h2-action" onClick={() => setOpen(true)}>＋ 招待</button>
          )}
        </h2>
        {members.map((m, i) => (
          <div key={m.id} className="member-row">
            <div className="m-avatar member-av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
              {m.name[0]}
            </div>
            <div className="m-info">
              <div className="m-name">
                {m.name}{m.id === me.id && <span className="you">あなた</span>}
              </div>
              <div className="m-mail">{m.email}</div>
              <div className="member-tags">
                {isAdmin ? (
                  <select className={`role-select ${m.role === 'admin' ? 'is-admin' : ''}`} value={m.role}
                    aria-label={`${m.name}の権限`}
                    onChange={(e) => changeRole(m, e.target.value as Member['role'])}>
                    <option value="member">一般</option>
                    <option value="admin">管理者</option>
                  </select>
                ) : (
                  <span className="badge badge-gray">{m.role === 'admin' ? '管理者' : '一般'}</span>
                )}
                {m.status === 'invited' && <span className="badge badge-yellow">招待中・未参加</span>}
                {onOpenProfile && m.id !== me.id && m.status === 'active' && (
                  <button className="btn-chip" onClick={() => onOpenProfile(m)}>プロフィール</button>
                )}
              </div>
            </div>
            <div className="m-hours">
              <span className="m-hours-label">所定勤務</span>
              <div>
                <input type="time" value={hm(m.work_start)} disabled={!isAdmin}
                  aria-label={`${m.name}の所定勤務開始`}
                  onChange={(e) => changeHours(m, 'work_start', e.target.value)} />
                <span> – </span>
                <input type="time" value={hm(m.work_end)} disabled={!isAdmin}
                  aria-label={`${m.name}の所定勤務終了`}
                  onChange={(e) => changeHours(m, 'work_end', e.target.value)} />
              </div>
              <span className="m-hours-label" style={{ marginTop: 6 }}>時給（0=給与制）</span>
              <div>
                <span>¥ </span>
                <input type="text" inputMode="numeric" className="rate-input"
                  aria-label={`${m.name}の時給`} value={m.hourly_rate || 0} disabled={!isAdmin}
                  onChange={(e) => changeRate(m, e.target.value)} />
              </div>
            </div>
          </div>
        ))}
        {err && !open && <div className="notice warn">{err}</div>}
        {isAdmin && (
          <div className="join-code-subtle">
            参加コード <b>{code || '—'}</b>
            <button onClick={copyCode}>{copied ? 'コピーしました' : 'コピー'}</button>
            <span className="join-code-hint">共有すれば相手が自分でアカウントを作って参加できます</span>
          </div>
        )}
      </div>

      {isAdmin && open && (
        <div className="card">
          <h2>メンバーを招待</h2>
          <label htmlFor="iv-name">名前</label>
          <input id="iv-name" type="text" placeholder="山田 太郎" autoFocus
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          <label htmlFor="iv-mail">メールアドレス</label>
          <input id="iv-mail" type="email" placeholder="you@example.com"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

          <label>所定勤務時間帯</label>
          <div className="draft-times">
            <input type="time" aria-label="所定勤務開始" value={form.work_start}
              onChange={(e) => setForm({ ...form, work_start: e.target.value })} />
            <span>–</span>
            <input type="time" aria-label="所定勤務終了" value={form.work_end}
              onChange={(e) => setForm({ ...form, work_end: e.target.value })} />
          </div>

          {err && <div className="notice warn">{err}</div>}
          <div className="notice">
            メールアドレスが分かっている人向けです。登録したアドレスでアカウントを作成すると自動で参加し、
            ここで設定した名前と所定勤務時間帯が引き継がれます。
            アドレスが分からない場合は名簿の下にある参加コードを共有してください
          </div>
          <div className="form-actions">
            <button className="btn-primary" style={{ margin: 0 }}
              disabled={!form.name || !form.email || busy} onClick={invite}>
              {busy ? '登録中…' : '名簿に追加'}
            </button>
            <button className="btn-outline" onClick={() => { setOpen(false); setErr('') }}>キャンセル</button>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <h2>MyHood連携 <span className="tag">管理者設定</span></h2>
          <label htmlFor="mh-url">MyHoodの投稿先URL</label>
          <input id="mh-url" type="url" placeholder="https://myhood.example.com/..."
            value={myhood} onChange={(e) => setMyhood(e.target.value)} />
          <div className="form-actions">
            <button className="btn-primary" style={{ margin: 0 }} onClick={saveMyhood}>保存</button>
          </div>
          {myhoodMsg && <div className="notice">{myhoodMsg}</div>}
          <div className="notice">
            設定すると、日報と今日の予定に「MyHoodに投稿」ボタンが表示され、動画での提出ができるようになります。
            空にして保存すると連携を解除します
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <h2>出勤簿の出力 <span className="tag">月末のCSV出力</span></h2>
          <div className="draft-times">
            <input type="month" aria-label="対象月" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button className="btn-primary" style={{ margin: 0 }}
              onClick={() => exportKintaiCsv(members, month)}>CSVをダウンロード</button>
          </div>
          <div className="notice">
            全メンバーの1か月分を、現行の出勤簿スプレッドシートと同じ列構成
            （出勤・ランチ・退勤・中抜け・総時間・実労働時間・業務内容）で出力します
          </div>
        </div>
      )}

      {isAdmin && invs.length > 0 && (
        <div className="card">
          <h2>請求書 <span className="tag">メンバーからの請求</span></h2>
          <div className="list">
            {invs.map((v) => (
              <div key={v.id} className="list-item">
                <div className="when">{v.month.replace('-', '/')}</div>
                <div className="title">
                  {members.find((m) => m.id === v.member_id)?.name ?? '—'} · 実働 {hmm(v.minutes)} · {yen(invoiceTotal(v))}
                </div>
                <button className="btn-outline" onClick={() => setInvView(v)}>表示</button>
                {v.status === 'paid' ? (
                  <span className="badge badge-blue">支払済み</span>
                ) : (
                  <button className="btn-primary" style={{ margin: 0 }} onClick={() => markPaid(v)}>支払済みにする</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- 稼働と請求（プロフィール内・時給が設定されている人だけ） ---------- */
function MyWork({ me }: { me: Member }) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [minutes, setMinutes] = useState(0)
  const [inv, setInv] = useState<Invoice | null>(null) // その月の発行済み請求書
  const [expenses, setExpenses] = useState<{ label: string; amount: number }[]>([])
  const [expLabel, setExpLabel] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [view, setView] = useState(false)
  const [err, setErr] = useState('')

  const [autoExp, setAutoExp] = useState<MoneyExpense[]>([]) // 経費管理で承認済み・未請求の会社経費

  const load = useCallback(async () => {
    setMinutes(await monthWorkedMinutes(me.id, month))
    const { from, to } = monthRange(month)
    const [{ data }, { data: exps }] = await Promise.all([
      supabase.from('invoices').select('*')
        .eq('member_id', me.id).eq('month', month).maybeSingle(),
      supabase.from('money_expenses').select('*')
        .eq('member_id', me.id).eq('scope', 'company').eq('status', 'approved')
        .is('invoice_id', null).gte('occurred_on', from).lt('occurred_on', to),
    ])
    setInv((data as Invoice | null) ?? null)
    setAutoExp((exps as MoneyExpense[]) ?? [])
  }, [me.id, month])

  useEffect(() => { load() }, [load])

  const addExpense = () => {
    const amount = Number(expAmount)
    if (!expLabel || !amount) return
    setExpenses([...expenses, { label: expLabel, amount }])
    setExpLabel(''); setExpAmount('')
  }

  const issue = async () => {
    setErr('')
    // 経費管理で承認済みの会社経費を自動で明細に載せる
    const allExpenses = [...autoExp.map((e) => ({ label: e.label, amount: e.amount })), ...expenses]
    const { data: created, error } = await supabase.from('invoices').insert({
      member_id: me.id, month, minutes: Math.round(minutes),
      hourly_rate: me.hourly_rate, expenses: allExpenses,
      status: 'issued', issued_at: new Date().toISOString(), paid_at: null,
    }).select().single()
    if (error) return setErr(`発行できませんでした（${error.message}）`)
    if (autoExp.length > 0 && created) {
      await supabase.from('money_expenses')
        .update({ invoice_id: (created as Invoice).id })
        .in('id', autoExp.map((e) => e.id))
    }
    setExpenses([])
    load()
    setView(true)
  }

  const labor = Math.round((minutes / 60) * me.hourly_rate)

  if (view && inv) return <InvoiceView inv={inv} memberName={me.name} onClose={() => setView(false)} />

  return (
    <div className="card">
      <h2>稼働と請求 <span className="tag">実働 × 時給で請求書を発行</span></h2>
      <div className="draft-times">
        <input type="month" aria-label="対象月" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className="btn-outline" onClick={() => exportKintaiCsv([me], month)}>稼働表CSV</button>
      </div>
      <div className="log-row">
        <span className="d">実働</span>
        <span className="t">{hmm(minutes)} × {yen(me.hourly_rate)}</span>
        <span className="dur">{yen(labor)}</span>
      </div>
      {inv ? (
        <>
          <div className="notice">
            この月の請求書は発行済みです（{inv.status === 'paid' ? '支払済み' : '支払待ち'}・合計 {yen(invoiceTotal(inv))}）
          </div>
          <button className="btn-primary" onClick={() => setView(true)}>請求書を表示</button>
        </>
      ) : (
        <>
          {autoExp.map((e) => (
            <div key={e.id} className="log-row">
              <span className="d">経費</span>
              <span className="t">{e.label} <span className="tag">経費管理から自動</span></span>
              <span className="dur">{yen(e.amount)}</span>
            </div>
          ))}
          {expenses.map((e, i) => (
            <div key={i} className="log-row">
              <span className="d">経費</span>
              <span className="t">{e.label}</span>
              <span className="dur">{yen(e.amount)}</span>
            </div>
          ))}
          <div className="draft-times" style={{ flexWrap: 'wrap' }}>
            <input type="text" placeholder="経費の項目（例: 交通費）" style={{ width: 180 }}
              value={expLabel} onChange={(e) => setExpLabel(e.target.value)} />
            <input type="text" inputMode="numeric" placeholder="金額" style={{ width: 100 }}
              value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
            <button className="btn-outline" onClick={addExpense}>＋ 経費を追加</button>
          </div>
          {err && <div className="notice warn">{err}</div>}
          <button className="btn-primary" disabled={minutes <= 0} onClick={issue}>
            請求書を発行（{yen(labor + autoExp.reduce((s, e) => s + e.amount, 0) + expenses.reduce((s, e) => s + e.amount, 0))}）
          </button>
          <div className="notice">
            発行すると管理者に届き、確認後に支払済みになります。発行時点の実働と時給で金額が確定します
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- プロフィール・設定 ---------- */
function Profile({ me, onRename, onOpenMoney }: { me: Member; onRename: (name: string) => void; onOpenMoney?: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <>
      <div className="card">
        <button className="profile-head profile-head-btn" aria-expanded={settingsOpen}
          title="連携・アカウント設定を開く" onClick={() => setSettingsOpen(!settingsOpen)}>
          <div className="m-avatar profile-avatar">{me.name[0]}</div>
          <div>
            <div className="profile-name">{me.name}</div>
            <div className="m-mail">{me.email}</div>
            <div className="account-badges">
              <span className="badge badge-gray">{me.role === 'admin' ? '管理者' : '一般'}</span>
              <span className="badge badge-gray">所定 {hm(me.work_start)}–{hm(me.work_end)}</span>
            </div>
          </div>
          <span className="profile-caret">{settingsOpen ? '▴' : '▾'}</span>
        </button>
        {me.role !== 'admin' && (
          <div className="notice">所定勤務時間帯の変更は管理者に依頼してください（打刻漏れ時の自動補完に使われます）</div>
        )}
      </div>
      {onOpenMoney && (
        <div className="card">
          <div className="link-row">
            <div className="link-info">
              <span style={{ fontSize: 22 }}>💰</span>
              <div>
                <div className="link-title">経費管理</div>
                <div className="link-desc">経費の提出・支払管理・個人の帳簿を全画面で</div>
              </div>
            </div>
            <button className="btn-primary" style={{ margin: 0 }} onClick={onOpenMoney}>開く</button>
          </div>
        </div>
      )}
      {settingsOpen && <AccountSettings me={me} onRename={onRename} />}
      {me.hourly_rate > 0 && <MyWork me={me} />}
    </>
  )
}

// 連携とアカウント設定（プロフィールの一番上をタップすると表示される）
function AccountSettings({ me, onRename }: { me: Member; onRename: (name: string) => void }) {
  const [name, setName] = useState(me.name)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [providers, setProviders] = useState<string[]>([])
  const [googleOk, setGoogleOk] = useState(false)

  const loadIdentities = useCallback(async () => {
    const { data } = await supabase.auth.getUserIdentities()
    setProviders((data?.identities ?? []).map((i) => i.provider))
  }, [])

  useEffect(() => {
    loadIdentities()
    isProviderEnabled('google').then(setGoogleOk)
  }, [loadIdentities])

  const googleLinked = providers.includes('google')

  const saveName = async () => {
    setErr(''); setMsg('')
    // 本人による自分のレコード更新はRLSの members_self_update で許可済み
    const { error } = await supabase.from('members').update({ name }).eq('id', me.id)
    if (error) return setErr('名前を変更できませんでした')
    onRename(name)
    setMsg('名前を保存しました')
  }

  const changePassword = async () => {
    setErr(''); setMsg('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return setErr(authError(error.message))
    setPassword('')
    setMsg('パスワードを変更しました')
  }

  const linkGoogle = async () => {
    setErr('')
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google', options: googleOAuthOptions,
    })
    if (error) setErr(authError(error.message))
  }

  const unlinkGoogle = async () => {
    setErr(''); setMsg('')
    const { data } = await supabase.auth.getUserIdentities()
    const identity = data?.identities?.find((i) => i.provider === 'google')
    if (!identity) return
    const { error } = await supabase.auth.unlinkIdentity(identity)
    if (error) return setErr(authError(error.message))
    loadIdentities()
    setMsg('Googleの連携を解除しました')
  }

  return (
    <>
      <div className="card">
        <h2>外部サービス連携</h2>
        <div className="link-row">
          <div className="link-info">
            <GoogleLogo />
            <div>
              <div className="link-title">Google アカウント</div>
              <div className="link-desc">
                {googleLinked ? '連携済み。カレンダーとMeetに利用します'
                  : googleOk ? '連携するとGoogleログインとカレンダー連携が使えます'
                  : 'Googleログインが未設定です。管理者にご確認ください'}
              </div>
            </div>
          </div>
          {googleLinked
            ? <button className="btn-outline" onClick={unlinkGoogle}>解除</button>
            : <button className="btn-primary" style={{ margin: 0 }} disabled={!googleOk} onClick={linkGoogle}>連携する</button>}
        </div>
      </div>

      <div className="card">
        <h2>アカウント設定</h2>
        <label htmlFor="pf-name">名前</label>
        <input id="pf-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" disabled={!name || name === me.name} onClick={saveName}>名前を保存</button>

        <label htmlFor="pf-pw">新しいパスワード</label>
        <input id="pf-pw" type="password" autoComplete="new-password" placeholder="8文字以上"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-primary" disabled={password.length < 8} onClick={changePassword}>
          パスワードを変更
        </button>

        {msg && <div className="notice">{msg}</div>}
        {err && <div className="notice warn">{err}</div>}
        <button className="btn-logout" onClick={() => supabase.auth.signOut()}>ログアウト</button>
      </div>
    </>
  )
}

/* ---------- 個人目標（稼働表とは別の、個人の目標管理） ---------- */
const fmtMd = (d: string) => {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}
// 今週=今度の日曜、今月=月末
const weekEnd = () => {
  const d = new Date()
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
  return d.toLocaleDateString('sv-SE')
}
const monthEnd = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('sv-SE')
}

const BLANK_GOAL = { title: '', body: '', period: 'week' as Goal['period_type'], due: '' }
const PERIODS: { key: Goal['period_type']; label: string }[] = [
  { key: 'week', label: '今週' },
  { key: 'month', label: '今月' },
  { key: 'custom', label: '期日指定' },
]

function GoalsCard({ member, me, names, canEvaluate }: {
  member: Member; me: Member; names: Record<string, string>; canEvaluate?: boolean
}) {
  const isSelf = member.id === me.id
  const [goals, setGoals] = useState<Goal[]>([])
  const [evals, setEvals] = useState<Record<string, GoalEvaluation[]>>({})
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK_GOAL)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [reviewFor, setReviewFor] = useState<string | null>(null)
  const [reviewText, setReviewText] = useState('')
  const [evalFor, setEvalFor] = useState<string | null>(null)
  const [evalRating, setEvalRating] = useState(0)
  const [evalText, setEvalText] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editFor, setEditFor] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(BLANK_GOAL)

  const load = useCallback(async () => {
    const { data } = await supabase.from('goals').select('*')
      .eq('member_id', member.id).order('due_date')
    const rows = (data as Goal[] | null) ?? []
    setGoals(rows)
    const pairs = await Promise.all(rows.map(async (g) => {
      const { data: ev } = await supabase.from('goal_evaluations').select('*')
        .eq('goal_id', g.id).order('created_at')
      return [g.id, (ev as GoalEvaluation[] | null) ?? []] as const
    }))
    setEvals(Object.fromEntries(pairs))
  }, [member.id])

  useEffect(() => { load() }, [load])

  const dueDate = form.period === 'week' ? weekEnd() : form.period === 'month' ? monthEnd() : form.due

  const add = async () => {
    setErr(''); setBusy(true)
    const { data: created, error } = await supabase.from('goals').insert({
      company_id: member.company_id, member_id: member.id,
      period_type: form.period, due_date: dueDate,
      title: form.title, body: form.body || null,
      status: 'open', self_review: null, reviewed_at: null, google_event_id: null,
      created_at: new Date().toISOString(),
    }).select('id').single()
    setBusy(false)
    if (error) return setErr(`目標を追加できませんでした（${error.message}）`)
    if (created) dueSync('goal', (created as { id: string }).id)
    setForm(BLANK_GOAL)
    setOpen(false)
    load()
  }

  const removeGoal = async (g: Goal) => {
    setMenuFor(null)
    if (!confirm(`「${g.title}」を削除しますか？`)) return
    await dueSync('goal', g.id, 'delete') // 行が消える前にカレンダー側のイベントを消す
    const { error } = await supabase.from('goals').delete().eq('id', g.id)
    if (error) return setErr('削除できませんでした')
    load()
  }

  const startGoal = async (g: Goal) => {
    const { error } = await supabase.from('goals').update({ status: 'active' }).eq('id', g.id)
    if (error) return setErr('更新できませんでした')
    load()
  }

  const openEdit = (g: Goal) => {
    setMenuFor(null)
    setEditFor(g.id)
    setEditForm({ title: g.title, body: g.body ?? '', period: g.period_type, due: g.due_date })
  }

  const saveEdit = async (g: Goal) => {
    setErr('')
    const due = editForm.period === 'week' ? weekEnd() : editForm.period === 'month' ? monthEnd() : editForm.due
    const { error } = await supabase.from('goals')
      .update({ title: editForm.title, body: editForm.body || null, period_type: editForm.period, due_date: due })
      .eq('id', g.id)
    if (error) return setErr(`保存できませんでした（${error.message}）`)
    dueSync('goal', g.id)
    setEditFor(null)
    load()
  }

  const saveReview = async (g: Goal) => {
    setErr('')
    const { error } = await supabase.from('goals')
      .update({ self_review: reviewText, reviewed_at: new Date().toISOString(), status: 'done' })
      .eq('id', g.id)
    if (error) return setErr('振り返りを保存できませんでした')
    setReviewFor(null); setReviewText('')
    load()
  }

  const submitEval = async (g: Goal) => {
    setErr('')
    const { error } = await supabase.from('goal_evaluations').insert({
      goal_id: g.id, evaluator_member_id: me.id,
      rating: evalRating || null, comment: evalText,
      created_at: new Date().toISOString(),
    })
    if (error) return setErr(`評価を投稿できませんでした（${error.message}）`)
    setEvalFor(null); setEvalRating(0); setEvalText('')
    load()
  }

  const overdue = (g: Goal) => (g.status === 'open' || g.status === 'active') && g.due_date <= today()
  // 期日バッジの色: 未着手=灰、実行中=緑、期日超過=黄、終了=灰
  const dueBadge = (g: Goal) =>
    overdue(g) ? 'badge-yellow' : g.status === 'active' ? 'badge-green' : 'badge-gray'

  return (
    <div className="card card-plain">
      <h2>
        目標 <span className="tag">今週・今月と中長期</span>
        {isSelf && !open && <button className="h2-action" onClick={() => setOpen(true)}>＋ 目標を追加</button>}
      </h2>

      {isSelf && open && (
        <div className="goal-form">
          <label htmlFor="gl-title">目標</label>
          <input id="gl-title" type="text" placeholder="例: 新規案件の見積もりを3件出す" autoFocus
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label htmlFor="gl-body">補足（任意）</label>
          <input id="gl-body" type="text" placeholder="達成基準やメモ"
            value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <label>期間</label>
          <div className="seg-row" role="tablist" aria-label="目標の期間">
            {PERIODS.map((p) => (
              <button key={p.key} role="tab" aria-selected={form.period === p.key}
                className={`preset-chip ${form.period === p.key ? 'sel' : ''}`}
                onClick={() => setForm({ ...form, period: p.key })}>{p.label}</button>
            ))}
            {form.period === 'custom' && (
              <input type="date" aria-label="期日" value={form.due}
                onChange={(e) => setForm({ ...form, due: e.target.value })} />
            )}
          </div>
          <div className="notice">期日: {dueDate ? fmtMd(dueDate) : '未設定'}（今週=日曜、今月=月末。年末や年度末は期日指定で）</div>
          <div className="form-actions">
            <button className="btn-primary" style={{ margin: 0 }}
              disabled={!form.title || !dueDate || busy} onClick={add}>
              {busy ? '追加中…' : '追加'}
            </button>
            <button className="btn-outline" onClick={() => { setOpen(false); setErr('') }}>キャンセル</button>
          </div>
        </div>
      )}

      {goals.length === 0 && !open && (
        <div className="notice">{isSelf ? 'まだ目標がありません。「＋ 目標を追加」から設定できます' : 'まだ目標がありません'}</div>
      )}

      <div className="list">
        {goals.map((g) => editFor === g.id ? (
          <div key={g.id} className="goal-item">
            <label htmlFor={`ge-title-${g.id}`}>目標</label>
            <input id={`ge-title-${g.id}`} type="text" autoFocus
              value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            <label htmlFor={`ge-body-${g.id}`}>補足（任意）</label>
            <input id={`ge-body-${g.id}`} type="text" placeholder="達成基準やメモ"
              value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })} />
            <label>期間</label>
            <div className="seg-row" role="tablist" aria-label="目標の期間">
              {PERIODS.map((p) => (
                <button key={p.key} role="tab" aria-selected={editForm.period === p.key}
                  className={`preset-chip ${editForm.period === p.key ? 'sel' : ''}`}
                  onClick={() => setEditForm({ ...editForm, period: p.key })}>{p.label}</button>
              ))}
              {editForm.period === 'custom' && (
                <input type="date" aria-label="期日" value={editForm.due}
                  onChange={(e) => setEditForm({ ...editForm, due: e.target.value })} />
              )}
            </div>
            <div className="form-actions">
              <button className="btn-primary" style={{ margin: 0 }}
                disabled={!editForm.title || (editForm.period === 'custom' && !editForm.due)}
                onClick={() => saveEdit(g)}>保存</button>
              <button className="btn-outline" onClick={() => setEditFor(null)}>キャンセル</button>
            </div>
          </div>
        ) : (
          <div key={g.id} className="goal-item">
            <div className="goal-head">
              <span className={`badge ${dueBadge(g)}`}>
                {g.period_type === 'week' ? '今週' : g.period_type === 'month' ? '今月' : '中長期'} · {fmtMd(g.due_date)}まで
              </span>
              {g.status === 'done' && <span className="badge badge-blue">達成・振り返り済み</span>}
              {g.status === 'dropped' && <span className="badge badge-gray">取り下げ</span>}
              {overdue(g) && <span className="badge badge-yellow">期日到来・振り返り待ち</span>}
              {!overdue(g) && g.status === 'active' && <span className="badge badge-green">実行中</span>}
              {!overdue(g) && g.status === 'open' && <span className="badge badge-gray">未着手</span>}
              {isSelf && g.status === 'open' && !overdue(g) && (
                <button className="btn-chip" onClick={() => startGoal(g)}>着手する</button>
              )}
              {isSelf && (g.status === 'open' || g.status === 'active') && (
                <div className="goal-menu">
                  <button className="icon-btn goal-menu-btn" aria-label="目標の操作" aria-expanded={menuFor === g.id}
                    onClick={() => setMenuFor(menuFor === g.id ? null : g.id)}>⋯</button>
                  {menuFor === g.id && (
                    <div className="goal-menu-pop" role="menu">
                      <button role="menuitem" onClick={() => openEdit(g)}>編集</button>
                      <button role="menuitem" className="danger" onClick={() => removeGoal(g)}>削除</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="goal-title">{g.title}</div>
            {g.body && <div className="goal-body">{g.body}</div>}

            {g.self_review && (
              <div className="goal-review">
                <span className="goal-review-label">振り返り</span>{g.self_review}
              </div>
            )}
            {isSelf && !g.self_review && overdue(g) && (
              reviewFor === g.id ? (
                <div className="goal-review-form">
                  <textarea rows={3} placeholder="達成度や学びを書いて振り返りましょう"
                    value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
                  <div className="form-actions">
                    <button className="btn-primary" style={{ margin: 0 }}
                      disabled={!reviewText} onClick={() => saveReview(g)}>振り返りを保存</button>
                    <button className="btn-outline" onClick={() => { setReviewFor(null); setReviewText('') }}>キャンセル</button>
                  </div>
                </div>
              ) : (
                <button className="btn-outline" onClick={() => { setReviewFor(g.id); setReviewText('') }}>振り返りを書く</button>
              )
            )}

            {(evals[g.id] ?? []).map((ev) => (
              <div key={ev.id} className="goal-eval">
                <span className="goal-review-label">{names[ev.evaluator_member_id] ?? '—'}の評価</span>
                {ev.rating != null && <span className="goal-stars">{'★'.repeat(ev.rating)}{'☆'.repeat(5 - ev.rating)}</span>}
                {ev.comment}
              </div>
            ))}
            {canEvaluate && (
              evalFor === g.id ? (
                <div className="goal-review-form">
                  <div className="seg-row" role="radiogroup" aria-label="評価（5段階）">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} role="radio" aria-checked={evalRating === n}
                        className={`preset-chip ${evalRating === n ? 'sel' : ''}`}
                        onClick={() => setEvalRating(evalRating === n ? 0 : n)}>★{n}</button>
                    ))}
                  </div>
                  <textarea rows={3} placeholder="評価コメント（本人と会社のメンバーに公開されます）"
                    value={evalText} onChange={(e) => setEvalText(e.target.value)} />
                  <div className="form-actions">
                    <button className="btn-primary" style={{ margin: 0 }}
                      disabled={!evalText} onClick={() => submitEval(g)}>評価を投稿</button>
                    <button className="btn-outline" onClick={() => { setEvalFor(null); setEvalRating(0); setEvalText('') }}>キャンセル</button>
                  </div>
                </div>
              ) : (
                <button className="btn-outline" onClick={() => { setEvalFor(g.id); setEvalRating(0); setEvalText('') }}>評価する</button>
              )
            )}
          </div>
        ))}
      </div>
      {err && <div className="notice warn">{err}</div>}
    </div>
  )
}

/* ---------- ネクストアクション（目標とは別の、直近のやること管理） ---------- */
const NA_LABEL: Record<NextAction['status'], string> = { todo: '未着手', doing: '進行中', done: '完了' }

function NextActionsCard({ member, me }: { member: Member; me: Member }) {
  const isSelf = member.id === me.id
  const [rows, setRows] = useState<NextAction[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [leaving, setLeaving] = useState<Set<string>>(new Set()) // 完了直後、消えるまでの間の行
  const composing = useRef(false) // IME変換中はEnterで追加しない
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('next_actions').select('*')
      .eq('member_id', member.id).order('created_at')
    setRows((data as NextAction[] | null) ?? [])
  }, [member.id])

  useEffect(() => { load() }, [load])

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1500) }

  const patch = (id: string, p: Partial<NextAction>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))

  const save = async (id: string, p: Partial<NextAction>) => {
    setErr('')
    const { error } = await supabase.from('next_actions').update(p).eq('id', id)
    if (error) return setErr('保存できませんでした')
    flash()
  }

  const changeStatus = async (r: NextAction, status: NextAction['status']) => {
    const p = { status, done_at: status === 'done' ? new Date().toISOString() : null }
    patch(r.id, p)
    if (status === 'done' && !showDone) {
      // 打ち消し線を一拍見せてからスッと消す
      setLeaving((s) => new Set(s).add(r.id))
      setTimeout(() => setLeaving((s) => { const n = new Set(s); n.delete(r.id); return n }), 900)
    }
    await save(r.id, p)
    // 完了したらカレンダーから消し、戻したら再同期する
    dueSync('next_action', r.id, status === 'done' ? 'delete' : 'upsert')
  }
  const changeDue = async (r: NextAction, due: string) => {
    const p = { due_date: due || null }
    patch(r.id, p); await save(r.id, p)
    dueSync('next_action', r.id)
  }
  // 内容・メモは入力停止後に自動保存（モバイルではblurが起きないままタブ移動しがちなため）
  const patchText = (r: NextAction, field: 'title' | 'note', value: string) => {
    patch(r.id, { [field]: value })
    const key = `${r.id}:${field}`
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      if (field === 'title' && !value.trim()) return
      save(r.id, { [field]: field === 'title' ? value.trim() : value || null })
    }, 800)
  }
  const flushText = (r: NextAction, field: 'title' | 'note') => {
    const key = `${r.id}:${field}`
    clearTimeout(timers.current[key])
    const value = field === 'title' ? r.title : (r.note ?? '')
    if (field === 'title' && !value.trim()) return
    save(r.id, { [field]: field === 'title' ? value.trim() : value || null })
  }

  const add = async () => {
    const title = newTitle.trim()
    if (!title) return
    setErr('')
    const { error } = await supabase.from('next_actions').insert({
      company_id: member.company_id, member_id: member.id,
      title, status: 'todo', due_date: null, note: null, done_at: null, google_event_id: null,
      created_at: new Date().toISOString(),
    })
    if (error) return setErr(`追加できませんでした（${error.message}）`)
    setNewTitle('')
    load()
  }

  const remove = async (r: NextAction) => {
    if (r.google_event_id) await dueSync('next_action', r.id, 'delete') // 行が消える前にイベントを消す
    const { error } = await supabase.from('next_actions').delete().eq('id', r.id)
    if (error) return setErr('削除できませんでした')
    load()
  }

  const doneCount = rows.filter((r) => r.status === 'done').length
  // 完了した行はToDoアプリのように一覧から消す（少しの間打ち消し線で見せてから）。
  // 「完了を表示」で見返し・未完了への戻しができる
  const visibleRows = rows.filter((r) => r.status !== 'done' || showDone || leaving.has(r.id))

  if (!isSelf && rows.length === 0) return null

  return (
    <div className="card card-plain">
      <h2>
        ネクストアクション{' '}
        <span className="tag">{rows.length > 0 ? `${doneCount}/${rows.length} 完了` : '直近のやること'}</span>
        {saved && <span className="pt-saved">✓ 保存</span>}
      </h2>
      {visibleRows.length > 0 && (
        <div className="plan-table-wrap">
          <table className="plan-table na-table">
            <colgroup>
              <col className="na-col-due" /><col /><col className="na-col-status" /><col className="na-col-note" />
            </colgroup>
            <thead>
              <tr><th>期日</th><th>内容</th><th>ステータス</th><th>メモ</th></tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className={`${r.status === 'done' ? 'na-done' : ''} ${leaving.has(r.id) ? 'na-leaving' : ''}`}>
                  <td className="na-due">
                    {isSelf ? (
                      // 表示は月/日だけにして、タップで下の透明なdate入力のピッカーを開く
                      <label className="na-due-edit">
                        <span>{r.due_date ? fmtMd(r.due_date) : '—'}</span>
                        <input type="date" value={r.due_date ?? ''} aria-label="期日"
                          onChange={(e) => changeDue(r, e.target.value)} />
                      </label>
                    ) : (r.due_date ? fmtMd(r.due_date) : '—')}
                  </td>
                  <td className="na-title">
                    {isSelf ? (
                      <div className="na-title-wrap">
                        <input type="text" value={r.title} aria-label="内容"
                          onChange={(e) => patchText(r, 'title', e.target.value)}
                          onBlur={() => flushText(r, 'title')} />
                        <button className="pt-break-del na-del" aria-label={`${r.title}を削除`}
                          onClick={() => remove(r)}>×</button>
                      </div>
                    ) : r.title}
                  </td>
                  <td>
                    {isSelf ? (
                      <select className={`na-status na-${r.status}`} value={r.status} aria-label={`${r.title}のステータス`}
                        onChange={(e) => changeStatus(r, e.target.value as NextAction['status'])}>
                        {(['todo', 'doing', 'done'] as const).map((s) => (
                          <option key={s} value={s}>{NA_LABEL[s]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`badge ${r.status === 'done' ? 'badge-blue' : r.status === 'doing' ? 'badge-green' : 'badge-gray'}`}>
                        {NA_LABEL[r.status]}
                      </span>
                    )}
                  </td>
                  <td className="na-note">
                    {isSelf ? (
                      <input type="text" value={r.note ?? ''} aria-label="メモ" placeholder="メモ"
                        onChange={(e) => patchText(r, 'note', e.target.value)}
                        onBlur={() => flushText(r, 'note')} />
                    ) : (r.note ?? '')}
                  </td>
                </tr>
              ))}
              {isSelf && (
                // 表の最下行から直接追加（Excel風）
                <tr className="pt-add-row">
                  <td className="na-due">＋</td>
                  <td className="na-title">
                    <input type="text" placeholder="やることを追加" aria-label="やることを追加"
                      value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                      onCompositionStart={() => { composing.current = true }}
                      onCompositionEnd={() => { composing.current = false }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !composing.current && !e.nativeEvent.isComposing) add() }} />
                  </td>
                  <td colSpan={2}>
                    <button className="link-btn" disabled={!newTitle.trim()} onClick={add}>＋追加</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {doneCount > 0 && (
        <button className="na-show-done" onClick={() => setShowDone(!showDone)}>
          {showDone ? '完了したものを隠す' : `完了した${doneCount}件を表示`}
        </button>
      )}
      {isSelf && (
        <>
          {visibleRows.length === 0 && (
            <div className="draft-times">
              <input type="text" placeholder="やることを追加" style={{ flex: 1 }}
                value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                onCompositionStart={() => { composing.current = true }}
                onCompositionEnd={() => { composing.current = false }}
                // 日本語入力の変換確定Enterでは追加しない
                onKeyDown={(e) => { if (e.key === 'Enter' && !composing.current && !e.nativeEvent.isComposing) add() }} />
              <button className="btn-primary" style={{ margin: 0 }} disabled={!newTitle.trim()} onClick={add}>追加</button>
            </div>
          )}
          <div className="notice">目標とは別の、直近のやることリストです。稼働表とは連動しません</div>
        </>
      )}
      {err && <div className="notice warn">{err}</div>}
    </div>
  )
}

/* ---------- フィードバック（プロフィールへの公開投稿） ---------- */
function FeedbackCard({ target, me, names }: { target: Member; me: Member; names: Record<string, string> }) {
  const [posts, setPosts] = useState<FeedbackPost[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isSelf = target.id === me.id

  const load = useCallback(async () => {
    const { data } = await supabase.from('feedback_posts').select('*')
      .eq('target_member_id', target.id).order('created_at', { ascending: false })
    setPosts((data as FeedbackPost[] | null) ?? [])
  }, [target.id])

  useEffect(() => { load() }, [load])

  const post = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.from('feedback_posts').insert({
      company_id: target.company_id, target_member_id: target.id,
      author_member_id: me.id, body, created_at: new Date().toISOString(),
    })
    setBusy(false)
    if (error) return setErr(`投稿できませんでした（${error.message}）`)
    setBody('')
    load()
  }

  const remove = async (p: FeedbackPost) => {
    if (!confirm('この投稿を削除しますか？')) return
    const { error } = await supabase.from('feedback_posts').delete().eq('id', p.id)
    if (error) return setErr('削除できませんでした')
    load()
  }

  return (
    <div className="card">
      <h2>フィードバック <span className="tag">会社のメンバーに公開</span></h2>
      {!isSelf && (
        <>
          <textarea rows={3} placeholder={`${target.name}さんへのフィードバックを書く`}
            value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="form-actions">
            <button className="btn-primary" style={{ margin: 0 }} disabled={!body || busy} onClick={post}>
              {busy ? '投稿中…' : '投稿'}
            </button>
          </div>
        </>
      )}
      {posts.length === 0 && (
        <div className="notice">{isSelf ? 'まだフィードバックはありません。届くとここに表示されます' : 'まだフィードバックはありません'}</div>
      )}
      <div className="list">
        {posts.map((p) => (
          <div key={p.id} className="goal-item">
            <div className="goal-head">
              <span className="badge badge-gray">{names[p.author_member_id] ?? '—'}</span>
              <span className="goal-when">{fmtMd(p.created_at.slice(0, 10))}</span>
              {p.author_member_id === me.id && (
                <button className="edit-delete goal-delete" onClick={() => remove(p)}>削除</button>
              )}
            </div>
            <div className="goal-body">{p.body}</div>
          </div>
        ))}
      </div>
      {err && <div className="notice warn">{err}</div>}
    </div>
  )
}

/* ---------- 他メンバーのプロフィール閲覧（目標＋フィードバック。管理者は評価も） ---------- */
function MemberProfileView({ member, me, names, onBack }: {
  member: Member; me: Member; names: Record<string, string>; onBack: () => void
}) {
  return (
    <>
      <div className="card">
        <div className="profile-head">
          <div className="m-avatar profile-avatar">{member.name[0]}</div>
          <div>
            <div className="profile-name">{member.name}</div>
            <div className="m-mail">{member.email}</div>
            <div className="account-badges">
              <span className="badge badge-gray">{member.role === 'admin' ? '管理者' : '一般'}</span>
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-outline" onClick={onBack}>← 戻る</button>
        </div>
      </div>
      <NextActionsCard member={member} me={me} />
      <GoalsCard member={member} me={me} names={names} canEvaluate={me.role === 'admin'} />
      <FeedbackCard target={member} me={me} names={names} />
    </>
  )
}

/* ---------- プロフィールタブ（自分／管理者は組織管理と切り替え） ---------- */
function ProfilePage({ me, onRename, onOpenMoney }: { me: Member; onRename: (name: string) => void; onOpenMoney?: () => void }) {
  const isAdmin = me.role === 'admin'
  const [view, setView] = useState<'mine' | 'org'>('mine')
  const [members, setMembers] = useState<Member[]>([])
  const [viewing, setViewing] = useState<Member | null>(null)

  useEffect(() => {
    supabase.from('members').select('*').eq('company_id', me.company_id).order('created_at')
      .then(({ data }) => setMembers((data as Member[] | null) ?? []))
  }, [me.company_id])

  const names = Object.fromEntries(members.map((m) => [m.id, m.name]))
  const colleagues = members.filter((m) => m.id !== me.id && m.status === 'active')

  if (viewing) {
    return <MemberProfileView member={viewing} me={me} names={names} onBack={() => setViewing(null)} />
  }

  return (
    <>
      {isAdmin && (
        <div className="seg-row" role="tablist" aria-label="プロフィールの切り替え">
          <button role="tab" aria-selected={view === 'mine'}
            className={`preset-chip ${view === 'mine' ? 'sel' : ''}`}
            onClick={() => setView('mine')}>自分</button>
          <button role="tab" aria-selected={view === 'org'}
            className={`preset-chip ${view === 'org' ? 'sel' : ''}`}
            onClick={() => setView('org')}>組織管理</button>
        </div>
      )}
      {isAdmin && view === 'org' ? (
        <Members me={me} onOpenProfile={setViewing} />
      ) : (
        <>
          <Profile me={me} onRename={onRename} onOpenMoney={onOpenMoney} />
          <NextActionsCard member={me} me={me} />
          <GoalsCard member={me} me={me} names={names} />
          <FeedbackCard target={me} me={me} names={names} />
          {colleagues.length > 0 && (
            <div className="card">
              <h2>メンバー <span className="tag">目標を見る・フィードバックを送る</span></h2>
              <div className="list">
                {colleagues.map((m, i) => (
                  <div key={m.id} className="list-item">
                    <div className="m-avatar member-av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                      {m.name[0]}
                    </div>
                    <div className="title">{m.name}</div>
                    <button className="btn-outline" onClick={() => setViewing(m)}>プロフィール</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

/* ---------- App ---------- */
const ICONS: Record<Tab, React.ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  report: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" />
    </svg>
  ),
  schedule: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="17" rx="2" /><path d="M3 10h18M8 2v5M16 2v5" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  ),
}

// 4つ目は全員プロフィール（管理者はプロフィール内の上タブで組織管理＝旧名簿へ）
const tabsFor = (_role: Member['role']): { key: Tab; label: string }[] => [
  { key: 'home', label: 'ホーム' },
  { key: 'report', label: '稼働表' },
  { key: 'schedule', label: 'カレンダー' },
  { key: 'profile', label: 'プロフィール' },
]

/* ---------- デモ（/demo・データはインメモリ） ---------- */
function DemoApp() {
  const [tab, setTab] = useState<Tab>('home')
  const switchable = DEMO_MEMBERS.filter((m) => m.status === 'active')
  const [me, setMe] = useState(switchable[0])
  const [open, setOpen] = useState(false)

  const pick = (m: Member) => { setMe(m); setTab('home'); setOpen(false) }

  return (
    <div className="app">
      <button className="demo-fab" onClick={() => setOpen(!open)}>
        デモ画面 · {me.name}（{me.role === 'admin' ? '管理者' : '従業員'}）{open ? ' ▴' : ' ▾'}
      </button>
      {open && (
        <div className="demo-bar">
          {switchable.map((m, i) => (
            <button key={m.id} className={`demo-user ${m.id === me.id ? 'sel' : ''}`} onClick={() => pick(m)}>
              <span className="m-avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>{m.name[0]}</span>
              {m.name}（{m.role === 'admin' ? '管理者' : '従業員'}）
            </button>
          ))}
          <a href="/" style={{ marginLeft: 'auto', fontSize: 12 }}>ログイン画面へ</a>
        </div>
      )}
      <header className="header">
        <button className="brand" onClick={() => setTab('home')}>
          <span className="brand-mark">🌻</span>ひまわり事務機
        </button>
        <button className={`avatar ${tab === 'profile' ? 'sel' : ''}`} title="プロフィール・設定"
          onClick={() => setTab('profile')}>
          {me.name[0]}
        </button>
      </header>
      {/* keyで切り替え時に各画面を作り直し、前のユーザーのデータを残さない */}
      {tab === 'home' && <Home key={me.id} me={me} />}
      {tab === 'report' && <Report key={me.id} me={me} />}
      {tab === 'schedule' && <Schedule key={me.id} me={me} />}
      {tab === 'profile' && <ProfilePage key={me.id} me={me} onRename={(name) => setMe({ ...me, name })} />}
      <nav className="tabbar">
        {tabsFor(me.role).map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="icon">{ICONS[t.key]}</span>{t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Member | null>(null)
  const [company, setCompany] = useState<{ id: string; name: string; icon: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)
  const [moneyMode, setMoneyMode] = useState(false)

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) { setMe(null); setCompany(null); setLoading(false); return }
    // 招待済みレコードがあれば自分のアカウントに紐付け（activate）
    await supabase.from('members')
      .update({ user_id: s.user.id, status: 'active' })
      .eq('email', s.user.email!).is('user_id', null)
    const { data } = await supabase.from('members').select('*')
      .eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle()
    setMe(data)
    if (data) {
      const { data: c } = await supabase.from('companies')
        .select('id, name, icon').eq('id', data.company_id).single()
      setCompany(c)
    }
    setLoading(false)
  }, [])

  const editBrand = async () => {
    if (!company) return
    const name = prompt('会社名', company.name)
    if (name === null) return
    const icon = prompt('アイコン（絵文字か1文字）', company.icon)
    if (icon === null) return
    const { error } = await supabase.from('companies')
      .update({ name: name || company.name, icon: (icon || company.icon).slice(0, 2) })
      .eq('id', company.id)
    if (error) alert('変更は管理者のみ可能です')
    else setCompany({ ...company, name: name || company.name, icon: (icon || company.icon).slice(0, 2) })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      loadMe(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      // OAuth直後にしか渡ってこないrefresh_tokenを保存（カレンダー同期用）
      if (s?.provider_refresh_token) {
        supabase.from('google_tokens')
          .upsert({ user_id: s.user.id, refresh_token: s.provider_refresh_token, updated_at: new Date().toISOString() })
          .then(() => {})
      }
      setSession(s)
      loadMe(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadMe])

  // お金管理モード: ヘッダー・タブバーを出さない全画面
  if (moneyMode && me) {
    return (
      <div className="app">
        <MoneyMode me={me} onClose={() => setMoneyMode(false)} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header" style={{ visibility: me ? 'visible' : 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="brand" onClick={() => setTab('home')}>
            {company?.icon ? <span className="brand-mark">{company.icon}</span> : <DayDeedLogo />}
            {company?.name ?? 'DayDeed'}
          </button>
          {me?.role === 'admin' && company && (
            <button className="brand-edit" title="会社名・アイコンを変更" onClick={editBrand}>✎</button>
          )}
        </div>
        {me && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="icon-btn money-icon-btn" title="経費管理" aria-label="経費管理"
              onClick={() => setMoneyMode(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M8.5 7.5 12 12l3.5-4.5M12 12v5M9.5 13.5h5M9.5 16h5" />
              </svg>
            </button>
            <button className={`avatar ${tab === 'profile' ? 'sel' : ''}`} title="プロフィール・設定"
              onClick={() => setTab('profile')}>
              {me.name[0]}
            </button>
          </div>
        )}
      </header>

      {loading ? <div className="empty">読み込み中…</div>
        : recovering ? <NewPassword onDone={() => setRecovering(false)} />
        : !session ? <Auth />
        : !me ? <Onboarding email={session.user.email ?? ''} onDone={() => loadMe(session)} />
        : (
          <>
            {tab === 'home' && <Home me={me} />}
            {tab === 'report' && <Report me={me} />}
            {tab === 'schedule' && <Schedule me={me} />}
            {tab === 'profile' && (
              <ProfilePage me={me} onRename={(name) => setMe({ ...me, name })}
                onOpenMoney={() => setMoneyMode(true)} />
            )}
            <nav className="tabbar">
              {tabsFor(me.role).map((t) => (
                <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                  <span className="icon">{ICONS[t.key]}</span>{t.label}
                </button>
              ))}
            </nav>
          </>
        )}
    </div>
  )
}

// /demo ではフックの実行を分岐させないよう、コンポーネントごと差し替える
export default DEMO ? DemoApp : App
