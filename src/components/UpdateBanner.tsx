import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * 新しい版を受け取ったら知らせ、利用者が押したときだけ切り替える。
 * 裏で勝手に切り替えると、開いている画面（古い版）と配信される部品（新しい版）が食い違い、
 * 読み込みに失敗して真っ白になることがあるため
 */
export default function UpdateBanner() {
  const [update, setUpdate] = useState<((reload?: boolean) => Promise<void>) | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return // 開発中は Service Worker を使わない
    const updateSW = registerSW({
      onNeedRefresh: () => setUpdate(() => updateSW),
      // 開いたままのアプリでも、1時間ごとに新しい版を確かめる
      onRegisteredSW: (_url, reg) => {
        if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
      },
    })
  }, [])

  if (!update || dismissed) return null
  return (
    <div className="update-banner" role="status">
      <span>新しいバージョンがあります</span>
      <button className="ghost small-btn" onClick={() => setDismissed(true)}>
        あとで
      </button>
      <button className="primary small-btn" onClick={() => update(true)}>
        更新
      </button>
    </div>
  )
}
