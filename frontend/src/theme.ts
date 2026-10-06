/* 表示（ライト/ダーク）。端末に保存し、<html data-theme> で切り替える。system は端末の設定に従う */
export type Theme = 'system' | 'light' | 'dark'
const THEME_KEY = 'daydeed-theme'
export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch { return 'system' }
}
export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, t)
  } catch { /* 保存できなくても今の表示は切り替わる */ }
}
