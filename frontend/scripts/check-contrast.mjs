// tokens.css の色の組み合わせが WCAG AA を満たすかをライト・ダーク両方で検査する
// 文字 4.5:1 / 入力欄の枠など UI 部品 3:1。1つでも下回れば exit 1
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
const tokens = Object.fromEntries(
  [...css.matchAll(/--(?:md-sys-color-)?([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)].map((m) => [m[1], [m[2], m[3]]]),
)

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const grounds = ['surface', 'surface-container', 'surface-container-high']
const checks = [
  ...['primary', 'error'].flatMap((r) => [[`on-${r}`, r, 4.5], [`on-${r}-container`, `${r}-container`, 4.5]]),
  // 文字色として地の上に置くもの（本文・補助・リンク・選択中タブ・削除）
  ...grounds.flatMap((g) => ['on-surface', 'on-surface-variant', 'primary', 'error'].map((fg) => [fg, g, 4.5])),
  ['outline', 'surface', 3], ['outline', 'surface-container', 3],
  ...[1, 2, 3, 4, 5, 6].map((n) => [`on-yo-${n}-container`, `yo-${n}-container`, 4.5]),
]

let failed = 0
for (const [fg, bg, min] of checks) {
  if (!tokens[fg] || !tokens[bg]) { console.log(`MISSING  --${fg} / --${bg}`); failed++; continue }
  ;['light', 'dark'].forEach((mode, i) => {
    const r = ratio(tokens[fg][i], tokens[bg][i])
    if (r < min) { console.log(`FAIL ${mode.padEnd(5)} --${fg} on --${bg}: ${r.toFixed(2)} < ${min}`); failed++ }
  })
}
console.log(failed ? `${failed} 件が基準未満` : `OK: ${checks.length * 2} 組すべて基準以上`)
process.exit(failed ? 1 : 0)
