import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isProviderEnabled, supabase, today } from './lib/supabase'
import { DEMO, DEMO_MEMBERS } from './lib/demo'
import type { Attendance, Break, Member, Report as ReportRow } from './lib/supabase'
import {
  Avatar, Badge, Button, Card, DateChip, Divider, ErrorMessage, Header, IconButton, List, ListRow,
  LeadingIcon, Notice, SegmentedControl, SelectField, Sidebar, Stats, TabBar, TextField, type IconName, type TabItem,
} from './ui'
import { applyTheme, readTheme } from './theme'

type Tab = 'home' | 'timecard' | 'profile' | 'settings'
type Company = { id: string; name: string; icon: string }

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
    <main className="ui-page narrow">
      <div className="ui-row center">
        <DayDeedLogo size={44} /><h1 className="ui-title">DayDeed</h1>
      </div>
      <Card title={mode === 'signin' ? 'ログイン' : mode === 'signup' ? '新しいアカウントを作成' : 'パスワードを再設定'}>
        {mode !== 'reset' && googleOk && (
          <>
            <Button variant="outline" fullWidth onClick={google}>
              <GoogleLogo />Google で{mode === 'signup' ? '登録' : 'ログイン'}
            </Button>
            <Divider>または</Divider>
          </>
        )}
        <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); submit() }}>
          {mode === 'signup' && (
            <TextField label="名前" autoComplete="name" placeholder="山田 太郎"
              value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <TextField label="メールアドレス" type="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          {mode !== 'reset' && (
            <TextField label="パスワード" type="password" hint={mode === 'signup' ? '8文字以上' : undefined}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          {err && <ErrorMessage>{err}</ErrorMessage>}
          {info && <Notice icon="check">{info}</Notice>}
          <Button type="submit" fullWidth disabled={!canSubmit || busy}>
            {busy ? '処理中…'
              : mode === 'signin' ? 'ログイン'
              : mode === 'signup' ? 'アカウントを作成'
              : '再設定メールを送信'}
          </Button>
        </form>
      </Card>
      <div className="ui-row center">
        {mode === 'signin' ? (
          <>
            <Button variant="ghost" onClick={() => reset('reset')}>パスワードを忘れた</Button>
            <Button variant="ghost" onClick={() => reset('signup')}>アカウントを作成</Button>
          </>
        ) : <Button variant="ghost" onClick={() => reset('signin')}>ログインに戻る</Button>}
      </div>
      <p className="ui-secondary ui-center"><a href="/demo">アカウントなしでデモを見る</a></p>
    </main>
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
    <main className="ui-page narrow">
      <Card title="新しいパスワードを設定">
        <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); save() }}>
          <TextField label="新しいパスワード" type="password" autoComplete="new-password" hint="8文字以上"
            value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          {err && <ErrorMessage>{err}</ErrorMessage>}
          <Button type="submit" fullWidth disabled={password.length < 8}>パスワードを変更</Button>
        </form>
      </Card>
    </main>
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
    <main className="ui-page narrow">
      <Card title="ようこそ">
        <p className="ui-text"><b>{email}</b> でログインしました。どちらの立場か選んでください。</p>
        <List label="立場">
          <ListRow title="会社を新しく作る" onClick={() => setChoice('create')}
            subtitle="あなたが管理者になります。メンバーの招待、権限や勤務時間の管理ができます" />
          <ListRow title="会社に招待されている" onClick={() => setChoice('invited')}
            subtitle="従業員として参加します。管理者に名簿へ登録してもらう必要があります" />
        </List>
      </Card>
    </main>
  )

  if (choice === 'invited') return (
    <>
      <Header title="会社に参加" onBack={() => setChoice('none')} />
      <main className="ui-page narrow">
        <Card>
          <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); join() }}>
            <p className="ui-text">管理者から共有された参加コードを入力してください。</p>
            <TextField label="参加コード" placeholder="ABC123" autoFocus autoComplete="off" autoCapitalize="characters"
              maxLength={6} value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr('') }} />
            {err && <ErrorMessage>{err}</ErrorMessage>}
            <Button type="submit" fullWidth disabled={code.length < 6 || busy}>
              {busy ? '参加中…' : '参加する'}
            </Button>
          </form>
          <Notice>
            コードが分からない場合は、管理者に <b>{email}</b> で名簿へ登録してもらってから、このページを再読み込みしても参加できます
          </Notice>
        </Card>
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>ログアウト</Button>
      </main>
    </>
  )

  return (
    <>
      <Header title="会社を作成" onBack={() => setChoice('none')} />
      <main className="ui-page narrow">
        <Card>
          <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); create() }}>
            <p className="ui-text">作成すると、あなたがこの会社の管理者になります。</p>
            <TextField label="会社名" placeholder="例: 株式会社サンプル" autoFocus
              value={name} onChange={(e) => setName(e.target.value)} />
            {err && <ErrorMessage>{err}</ErrorMessage>}
            <Button type="submit" fullWidth disabled={!name}>作成して始める</Button>
          </form>
        </Card>
      </main>
    </>
  )
}

