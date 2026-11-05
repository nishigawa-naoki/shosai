import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import EditorScreen from '../components/EditorScreen'
import Icon from '../components/Icon'
import {
  deleteEpisode,
  episodeBodyPath,
  migrateLegacyDoc,
  saveEpisode,
  updateEpisodeMeta,
  useListMetaSync,
  type EpisodeMeta,
  type TextSave,
} from '../lib/db'
import { countChars } from '../lib/text'
import { useAutosave } from '../lib/useAutosave'
import { useWorkScope } from '../lib/workScope'

/** 作品の更新日時（作品一覧の並び順にだけ使う）は、この間隔より細かくは書かない */
const TOUCH_WORK_INTERVAL_MS = 5 * 60 * 1000

export default function EpisodePage() {
  const { episodeId = '' } = useParams()
  // uid はデータの持ち主（共有された作品なら相手）
  const { ownerUid: uid, workId, base, canEdit } = useWorkScope()
  const navigate = useNavigate()
  const lastTouch = useRef(0)
  const meta = useListMetaSync<EpisodeMeta>(
    useCallback((m) => updateEpisodeMeta(uid, workId, episodeId, m), [uid, workId, episodeId]),
  )
  const save = useCallback(
    (v: TextSave) => {
      const touchWork = v.updatedAt - lastTouch.current >= TOUCH_WORK_INTERVAL_MS
      if (touchWork) lastTouch.current = v.updatedAt
      const m = { title: v.title, charCount: countChars(v.body) }
      return saveEpisode(uid, workId, episodeId, v, { meta: meta.take(m, v.updatedAt) ? m : null, touchWork })
    },
    [uid, workId, episodeId, meta],
  )
  const doc = useAutosave(episodeBodyPath(uid, workId, episodeId), save)

  // 旧形式（一覧用の文書に本文がある）の話を直接開いた場合は、その場で本文の文書へ移す
  // 確認が終わるまでは「見つかりません」ではなく読み込み中として扱う
  const [legacyChecked, setLegacyChecked] = useState(false)
  useEffect(() => {
    // 閲覧のみの共有相手は移せない（書き込めない）
    if (!doc.missing || !canEdit) return
    migrateLegacyDoc(uid, workId, 'episode', episodeId).finally(() => setLegacyChecked(true))
  }, [doc.missing, uid, workId, episodeId, canEdit])
  const migrating = doc.missing && canEdit && !legacyChecked

  const remove = () => {
    if (!confirm(`「${doc.title || '無題'}」を削除しますか？`)) return
    doc.discard()
    meta.cancel()
    deleteEpisode(uid, workId, episodeId)
    navigate(base, { replace: true })
  }

  return (
    <EditorScreen
      doc={doc}
      migrating={migrating}
      backTo={base}
      readOnly={!canEdit}
      titlePlaceholder="話タイトル"
      bodyPlaceholder="本文"
      menu={
        canEdit && (
          <button className="menu-item danger" onClick={remove}>
            <Icon name="trash" size={16} />
            この話を削除
          </button>
        )
      }
    />
  )
}
