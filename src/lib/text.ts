/** 空白・改行を除いた文字数（サロゲートペアを1文字として数える） */
export function countChars(text: string): number {
  let n = 0
  for (const ch of text) {
    if (!/\s/.test(ch)) n++
  }
  return n
}

export function formatCount(n: number): string {
  return `${n.toLocaleString('ja-JP')}字`
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(name: string): string {
  return (name.trim() || '無題').replace(/[\\/:*?"<>|]/g, '_')
}
