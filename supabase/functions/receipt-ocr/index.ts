// レシート画像から店名・金額・日付・住所をClaude(Vision)で抽出する。
// リクエスト: { image: <base64>, media_type: 'image/jpeg' など }
// 失敗しても200で {ok:false, reason} を返す（手入力にフォールバックし、登録をブロックしない）
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const { image, media_type } = await req.json().catch(() => ({}))
  if (!image || !media_type) return json({ error: 'image and media_type required' }, 400)

  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: userData } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (!user) return json({ error: 'unauthorized' }, 401)
  // 名簿にいる人だけ使える
  const { data: member } = await admin.from('members')
    .select('id').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle()
  if (!member) return json({ error: 'forbidden' }, 403)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, reason: 'ANTHROPIC_API_KEY not set' })

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data: image } },
          {
            type: 'text',
            text: 'これはレシートの写真です。次のJSONだけを出力してください（説明文なし）: ' +
              '{"store": 店名(string|null), "amount": 合計金額の数値(number|null), ' +
              '"date": 日付をYYYY-MM-DD(string|null), "address": 店の住所(string|null)}。' +
              '読み取れない項目はnull。合計金額は税込の支払総額。',
          },
        ],
      }],
    })
    if (msg.stop_reason === 'refusal') return json({ ok: false, reason: 'refused' })
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return json({ ok: false, reason: 'no_json' })
    const data = JSON.parse(m[0])
    return json({
      ok: true,
      store: typeof data.store === 'string' ? data.store : null,
      amount: typeof data.amount === 'number' && data.amount > 0 ? Math.round(data.amount) : null,
      date: typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null,
      address: typeof data.address === 'string' ? data.address : null,
    })
  } catch (e) {
    return json({ ok: false, reason: (e as Error).message })
  }
})
