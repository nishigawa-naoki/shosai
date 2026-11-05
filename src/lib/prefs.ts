import { useCallback, useEffect, useState } from 'react'

const KEY = 'novel-editor:fontSize'
const MIN = 13
const MAX = 26

function read(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n >= MIN && n <= MAX ? n : 17
  } catch {
    return 17
  }
}

/** 本文の文字サイズ（端末ごとに保存） */
export function useFontSize() {
  const [size, setSize] = useState(read)
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${size}px`)
    try {
      localStorage.setItem(KEY, String(size))
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, [size])
  const inc = useCallback(() => setSize((s) => Math.min(MAX, s + 1)), [])
  const dec = useCallback(() => setSize((s) => Math.max(MIN, s - 1)), [])
  return { size, inc, dec }
}
