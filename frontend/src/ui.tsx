import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
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
}
export function Button({ variant = 'primary', danger, fullWidth, className, ...rest }: ButtonProps) {
  return <button type="button" className={cx('ui-btn ui-state', `ui-btn-${variant}`, danger && 'danger', fullWidth && 'ui-btn-full', className)} {...rest} />
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName
  /** 読み上げ用の名前（アイコンだけなので必須） */
  label: string
  /** 右上の件数。0 なら出さない */
  badge?: number
}
export function IconButton({ icon, label, badge = 0, className, ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={badge > 0 ? `${label}（${badge}件）` : label} className={cx('ui-icon-btn ui-state', className)} {...rest}>
      <Icon name={icon} />
      {badge > 0 && <span className="ui-icon-btn-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}

/** 画面上部。onBack があれば左に戻るボタン。title は画面の h1 */
export function Header({ title, onBack, backLabel = '戻る', actions }: {
  title: ReactNode; onBack?: () => void; backLabel?: string; actions?: ReactNode
}) {
  return (
    <header className="ui-header">
      {onBack && <IconButton icon="back" label={backLabel} onClick={onBack} />}
      <h1 className="ui-header-title">{title}</h1>
      {actions && <div className="ui-header-actions">{actions}</div>}
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

/** 内容のまとまり。title は h2、action は見出しの右（ghost ボタンなど） */
export function Card({ title, action, className, children }: {
  title?: ReactNode; action?: ReactNode; className?: string; children: ReactNode
}) {
  return (
    <section className={cx('ui-card', className)}>
      {(title || action) && (
        <div className="ui-card-head">
          {title && <h2 className="ui-card-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
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
