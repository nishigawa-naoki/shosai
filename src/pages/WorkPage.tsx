import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import PromptDialog from '../components/PromptDialog'
import ShareDialog from '../components/ShareDialog'
import { useAuth } from '../lib/auth'
import {
  createChapter,
  createEpisode,
  createNote,
  deleteChapter,
  deleteWork,
  episodesPath,
  insertEpisode,
  isChapter,
  renameChapter,
  loadEpisodeBodies,
  makePreview,
  migrateLegacyBodies,
  NOTE_KIND_LABEL,
  notesPath,
  moveItem,
  renameWork,
  setShares,
  SHARE_ROLE_LABEL,
  sharesOf,
  useCollection,
  type Episode,
  type Note,
  type NoteKind,
  type Share,
} from '../lib/db'
import { downloadText, formatCount, safeFilename } from '../lib/text'
import { useWorkScope } from '../lib/workScope'

type Tab = 'episodes' | 'notes'

function nextOrder(items: { order: number }[]) {
  return items.reduce((m, i) => Math.max(m, i.order), 0) + 1
}

/** 章の見出しごとの、その章に入る話の数と文字数（次の見出しまで） */
function chapterStats(items: Episode[]) {
  const stats = new Map<string, { episodes: number; chars: number }>()
  let current: { episodes: number; chars: number } | null = null
  for (const e of items) {
    if (isChapter(e)) {
      current = { episodes: 0, chars: 0 }
      stats.set(e.id, current)
    } else if (current) {
      current.episodes++
      current.chars += e.charCount ?? 0
    }
  }
  return stats
}

/** index の見出しの章の末尾（次の見出しの直前）の、一覧の中の位置 */
function chapterEnd(items: Episode[], index: number) {
  const next = items.findIndex((e, i) => i > index && isChapter(e))
  return next === -1 ? items.length : next
}

type ChapterDialog = { mode: 'new' } | { mode: 'edit'; chapter: Episode }

function OrderButtons<T extends { id: string; order: number }>({
  items,
  index,
  path,
}: {
  items: T[]
  index: number
  path: string
}) {
  const { canEdit } = useWorkScope()
  if (!canEdit) return null
  return (
    <span className="order-btns">
      <button
        className="icon-btn small"
        aria-label="上へ"
        disabled={index === 0}
        onClick={() => moveItem(path, items, index, index - 1)}
      >
        <Icon name="up" size={16} />
      </button>
      <button
        className="icon-btn small"
        aria-label="下へ"
        disabled={index === items.length - 1}
        onClick={() => moveItem(path, items, index, index + 1)}
      >
        <Icon name="down" size={16} />
      </button>
    </span>
  )
}