/* ---------- 今日の記録の時刻エディタ（行をタップするとその下に開く。iOS カレンダーの日時欄と同じ） ---------- */
function TimeEditor({ fields, onSave, onCancel, onDelete }: {
  fields: { label: string; value: string; onChange: (v: string) => void; hint?: string }[]
  onSave: () => void; onCancel: () => void; onDelete?: () => void
}) {
  return (
    <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <div className="ui-row">
        {fields.map((f, i) => (
          <TextField key={f.label} type="time" label={f.label} hint={f.hint} autoFocus={i === 0}
            value={f.value} onChange={(e) => f.onChange(e.target.value)} />
        ))}
      </div>
      <div className="ui-row">
        <Button type="submit" variant="outline">保存</Button>
        <Button variant="ghost" onClick={onCancel}>キャンセル</Button>
        {onDelete && <Button variant="ghost" danger className="ui-push" onClick={onDelete}>削除</Button>}
      </div>
    </form>
  )
}

/* ---------- 出勤・退勤 ---------- */
function Home({ me, title }: { me: Member; title: ReactNode }) {
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


  // 今押すべき操作だけを塗りボタンにする（出勤 → 退勤 / 中抜け中は中抜けを終了）。退勤後は塗りなし
  const primary: { label: string; icon: IconName; onClick: () => void } | null = !att?.clock_in ? { label: '出勤する', icon: 'login', onClick: punchIn }
    : att.clock_out ? null
    : openBreak ? { label: '中抜けを終了', icon: 'play', onClick: endBreak }
    : { label: '退勤する', icon: 'logout', onClick: () => punchOut() }
  const secondary: { label: string; icon: IconName; onClick: () => void } | null = att?.clock_out ? { label: '勤務を再開', icon: 'play', onClick: resume }
    : att?.clock_in && !openBreak ? { label: '中抜け・休憩', icon: 'pause', onClick: startBreak }
    : null
  // 出勤後は現在時刻ではなく実働時間を主役に（休憩・中抜けは除いてリアルタイムに進む）
  const sec = att?.clock_in ? Math.max(0, Math.floor(workedMinutes(att, now.getTime()) * 60)) : 0
  const toggle = (key: string, open: () => void) => (editing === key ? setEditing(null) : open())
  const cancel = () => setEditing(null)
  const breaks = [...(att?.breaks ?? [])].sort((p, q) => (p.started_at < q.started_at ? -1 : 1))

  return (
    <>
      <Header title={title} />
      <main className="ui-page">
        <section className="ui-hero" aria-label="今日の勤務">
          <span className="ui-secondary">
            {now.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}
          </span>
          {att?.clock_in ? (
            <p className="ui-display">
              {Math.floor(sec / 3600)}:{String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}
              <small>:{String(sec % 60).padStart(2, '0')}</small>
            </p>
          ) : (
            <p className="ui-display">
              {now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
              <small>:{String(now.getSeconds()).padStart(2, '0')}</small>
            </p>
          )}
          <Badge tone={status === '勤務中' ? 'primary' : 'neutral'}
            icon={status === '勤務中' ? 'check' : status === '中抜け中' ? 'pause' : status === '退勤済み' ? 'logout' : 'clock'}>
            {status}{att?.clock_in ? '・実働' : ''}
          </Badge>
        </section>

        {err && <ErrorMessage>{err}</ErrorMessage>}
        {(primary || secondary) && (
          <div className="ui-tiles">
            {primary && <Button tile icon={primary.icon} onClick={primary.onClick}>{primary.label}</Button>}
            {secondary && <Button tile variant="outline" icon={secondary.icon} onClick={secondary.onClick}>{secondary.label}</Button>}
          </div>
        )}

        <HomeDashboard me={me}>
        <Card title="今日の記録" icon="list">
          <List label="今日の記録">
            <ListRow leading={<LeadingIcon name="login" tone={att?.clock_in ? undefined : 'muted'} />} title="出勤"
              subtitle={att?.auto_in ? '自動補完（タップして修正）' : att?.clock_in ? undefined : 'タップで時刻を指定'}
              expanded={editing === 'in'} onClick={() => toggle('in', () => openEdit('in'))}
              trailing={fmtTime(att?.clock_in ?? null)}>
              {editing === 'in' && (
                <TimeEditor fields={[{ label: '出勤時刻', value: editTime, onChange: setEditTime }]}
                  onSave={commitEdit} onCancel={cancel} />
              )}
            </ListRow>
            {att?.clock_in && breaks.map((b) => (
              <ListRow key={b.id} leading={<LeadingIcon name="pause" tone="soft" />} title="中抜け"
                subtitle={b.ended_at ? undefined : '中抜け中'}
                expanded={editing === b.id} onClick={() => toggle(b.id, () => openBreakEdit(b))}
                trailing={`${fmtTime(b.started_at)}–${b.ended_at ? fmtTime(b.ended_at) : ''}`}>
                {editing === b.id && (
                  <TimeEditor onSave={commitEdit} onCancel={cancel} onDelete={() => deleteBreak(b.id)} fields={[
                    { label: '開始', value: editTime, onChange: setEditTime },
                    { label: '終了', value: editTime2, onChange: setEditTime2, hint: '空欄にすると中抜け中に戻ります' },
                  ]} />
                )}
              </ListRow>
            ))}
            <ListRow leading={<LeadingIcon name="logout" tone={att?.clock_out ? undefined : 'muted'} />} title="退勤"
              subtitle={att?.auto_out ? '自動補完（タップして修正）' : att?.clock_out ? undefined : '押し忘れはタップで指定'}
              expanded={editing === 'out'} onClick={() => toggle('out', () => openEdit('out'))}
              trailing={fmtTime(att?.clock_out ?? null)}>
              {editing === 'out' && (
                <TimeEditor onSave={commitEdit} onCancel={cancel} fields={[{
                  label: '退勤時刻', value: editTime, onChange: setEditTime,
                  hint: att?.clock_in ? undefined : `出勤は所定の開始時刻（${hm(me.work_start)}）で自動補完されます`,
                }]} />
              )}
            </ListRow>
            {att?.clock_in && !att.clock_out && !openBreak && (
              <ListRow tone="primary" leading={<LeadingIcon name="plus" tone="soft" />} title="中抜けを後から追加"
                expanded={editing === 'newbreak'} onClick={() => toggle('newbreak', openNewBreak)}>
                {editing === 'newbreak' && (
                  <TimeEditor onSave={commitEdit} onCancel={cancel} fields={[
                    { label: '開始', value: editTime, onChange: setEditTime },
                    { label: '終了', value: editTime2, onChange: setEditTime2, hint: '空欄なら中抜け中として記録します' },
                  ]} />
                )}
              </ListRow>
            )}
          </List>
        </Card>
        </HomeDashboard>
      </main>
    </>
  )
}


/* ---------- ホームの要約（今週・今月の実働と曜日別・給与見込み） ---------- */
function HomeDashboard({ me, children }: { me: Member; children: ReactNode }) {
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
      <Stats items={[
        { label: '今週', icon: 'calendar', value: hmm(weekMin) },
        { label: '今月', icon: 'chart', value: hmm(monthMin) },
        ...(me.contract_amount != null || me.hourly_rate > 0
          ? [{ label: '給与見込み', icon: 'yen' as const, value: yen(me.contract_amount ?? monthMin / 60 * me.hourly_rate) }] : []),
      ]} />
      {children}
      <Card title="今週の実働" icon="calendar">
        <Stats columns={7} items={weekDays.map((d, i) => ({
          label: '月火水木金土日'[i], value: minOf(d) ? hmm(minOf(d)) : '–', current: d === t,
        }))} />
      </Card>
    </>
  )
}

