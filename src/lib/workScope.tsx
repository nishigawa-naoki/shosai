import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { useAuth } from './auth'
import { roleOf, useDocument, workPath, type Work, type WorkRole } from './db'
import { backupsUnder, removeBackupsUnder } from './useAutosave'

/**
 * 作品の画面（作品・話・メモ）で共通の情報。
 * 自分の作品は /works/:workId、共有された作品は /shared/:ownerUid/:workId の下に置く。
 * データはどちらも持ち主の場所（users/{ownerUid}/works/...）にある
 */
export type WorkScope = {
  ownerUid: string
  workId: string
  /** 作品の画面の URL（この下に /episodes/... などが続く） */
  base: string
  work: Work | null
  loading: boolean
  role: WorkRole
  canEdit: boolean
}

const Ctx = createContext<WorkScope | null>(null)

export function useWorkScope(): WorkScope {
  const scope = useContext(Ctx)
  if (!scope) throw new Error('useWorkScope must be used inside WorkScopeRoute')
  return scope
}

/**
 * 共有が解除された（または見つからない）作品。
 * 編集中に解除されると直前の入力は保存できず端末に退避されたまま残るので、控えられるように見せてから消す
 */
function Unavailable({ path }: { path: string }) {
  const [unsaved, setUnsaved] = useState<ReturnType<typeof backupsUnder>>([])
  // 編集画面が外れるときの保存（退避の書き込み）は、この画面の描画より後に走るので、その後で読む
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
  return (
    <div className="page center">
      <p>この作品は見つからないか、共有が解除されています。</p>
      {unsaved.length > 0 && (
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
                removeBackupsUnder(path)
                setUnsaved([])
              }}
            >
              捨てる
            </button>
          </div>
        </div>
      )}
      <Link to="/">作品一覧へ</Link>
    </div>
  )
}

export function WorkScopeRoute() {
  const { ownerUid: sharedOwner, workId = '' } = useParams()
  const { user } = useAuth()
  const uid = user!.uid
  const ownerUid = sharedOwner ?? uid
  const isOwn = ownerUid === uid
  const base = sharedOwner ? `/shared/${sharedOwner}/${workId}` : `/works/${workId}`
  const path = workPath(ownerUid, workId)
  const { data: work, loading } = useDocument<Work>(path)
  const role: WorkRole | null = isOwn ? 'owner' : roleOf(work, user?.email)

  // 値を作り直すと、作品の文書が変わらなくても話・メモの画面全体が描き直されるのでまとめる
  const scope = useMemo<WorkScope | null>(
    () => (role ? { ownerUid, workId, base, work, loading, role, canEdit: role !== 'view' } : null),
    [ownerUid, workId, base, work, loading, role],
  )

  if (!scope) {
    return loading ? <div className="page muted">読み込み中…</div> : <Unavailable path={path} />
  }
  return (
    <Ctx.Provider value={scope}>
      <Outlet />
    </Ctx.Provider>
  )
}
