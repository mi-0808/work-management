import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Catalog from './Catalog'
import { applyTheme, readTheme } from './theme'

// 設定で選んだライト/ダークを描画前に戻す（ちらつき防止）
applyTheme(readTheme())

// /catalog はデザインカタログ（共通部品の一覧）
const Root = location.pathname.startsWith('/catalog') ? Catalog : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
