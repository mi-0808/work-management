import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isProviderEnabled, supabase, today } from './lib/supabase'
import { DEMO, DEMO_MEMBERS } from './lib/demo'
import type { Attendance, Break, Invoice, Member, Report as ReportRow, Schedule as ScheduleRow } from './lib/supabase'

type Tab = 'home' | 'report' | 'schedule' | 'members' | 'profile'

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
      options: { redirectTo: location.origin },
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
          <span className="brand-mark">勤</span>Kintai
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
              {e.with_meet && <span className="badge badge-blue">Meet</span>}
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
            {e.with_meet && <span className="badge badge-blue">Meet</span>}
          </div>
        ))}
        {selDay.meetings.length === 0 && <div className="wd-row empty-inline">ミーティングはありません</div>}
        {selDay.rep?.plan && <div className="wd-plan">やること: {selDay.rep.plan}</div>}
      </div>
    </div>
  )
}

/* ---------- 出勤・退勤 ---------- */
function Home({ me }: { me: Member }) {
  const now = useClock()
  const [att, setAtt] = useState<Attendance | null>(null)
  const [week, setWeek] = useState<Attendance[]>([])
  const [plan, setPlan] = useState('')
  const [err, setErr] = useState('')
  // 押し忘れ修正用: ボタン内で時刻を直接編集する（'in' | 'out' | 中抜けのid | 編集中でなければnull）
  const [editing, setEditing] = useState<string | null>(null)
  const [editTime, setEditTime] = useState('')
  const [editTime2, setEditTime2] = useState('') // 中抜けの終了時刻用
  // 最近の勤怠の「やったこと」（日報body）のインライン編集
  const [reports, setReports] = useState<ReportRow[]>([])
  const [editDay, setEditDay] = useState<string | null>(null)
  const [dayBody, setDayBody] = useState('')

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
    setReports((reps as ReportRow[]) ?? [])
    setWeek(data ?? [])
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

  // 「やったこと」＝稼働予定表と同じ daily_reports.plan。どちらで編集しても同期される
  const saveDayBody = async () => {
    if (!editDay) return
    setErr('')
    const { error } = await supabase.from('daily_reports').upsert(
      { member_id: me.id, work_date: editDay, plan: dayBody },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`保存できませんでした（${error.message}）`)
    setEditDay(null)
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

      <TodayMeetings me={me} />
      <WeekPlan me={me} />
      <PlanRows me={me} />

      <div className="card">
        <h2>最近の勤怠</h2>
        {week.length === 0 ? <div className="empty">まだ勤怠記録がありません</div> : (
          week.map((a) => {
            const bm = breakMinutes(a.breaks)
            // 稼働予定表の「やること」(plan)と同一データ。旧データはbodyに残っているので後ろで拾う
            const rep = reports.find((r) => r.work_date === a.work_date)
            const body = rep?.plan || rep?.body || ''
            return (
              <div key={a.id} className="log-entry">
                <div className="log-row">
                  <span className="d">{a.work_date.slice(5).replace('-', '/')}</span>
                  <span className="t">
                    {fmtTime(a.clock_in)} – {a.clock_out ? fmtTime(a.clock_out) : '勤務中'}
                    {bm > 0 && ` · 中抜け${Math.round(bm)}分`}
                  </span>
                  {(a.auto_in || a.auto_out) && <span className="badge badge-yellow">⚠ 自動補完</span>}
                  <span className="dur">{a.clock_in ? workedLabel(a) : '—'}</span>
                </div>
                {editDay === a.work_date ? (
                  <div className="draft-times log-note-edit">
                    <input type="text" autoFocus aria-label="やったこと" placeholder="やったことを入力"
                      value={dayBody} onChange={(e) => setDayBody(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveDayBody()} />
                    <button className="edit-ok" aria-label="保存" onClick={saveDayBody}>✓</button>
                    <button className="edit-cancel" aria-label="キャンセル" onClick={() => setEditDay(null)}>✕</button>
                  </div>
                ) : (
                  <button className={`log-note ${body ? '' : 'empty'}`}
                    onClick={() => { setEditDay(a.work_date); setDayBody(body) }}>
                    {body || '＋ やったことを書く'}
                  </button>
                )}
              </div>
            )
          })
        )}
        {att?.auto_in && (
          <div className="notice">
            出勤打刻がなかったため、所定開始時刻（{hm(me.work_start)}）で自動補完しました。修正が必要な場合は管理者に連絡してください
          </div>
        )}
      </div>
    </>
  )
}

/* ---------- 稼働予定表（日報タブ内・自己管理用。月単位で切り替え） ---------- */
function PlanRows({ me }: { me: Member }) {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [atts, setAtts] = useState<Attendance[]>([]) // 実稼働（打刻）の記録
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
    const [{ data }, { data: a }] = await Promise.all([
      supabase.from('daily_reports').select('*').eq('member_id', me.id)
        .gte('work_date', from).lt('work_date', to).order('work_date', { ascending: true }),
      supabase.from('attendances').select('*, breaks(*)').eq('member_id', me.id)
        .gte('work_date', from).lt('work_date', to),
    ])
    setAtts((a as Attendance[]) ?? [])
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
                const a = atts.find((x) => x.work_date === r.work_date)
                return (
                <tr key={r.work_date} className={r.work_date === today() ? 'pt-today' : ''}>
                  <td className="pt-date">{fmtDate(r.work_date)}
                    {a?.clock_out && (
                      // 確定は自動ではなく本人がボタンで固定する。押すまではいつでも編集可
                      <button className={`pt-fix-btn ${r.confirmed ? 'on' : ''}`}
                        aria-pressed={r.confirmed ?? false}
                        onClick={() => { dirty.current.add(r.work_date); const nr = { ...r, confirmed: !r.confirmed }; patch(r.work_date, { confirmed: nr.confirmed }); save(nr) }}>
                        {r.confirmed ? '確定済' : '確定'}
                      </button>
                    )}
                    {savedAt === r.work_date && <span className="pt-saved" role="status">✓保存</span>}</td>
                  {r.confirmed ? (
                    // 稼働が終わった日は予定ではなく実際の打刻時刻で確定表示（編集はホームの打刻修正から）
                    <>
                      <td className="pt-time pt-done">{a?.clock_in ? fmtTime(a.clock_in) : (r.planned_start ?? '')}</td>
                      <td className="pt-time pt-done">{a?.clock_out ? fmtTime(a.clock_out) : (r.planned_end ?? '')}</td>
                    </>
                  ) : (
                    <>
                      <td><input type="text" inputMode="numeric"
                        placeholder={a?.clock_in ? fmtTime(a.clock_in) : '0900'} className="pt-time"
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
      <PlanRows me={me} />
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
    const { data } = await supabase.from('schedules').select('*')
      .gte('starts_at', from).lt('starts_at', to).order('starts_at')
    // 却下された提案は表示しない
    setEvents((data ?? []).filter((e: ScheduleRow) => e.status !== 'declined'))
  }, [year, month])

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
    const { error } = await supabase.from('schedules').insert({
      company_id: me.company_id, member_id: me.id, title,
      starts_at: mk(draft.start), ends_at: mk(draft.end), with_meet: meet,
      ...(proposeTo ? { status: 'proposed', proposed_by: me.id, to_member_id: proposeTo } : {}),
    })
    if (error) return setErr(`予定を保存できませんでした（${error.message}）`)
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
        </div>
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
              <b>{e.title}</b> {evStart(e)}–{evEnd(e)}{e.with_meet && ' · Meet'}
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

/* ---------- 名簿 ---------- */
// MyHood swatch palette（塗り専用。白文字が乗るので濃色寄りに調整）
const AVATAR_COLORS = ['#007f66', '#2F8CFF', '#7c5cd6', '#0f8a7e', '#c2447e', '#c2691c']

const BLANK_INVITE = { name: '', email: '', work_start: '09:00', work_end: '18:00' }

function Members({ me }: { me: Member }) {
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

  const load = useCallback(async () => {
    setMinutes(await monthWorkedMinutes(me.id, month))
    const { data } = await supabase.from('invoices').select('*')
      .eq('member_id', me.id).eq('month', month).maybeSingle()
    setInv((data as Invoice | null) ?? null)
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
    const { error } = await supabase.from('invoices').insert({
      member_id: me.id, month, minutes: Math.round(minutes),
      hourly_rate: me.hourly_rate, expenses,
      status: 'issued', issued_at: new Date().toISOString(), paid_at: null,
    })
    if (error) return setErr(`発行できませんでした（${error.message}）`)
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
            請求書を発行（{yen(labor + expenses.reduce((s, e) => s + e.amount, 0))}）
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
function Profile({ me, onRename }: { me: Member; onRename: (name: string) => void }) {
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
      provider: 'google', options: { redirectTo: location.origin },
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
        <div className="profile-head">
          <div className="m-avatar profile-avatar">{me.name[0]}</div>
          <div>
            <div className="profile-name">{me.name}</div>
            <div className="m-mail">{me.email}</div>
            <div className="account-badges">
              <span className="badge badge-gray">{me.role === 'admin' ? '管理者' : '一般'}</span>
              <span className="badge badge-gray">所定 {hm(me.work_start)}–{hm(me.work_end)}</span>
            </div>
          </div>
        </div>
        {me.role !== 'admin' && (
          <div className="notice">所定勤務時間帯の変更は管理者に依頼してください（打刻漏れ時の自動補完に使われます）</div>
        )}
      </div>

      {me.hourly_rate > 0 && <MyWork me={me} />}

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
  members: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
      <path d="M16 5.5a3.5 3.5 0 0 1 0 6.6" /><path d="M17.5 15.5c2.2.6 3.6 2.1 4 4.5" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  ),
}

// 管理者は名簿、一般はプロフィールを4つ目に置く（管理者はアバターからプロフィールへ）
const tabsFor = (role: Member['role']): { key: Tab; label: string }[] => [
  { key: 'home', label: 'ホーム' },
  { key: 'report', label: '稼働表' },
  { key: 'schedule', label: 'カレンダー' },
  role === 'admin'
    ? { key: 'members', label: '名簿' }
    : { key: 'profile', label: 'プロフィール' },
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
      {tab === 'members' && <Members key={me.id} me={me} />}
      {tab === 'profile' && <Profile key={me.id} me={me} onRename={(name) => setMe({ ...me, name })} />}
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
      setSession(s)
      loadMe(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadMe])

  return (
    <div className="app">
      <header className="header" style={{ visibility: me ? 'visible' : 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="brand" onClick={() => setTab('home')}>
            <span className="brand-mark">{company?.icon ?? '勤'}</span>
            {company?.name ?? 'Kintai'}
          </button>
          {me?.role === 'admin' && company && (
            <button className="brand-edit" title="会社名・アイコンを変更" onClick={editBrand}>✎</button>
          )}
        </div>
        {me && (
          <button className={`avatar ${tab === 'profile' ? 'sel' : ''}`} title="プロフィール・設定"
            onClick={() => setTab('profile')}>
            {me.name[0]}
          </button>
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
            {tab === 'members' && <Members me={me} />}
            {tab === 'profile' && <Profile me={me} onRename={(name) => setMe({ ...me, name })} />}
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
