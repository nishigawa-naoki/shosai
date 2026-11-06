import { useState } from 'react'
import { logOut, syncState, useAuth } from '../lib/auth'
import UnsavedBackups from './UnsavedBackups'

/** 以前の URL。ここで開いたときだけ、新しい URL への移動を案内する */
const OLD_HOSTS = ['novel-editor-c94e8.web.app', 'novel-editor-c94e8.firebaseapp.com']
export const NEW_ORIGIN = 'https://shosai-app.web.app'

/**
 * URL を変えた案内。古い URL ではアプリをそのまま使えるようにしてある。
 * 端末内の未同期の変更は URL ごとに別なので、移る前に同期が済んでいることを確かめる
 * （iPhone ではホーム画面のアプリを消すと、その端末内のデータも消える）
 */
export default function MovedNotice() {
  const { user } = useAuth()
  const [hidden, setHidden] = useState(false)
  const [checking, setChecking] = useState(false)
  // 未同期で止まったときに、保存できなかった編集内容（元の画面を開けないものも含む）を見せる
  const [showUnsaved, setShowUnsaved] = useState(false)
  if (hidden || !OLD_HOSTS.includes(location.hostname)) return null

  const move = async () => {
    setChecking(true)
    try {
      const { sent, unsaved } = await syncState()
      if (!sent) {
        // 送信待ち：オンラインで待てば届く。ここでは捨てさせない（届いた後に衝突すれば、元の画面で解決できる）
        alert('この端末に、まだサーバーに送信できていない変更があります。\nオンラインの状態で少し待ってから、もう一度押してください。')
        return
      }
      if (unsaved) {
        // 送信は済んだのに退避が残っている＝保存を拒否された、または保存先が無くなった編集
        alert(
          'サーバーに保存できなかった変更がこの端末に残っています。\n編集した画面を開いて解決するか、案内の下に表示する内容を控える・捨ててから、もう一度押してください。',
        )
        setShowUnsaved(true)
        return
      }
      // 移った後は古い URL を使わないので、原稿のコピーとログイン状態を消してから移るかを選んでもらう
      if (
        user &&
        confirm(
          'この URL の端末内のデータ（原稿のコピー・ログイン状態）を消してから移りますか？\n\nOK：消してから移る（おすすめ）\nキャンセル：残したまま移る',
        )
      ) {
        await logOut(NEW_ORIGIN)
        return
      }
      location.assign(NEW_ORIGIN)
    } catch (e) {
      console.error(e)
      alert('移動の準備に失敗しました。もう一度お試しください。')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="moved-notice" role="status">
      <p>
        <strong>アプリの URL が変わりました</strong>
        <br />
        新しい URL：{NEW_ORIGIN.replace('https://', '')}
      </p>
      <p className="small muted">
        下のボタンで、この端末の変更がすべて同期済みかを確かめてから移ります。新しい URL ではログインし直してください。
        ホーム画面に追加している場合は、新しい URL で内容を確かめてから、古いアイコンを削除してください。
      </p>
      <div className="moved-actions">
        <button className="ghost small-btn" onClick={() => setHidden(true)}>
          あとで
        </button>
        <button className="primary small-btn" onClick={move} disabled={checking}>
          {checking ? '確認中…' : '新しい URL へ移る'}
        </button>
      </div>
      {/* 'users' の下＝この端末に残っているすべての退避 */}
      {showUnsaved && <UnsavedBackups path="users" />}
    </div>
  )
}
