import { useEffect, useState } from 'react'
import { backupsUnder, discardBackup } from '../lib/useAutosave'

/**
 * 保存できなかった編集内容（端末に退避したもの）のうち、path（とその配下）の分を見せ、コピー・破棄できるようにする。
 * 共有が解除された・他の端末で削除されたなどで元の画面を開けなくなった退避は、ここでしか片付けられない
 */
export default function UnsavedBackups({ path }: { path: string }) {
  const [unsaved, setUnsaved] = useState<ReturnType<typeof backupsUnder>>([])
  // 編集画面が外れるときの保存（退避の書き込み）は、この部品の描画より後に走るので、その後で読む
  useEffect(() => {
    const t = setTimeout(() => setUnsaved(backupsUnder(path)))
    return () => clearTimeout(t)
  }, [path])
  const [copied, setCopied] = useState('')
  const copy = async (p: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(p)
    } catch {
      alert('コピーできませんでした')
    }
  }
  if (unsaved.length === 0) return null
  return (
    <div className="problem-banner" role="alert">
      <p>保存できなかった編集内容がこの端末に残っています。必要ならコピーして控えてください。</p>
      <div className="problem-actions">
        {unsaved.map((u) => (
          <button key={u.path} onClick={() => copy(u.path, `${u.title}\n\n${u.body}`)}>
            {copied === u.path ? 'コピーしました' : `「${u.title || '無題'}」をコピー`}
          </button>
        ))}
        <button
          className="danger"
          onClick={() => {
            if (!confirm('保存できなかった編集内容を捨てます。')) return
            // 表示した版だけを消す（表示した後に書き足された新しい版は残す）
            unsaved.forEach((u) => discardBackup(u.path, u.updatedAt))
            setUnsaved(backupsUnder(path))
          }}
        >
          捨てる
        </button>
      </div>
    </div>
  )
}