/* ---------- タイムカードの1日を開いた時の編集欄（行の下に開く。ホームの「今日の記録」と同じ） ---------- */
type DayDraft = { inT: string; outT: string; brs: { s: string; e: string }[] }
const sortedBreaks = (a: Attendance) => [...(a.breaks ?? [])].sort((p, q) => (p.started_at < q.started_at ? -1 : 1))
const breaksText = (brs: DayDraft['brs']) => brs.filter((b) => b.s || b.e).map((b) => `${b.s}-${b.e}`).join(', ')

function DayEditor({ a, confirmed, onSave, onToggleConfirm, onClose }: {
  a: Attendance; confirmed: boolean; onSave: (d: DayDraft) => void; onToggleConfirm: () => void; onClose: () => void
}) {
  const [inT, setIn] = useState(isoHm(a.clock_in))
  const [outT, setOut] = useState(isoHm(a.clock_out))
  const [brs, setBrs] = useState(() => sortedBreaks(a).map((b) => ({ s: isoHm(b.started_at), e: isoHm(b.ended_at) })))
  const setBr = (i: number, patch: Partial<DayDraft['brs'][number]>) => setBrs(brs.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  // 確定した日は直せない（確定を取り消すと直せる）
  if (confirmed) return (
    <div className="ui-stack tight">
      <p className="ui-secondary">確定済みの日は直せません。直すときは確定を取り消してください</p>
      <div><Button variant="outline" onClick={onToggleConfirm}>確定を取り消す</Button></div>
    </div>
  )
  return (
    <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); onSave({ inT, outT, brs }) }}>
      <div className="ui-row">
        <TextField type="time" label="出勤" autoFocus value={inT} onChange={(e) => setIn(e.target.value)} />
        <TextField type="time" label="退勤" value={outT} onChange={(e) => setOut(e.target.value)} hint={a.clock_out || !a.clock_in ? undefined : '勤務中'} />
      </div>
      {brs.map((b, i) => (
        <div className="ui-row end" key={i}>
          <TextField type="time" label={`中抜け${i + 1} 開始`} value={b.s} onChange={(e) => setBr(i, { s: e.target.value })} />
          <TextField type="time" label="終了" value={b.e} onChange={(e) => setBr(i, { e: e.target.value })} />
          <IconButton plain icon="close" label={`中抜け${i + 1}を削除`} onClick={() => setBrs(brs.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div><Button variant="ghost" icon="plus" onClick={() => setBrs([...brs, { s: '', e: '' }])}>中抜けを追加</Button></div>
      <div className="ui-row">
        <Button type="submit" variant="outline">保存</Button>
        <Button variant="ghost" onClick={onClose}>キャンセル</Button>
        {a.clock_out && <Button variant="ghost" icon="check" className="ui-push" onClick={onToggleConfirm}>この日を確定</Button>}
      </div>
    </form>
  )
}

/* ---------- タイムカード（月の実績: 週ごとのリスト。行をタップすると開いて直せる） ---------- */
function KintaiTable({ me }: { me: Member }) {
  const [atts, setAtts] = useState<Attendance[]>([])
  const [reps, setReps] = useState<ReportRow[]>([])
  const [month, setMonth] = useState(today().slice(0, 7))
  const [err, setErr] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [open, setOpen] = useState<string | null>(null) // 開いている日（work_date）

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
    setOpen(null)
    setMonth(new Date(y, m - 1 + delta, 1).toLocaleDateString('sv-SE').slice(0, 7))
  }

  const normTime = (v: string) => {
    const d = v.replace(/[^0-9]/g, '')
    if (!d) return ''
    const [h, m] = d.length <= 2 ? [+d, 0] : [+d.slice(0, -2), +d.slice(-2)]
    if (h > 23 || m > 59) return ''
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const toIso = (date: string, hmStr: string) => new Date(`${date}T${hmStr}:00`).toISOString()
  const flash = (date: string) => {
    setSavedAt(date)
    setTimeout(() => setSavedAt((s) => (s === date ? '' : s)), 1500)
  }
  // 出勤/退勤の修正。手で直したら自動補完フラグは下ろす。成功したら true
  const saveActual = async (date: string, field: 'clock_in' | 'clock_out', v: string) => {
    setErr('')
    const { error } = await supabase.from('attendances').upsert(
      { member_id: me.id, work_date: date, [field]: toIso(date, v),
        [field === 'clock_in' ? 'auto_in' : 'auto_out']: false },
      { onConflict: 'member_id,work_date' },
    )
    if (error) { setErr(`実績を保存できませんでした（${error.message}）`); return false }
    return true
  }
  const fmtBreaks = (a: Attendance) =>
    sortedBreaks(a).map((b) => `${fmtTime(b.started_at)}–${b.ended_at ? fmtTime(b.ended_at) : ''}`).join(', ')
  // 「1200-1300, 1500-1515」形式をパースしてその日のbreaksを入れ替える。成功したら true
  const saveBreaks = async (a: Attendance, text: string) => {
    setErr('')
    const parts = text.split(/[,、]/).map((s) => s.trim()).filter(Boolean)
    const ranges: [string, string][] = []
    for (const p of parts) {
      const [s, e] = p.split(/[-–~〜]/).map((t) => normTime(t ?? ''))
      if (!s || !e) { setErr(`中抜けは開始と終了の両方を入れてください（${p}）`); return false }
      ranges.push([s, e])
    }
    await supabase.from('breaks').delete().eq('attendance_id', a.id)
    for (const [s, e] of ranges) {
      const { error } = await supabase.from('breaks').insert(
        { attendance_id: a.id, started_at: toIso(a.work_date, s), ended_at: toIso(a.work_date, e) })
      if (error) { setErr(`中抜けを保存できませんでした（${error.message}）`); return false }
    }
    return true
  }
  // 開いた日の保存: 変わった所だけ書き込む。全部うまくいったら閉じる
  const saveDay = async (a: Attendance, d: DayDraft) => {
    // 記録のない日を後から入れる時は出勤・退勤の両方を必須にする（勤務中のまま残さない）
    if (!a.clock_in && (!d.inT || !d.outT)) return setErr('出勤と退勤の両方を入れてください')
    const inChanged = !!d.inT && d.inT !== isoHm(a.clock_in)
    const outChanged = !!d.outT && d.outT !== isoHm(a.clock_out)
    const brsChanged = breaksText(d.brs) !== breaksText(sortedBreaks(a).map((b) => ({ s: isoHm(b.started_at), e: isoHm(b.ended_at) })))
    if (!inChanged && !outChanged && !brsChanged) return setOpen(null) // 何も変えていなければ閉じるだけ
    let ok = true
    if (inChanged) ok = await saveActual(a.work_date, 'clock_in', d.inT)
    if (ok && outChanged) ok = await saveActual(a.work_date, 'clock_out', d.outT)
    if (ok && brsChanged && !a.id) { // 新しく作った日は中抜けを付ける前に id を取り直す
      const { data } = await supabase.from('attendances').select('id').eq('member_id', me.id).eq('work_date', a.work_date).single()
      a = { ...a, id: data?.id }
    }
    if (ok && brsChanged) ok = await saveBreaks(a, breaksText(d.brs))
    load()
    if (!ok) return
    flash(a.work_date)
    setOpen(null)
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
    setOpen(null)
    load()
  }

  const [y, m] = month.split('-').map(Number)
  const days = atts.filter((a) => a.clock_in)
  const done = days.filter((d) => d.clock_out)
  const isConfirmed = (a: Attendance) => reps.find((r) => r.work_date === a.work_date)?.confirmed ?? false
  // その月の今日までの全日を週（月曜始まり）ごとに並べる。記録のない日も「未入力」として出し、後から入れられる
  const lastDay = month === today().slice(0, 7) ? +today().slice(8) : month < today().slice(0, 7) ? new Date(y, m, 0).getDate() : 0
  const allDays = Array.from({ length: lastDay }, (_, i): Attendance => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    return atts.find((a) => a.work_date === date)
      ?? { id: '', member_id: me.id, work_date: date, clock_in: null, clock_out: null, auto_in: false, auto_out: false, plan: null, plan_video: null }
  })
  const weeks = allDays.reduce<[string, Attendance[]][]>((acc, a) => {
    const wk = weekOf(a.work_date)
    const last = acc[acc.length - 1]
    if (last?.[0] === wk) last[1].push(a)
    else acc.push([wk, [a]])
    return acc
  }, [])

  return (
    <>
      <div className="ui-row center nowrap">
        <IconButton icon="back" label="前の月" onClick={() => moveMonth(-1)} />
        <p className="ui-month">{y}年{m}月</p>
        <IconButton icon="chevron" label="次の月" onClick={() => moveMonth(1)} />
      </div>
      <Stats items={[
        { label: '合計', icon: 'clock', value: hmm(done.reduce((sum, d) => sum + workedMinutes(d), 0)) },
        { label: '出勤', icon: 'calendar', value: `${days.length}日` },
        { label: '確定', icon: 'check', value: `${done.filter(isConfirmed).length}/${done.length}` },
      ]} />
      {err && <ErrorMessage>{err}</ErrorMessage>}
      {allDays.length === 0 && <p className="ui-secondary ui-center">この月の勤怠記録はありません</p>}
      {weeks.map(([wk, list]) => (
        <Card key={wk} icon="calendar" title={`${+wk.slice(5, 7)}月${+wk.slice(8)}日〜の週`}
          action={<span className="ui-secondary">合計 {asHm(list.filter((d) => d.clock_out).reduce((sum, d) => sum + workedMinutes(d), 0))}</span>}>
          <List label={`${+wk.slice(5, 7)}月${+wk.slice(8)}日からの週の勤怠`}>
            {list.map((a) => {
              const confirmed = isConfirmed(a)
              const dt = new Date(a.work_date + 'T00:00')
              return (
                <ListRow key={a.work_date}
                  leading={<DateChip day={dt.getDate()} weekday={'日月火水木金土'[dt.getDay()]} current={a.work_date === today()} />}
                  title={a.clock_in ? `${fmtTime(a.clock_in)} – ${a.clock_out ? fmtTime(a.clock_out) : '勤務中'}` : <span className="ui-secondary">未入力</span>}
                  subtitle={!a.clock_in ? 'タップして稼働時間を入力' : [
                    a.clock_out ? `実働 ${workedLabel(a)}` : '',
                    a.breaks?.length ? `中抜け ${fmtBreaks(a)}` : '',
                    a.auto_in || a.auto_out ? '自動補完あり' : '',
                  ].filter(Boolean).join('・') || undefined}
                  trailing={savedAt === a.work_date
                    ? <span role="status"><Badge tone="primary" icon="check">保存しました</Badge></span>
                    : confirmed ? <Badge icon="check">確定</Badge> : undefined}
                  expanded={open === a.work_date} onClick={() => { setErr(''); setOpen(open === a.work_date ? null : a.work_date) }}>
                  {open === a.work_date && (
                    <DayEditor a={a} confirmed={confirmed} onSave={(d) => saveDay(a, d)}
                      onToggleConfirm={() => toggleConfirm(a)} onClose={() => setOpen(null)} />
                  )}
                </ListRow>
              )
            })}
          </List>
        </Card>
      ))}
    </>
  )
}

/* ---------- 分 → "H:MM" ---------- */
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`
const hmm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`

/* ---------- 名簿 ---------- */
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

  // 自分の権限は変えられない（一般にすると名簿が見えなくなり、自分では管理者に戻せないため）
  const changeRole = async (m: Member, role: Member['role']) => {
    setErr('')
    if (m.id === me.id) return setErr('自分の権限は変更できません。ほかの管理者に変更してもらってください')
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
      {isAdmin && open && (
        <Card title="メンバーを招待" icon="plus">
          <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); invite() }}>
            <TextField label="名前" placeholder="山田 太郎" autoFocus required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="メールアドレス" type="email" placeholder="you@example.com" required
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {err && <ErrorMessage>{err}</ErrorMessage>}
            <Notice>
              メールアドレスが分かっている人向けです。登録したアドレスでアカウントを作成すると自動で参加し、
              ここで設定した名前が引き継がれます。アドレスが分からない場合は名簿の下にある参加コードを共有してください
            </Notice>
            <div className="ui-row">
              <Button type="submit" disabled={!form.name || !form.email || busy}>{busy ? '登録中…' : '名簿に追加'}</Button>
              <Button variant="outline" onClick={() => { setOpen(false); setErr('') }}>キャンセル</Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={`メンバー ${members.length}名`} icon="users"
        action={isAdmin && !open && <Button variant="ghost" icon="plus" onClick={() => setOpen(true)}>招待</Button>}>
        <List label="メンバー名簿">
          {members.map((m) => {
            const monthly = m.contract_amount != null
            const amount = (monthly ? m.contract_amount : m.hourly_rate) ?? 0
            const opened = detail === m.id
            return (
              <ListRow key={m.id} leading={<Avatar name={m.name} seed={m.id} />}
                title={<>{m.name} {m.id === me.id && <Badge tone="primary">あなた</Badge>}</>}
                subtitle={<>{m.email}<br />{m.role === 'admin' ? '管理者' : '一般'}・{amount > 0 ? `${yen(amount)}/${monthly ? '月' : '時'}` : '給与未設定'}</>}
                trailing={m.status === 'invited' ? <Badge icon="alert">招待中</Badge> : undefined}
                expanded={isAdmin ? opened : undefined}
                onClick={isAdmin ? () => setDetail(opened ? null : m.id) : undefined}>
                {opened && (
                  <>
                    <div className="ui-field">
                      <span className="ui-field-label" aria-hidden="true">権限</span>
                      {m.id === me.id ? (
                        <p className="ui-text">
                          {m.role === 'admin' ? '管理者' : '一般'}
                          <span className="ui-secondary">（自分の権限は変えられません。変更はほかの管理者に依頼してください）</span>
                        </p>
                      ) : (
                        <SegmentedControl label={`${m.name}の権限`} value={m.role} onChange={(r) => changeRole(m, r)}
                          options={[{ key: 'member', label: '一般' }, { key: 'admin', label: '管理者' }]} />
                      )}
                    </div>
                    <div className="ui-field">
                      <span className="ui-field-label" aria-hidden="true">給与形態</span>
                      <SegmentedControl label={`${m.name}の給与形態`} value={monthly ? 'monthly' : 'hourly'}
                        options={[{ key: 'hourly', label: '時給' }, { key: 'monthly', label: '月額' }]}
                        onChange={(k) => changePay(m, k === 'monthly' ? { contract_amount: 0 } : { contract_amount: null })} />
                    </div>
                    <TextField label={monthly ? '契約金額（月額）' : '時給'} inputMode="numeric" placeholder="0"
                      hint={monthly ? '円 / 月' : '円 / 時間'} value={amount || ''}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value.replace(/[,¥\s]/g, '')) || 0)
                        changePay(m, monthly ? { contract_amount: v } : { hourly_rate: v })
                      }} />
                    {m.id !== me.id && (
                      <div><Button variant="ghost" danger onClick={() => remove(m)}>このメンバーを削除</Button></div>
                    )}
                  </>
                )}
              </ListRow>
            )
          })}
        </List>
        {err && !open && <ErrorMessage>{err}</ErrorMessage>}
        {isAdmin && (
          <div className="ui-row between">
            <div>
              <p className="ui-secondary">参加コード</p>
              <p className="ui-text ui-code">{code || '—'}</p>
            </div>
            <Button variant="outline" icon={copied ? 'check' : 'copy'} onClick={copyCode}>
              {copied ? 'コピーしました' : 'コピー'}
            </Button>
            <p className="ui-secondary">共有すれば相手が自分でアカウントを作って参加できます</p>
          </div>
        )}
      </Card>
    </>
  )
}

