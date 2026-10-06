import { Fragment, useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isProviderEnabled, supabase, today } from './lib/supabase'
import { DEMO, DEMO_MEMBERS } from './lib/demo'
import type { Attendance, Break, Member, Report as ReportRow } from './lib/supabase'

type Tab = 'home' | 'timecard' | 'profile'

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
  return Math.max(0, gross - breakMinutes(a.breaks, end)) // 閉じていない中抜けは退勤時刻まで
}

const asHm = (min: number) => `${Math.floor(min / 60)}時間${String(Math.round(min % 60)).padStart(2, '0')}分`
const workedLabel = (a: Attendance) => asHm(workedMinutes(a))
// その日が属する週（月曜始まり）の月曜日 "YYYY-MM-DD"
const weekOf = (date: string) => {
  const d = new Date(date + 'T00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toLocaleDateString('sv-SE')
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
const googleOAuthOptions = { redirectTo: location.origin }

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
    // 中抜けしたまま戻らなかった日は、中抜け開始時刻を退勤とみなす（その中抜けは消す）
    const stale = (data ?? []).find((a) => a.work_date < today() && a.clock_in && !a.clock_out)
    if (stale) {
      const open = (stale.breaks as Break[] | undefined)?.find((b) => !b.ended_at)
      if (open) await supabase.from('breaks').delete().eq('id', open.id)
      await supabase.from('attendances').update({
        clock_out: open?.started_at ?? new Date(stale.work_date + 'T23:59:59').toISOString(), auto_out: true,
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

  // 退勤後にまた稼働する場合。退勤〜再開を中抜けとして記録し、退勤時刻を消して勤務中に戻す
  const resume = async () => {
    if (!att?.clock_out) return
    setErr('')
    const { error } = await supabase.from('breaks').insert({
      attendance_id: att.id, started_at: att.clock_out, ended_at: new Date().toISOString(),
    })
    if (error) return setErr(`勤務を再開できませんでした（${error.message}）`)
    save({ clock_out: null })
  }

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

      <HomeDashboard me={me} />
    </>
  )
}


/* ---------- ホームの要約（今週・今月の実働と曜日別・給与見込み） ---------- */
function HomeDashboard({ me }: { me: Member }) {
  const [atts, setAtts] = useState<Attendance[]>([])
  const t = today()
  const month = t.slice(0, 7)
  const wk = weekOf(t)
  const from = wk < `${month}-01` ? wk : `${month}-01`
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(wk + 'T00:00'); d.setDate(d.getDate() + i); return d.toLocaleDateString('sv-SE')
  })

  useEffect(() => {
    supabase.from('attendances').select('*, breaks(*)').eq('member_id', me.id).gte('work_date', from)
      .then(({ data }) => setAtts((data as Attendance[]) ?? []))
  }, [me.id, from])

  const done = atts.filter((a) => a.clock_in) // 勤務中の今日も今までの分を数える
  const minOf = (d: string) => done.filter((a) => a.work_date === d).reduce((sum, a) => sum + workedMinutes(a), 0)
  const weekMin = weekDays.reduce((sum, d) => sum + minOf(d), 0)
  const monthMin = done.filter((a) => a.work_date.startsWith(month)).reduce((sum, a) => sum + workedMinutes(a), 0)

  return (
    <>
      <div className="home-stats">
        <div><span>今週</span><b>{hmm(weekMin)}</b></div>
        <div><span>今月</span><b>{hmm(monthMin)}</b></div>
        {(me.contract_amount != null || me.hourly_rate > 0) && (
          <div><span>給与見込み</span><b>{yen(me.contract_amount ?? monthMin / 60 * me.hourly_rate)}</b></div>
        )}
      </div>

      <div className="week-strip">
        {weekDays.map((d) => (
          <div key={d} className={d === t ? 'today' : ''}>
            <span>{'月火水木金土日'[weekDays.indexOf(d)]}</span>
            <b>{minOf(d) ? hmm(minOf(d)) : '–'}</b>
          </div>
        ))}
      </div>
    </>
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
    <div className="card card-plain">
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
              {days.map((a, idx) => {
                const wk = weekOf(a.work_date)
                const lastOfWeek = idx === days.length - 1 || weekOf(days[idx + 1].work_date) !== wk
                const weekMin = days.filter((d) => weekOf(d.work_date) === wk && d.clock_out)
                  .reduce((sum, d) => sum + workedMinutes(d), 0)
                const confirmed = reps.find((r) => r.work_date === a.work_date)?.confirmed ?? false
                return (
                  <Fragment key={a.id}>
                  <tr className={a.work_date === today() ? 'pt-today' : ''}>
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
                  {lastOfWeek && (
                    <tr className="pt-subtotal">
                      <td colSpan={4}>{fmtDate(wk).slice(0, 5)}〜の週 合計</td>
                      <td className="pt-time">{asHm(weekMin)}</td><td />
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="pt-total">
                <td colSpan={4}>{m}月 合計（{days.filter((d) => d.clock_out).length}日）</td>
                <td className="pt-time">{asHm(days.filter((d) => d.clock_out).reduce((sum, d) => sum + workedMinutes(d), 0))}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {err && <div className="notice warn">{err}</div>}
    </div>
  )
}

/* ---------- 分 → "H:MM" ---------- */
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`
const hmm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`

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
  const [detail, setDetail] = useState<string | null>(null) // 詳細設定を開いているメンバー
  const isAdmin = me.role === 'admin'

  const load = useCallback(async () => {
    const [{ data: rows }, { data: company }] = await Promise.all([
      supabase.from('members').select('*').eq('company_id', me.company_id).order('created_at'),
      supabase.from('companies').select('join_code').eq('id', me.company_id).maybeSingle(),
    ])
    setMembers(((rows as Member[]) ?? []).filter((m) => m.status !== 'disabled'))
    setCode(company?.join_code ?? '')
  }, [me.company_id])

  useEffect(() => { load() }, [load])

  const copyCode = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 時給制は hourly_rate、月額契約は contract_amount（nullなら時給制）
  const changePay = async (m: Member, patch: Pick<Member, 'hourly_rate'> | Pick<Member, 'contract_amount'>) => {
    setMembers(members.map((x) => (x.id === m.id ? { ...x, ...patch } : x)))
    const { error } = await supabase.from('members').update(patch).eq('id', m.id)
    if (error) setErr('時給額/契約金額を変更できませんでした')
  }

  // 削除は status='disabled' にするだけ（勤怠記録は残す）。名簿・ログイン・タイムカードから外れる
  const remove = async (m: Member) => {
    if (!confirm(`${m.name}さんをメンバーから削除しますか？\n（これまでの勤怠記録は残ります）`)) return
    setErr('')
    const { error } = await supabase.from('members').update({ status: 'disabled' }).eq('id', m.id)
    if (error) return setErr(`削除できませんでした（${error.message}）`)
    setDetail(null)
    load()
  }

  const changeRole = async (m: Member, role: Member['role']) => {
    setErr('')
    const { error } = await supabase.from('members').update({ role }).eq('id', m.id)
    if (error) return setErr(error.message)
    load()
  }

  const invite = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.from('members').insert({ company_id: me.company_id, ...form })
    setBusy(false)
    if (error) {
      return setErr(error.code === '23505'
        ? 'このメールアドレスは既に名簿に登録されています（削除したメンバーを含む）'
        : `招待できませんでした（${error.message}）`)
    }
    setForm(BLANK_INVITE)
    setOpen(false)
    load()
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
        <div className="member-list">
          {members.map((m, i) => {
            const monthly = m.contract_amount != null
            const amount = (monthly ? m.contract_amount : m.hourly_rate) ?? 0
            const opened = detail === m.id
            return (
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
                <div className="m-pay">
                  <span className="m-pay-kind">{monthly ? '月額' : '時給'}</span>
                  <b className={`m-pay-amount ${amount > 0 ? '' : 'unset'}`}>{amount > 0 ? yen(amount) : '未設定'}</b>
                  {isAdmin && (
                    <button className="link-btn" aria-expanded={opened}
                      onClick={() => setDetail(opened ? null : m.id)}>{opened ? '閉じる' : '詳細設定'}</button>
                  )}
                </div>
                {opened && (
                  <div className="m-detail">
                    <div className="m-detail-row">
                      <span className="m-detail-label">給与形態</span>
                      <div className="seg-row" role="group" aria-label={`${m.name}の給与形態`}>
                        <button className={`preset-chip ${monthly ? '' : 'sel'}`} aria-pressed={!monthly}
                          onClick={() => monthly && changePay(m, { contract_amount: null })}>時給</button>
                        <button className={`preset-chip ${monthly ? 'sel' : ''}`} aria-pressed={monthly}
                          onClick={() => !monthly && changePay(m, { contract_amount: 0 })}>月額</button>
                      </div>
                    </div>
                    <div className="m-detail-row">
                      <span className="m-detail-label">金額</span>
                      <div className="m-yen">
                        ¥
                        <input type="text" inputMode="numeric" placeholder="0"
                          aria-label={`${m.name}の${monthly ? '契約金額（月額）' : '時給'}`}
                          value={amount || ''}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value.replace(/[,¥\s]/g, '')) || 0)
                            changePay(m, monthly ? { contract_amount: v } : { hourly_rate: v })
                          }} />
                        {monthly ? '/ 月' : '/ 時間'}
                      </div>
                    </div>
                    {m.id !== me.id && (
                      <div className="m-detail-foot">
                        <button className="m-delete" onClick={() => remove(m)}>このメンバーを削除</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
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

          {err && <div className="notice warn">{err}</div>}
          <div className="notice">
            メールアドレスが分かっている人向けです。登録したアドレスでアカウントを作成すると自動で参加し、
            ここで設定した名前が引き継がれます。
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
    </>
  )
}

/* ---------- プロフィール・設定 ---------- */
function Profile({ me, onRename }: { me: Member; onRename: (name: string) => void }) {
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
            </div>
          </div>
          <span className="profile-caret">{settingsOpen ? '▴' : '▾'}</span>
        </button>
      </div>
      {settingsOpen && <AccountSettings me={me} onRename={onRename} />}
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
                {googleLinked ? '連携済み。Googleでログインできます'
                  : googleOk ? '連携するとGoogleでログインできます'
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

/* ---------- プロフィールタブ（自分／管理者はメンバー管理も） ---------- */
function ProfilePage({ me, onRename }: { me: Member; onRename: (name: string) => void }) {
  return (
    <div className="flat">
      <Profile me={me} onRename={onRename} />
      {me.role === 'admin' && <Members me={me} />}
    </div>
  )
}

/* ---------- 管理者はタイムカードの上でメンバーを切り替えて見る ---------- */
function MemberSwitch({ me, children }: { me: Member; children: (m: Member) => React.ReactNode }) {
  const [members, setMembers] = useState<Member[]>([])
  const [id, setId] = useState(me.id)
  useEffect(() => {
    if (me.role !== 'admin') return
    supabase.from('members').select('*').eq('company_id', me.company_id).eq('status', 'active').order('created_at')
      .then(({ data }) => setMembers((data as Member[] | null) ?? []))
  }, [me.company_id, me.role])
  const member = members.find((m) => m.id === id) ?? me
  return (
    <>
      {me.role === 'admin' && members.length > 1 && (
        <label className="member-switch">
          表示中のメンバー
          <select value={member.id} onChange={(e) => setId(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name}（自分）` : m.name}</option>)}
          </select>
        </label>
      )}
      <Fragment key={member.id}>{children(member)}</Fragment>
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
  timecard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  ),
}

// 管理者のメンバー管理はプロフィール内
const tabsFor = (_role: Member['role']): { key: Tab; label: string }[] => [
  { key: 'home', label: 'ホーム' },
  { key: 'timecard', label: 'タイムカード' },
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
      {tab === 'timecard' && <MemberSwitch key={me.id} me={me}>{(m) => <KintaiTable me={m} />}</MemberSwitch>}
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
  // ponytail: 経費管理は削除済み。ヘッダーの経費ボタンは別PRで外すまでsetterだけ残す（押しても何も起きない）
  const [, setMoneyMode] = useState(false)

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) { setMe(null); setCompany(null); setLoading(false); return }
    // 招待済みレコードがあれば自分のアカウントに紐付け（activate）
    await supabase.from('members')
      .update({ user_id: s.user.id, status: 'active' })
      .eq('email', s.user.email!).is('user_id', null).eq('status', 'invited')
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
            {tab === 'home' && <Home key={me.id} me={me} />}
            {tab === 'timecard' && <MemberSwitch me={me}>{(m) => <KintaiTable me={m} />}</MemberSwitch>}
            {tab === 'profile' && (
              <ProfilePage me={me} onRename={(name) => setMe({ ...me, name })} />
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
