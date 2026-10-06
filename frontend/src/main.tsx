import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import App from './App'
import Catalog from './Catalog'

// /catalog はデザインカタログ（共通部品の一覧）
const Root = location.pathname.startsWith('/catalog') ? Catalog : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
