import { useState } from 'react'
import {
  Avatar, Badge, Button, Card, DateChip, Divider, ErrorMessage, Header, IconButton, LeadingIcon, List, ListRow,
  Notice, SegmentedControl, SelectField, Sidebar, Stats, TabBar, TextArea, TextField, type TabItem,
} from './ui'

/* デザインカタログ（/catalog）。共通部品と色を実物で並べる。部品を足したらここにも置く */

type Theme = 'system' | 'light' | 'dark'
type Tab = 'home' | 'timecard' | 'profile'

const TABS: TabItem<Tab>[] = [
  { key: 'home', label: 'ホーム', icon: 'home' },
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
const MEMBERS = [['m1', '高橋'], ['m2', '佐藤'], ['m3', '田中'], ['m4', '鈴木'], ['m5', '伊藤'], ['m6', '山本']]

export default function Catalog() {
  const [theme, setTheme] = useState<Theme>('system')
  const [tab, setTab] = useState<Tab>('home')
  const [plan, setPlan] = useState('')
  const [open, setOpen] = useState(false)
  const brand = <span className="ui-row nowrap">DayDeed</span>
  return (
    <div className="ui-root ui-shell" data-theme={theme === 'system' ? undefined : theme}>
      <Sidebar brand={brand} items={TABS} value={tab} onChange={setTab} user={{ name: '高橋 誠', seed: 'm1', sub: '管理者' }} />
      <div className="ui-shell-main">
      <Header title="デザインカタログ" onBack={() => { location.href = '/' }}
        actions={<IconButton icon="bell" label="お知らせ" badge={3} />} />
      <main className="ui-page">
        <Card title="表示モード" icon="sun" className="plain">
          <SegmentedControl label="表示モード" fullWidth value={theme} onChange={setTheme}
            options={[{ key: 'system', label: '自動', icon: 'monitor' }, { key: 'light', label: 'ライト', icon: 'sun' }, { key: 'dark', label: 'ダーク', icon: 'moon' }]} />
          <p className="ui-secondary">PC（幅 1024px 以上）では左のサイドバー（Sidebar）、スマホでは下のタブ（TabBar）が出ます</p>
        </Card>

        <Card title="色">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-2)' }}>
            {ROLES.map(([bg, fg, use]) => (
              <div key={bg} style={{
                background: `var(--md-sys-color-${bg})`, color: `var(--md-sys-color-${fg})`,
                border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-3)',
              }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{bg}</div>
                <div style={{ fontSize: 'var(--text-xs)' }}>{use}</div>
              </div>
            ))}
          </div>
          <p className="ui-text">本文は on-surface。<span className="ui-secondary">ラベル・補足は on-surface-variant。</span></p>
        </Card>

        <Card title="文字">
          {SIZES.map((s) => (
            <div key={s} style={{ fontSize: `var(--text-${s})`, lineHeight: 1.5 }}>text-{s}　今日の勤怠 09:00</div>
          ))}
          <p className="ui-display">9:41<small>:05</small></p>
        </Card>

        <Card title="ボタン" icon="plus">
          <div className="ui-tiles">
            <Button tile icon="logout">退勤する</Button>
            <Button tile variant="outline" icon="pause">中抜け・休憩</Button>
          </div>
          <div className="ui-row">
            <Button>出勤する</Button>
            <Button variant="outline">キャンセル</Button>
            <Button variant="ghost">あとで</Button>
          </div>
          <div className="ui-row">
            <Button variant="outline" danger icon="power">ログアウト</Button>
            <Button disabled>保存中</Button>
            <IconButton icon="gear" label="設定" />
            <IconButton icon="close" label="閉じる" plain />
          </div>
        </Card>

        <Card title="リスト" icon="list">
          <List label="リストの例">
            <ListRow leading={<LeadingIcon name="login" />} title="出勤" trailing="09:00" onClick={() => setOpen(!open)} expanded={open}>
              {open && <TextField label="出勤時刻" type="time" defaultValue="09:00" />}
            </ListRow>
            <ListRow leading={<LeadingIcon name="pause" tone="soft" />} title="中抜け" subtitle="中抜け中" trailing="12:00–" onClick={() => {}} />
            <ListRow leading={<Avatar name="佐藤" seed="m2" />} title="佐藤 美咲" subtitle="sato@example.com" onClick={() => {}} />
            <ListRow leading={<LeadingIcon name="mail" tone="muted" />} title="メールアドレス" trailing="takahashi@example.com" />
            <ListRow tone="primary" leading={<LeadingIcon name="plus" tone="soft" />} title="中抜けを後から追加" onClick={() => {}} />
          </List>
        </Card>

        <Card title="数字の要約" icon="chart">
          <Stats items={[{ label: '今週', icon: 'calendar', value: '32:10' }, { label: '今月', icon: 'chart', value: '120:45' }, { label: '給与見込み', icon: 'yen', value: '¥186,000' }]} />
          <Stats columns={7} items={'月火水木金土日'.split('').map((d, i) => ({ label: d, value: i < 3 ? '8:00' : '–', current: i === 2 }))} />
        </Card>

        <Card title="タイムカードの行" icon="clock">
          <List label="タイムカードの例">
            <ListRow leading={<DateChip day={6} weekday="月" current />} title="09:00 – 勤務中" subtitle="中抜け 12:00–13:00" onClick={() => {}} />
            <ListRow leading={<DateChip day={3} weekday="金" />} title="09:02 – 18:10" trailing={<><Badge icon="check">確定</Badge>8時間08分</>} onClick={() => {}} />
          </List>
        </Card>

        <Card title="バッジ">
          <div className="ui-row">
            <Badge tone="primary" icon="check">勤務中</Badge>
            <Badge icon="pause">中抜け中</Badge>
            <Badge icon="alert">自動補完</Badge>
            <Badge tone="error" icon="alert">要修正</Badge>
          </div>
        </Card>

        <Card title="入力欄">
          <TextField label="今日の予定" placeholder="資料作成、定例ミーティング" value={plan} onChange={(e) => setPlan(e.target.value)} />
          <TextField label="退勤時刻" type="time" defaultValue="08:30" error="退勤時刻が出勤より前になっています" />
          <TextField label="メールアドレス" type="email" required placeholder="name@example.com" hint="ログインに使います" />
          <SelectField label="表示中のメンバー" defaultValue="m1">
            <option value="m1">高橋 誠（自分）</option><option value="m2">佐藤 美咲</option>
          </SelectField>
          <SegmentedControl label="給与形態" value="hourly" onChange={() => {}}
            options={[{ key: 'hourly', label: '時給' }, { key: 'monthly', label: '月額' }]} />
          <TextArea label="日報" placeholder="今日やったこと、明日やること" />
        </Card>

        <Card title="知らせ">
          <Notice icon="check">名前を保存しました</Notice>
          <ErrorMessage>保存できませんでした。通信を確認してもう一度お試しください</ErrorMessage>
          <Divider>または</Divider>
        </Card>

        <Card title="メンバーのアイコン" icon="users">
          <div className="ui-row">
            {MEMBERS.map(([id, name]) => <Avatar key={id} name={name} seed={id} />)}
          </div>
        </Card>
      </main>
      </div>
      <TabBar items={TABS} value={tab} onChange={setTab} />
    </div>
  )
}