/* ---------- 会社名（管理者） ---------- */
function CompanyCard({ company, onSaved }: { company: Company; onSaved: (c: Company) => void }) {
  const [name, setName] = useState(company.name)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const save = async () => {
    setErr(''); setMsg('')
    const next = { name: name || company.name }
    const { error } = await supabase.from('companies').update(next).eq('id', company.id)
    if (error) return setErr('変更は管理者のみ可能です')
    onSaved({ ...company, ...next })
    setMsg('保存しました')
  }

  return (
    <Card title="会社" icon="building">
      <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); save() }}>
        <TextField label="会社名" value={name} onChange={(e) => setName(e.target.value)} />
        {err && <ErrorMessage>{err}</ErrorMessage>}
        {msg && <Notice icon="check">{msg}</Notice>}
        <div><Button type="submit" variant="outline" disabled={!name || name === company.name}>保存</Button></div>
      </form>
    </Card>
  )
}

/* ---------- 設定画面の中身: 表示（自動/ライト/ダーク）。値の保存と切り替えは theme.ts ---------- */
function AppearanceCard() {
  const [theme, setTheme] = useState(readTheme)
  return (
    <Card title="表示" icon="sun" className="plain">
      <SegmentedControl label="表示" fullWidth value={theme} onChange={(t) => { applyTheme(t); setTheme(t) }}
        options={[{ key: 'system', label: '自動', icon: 'monitor' }, { key: 'light', label: 'ライト', icon: 'sun' }, { key: 'dark', label: 'ダーク', icon: 'moon' }]} />
      <p className="ui-secondary">「自動」は端末の設定に合わせて切り替わります。選んだ表示はこの端末にだけ保存されます</p>
    </Card>
  )
}

