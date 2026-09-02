// アプリの予定をGoogleカレンダーへ片方向同期する。
// リクエスト: { schedule_id, action: 'upsert' | 'delete' }
// 同期できない場合も200で {synced:false, reason} を返す（予定保存をブロックしない）
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

Deno.serve(async (req) => {
  const { schedule_id, action = 'upsert' } = await req.json().catch(() => ({}))
  if (!schedule_id) return json({ error: 'schedule_id required' }, 400)

  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: userData } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (!user) return json({ error: 'unauthorized' }, 401)

  const { data: sc } = await admin.from('schedules').select('*').eq('id', schedule_id).maybeSingle()
  if (!sc) return json({ error: 'schedule not found' }, 404)

  const token = await accessToken(user.id)
  if (!token) return json({ synced: false, reason: 'no_google_token' })
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  if (action === 'delete') {
    if (sc.google_event_id) {
      await fetch(`${GCAL}/${sc.google_event_id}`, { method: 'DELETE', headers: auth }) // 404/410は無視
      await admin.from('schedules').update({ google_event_id: null, meet_url: null }).eq('id', schedule_id)
    }
    return json({ synced: true })
  }

  // 参加者 = 作成者と宛先メンバーのメール
  const memberIds = [sc.member_id, sc.to_member_id, sc.proposed_by].filter(Boolean)
  const { data: members } = await admin.from('members').select('email').in('id', memberIds)
  const event = {
    summary: sc.title || '予定',
    start: { dateTime: sc.starts_at, timeZone: 'Asia/Tokyo' },
    end: { dateTime: sc.ends_at, timeZone: 'Asia/Tokyo' },
    attendees: (members ?? []).map((m) => ({ email: m.email })),
    ...(sc.with_meet && !sc.google_event_id
      ? { conferenceData: { createRequest: { requestId: sc.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
      : {}),
  }
  const url = sc.google_event_id ? `${GCAL}/${sc.google_event_id}?conferenceDataVersion=1` : `${GCAL}?conferenceDataVersion=1`
  const res = await fetch(url, { method: sc.google_event_id ? 'PATCH' : 'POST', headers: auth, body: JSON.stringify(event) })
  const ev = await res.json()
  if (!res.ok) return json({ synced: false, reason: ev.error?.message ?? 'google_api_error' })

  await admin.from('schedules')
    .update({ google_event_id: ev.id, meet_url: ev.hangoutLink ?? sc.meet_url ?? null })
    .eq('id', schedule_id)
  return json({ synced: true, meet_url: ev.hangoutLink ?? null })
})
