import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, today } from './lib/supabase'
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

/* ---------- ログイン ---------- */
function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  const google = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin },
    })

  const sendCode = async () => {
    setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin },
    })
    if (error) return setErr(error.message)
    setSent(true)
  }

  const verify = async () => {
    setErr('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) setErr('コードが違うか期限切れです。再送信してください')
  }

  return (
    <div className="card" style={{ marginTop: 60, textAlign: 'center' }}>
      <div className="brand" style={{ justifyContent: 'center', marginBottom: 16 }}>
        <span className="brand-mark">勤</span>Kintai
      </div>
      <button className="btn-primary" style={{ width: '100%' }} onClick={google}>
        Google でログイン
      </button>
      <label style={{ textAlign: 'left', marginTop: 20 }}>または開発用: メールで認証コードを受け取る</label>
      <input type="text" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      {sent && (
        <>
          <label style={{ textAlign: 'left' }}>メールに届いた6桁コード</label>
          <input type="text" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </>
      )}
      {err && <div className="notice warn">{err}</div>}
      {!sent ? (
        <button className="btn-primary" disabled={!email} onClick={sendCode}>認証コードを送信</button>
      ) : (
        <>
          <button className="btn-primary" disabled={code.length < 6} onClick={verify}>ログイン</button>
          <button className="btn-primary" style={{ background: 'var(--blue-100)', color: 'var(--blue-700)', marginLeft: 8 }}
            onClick={sendCode}>再送信</button>
        </>
      )}
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

  const punchIn = async () => {
    await supabase.from('attendances').upsert(
      { member_id: me.id, work_date: today(), clock_in: new Date().toISOString(), plan },
      { onConflict: 'member_id,work_date' },
    )
    load()
  }

  // 退勤のみ → 出勤を所定開始時刻で自動補完
  const punchOut = async () => {
    const patch: Partial<Attendance> = { clock_out: new Date().toISOString() }
    if (!att?.clock_in) {
      const d = new Date()
      const [h, m] = hm(me.work_start).split(':').map(Number)
      d.setHours(h, m, 0, 0)
      patch.clock_in = d.toISOString()
      patch.auto_in = true
    }
    await supabase.from('attendances').upsert(
      { member_id: me.id, work_date: today(), plan, ...patch },
      { onConflict: 'member_id,work_date' },
    )
    load()
  }

  const savePlan = async () => {
    await supabase.from('attendances').upsert(
      { member_id: me.id, work_date: today(), plan },
      { onConflict: 'member_id,work_date' },
    )
    load()
  }

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
    await supabase.from('daily_reports').upsert(
      { member_id: me.id, work_date: today(), body },
      { onConflict: 'member_id,work_date' },
    )
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
    await supabase.from('schedules').insert({
      company_id: me.company_id, member_id: me.id, title,
      starts_at: mk(draft.start), ends_at: mk(draft.end), with_meet: meet,
    })
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

  const save = async () => {
    // 自分の名前変更は管理者でなくても許可したいが、RLSは管理者のみなので自分用ポリシーで対応済み
    const { error } = await supabase.from('members').update({ name }).eq('id', me.id)
    if (error) alert('名前を変更できませんでした')
    else { onRename(name); setOpen(false) }
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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadMe(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadMe])

  return (
    <div className="app">
      <header className="header">
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
        : !session ? <Login />
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