/* ---------- プロフィールの「アカウント」: 名前・パスワード ---------- */
function AccountCard({ me, onRename }: { me: Member; onRename: (name: string) => void }) {
  // 誤って書き換えないよう、最初は値だけ。行をタップした時だけ入力欄を開く（iOS の設定と同じ）
  const [editing, setEditing] = useState<'name' | 'password' | null>(null)
  const [name, setName] = useState(me.name)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const open = (key: 'name' | 'password') => {
    setMsg(''); setErr('')
    if (editing === key) return setEditing(null)
    setName(me.name); setPassword('')
    setEditing(key)
  }

  const saveName = async () => {
    setErr(''); setMsg('')
    // 本人による自分のレコード更新はRLSの members_self_update で許可済み
    const { error } = await supabase.from('members').update({ name }).eq('id', me.id)
    if (error) return setErr('名前を変更できませんでした')
    onRename(name)
    setEditing(null)
    setMsg('名前を保存しました')
  }

  const changePassword = async () => {
    setErr(''); setMsg('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return setErr(authError(error.message))
    setPassword('')
    setEditing(null)
    setMsg('パスワードを変更しました')
  }

  const actions = (canSave: boolean) => (
    <div className="ui-row">
      <Button type="submit" variant="outline" disabled={!canSave}>保存</Button>
      <Button variant="ghost" onClick={() => setEditing(null)}>キャンセル</Button>
    </div>
  )

  return (
    <Card title="アカウント" icon="user" className="plain">
      <List label="アカウント">
        <ListRow leading={<LeadingIcon name="user" tone="soft" />} title="名前" trailing={me.name} expanded={editing === 'name'} onClick={() => open('name')}>
          {editing === 'name' && (
            <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); saveName() }}>
              <TextField label="新しい名前" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              {actions(!!name && name !== me.name)}
            </form>
          )}
        </ListRow>
        <ListRow leading={<LeadingIcon name="lock" tone="soft" />} title="パスワード" trailing="変更する" expanded={editing === 'password'} onClick={() => open('password')}>
          {editing === 'password' && (
            <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); changePassword() }}>
              <TextField label="新しいパスワード" type="password" autoComplete="new-password" hint="8文字以上" autoFocus
                value={password} onChange={(e) => setPassword(e.target.value)} />
              {actions(password.length >= 8)}
            </form>
          )}
        </ListRow>
      </List>
      {msg && <Notice icon="check">{msg}</Notice>}
      {err && <ErrorMessage>{err}</ErrorMessage>}
    </Card>
  )
}

