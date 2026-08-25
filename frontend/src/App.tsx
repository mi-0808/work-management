import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isProviderEnabled, supabase, today } from './lib/supabase'
import type { Attendance, Member, Report as ReportRow, Schedule as ScheduleRow } from './lib/supabase'

type Tab = 'home' | 'report' | 'schedule' | 'members'

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—'
const hm = (t: string) => t.slice(0, 5) // "09:00:00" → "09:00"
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
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
function Onboarding({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')

  const create = async () => {
    const { error } = await supabase.from('companies').insert({ name })
    if (error) return setErr(error.message)
    onDone()
  }

  return (
    <div className="card" style={{ marginTop: 60 }}>
      <h2>会社を作成</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        まだどの会社にも所属していません。会社を作成すると、あなたが管理者になります。
        招待を受けている場合は、招待メールのアドレスでログインし直してください。
      </p>
      <label>会社名</label>
      <input type="text" placeholder="例: 株式会社サンプル" value={name} onChange={(e) => setName(e.target.value)} />
      {err && <div className="notice warn">{err}</div>}
      <button className="btn-primary" disabled={!name} onClick={create}>
        会社を作成して始める
      </button>
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

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('attendances')
      .select('*')
      .eq('member_id', me.id)
      .order('work_date', { ascending: false })
      .limit(7)
    setWeek(data ?? [])
    const t = (data ?? []).find((a) => a.work_date === today()) ?? null
    setAtt(t)
    if (t?.plan) setPlan(t.plan)
  }, [me.id])

  useEffect(() => { load() }, [load])

  const status = att?.clock_out ? '退勤済み' : att?.clock_in ? '勤務中' : '未出勤'

  // 保存は必ず結果を確認する。黙って失敗すると打刻が消えたように見えるため
  const save = async (patch: Partial<Attendance>) => {
    setErr('')
    const { error } = await supabase.from('attendances').upsert(
      { member_id: me.id, work_date: today(), plan, ...patch },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`保存できませんでした（${error.message}）。ログインし直してもう一度お試しください`)
    load()
  }

  const punchIn = () => save({ clock_in: new Date().toISOString() })

  // 退勤のみ → 出勤を所定開始時刻で自動補完
  const punchOut = () => {
    const patch: Partial<Attendance> = { clock_out: new Date().toISOString() }
    if (!att?.clock_in) {
      const d = new Date()
      const [h, m] = hm(me.work_start).split(':').map(Number)
      d.setHours(h, m, 0, 0)
      patch.clock_in = d.toISOString()
      patch.auto_in = true
    }
    return save(patch)
  }

  const savePlan = () => save({})

  return (
    <>
      <div className="hero">
        <div className="date">
          {now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
        </div>
        <div className="clock">
          {now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div className="status-chip"><span className="dot" />{status}</div>
        {err && <div className="notice warn" style={{ position: 'relative', zIndex: 1 }}>{err}</div>}
        <div className="punch-row">
          <button className="btn btn-in" disabled={!!att?.clock_in} onClick={punchIn}>
            {att?.clock_in ? `出勤 ${fmtTime(att.clock_in)}` : '出勤する'}
          </button>
          <button className="btn btn-out" disabled={!!att?.clock_out} onClick={punchOut}>
            {att?.clock_out ? `退勤 ${fmtTime(att.clock_out)}` : '退勤する'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>今日の予定 <span className="tag">出勤時に登録</span></h2>
        <textarea
          placeholder="今日やる予定を入力（例: 新規案件の見積もり作成、15時から定例MTG）"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        />
        <button className="btn-primary" disabled={!plan} onClick={savePlan}>予定を保存</button>
      </div>

      <div className="card">
        <h2>最近の勤怠</h2>
        {week.length === 0 ? <div className="empty">まだ勤怠記録がありません</div> : (
          <table>
            <thead>
              <tr><th>日付</th><th>出勤</th><th>退勤</th><th>状態</th></tr>
            </thead>
            <tbody>
              {week.map((a) => (
                <tr key={a.id}>
                  <td>{a.work_date.slice(5).replace('-', '/')}</td>
                  <td>{fmtTime(a.clock_in)}</td>
                  <td>{fmtTime(a.clock_out)}</td>
                  <td>
                    {(a.auto_in || a.auto_out) && <span className="badge badge-yellow">自動補完</span>}{' '}
                    <span className="badge badge-blue">{a.clock_out ? '退勤済み' : a.clock_in ? '勤務中' : '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

/* ---------- 日報 ---------- */
function Report({ me }: { me: Member }) {
  const [body, setBody] = useState('')
  const [plan, setTodayPlan] = useState<string | null>(null)
  const [history, setHistory] = useState<ReportRow[]>([])
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [{ data: reports }, { data: att }] = await Promise.all([
      supabase.from('daily_reports').select('*').eq('member_id', me.id)
        .order('work_date', { ascending: false }).limit(7),
      supabase.from('attendances').select('plan').eq('member_id', me.id).eq('work_date', today()).maybeSingle(),
    ])
    setHistory(reports ?? [])
    setTodayPlan(att?.plan ?? null)
    const t = (reports ?? []).find((r) => r.work_date === today())
    if (t) { setBody(t.body); setSaved(true) }
  }, [me.id])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    setErr('')
    const { error } = await supabase.from('daily_reports').upsert(
      { member_id: me.id, work_date: today(), body },
      { onConflict: 'member_id,work_date' },
    )
    if (error) return setErr(`提出できませんでした（${error.message}）`)
    setSaved(true)
    load()
  }

  return (
    <>
      <div className="card">
        <h2>今日の日報 <span className="tag">{today().slice(5).replace('-', '/')}</span></h2>
        <label>今日の予定（出勤時に登録）</label>
        <div className="list-item">
          <div className="title">{plan || '未登録'}</div>
        </div>
        <label>業務内容（実績）</label>
        <textarea placeholder="今日行った業務を入力" value={body}
          onChange={(e) => { setBody(e.target.value); setSaved(false) }} />
        {err && <div className="notice warn">{err}</div>}
        <button className="btn-primary" disabled={!body || saved} onClick={submit}>
          {saved ? '提出済み ✓' : '日報を提出'}
        </button>
      </div>

      <div className="card">
        <h2>過去の日報</h2>
        {history.length === 0 ? <div className="empty">まだ日報がありません</div> : (
          <div className="list">
            {history.map((r) => (
              <div key={r.id} className="list-item">
                <div className="when">{r.work_date.slice(5).replace('-', '/')}</div>
                <div className="title">{r.body}</div>
                <span className="badge badge-blue">提出済</span>
              </div>
            ))}
          </div>
        )}
      </div>
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

  const load = useCallback(async () => {
    const from = new Date(year, month, 1).toISOString()
    const to = new Date(year, month + 1, 1).toISOString()
    const { data } = await supabase.from('schedules').select('*')
      .gte('starts_at', from).lt('starts_at', to).order('starts_at')
    setEvents(data ?? [])
  }, [year, month])

  useEffect(() => { load() }, [load])

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
    })
    if (error) return setErr(`予定を保存できませんでした（${error.message}）`)
    setDraft(null); setTitle(''); setMeet(true)
    load()
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
            <div key={e.id} className={`tl-block ${isMine(e) ? 'me' : 'boss'}`}
              style={block(evStart(e), evEnd(e))} onPointerDown={(ev) => ev.stopPropagation()}>
              <b>{e.title}</b> {evStart(e)}–{evEnd(e)}{e.with_meet && ' · Meet'}
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
              <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              <span>–</span>
              <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={meet} onChange={(e) => setMeet(e.target.checked)} style={{ width: 'auto' }} />
              Google Meet のリンクを付ける
            </label>
            {err && <div className="notice warn">{err}</div>}
            <button className="btn-primary" disabled={!title || !!conflict} onClick={add}>
              追加してカレンダーに同期
            </button>
          </div>
        )}
        {!draft && <div className="notice">タイムラインの空き時間をタップすると、そこに予定を作成できます</div>}
      </div>
    </>
  )
}

/* ---------- 名簿 ---------- */
const AVATAR_COLORS = ['#2563eb', '#0b2a6b', '#eab308', '#94a3b8', '#0891b2', '#7c3aed']

function Members({ me }: { me: Member }) {
  const [members, setMembers] = useState<Member[]>([])
  const [err, setErr] = useState('')
  const isAdmin = me.role === 'admin'

  const load = useCallback(async () => {
    const { data } = await supabase.from('members').select('*')
      .eq('company_id', me.company_id).order('created_at')
    setMembers(data ?? [])
  }, [me.company_id])

  useEffect(() => { load() }, [load])

  const changeHours = async (m: Member, key: 'work_start' | 'work_end', value: string) => {
    setMembers(members.map((x) => (x.id === m.id ? { ...x, [key]: value } : x)))
    const { error } = await supabase.from('members').update({ [key]: value }).eq('id', m.id)
    if (error) setErr('所定時間の変更は管理者のみ可能です')
  }

  const invite = async () => {
    const name = prompt('メンバーの名前は？')
    if (!name) return
    const email = prompt('メールアドレスは？（このアドレスのGoogleアカウントでログインすると連携されます）')
    if (!email) return
    const external = confirm('社外メンバーですか？（OK=社外 / キャンセル=社内）')
    const { error } = await supabase.from('members').insert({
      company_id: me.company_id, name, email,
      member_type: external ? 'external' : 'internal',
    })
    if (error) setErr(error.message)
    load()
  }

  return (
    <div className="card">
      <h2>メンバー名簿 <span className="tag">Googleアカウント連携</span></h2>
      {members.map((m, i) => (
        <div key={m.id} className="member">
          <div className="m-avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
            {m.name[0]}
          </div>
          <div className="m-info">
            <div className="m-name">{m.name}{m.id === me.id && '（自分）'}</div>
            <div className="m-mail">{m.status === 'invited' ? `${m.email}（招待中）` : m.email}</div>
          </div>
          <div className="m-hours">
            <input type="time" value={hm(m.work_start)} disabled={!isAdmin}
              onChange={(e) => changeHours(m, 'work_start', e.target.value)} />
            <span>–</span>
            <input type="time" value={hm(m.work_end)} disabled={!isAdmin}
              onChange={(e) => changeHours(m, 'work_end', e.target.value)} />
          </div>
          <span className={`badge ${m.member_type === 'internal' ? 'badge-blue' : 'badge-yellow'}`}>
            {m.member_type === 'internal' ? '社内' : '社外'}
          </span>
          <span className="badge badge-gray">{m.role === 'admin' ? '管理者' : '一般'}</span>
        </div>
      ))}
      {err && <div className="notice warn">{err}</div>}
      {isAdmin && <button className="btn-primary" onClick={invite}>＋ メンバーを招待</button>}
      <div className="notice">社外メンバーは登録したメールの Google アカウントでログインすると連携されます。時刻は所定勤務時間帯（打刻漏れ時の自動補完に使用）</div>
    </div>
  )
}

/* ---------- アカウントメニュー ---------- */
function AccountMenu({ me, onRename }: { me: Member; onRename: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(me.name)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')

  const save = async () => {
    // 自分の名前変更は管理者でなくても許可したいが、RLSは管理者のみなので自分用ポリシーで対応済み
    const { error } = await supabase.from('members').update({ name }).eq('id', me.id)
    if (error) setMsg('名前を変更できませんでした')
    else { onRename(name); setOpen(false) }
  }

  const changePassword = async () => {
    const { error } = await supabase.auth.updateUser({ password })
    setMsg(error ? authError(error.message) : 'パスワードを変更しました')
    if (!error) setPassword('')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="avatar" title="アカウント" onClick={() => setOpen(!open)}>{me.name[0]}</button>
      {open && (
        <div className="account-menu">
          <label>名前</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="account-mail">{me.email}</div>
          <div className="account-badges">
            <span className={`badge ${me.member_type === 'internal' ? 'badge-blue' : 'badge-yellow'}`}>
              {me.member_type === 'internal' ? '社内' : '社外'}
            </span>
            <span className="badge badge-gray">{me.role === 'admin' ? '管理者' : '一般'}</span>
            <span className="badge badge-gray">所定 {hm(me.work_start)}–{hm(me.work_end)}</span>
          </div>
          <button className="btn-primary" disabled={!name || name === me.name} onClick={save}>名前を保存</button>
          <label htmlFor="ac-pw">新しいパスワード</label>
          <input id="ac-pw" type="password" autoComplete="new-password" placeholder="8文字以上"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn-primary" disabled={password.length < 8} onClick={changePassword}>
            パスワードを変更
          </button>
          {msg && <div className="notice">{msg}</div>}
          <button className="btn-logout" onClick={() => supabase.auth.signOut()}>ログアウト</button>
        </div>
      )}
    </div>
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
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: 'ホーム' },
  { key: 'report', label: '日報' },
  { key: 'schedule', label: '予定' },
  { key: 'members', label: '名簿' },
]

export default function App() {
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
        {me && <AccountMenu me={me} onRename={(name) => setMe({ ...me, name })} />}
      </header>

      {loading ? <div className="empty">読み込み中…</div>
        : recovering ? <NewPassword onDone={() => setRecovering(false)} />
        : !session ? <Auth />
        : !me ? <Onboarding onDone={() => loadMe(session)} />
        : (
          <>
            {tab === 'home' && <Home me={me} />}
            {tab === 'report' && <Report me={me} />}
            {tab === 'schedule' && <Schedule me={me} />}
            {tab === 'members' && <Members me={me} />}
            <nav className="tabbar">
              {TABS.map((t) => (
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
