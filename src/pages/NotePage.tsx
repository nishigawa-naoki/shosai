import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import EditorScreen from '../components/EditorScreen'
import Icon from '../components/Icon'
import {
  deleteNote,
  makePreview,
  migrateLegacyDoc,
  NOTE_KIND_LABEL,
  noteBodyPath,
  saveNoteText,
  setNoteKind,
  updateNoteMeta,
  useListMetaSync,
  type NoteKind,
  type NoteMeta,
  type TextSave,
} from '../lib/db'
import { useAutosave } from '../lib/useAutosave'
import { useWorkScope } from '../lib/workScope'

const PLACEHOLDERS: Record<NoteKind, { title: string; body: string }> = {
  character: { title: '名前', body: '年齢、外見、性格、口調、関係…' },
  setting: { title: '項目名', body: '内容' },
  document: { title: '資料タイトル', body: 'プロット、年表、取材メモなど' },
}

export default function NotePage() {
  const { noteId = '' } = useParams()
  // uid はデータの持ち主（共有された作品なら相手）
  const { ownerUid: uid, workId, base, canEdit } = useWorkScope()
  const navigate = useNavigate()
  const meta = useListMetaSync<NoteMeta>(
    useCallback((m) => updateNoteMeta(uid, workId, noteId, m), [uid, workId, noteId]),
  )
  const save = useCallback(
    (v: TextSave) => {
      const m = { title: v.title, preview: makePreview(v.body) }
      return saveNoteText(uid, workId, noteId, v, meta.take(m, v.updatedAt) ? m : null)
    },
    [uid, workId, noteId, meta],
  )
  const doc = useAutosave(noteBodyPath(uid, workId, noteId), save)
  const kind = (doc.data?.kind ?? 'character') as NoteKind
  const backTo = `${base}?tab=notes`

  // 旧形式のメモを直接開いた場合は、その場で本文の文書へ移す
  // 確認が終わるまでは「見つかりません」ではなく読み込み中として扱う
  const [legacyChecked, setLegacyChecked] = useState(false)
  useEffect(() => {
    // 閲覧のみの共有相手は移せない（書き込めない）
    if (!doc.missing || !canEdit) return
    migrateLegacyDoc(uid, workId, 'note', noteId).finally(() => setLegacyChecked(true))
  }, [doc.missing, uid, workId, noteId, canEdit])
  const migrating = doc.missing && canEdit && !legacyChecked

  const remove = () => {
    if (!confirm(`「${doc.title || '無題'}」を削除しますか？`)) return
    doc.discard()
    meta.cancel()
    deleteNote(uid, workId, noteId)
    navigate(backTo, { replace: true })
  }

  return (
    <EditorScreen
      doc={doc}
      migrating={migrating}
      backTo={backTo}
      titlePlaceholder={PLACEHOLDERS[kind].title}
      bodyPlaceholder={PLACEHOLDERS[kind].body}
      defaultFormat="markdown"
      readOnly={!canEdit}
      extra={
        <div className="note-kind">
          {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => (
            <button
              key={k}
              className={k === kind ? 'chip active' : 'chip'}
              disabled={!canEdit}
              onClick={() => k !== kind && setNoteKind(uid, workId, noteId, k)}
            >
              {NOTE_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      }
      menu={
        canEdit && (
          <button className="menu-item danger" onClick={remove}>
            <Icon name="trash" size={16} />
            このメモを削除
          </button>
        )
      }
    />
  )
}