/* ---------- プロフィール（Apple Account と同じ役割）: 自分の情報、管理者はメンバーと会社も。ログアウトは設定。
   設定（表示）への入口はスマホだけ右上の⚙︎（PC はサイドバーの「設定」） ---------- */
function ProfilePage({ me, company, onRename, onCompanyChange, onOpenSettings }: {
  me: Member; company: Company | null; onRename: (name: string) => void; onCompanyChange: (c: Company) => void; onOpenSettings: () => void
}) {
  return (
    <>
      <Header title="プロフィール" actions={<IconButton icon="gear" label="設定" className="ui-mobile-only" onClick={onOpenSettings} />} />
      <main className="ui-page">
        <section className="ui-hero" aria-label="あなた">
          <Avatar name={me.name} seed={me.id} size="lg" />
          <p className="ui-title">{me.name}</p>
          <span className="ui-secondary">{me.email}</span>
          <Badge icon={me.role === 'admin' ? 'building' : 'user'}>{me.role === 'admin' ? '管理者' : '一般'}</Badge>
        </section>
        <AccountCard me={me} onRename={onRename} />
        {me.role === 'admin' && <Members me={me} />}
        {me.role === 'admin' && company && <CompanyCard company={company} onSaved={onCompanyChange} />}
      </main>
    </>
  )
}

