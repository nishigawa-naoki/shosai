import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import MovedNotice from '../components/MovedNotice'
import PromptDialog from '../components/PromptDialog'
import { logOut, useAuth, useUid } from '../lib/auth'
import { createWork, roleOf, SHARE_ROLE_LABEL, useCollection, useSharedWorks, worksPath, type Work } from '../lib/db'
import { useTheme } from '../lib/theme'

function formatDate(ms: number) {
  return new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function WorksPage() {
  const uid = useUid()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { items: works, loading, error } = useCollection<Work>(worksPath(uid), 'updatedAt', 'desc')
  const { items: shared } = useSharedWorks(user?.email)
  const [adding, setAdding] = useState(false)
  const theme = useTheme()

  const signOutWithConfirm = () => {
    if (!confirm('ログアウトしますか？\nこの端末に保存されている原稿のデータも消去されます。')) return
    logOut().catch((e) => {
      console.error(e)
      alert('ログアウトに失敗しました。')
    })
  }

  // ルールで許可されていないアカウント（所有者以外）でログインした場合
  if (error === 'permission-denied') {
    return (
      <div className="page center">
        <h1>このアカウントでは利用できません</h1>
        <p className="muted">{user?.email} はこのアプリの利用が許可されていません。別のアカウントでログインし直してください。</p>
        <button className="primary" onClick={signOutWithConfirm}>
          ログアウト
        </button>
      </div>
    )
  }

  const add = (title: string) => {
    setAdding(false)
    const id = createWork(uid, title.trim() || '無題の作品')
    navigate(`/works/${id}`)
  }

  return (
    <div className="page">
      <MovedNotice />
      {adding && (
        <PromptDialog
          title="新しい作品"
          placeholder="作品タイトル（あとから変更できます）"
          okLabel="作成"
          onSubmit={add}
          onCancel={() => setAdding(false)}
        />
      )}
      <header className="topbar">
        <span className="brand">
          <Icon name="feather" size={18} />
          執筆帳
        </span>
        <span className="grow" />
        <button className="icon-btn" aria-label="類語帳" title="類語帳" onClick={() => navigate('/thesaurus')}>
          <Icon name="book" />
        </button>
        <button
          className="icon-btn"
          aria-label={theme.resolved === 'dark' ? 'ライトモードにする' : 'ダークモードにする'}
          title={theme.resolved === 'dark' ? 'ライトモードにする' : 'ダークモードにする'}
          onClick={theme.toggle}
        >
          <Icon name={theme.resolved === 'dark' ? 'sun' : 'moon'} />
        </button>
        <Link to="/settings" className="icon-btn" aria-label="設定" title="設定">
          <Icon name="settings" />
        </Link>
      </header>

      <div className="page-title">
        <h1>作品</h1>
        <button className="primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          新しい作品
        </button>
      </div>

      {loading ? (
        <p className="muted">読み込み中…</p>
      ) : works.length === 0 ? (
        <div className="empty">
          <Icon name="feather" size={28} />
          <p>まだ作品がありません</p>
          <p className="muted small">「新しい作品」から書き始めましょう</p>
        </div>
      ) : (
        <ul className="work-grid">
          {works.map((w) => (
            <li key={w.id}>
              <Link to={`/works/${w.id}`} className="work-card list-item">
                <span className="work-title list-title">{w.title || '無題の作品'}</span>
                <span className="muted small">{formatDate(w.updatedAt)} 更新</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {shared.length > 0 && (
        <section className="shared-works">
          <h2>共有された作品</h2>
          <ul className="work-grid">
            {shared.map((w) => (
              <li key={`${w.ownerUid}/${w.id}`}>
                <Link to={`/shared/${w.ownerUid}/${w.id}`} className="work-card list-item">
                  <span className="work-title list-title">{w.title || '無題の作品'}</span>
                  <span className="muted small">
                    {SHARE_ROLE_LABEL[roleOf(w, user?.email) ?? 'view']}
                    {w.ownerEmail && `・${w.ownerEmail}`}
                  </span>
                  <span className="muted small">{formatDate(w.updatedAt)} 更新</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="page-footer muted small">
        <span className="account">
          <Icon name="user" size={14} />
          {user?.email}
        </span>
        <button className="link" onClick={signOutWithConfirm}>
          <Icon name="logout" size={14} />
          ログアウト
        </button>
      </footer>
    </div>
  )
}
