import { useCallback, useEffect, useState } from 'react'

/** 表示の明るさ。system は端末の設定に合わせる（端末ごとに保存） */
export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'novel-editor:theme'
const BAR_COLOR = { light: '#f3f0e9', dark: '#121110' }
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const systemDark = () => window.matchMedia?.(DARK_QUERY).matches ?? false
export const resolveTheme = (pref: ThemePref) => (pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref)

/**
 * <html data-theme> とブラウザのバーの色を反映する。描画前（main.tsx）にも呼んで、ちらつきを防ぐ。
 * 「自動」のときは何も固定せず CSS のメディアクエリに任せる（端末の切り替えに、どの画面にいても追従する）
 */
export function applyTheme(pref: ThemePref = readThemePref()) {
  const root = document.documentElement
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  if (pref === 'system') {
    root.removeAttribute('data-theme')
    root.style.removeProperty('color-scheme')
    // index.html と同じく、ライト用・ダーク用の2つを media 付きで置く
    metas.forEach((m, i) => {
      const scheme = i === 0 ? 'light' : 'dark'
      m.setAttribute('media', `(prefers-color-scheme: ${scheme})`)
      m.setAttribute('content', BAR_COLOR[scheme])
    })
  } else {
    root.setAttribute('data-theme', pref)
    root.style.colorScheme = pref
    metas.forEach((m) => {
      m.removeAttribute('media')
      m.setAttribute('content', BAR_COLOR[pref])
    })
  }
  return resolveTheme(pref)
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readThemePref)
  const [resolved, setResolved] = useState(() => resolveTheme(pref))

  useEffect(() => {
    setResolved(applyTheme(pref))
    try {
      if (pref === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, pref)
    } catch {
      /* 保存できなくても表示は切り替える */
    }
    if (pref !== 'system') return
    // アイコンの表示（今がライトかダークか）だけ追従させる。見た目そのものは CSS が追従する
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => setResolved(resolveTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  /** ライト ⇄ ダークを切り替える（今の見た目の反対にする） */
  const toggle = useCallback(() => setPref(resolved === 'dark' ? 'light' : 'dark'), [resolved])

  return { pref, resolved, setPref, toggle }
}
