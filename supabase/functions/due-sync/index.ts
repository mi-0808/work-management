// 目標・ネクストアクションの期日をGoogleカレンダーの終日イベントへ片方向同期する。
// リクエスト: { kind: 'goal' | 'next_action', id, action: 'upsert' | 'delete' }
// 同期できない場合も200で {synced:false, reason} を返す（保存をブロックしない）
import { createClient } from 'jsr:@supabase/supabase-js@2'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// refresh_token → access_token。失効(invalid_grant)ならトークン行を消してnull
const accessToken = async (userId: string): Promise<string | null> => {
  const { data: row } = await admin.from('google_tokens').select('refresh_token').eq('user_id', userId).maybeSingle()
  if (!row) return null
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const tok = await res.json()
  if (!res.ok) {
    if (tok.error === 'invalid_grant') await admin.from('google_tokens').delete().eq('user_id', userId)
    return null
  }
  return tok.access_token
}

const nextDay = (d: string) => {
  const dt = new Date(d + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  const { kind, id, action = 'upsert' } = await req.json().catch(() => ({}))
  const table = kind === 'goal' ? 'goals' : kind === 'next_action' ? 'next_actions' : null
  if (!table || !id) return json({ error: 'kind and id required' }, 400)

  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: userData } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (!user) return json({ error: 'unauthorized' }, 401)

  const { data: row } = await admin.from(table).select('*').eq('id', id).maybeSingle()
  if (!row) return json({ error: 'not found' }, 404)

  // 本人の目標・アクションだけ同期できる
  const { data: member } = await admin.from('members')
    .select('id').eq('id', row.member_id).eq('user_id', user.id).maybeSingle()
  if (!member) return json({ error: 'forbidden' }, 403)

  const token = await accessToken(user.id)
  if (!token) return json({ synced: false, reason: 'no_google_token' })
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // 削除、または期日なしになった場合はイベントを消す
  if (action === 'delete' || !row.due_date) {
    if (row.google_event_id) {
      await fetch(`${GCAL}/${row.google_event_id}`, { method: 'DELETE', headers: auth }) // 404/410は無視
      await admin.from(table).update({ google_event_id: null }).eq('id', id)
    }
    return json({ synced: true })
  }

  const event = {
    summary: `${kind === 'goal' ? '【目標】' : '【やること】'}${row.title}`,
    start: { date: row.due_date },
    end: { date: nextDay(row.due_date) },
  }
  const url = row.google_event_id ? `${GCAL}/${row.google_event_id}` : GCAL
  const res = await fetch(url, {
    method: row.google_event_id ? 'PATCH' : 'POST', headers: auth, body: JSON.stringify(event),
  })
  const ev = await res.json()
  if (!res.ok) return json({ synced: false, reason: ev.error?.message ?? 'google_api_error' })

  await admin.from(table).update({ google_event_id: ev.id }).eq('id', id)
  return json({ synced: true })
})
