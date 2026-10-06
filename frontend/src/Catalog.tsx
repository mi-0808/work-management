import { useState } from 'react'
import { Badge, Button, Card, ErrorMessage, Header, IconButton, TabBar, TextArea, TextField, type TabItem } from './ui'

/* デザインカタログ（/catalog）。共通部品と色を実物で並べる。部品を足したらここにも置く */

type Theme = 'system' | 'light' | 'dark'
type Tab = 'home' | 'calendar' | 'timecard' | 'profile'

const THEMES: Record<Theme, string> = { system: '端末に合わせる', light: 'ライト', dark: 'ダーク' }
const TABS: TabItem<Tab>[] = [
  { key: 'home', label: 'ホーム', icon: 'home' },
  { key: 'calendar', label: 'カレンダー', icon: 'calendar' },
  { key: 'timecard', label: 'タイムカード', icon: 'clock' },
  { key: 'profile', label: 'プロフィール', icon: 'user' },
]
// [面の役割, その上の文字の役割, 使い道]
const ROLES: [string, string, string][] = [
  ['primary', 'on-primary', '塗りボタン・リンク・選択中'],
  ['primary-container', 'on-primary-container', '淡い塗り・選択中の札'],
  ['error', 'on-error', 'エラー・削除'],
  ['error-container', 'on-error-container', 'エラーの面'],
  ['surface', 'on-surface', '画面・カード'],
  ['surface-container', 'on-surface', '入れ子の面'],
  ['surface-container-high', 'on-surface', '押している間の面'],
]
const SIZES = ['2xl', 'xl', 'lg', 'base', 'sm', 'xs', '2xs']
const MEMBERS = ['高', '佐', '田', '鈴', '伊', '山']

const row = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' } as const
const stack = { display: 'grid', gap: 'var(--space-4)' }

export default function Catalog() {
  const [theme, setTheme] = useState<Theme>('system')
  const [tab, setTab] = useState<Tab>('home')
  const [plan, setPlan] = useState('')
  return (
    <div className="ui-root" data-theme={theme === 'system' ? undefined : theme}>
      <Header title="デザインカタログ" onBack={() => { location.href = '/' }}
        actions={<IconButton icon="bell" label="お知らせ" badge={3} />} />
      <main className="ui-page">
        <Card title="表示モード">
          <div style={row}>
            {(Object.keys(THEMES) as Theme[]).map((t) => (
              <Button key={t} variant={theme === t ? 'primary' : 'outline'} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {THEMES[t]}
              </Button>
            ))}
          </div>
        </Card>

        <Card title="色">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-2)' }}>
            {ROLES.map(([bg, fg, use]) => (
              <div key={bg} style={{
                background: `var(--md-sys-color-${bg})`, color: `var(--md-sys-color-${fg})`,
                border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-3)',
              }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{bg}</div>
                <div style={{ fontSize: 'var(--text-xs)' }}>{use}</div>
              </div>
            ))}
          </div>
          <p style={{ margin: 'var(--space-4) 0 0' }}>
            本文は on-surface。<span style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>ラベル・補足は on-surface-variant。</span>
          </p>
          <div style={{ ...row, marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--md-sys-color-on-surface-variant)' }}>
            <span style={{ flex: 1, borderBottom: '2px solid var(--md-sys-color-outline)' }}>outline（部品の枠）</span>
            <span style={{ flex: 1, borderBottom: '2px solid var(--md-sys-color-outline-variant)' }}>outline-variant（飾りの線）</span>
          </div>
        </Card>

        <Card title="文字">
          {SIZES.map((s) => (
            <div key={s} style={{ fontSize: `var(--text-${s})`, lineHeight: 1.5 }}>text-{s}　今日の勤怠 09:00</div>
          ))}
        </Card>

        <Card title="ボタン">
          <div style={stack}>
            <div style={row}>
              <Button>出勤する</Button>
              <Button variant="outline">キャンセル</Button>
              <Button variant="ghost">あとで</Button>
            </div>
            <div style={row}>
              <Button variant="outline" danger>削除</Button>
              <Button disabled>保存中</Button>
            </div>
            <Button fullWidth>幅いっぱい</Button>
          </div>
        </Card>

        <Card title="バッジ">
          <div style={row}>
            <Badge tone="primary" icon="check">勤務中</Badge>
            <Badge icon="pause">中抜け中</Badge>
            <Badge icon="alert">打刻漏れ</Badge>
            <Badge tone="error" icon="alert">要修正</Badge>
            <Badge>自動補完</Badge>
          </div>
        </Card>

        <Card title="入力欄">
          <div style={stack}>
            <TextField label="今日の予定" placeholder="資料作成、定例ミーティング" value={plan} onChange={(e) => setPlan(e.target.value)} />
            <TextField label="出勤時刻" type="time" defaultValue="09:00" hint="押し忘れたときだけ直します" />
            <TextField label="退勤時刻" type="time" defaultValue="08:30" error="退勤時刻が出勤より前になっています" />
            <TextField label="メールアドレス" type="email" required placeholder="name@example.com" />
            <TextField label="会社コード" defaultValue="ABC-123" disabled />
            <TextArea label="日報" placeholder="今日やったこと、明日やること" />
            <ErrorMessage>保存できませんでした。通信を確認してもう一度お試しください</ErrorMessage>
          </div>
        </Card>

        <Card title="カード" action={<Button variant="ghost">編集</Button>}>
          <p style={{ margin: 0 }}>見出し（h2）と右側の操作を持てる。内側の余白は 21px、角は 17px。</p>
        </Card>

        <Card title="メンバーのアイコン">
          <div style={row}>
            {MEMBERS.map((ch, i) => (
              <span key={ch} style={{
                width: 40, height: 40, borderRadius: 'var(--radius-full)', display: 'grid', placeItems: 'center', fontWeight: 500,
                background: `var(--yo-${i + 1}-container)`, color: `var(--on-yo-${i + 1}-container)`,
              }}>{ch}</span>
            ))}
          </div>
        </Card>
      </main>
      <TabBar items={TABS} value={tab} onChange={setTab} />
    </div>
  )
}