export default function WorkPage() {
  // uid はデータの持ち主（共有された作品なら相手）
  const { ownerUid: uid, workId, base, work, loading, role, canEdit } = useWorkScope()
  const isOwner = role === 'owner'
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'notes' ? 'notes' : 'episodes'
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [chapterDialog, setChapterDialog] = useState<ChapterDialog | null>(null)

  const epPath = episodesPath(uid, workId)
  const ntPath = notesPath(uid, workId)
  // 一覧の読み込み中に追加すると order が既存と重なるので、読み込み完了まで追加させない
  const { items: episodes, loading: episodesLoading } = useCollection<Episode>(epPath, 'order')
  const { items: notes, loading: notesLoading } = useCollection<Note>(ntPath, 'order')
  const [exporting, setExporting] = useState(false)

  // 旧形式（一覧用の文書に本文を持っていた）の話・メモが残っていれば、本文の文書へ移す
  // 移行済みの印がある作品では問い合わせない（読み取り回数を増やさない）
  // 閲覧のみの共有相手は書き込めないので移さない
  const needsMigration = work !== null && !work.bodiesSplit && canEdit
  useEffect(() => {
    if (needsMigration) migrateLegacyBodies(uid, workId)
  }, [needsMigration, uid, workId])

  if (loading) return <div className="page muted">読み込み中…</div>
  if (!work) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">作品一覧へ</Link>
      </div>
    )
  }

  const total = episodes.reduce((s, e) => s + (e.charCount ?? 0), 0)
  const episodeCount = episodes.filter((e) => !isChapter(e)).length
  const chapters = chapterStats(episodes)

  const rename = (title: string) => {
    setRenaming(false)
    if (title.trim() && title.trim() !== work.title) renameWork(uid, workId, title.trim())
  }

  const remove = async () => {
    if (!confirm(`「${work.title}」を削除しますか？\n本文・メモもすべて削除され、元に戻せません。`)) return
    await deleteWork(uid, workId)
    navigate('/', { replace: true })
  }

  // 一覧では本文を読み込まないので、書き出すときにまとめて読む
  const exportText = async () => {
    setExporting(true)
    try {
      const bodies = await loadEpisodeBodies(uid, workId)
      // オフラインでは、この端末でまだ開いていない話の本文が無い。空のまま書き出さずに知らせる
      const missing = episodes.filter((e) => !isChapter(e) && !bodies.has(e.id) && e.body === undefined)
      if (missing.length) {
        alert(
          `オフラインのため、この端末でまだ開いていない話（${missing.length}話）の本文を読み込めません。
オンラインのときに書き出してください。`,
        )
        return
      }
      const parts = [
        work.title,
        ...episodes.map((e) =>
          isChapter(e) ? `■ ${e.title || '無題の章'}` : `${e.title || '無題'}\n\n${bodies.get(e.id) ?? e.body ?? ''}`,
        ),
      ]
      downloadText(`${safeFilename(work.title)}.txt`, parts.join('\n\n\n'))
    } catch (e) {
      console.error(e)
      alert('書き出しに失敗しました。')
    } finally {
      setExporting(false)
    }
  }

  const saveShares = (shares: Share[]) => {
    setSharing(false)
    // オフラインでは送信できるまで完了しない。端末内には即時反映されるので待たない
    setShares(uid, workId, user?.email ?? '', shares).catch((e) => {
      console.error(e)
      alert('共有の設定を保存できませんでした。')
    })
  }

  const addEpisode = () => navigate(`${base}/episodes/${createEpisode(uid, workId, nextOrder(episodes))}`)
  const addEpisodeInChapter = (index: number) => {
    const at = chapterEnd(episodes, index)
    // 最後の章なら末尾への追加と同じ（振り直しの書き込みをしない）
    const id = at === episodes.length ? createEpisode(uid, workId, nextOrder(episodes)) : insertEpisode(uid, workId, episodes, at)
    navigate(`${base}/episodes/${id}`)
  }

  const submitChapter = (title: string) => {
    const d = chapterDialog
    setChapterDialog(null)
    if (!d) return
    const t = title.trim()
    if (d.mode === 'new') createChapter(uid, workId, nextOrder(episodes), t || '無題の章')
    else if (t && t !== d.chapter.title) renameChapter(uid, workId, d.chapter.id, t)
  }
  const removeChapter = (chapter: Episode) => {
    if (!confirm(`章「${chapter.title || '無題の章'}」の見出しを削除しますか？\n章の中の話は削除されず、そのまま残ります。`)) return
    setChapterDialog(null)
    deleteChapter(uid, workId, chapter.id)
  }
  const addNote = (kind: NoteKind) => navigate(`${base}/notes/${createNote(uid, workId, kind, nextOrder(notes))}`)
  const shareCount = work.sharedWith?.length ?? 0

  return (
    <div className="page">
      <header className="topbar">
        <Link to="/" className="icon-btn" aria-label="作品一覧" title="作品一覧">
          <Icon name="back" />
        </Link>
        <span className="topbar-label">{isOwner ? '作品' : '共有された作品'}</span>
      </header>
      <div className="page-title page-header">
        <h1 className="grow">{work.title}</h1>
        {isOwner ? (
          <>
            <button className="ghost" onClick={() => setSharing(true)} title="共有の設定">
              <Icon name="users" size={16} />
              {shareCount > 0 ? `共有中（${shareCount}人）` : '共有'}
            </button>
            <button className="ghost" onClick={() => setRenaming(true)} title="作品名を変更">
              <Icon name="pencil" size={16} />
              名前を変更
            </button>
          </>
        ) : (
          <span className="badge" title={work.ownerEmail ? `持ち主: ${work.ownerEmail}` : undefined}>
            {SHARE_ROLE_LABEL[role === 'edit' ? 'edit' : 'view']}
          </span>
        )}
      </div>
      {!isOwner && work.ownerEmail && <p className="muted small shared-by">{work.ownerEmail} さんから共有</p>}
      {sharing && user?.email && (
        <ShareDialog
          initial={sharesOf(work)}
          selfEmail={user.email}
          onSave={saveShares}
          onCancel={() => setSharing(false)}
        />
      )}
      {renaming && (
        <PromptDialog
          title="作品名を変更"
          initialValue={work.title}
          okLabel="変更"
          onSubmit={rename}
          onCancel={() => setRenaming(false)}
        />
      )}

      <nav className="tabs">
        <button className={tab === 'episodes' ? 'active' : ''} onClick={() => setParams({}, { replace: true })}>
          本文
        </button>
        <button
          className={tab === 'notes' ? 'active' : ''}
          onClick={() => setParams({ tab: 'notes' }, { replace: true })}
        >
          設定・資料
        </button>
      </nav>

      {tab === 'episodes' ? (
        <section>
          <div className="section-bar">
            <span className="stats">
              {chapters.size > 0 && (
                <>
                  <strong>{chapters.size}</strong> 章<span className="dot">・</span>
                </>
              )}
              <strong>{episodeCount}</strong> 話<span className="dot">・</span>
              <strong>{total.toLocaleString('ja-JP')}</strong> 字
            </span>
            {canEdit && (
              <span className="section-actions">
                <button className="ghost" onClick={() => setChapterDialog({ mode: 'new' })} disabled={episodesLoading}>
                  <Icon name="plus" size={16} />
                  章を追加
                </button>
                <button className="primary" onClick={() => addEpisode()} disabled={episodesLoading}>
                  <Icon name="plus" size={16} />
                  話を追加
                </button>
              </span>
            )}
          </div>
          {chapterDialog && (
            <PromptDialog
              title={chapterDialog.mode === 'new' ? '新しい章' : '章の名前を変更'}
              initialValue={chapterDialog.mode === 'edit' ? chapterDialog.chapter.title : ''}
              placeholder="章の名前（例：第一章　出会い）"
              okLabel={chapterDialog.mode === 'new' ? '追加' : '変更'}
              onSubmit={submitChapter}
              onCancel={() => setChapterDialog(null)}
              onDelete={chapterDialog.mode === 'edit' ? () => removeChapter(chapterDialog.chapter) : undefined}
              deleteLabel="章を削除"
            />
          )}
          <ul className="list">
            {(() => {
              let no = 0
              // 最初の見出しより前の話は、どの章にも入らない（字下げしない）
              let inChapter = false
              return episodes.map((e, i) => {
                if (isChapter(e)) {
                  inChapter = true
                  const s = chapters.get(e.id)
                  return (
                    <li key={e.id} className="list-row chapter-row">
                      <span className="list-item">
                        <span className="list-title chapter-title">{e.title || '無題の章'}</span>
                        <span className="muted small count">
                          {s?.episodes ?? 0}話・{formatCount(s?.chars ?? 0)}
                        </span>
                      </span>
                      {canEdit && (
                        <>
                          <button
                            className="icon-btn small"
                            aria-label="この章の最後に話を追加"
                            title="この章の最後に話を追加"
                            disabled={episodesLoading}
                            onClick={() => addEpisodeInChapter(i)}
                          >
                            <Icon name="plus" size={16} />
                          </button>
                          <button
                            className="icon-btn small"
                            aria-label="章の名前を変更・削除"
                            title="章の名前を変更・削除"
                            onClick={() => setChapterDialog({ mode: 'edit', chapter: e })}
                          >
                            <Icon name="pencil" size={16} />
                          </button>
                        </>
                      )}
                      <OrderButtons items={episodes} index={i} path={epPath} />
                    </li>
                  )
                }
                no++
                return (
                  <li key={e.id} className={`list-row${inChapter ? ' in-chapter' : ''}`}>
                    <Link to={`${base}/episodes/${e.id}`} className="list-item">
                      <span className="ep-no">{no}</span>
                      <span className="list-title">{e.title || '無題'}</span>
                      <span className="muted small count">{formatCount(e.charCount ?? 0)}</span>
                    </Link>
                    <OrderButtons items={episodes} index={i} path={epPath} />
                  </li>
                )
              })
            })()}
          </ul>
        </section>
      ) : (
        <section>
          {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((kind) => {
            const list = notes.filter((n) => n.kind === kind)
            return (
              <div key={kind} className="note-group">
                <div className="section-bar">
                  <h2>{NOTE_KIND_LABEL[kind]}</h2>
                  {canEdit && (
                    <button className="ghost" onClick={() => addNote(kind)} disabled={notesLoading}>
                      <Icon name="plus" size={16} />
                      追加
                    </button>
                  )}
                </div>
                {list.length === 0 && <p className="muted small empty-inline">まだありません</p>}
                <ul className="list">
                  {list.map((n, i) => (
                    <li key={n.id} className="list-row">
                      <Link to={`${base}/notes/${n.id}`} className="list-item column">
                        <span className="list-title">{n.title || '無題'}</span>
                        <span className="muted small preview-line">{n.preview ?? makePreview(n.body ?? '')}</span>
                      </Link>
                      <OrderButtons items={list} index={i} path={ntPath} />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      )}

      <footer className="page-footer">
        <button className="ghost" onClick={exportText} disabled={exporting}>
          <Icon name="download" size={16} />
          {exporting ? '書き出し中…' : 'テキストで書き出し'}
        </button>
        {isOwner && (
          <button className="ghost danger" onClick={remove}>
            <Icon name="trash" size={16} />
            作品を削除
          </button>
        )}
      </footer>
    </div>
  )
}
