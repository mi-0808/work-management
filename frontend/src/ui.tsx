import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import './tokens.css'
import './ui.css'

/* 共通部品（規定: docs/デザイン規定.md / 一覧: /catalog）。
   画面はこの部品だけで組み、色・形を個別に書かない。見た目は MyHood の同名部品と同じ */

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

const PATHS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="17" rx="2" /><path d="M3 10h18M8 2v5M16 2v5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></>,
  back: <path d="m15 18-6-6 6-6" />,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.5h.01" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></>,
  pause: <><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5h.01" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  power: <><path d="M12 3v8" /><path d="M7.5 6.3a7.5 7.5 0 1 0 9 0" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  login: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5M15 12H3" /></>,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5.5 3.5-5.5 3.5z" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c1.9.8 3 2.8 3 5.6" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  yen: <><path d="m7 4 5 7 5-7M12 11v9M8 13h8M8 16.5h8" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
}
export type IconName = keyof typeof PATHS

/** 飾りのアイコン。意味は隣の文言か aria-label で伝える */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = 主な操作（1画面に1つ）/ outline = キャンセル・二番手 / ghost = 補助 */
  variant?: 'primary' | 'outline' | 'ghost'
  /** 削除など取り消せない操作 */
  danger?: boolean
  fullWidth?: boolean
  /** 文字の前（tile なら上）に置くアイコン */
  icon?: IconName
  /** アイコンの下に文字を置く大きなボタン（マップの「経路・発信」）。.ui-tiles に並べる */
  tile?: boolean
}
export function Button({ variant = 'primary', danger, fullWidth, icon, tile, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={cx('ui-btn ui-state', `ui-btn-${variant}`, danger && 'danger', fullWidth && 'ui-btn-full', tile && 'tile', className)} {...rest}>
      {icon && <Icon name={icon} />}{children}
    </button>
  )
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName
  /** 読み上げ用の名前（アイコンだけなので必須） */
  label: string
  /** 右上の件数。0 なら出さない */
  badge?: number
  /** 白い丸と影なし（表の中・行の中で使う） */
  plain?: boolean
}
export function IconButton({ icon, label, badge = 0, plain, className, ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={badge > 0 ? `${label}（${badge}件）` : label} className={cx('ui-icon-btn ui-state', plain && 'plain', className)} {...rest}>
      <Icon name={icon} />
      {badge > 0 && <span className="ui-icon-btn-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}

/** 画面上部。title は画面の h1（大きなタイトル）。onBack があれば左にガラスの丸い戻るボタン。
 *  className="back-mobile-only" で PC では戻るを隠す（サイドバーから直接行ける画面） */
export function Header({ title, onBack, backLabel = '戻る', actions, className }: {
  title: ReactNode; onBack?: () => void; backLabel?: string; actions?: ReactNode; className?: string
}) {
  return (
    <header className={cx('ui-header', className)}>
      {onBack && (
        <button type="button" className="ui-icon-btn ui-header-back ui-state" onClick={onBack} aria-label={`${backLabel}に戻る`}>
          <Icon name="back" />
        </button>
      )}
      <h1 className="ui-header-title">{title}</h1>
      <div className="ui-header-actions">{actions}</div>
    </header>
  )
}

export type TabItem<K extends string> = { key: K; label: string; icon: IconName }
/** 画面下のメインナビ。項目は 3〜5 個 */
export function TabBar<K extends string>({ items, value, onChange }: {
  items: TabItem<K>[]; value: K; onChange: (key: K) => void
}) {
  return (
    <nav className="ui-tabbar" aria-label="メインナビゲーション">
      {items.map((t) => (
        <button key={t.key} type="button" className="ui-tab ui-state"
          aria-current={t.key === value ? 'page' : undefined} onClick={() => onChange(t.key)}>
          <Icon name={t.icon} />{t.label}
        </button>
      ))}
    </nav>
  )
}

/** PC（幅 1024px 以上）のメインナビ: 左のサイドバー（macOS の App Store と同じ）。スマホでは隠れて TabBar が出る。
 *  上に brand（アプリ名）、中に項目、一番下に使っている人（onUser を渡すと押せる。プロフィールへ）。.ui-shell の中に置く */
export function Sidebar<K extends string>({ brand, user, onUser, items, value, onChange }: {
  brand: ReactNode; user: { name: string; seed: string; sub: string }; onUser?: () => void
  items: TabItem<K>[]; value: K; onChange: (key: K) => void
}) {
  return (
    <aside className="ui-sidebar">
      <div className="ui-sidebar-brand">{brand}</div>
      <nav aria-label="メインナビゲーション">
        <ul>
          {items.map((t) => (
            <li key={t.key}>
              <button type="button" className="ui-sidebar-item ui-state"
                aria-current={t.key === value ? 'page' : undefined} onClick={() => onChange(t.key)}>
                <Icon name={t.icon} />{t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {onUser ? (
        <button type="button" className="ui-sidebar-user ui-state" aria-label={`${user.name}（プロフィールを開く）`} onClick={onUser}>
          <Avatar name={user.name} seed={user.seed} />
          <span className="ui-sidebar-me"><b>{user.name}</b><small>{user.sub}</small></span>
        </button>
      ) : (
        <div className="ui-sidebar-user">
          <Avatar name={user.name} seed={user.seed} />
          <span className="ui-sidebar-me"><b>{user.name}</b><small>{user.sub}</small></span>
        </div>
      )}
    </aside>
  )
}

/** 内容のまとまり。見出し（h2・大きく太い）をセルの外に置き、中身は明るい角丸のセルに入れる。
 *  icon は見出しの前のアイコン、action は見出しの右。className="plain" でセルなし（地に直接置く） */
export function Card({ title, icon, action, className, children }: {
  title?: ReactNode; icon?: IconName; action?: ReactNode; className?: string; children: ReactNode
}) {
  return (
    <section className={cx('ui-section', className)}>
      {(title || action) && (
        <div className="ui-section-head">
          {title && <h2 className="ui-section-title">{icon && <Icon name={icon} />}{title}</h2>}
          {action}
        </div>
      )}
      <div className="ui-card">{children}</div>
    </section>
  )
}

/** リストの行の頭に置く丸いアイコン。tone: 塗り（既定）/ soft（淡い）/ muted（グレー） */
export function LeadingIcon({ name, tone }: { name: IconName; tone?: 'soft' | 'muted' }) {
  return <span className={cx('ui-leading', tone)} aria-hidden="true"><Icon name={name} /></span>
}

/** 状態の札。色だけで伝えないよう icon か文言を必ず添える */
export function Badge({ tone = 'neutral', icon, children }: {
  tone?: 'neutral' | 'primary' | 'error'; icon?: IconName; children: ReactNode
}) {
  return <span className={`ui-badge ui-badge-${tone}`}>{icon && <Icon name={icon} />}{children}</span>
}

/** エラーの知らせ。出た瞬間に読み上げる */
export function ErrorMessage({ id, children }: { id?: string; children: ReactNode }) {
  return <div id={id} role="alert" className="ui-error"><Icon name="alert" /><div>{children}</div></div>
}

type FieldProps = { label: string; hint?: string; error?: string }

/** ラベル・補足・エラーを入力欄とつなぐ（ラベル必須。プレースホルダーをラベル代わりにしない） */
function Field({ id, label, hint, error, required, children }: FieldProps & {
  id: string; required?: boolean; children: (aria: { 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode
}) {
  const describedBy = cx(hint && `${id}-hint`, error && `${id}-error`) || undefined
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={id}>
        {label}{required && <span className="ui-field-required" aria-hidden="true"> *</span>}
      </label>
      {children({ 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && <p id={`${id}-hint`} className="ui-field-hint">{hint}</p>}
      {error && <ErrorMessage id={`${id}-error`}>{error}</ErrorMessage>}
    </div>
  )
}

export function TextField({ label, hint, error, id, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      {(aria) => <input id={fid} className={cx('ui-input', className)} {...aria} {...rest} />}
    </Field>
  )
}

export function TextArea({ label, hint, error, id, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      {(aria) => <textarea id={fid} className={cx('ui-input', className)} {...aria} {...rest} />}
    </Field>
  )
}

/** 選択欄（端末の標準ピッカーが開く）。中身は <option> */
export function SelectField({ label, hint, error, id, className, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      {(aria) => (
        <span className="ui-select-wrap">
          <select id={fid} className={cx('ui-input ui-select', className)} {...aria} {...rest} />
          <Icon name="chevron" />
        </span>
      )}
    </Field>
  )
}

/** 少数の選択肢から1つ選ぶ（HIG のセグメントコントロール）。選ぶとすぐ反映する */
export function SegmentedControl<K extends string>({ label, options, value, onChange, fullWidth }: {
  label: string; options: { key: K; label: string; icon?: IconName }[]; value: K; onChange: (key: K) => void; fullWidth?: boolean
}) {
  return (
    <div className={cx('ui-seg', fullWidth && 'full')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className="ui-state" aria-pressed={o.key === value}
          onClick={() => o.key !== value && onChange(o.key)}>{o.icon && <Icon name={o.icon} />}{o.label}</button>
      ))}
    </div>
  )
}

/** 成功・案内の知らせ（エラーは ErrorMessage）。出た瞬間に読み上げる */
export function Notice({ icon = 'info', children }: { icon?: IconName; children: ReactNode }) {
  return <div role="status" className="ui-notice"><Icon name={icon} /><div>{children}</div></div>
}

/** 区切り線。文言を入れると線の間に置く（「または」など） */
export function Divider({ children }: { children?: ReactNode }) {
  return <div className="ui-divider" role="separator">{children}</div>
}

/** メンバーの頭文字アイコン。色は seed（id）から洋パレットの6色を選ぶので、どの画面でも同じ人は同じ色 */
export function Avatar({ name, seed, size = 'md' }: { name: string; seed: string; size?: 'sm' | 'md' | 'lg' }) {
  const n = ([...seed].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 0) >>> 0) % 6 + 1
  return (
    <span className={`ui-avatar ${size}`} aria-hidden="true"
      style={{ background: `var(--yo-${n}-container)`, color: `var(--on-yo-${n}-container)` }}>{name[0]}</span>
  )
}

/** 行のまとまり（HIG のグループ化されたリスト）。中身は ListRow。Card の直下に置くと縁まで広がる */
export function List({ label, children }: { label?: string; children: ReactNode }) {
  return <ul className="ui-list" aria-label={label}>{children}</ul>
}

/** リストの1行。onClick があれば押せる行になり、右に › が付く（expanded を渡すと開閉の行）。
 *  tone を付けると「追加」「ログアウト」のような文字だけの操作行（› なし）。children は行の下に開く中身 */
export function ListRow({ leading, title, subtitle, trailing, onClick, expanded, tone, children }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode
  onClick?: () => void; expanded?: boolean; tone?: 'primary' | 'error'; children?: ReactNode
}) {
  const body = (
    <>
      {leading}
      <span className="ui-list-text">
        <span className="ui-list-title">{title}</span>
        {subtitle && <span className="ui-list-sub">{subtitle}</span>}
      </span>
      {trailing != null && <span className="ui-list-trailing">{trailing}</span>}
      {onClick && !tone && <span className="ui-list-chevron"><Icon name="chevron" /></span>}
    </>
  )
  return (
    <li>
      {onClick
        ? <button type="button" className={cx('ui-list-row ui-state', tone)} aria-expanded={expanded} onClick={onClick}>{body}</button>
        : <div className={cx('ui-list-row', tone)}>{body}</div>}
      {children && <div className="ui-list-detail">{children}</div>}
    </li>
  )
}

/** 数字の要約（今週の実働など）。current は今日など「今」の枠。columns を渡すと列数を固定 */
export function Stats({ items, columns }: {
  items: { label: string; value: ReactNode; current?: boolean; icon?: IconName }[]; columns?: number
}) {
  return (
    <dl className={cx('ui-stats', !!columns && 'fixed')} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {items.map((s) => (
        <div key={s.label} className="ui-stat" aria-current={s.current ? 'date' : undefined}>
          <dt>{s.icon && <Icon name={s.icon} />}{s.label}</dt><dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 日付の札（カレンダーの日付: 日にちの下に曜日）。current は今日（青の塗り） */
export function DateChip({ day, weekday, current }: { day: number; weekday: string; current?: boolean }) {
  return (
    <span className={cx('ui-date', current && 'current')} role="img" aria-label={`${day}日(${weekday})${current ? '・今日' : ''}`}>
      <b>{day}</b><small>{weekday}</small>
    </span>
  )
}