/* ---------- 管理者はタイムカードの上でメンバーを切り替えて見る ---------- */
function MemberSwitch({ me, children }: { me: Member; children: (m: Member) => ReactNode }) {
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
        <SelectField label="表示中のメンバー" value={member.id} onChange={(e) => setId(e.target.value)}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name}（自分）` : m.name}</option>)}
        </SelectField>
      )}
      <Fragment key={member.id}>{children(member)}</Fragment>
    </>
  )
}

/* ---------- 画面の切り替え。同じ画面への入口は PC・スマホそれぞれ1つだけ
   スマホ: 下のタブ（ホーム/タイムカード/プロフィール）。設定はプロフィール右上の⚙︎から
   PC: 左のサイドバー（ホーム/タイムカード/プロフィール/設定）。左下のアカウントからもプロフィールへ ---------- */
const TABS: TabItem<Tab>[] = [
  { key: 'home', label: 'ホーム', icon: 'home' },
  { key: 'timecard', label: 'タイムカード', icon: 'clock' },
  { key: 'profile', label: 'プロフィール', icon: 'user' },
]
const SIDEBAR: TabItem<Tab>[] = [...TABS, { key: 'settings', label: '設定', icon: 'gear' }]

function Screens({ me, company, onRename, onCompanyChange }: {
  me: Member; company: Company | null; onRename: (name: string) => void; onCompanyChange: (c: Company) => void
}) {
  const [tab, setTab] = useState<Tab>('home')
  const go = (t: Tab) => { setTab(t); scrollTo(0, 0) } // 移った先の画面は上から
  // サイドバーの上はアプリ（DayDeed）、ホームの題名は会社名。同じものを2か所に出さない
  const app = <><DayDeedLogo size={28} />DayDeed</>
  return (
    <div className="ui-shell">
      <Sidebar brand={app} items={SIDEBAR} value={tab} onChange={go}
        user={{ name: me.name, seed: me.id, sub: me.role === 'admin' ? '管理者' : '一般' }} onUser={() => go('profile')} />
      <div className="ui-shell-main">
        {tab === 'home' && <Home me={me} title={company?.name ?? 'DayDeed'} />}
        {tab === 'timecard' && (
          <>
            <Header title="タイムカード" />
            <main className="ui-page"><MemberSwitch me={me}>{(m) => <KintaiTable me={m} />}</MemberSwitch></main>
          </>
        )}
        {tab === 'profile' && <ProfilePage me={me} company={company} onRename={onRename} onCompanyChange={onCompanyChange} onOpenSettings={() => go('settings')} />}
        {tab === 'settings' && (
          <>
            <Header title="設定" onBack={() => go('profile')} backLabel="プロフィール" className="back-mobile-only" />
            <main className="ui-page">
              <AppearanceCard />
              <Card title="アカウント" icon="user" className="plain">
                <List label="アカウント">
                  <ListRow leading={<LeadingIcon name="mail" tone="muted" />} title="メールアドレス" trailing={me.email} />
                </List>
              </Card>
              <Button variant="outline" danger fullWidth icon="power" onClick={() => supabase.auth.signOut()}>ログアウト</Button>
            </main>
          </>
        )}
      </div>
      {/* スマホの設定はプロフィールの中の画面なので、タブはプロフィールを選択中にする */}
      <TabBar items={TABS} value={tab === 'settings' ? 'profile' : tab} onChange={go} />
    </div>
  )
}

/* ---------- デモ（/demo・データはインメモリ） ---------- */
function DemoApp() {
  const switchable = DEMO_MEMBERS.filter((m) => m.status === 'active')
  const [me, setMe] = useState(switchable[0])
  const [company, setCompany] = useState<Company>({ id: 'c1', name: 'ひまわり事務機', icon: '🌻' })
  return (
    <>
      <div className="ui-page top">
        <div className="ui-row between">
          <span className="ui-secondary">デモ画面です（データは保存されません）</span>
          <a className="ui-secondary" href="/">ログイン画面へ</a>
        </div>
        <SelectField label="表示するユーザー" value={me.id} onChange={(e) => setMe(switchable.find((m) => m.id === e.target.value) ?? me)}>
          {switchable.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.role === 'admin' ? '管理者' : '従業員'}）</option>)}
        </SelectField>
      </div>
      {/* keyで切り替え時に各画面を作り直し、前のユーザーのデータを残さない */}
      <Screens key={me.id} me={me} company={company} onRename={(name) => setMe({ ...me, name })} onCompanyChange={setCompany} />
    </>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Member | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)

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

  if (loading) return <main className="ui-page"><p className="ui-secondary ui-center" role="status">読み込み中…</p></main>
  if (recovering) return <NewPassword onDone={() => setRecovering(false)} />
  if (!session) return <Auth />
  if (!me) return <Onboarding email={session.user.email ?? ''} onDone={() => loadMe(session)} />
  return <Screens me={me} company={company} onRename={(name) => setMe({ ...me, name })} onCompanyChange={setCompany} />
}

// /demo ではフックの実行を分岐させないよう、コンポーネントごと差し替える
export default DEMO ? DemoApp : App
