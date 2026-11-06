import { useState } from 'react'

/** 以前の URL。ここで開いたときだけ、新しい URL への移動を案内する */
const OLD_HOSTS = ['novel-editor-c94e8.web.app', 'novel-editor-c94e8.firebaseapp.com']
export const NEW_ORIGIN = 'https://shosai-app.web.app'

/**
 * URL を変えた案内。古い URL ではアプリをそのまま使えるようにしてある
 * （端末内の未同期の変更は URL ごとに別なので、古い URL で同期を済ませてから移ってもらう）
 */
export default function MovedNotice() {
  const [hidden, setHidden] = useState(false)
  if (hidden || !OLD_HOSTS.includes(location.hostname)) return null
  return (
    <div className="moved-notice" role="status">
      <p>
        <strong>アプリの URL が変わりました</strong>
        <br />
        新しい URL：<a href={NEW_ORIGIN}>{NEW_ORIGIN.replace('https://', '')}</a>
      </p>
      <p className="small muted">
        この URL で書いた変更が「同期済み」になっていることを確かめてから移ってください。新しい URL ではログインし直し、
        ホーム画面に追加している場合は追加し直してください。
      </p>
      <div className="moved-actions">
        <button className="ghost small-btn" onClick={() => setHidden(true)}>
          あとで
        </button>
        <button className="primary small-btn" onClick={() => location.assign(NEW_ORIGIN)}>
          新しい URL を開く
        </button>
      </div>
    </div>
  )
}
