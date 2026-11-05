import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import EditorScreen from '../components/EditorScreen'
import Icon from '../components/Icon'
import { useUid } from '../lib/auth'
import { deleteThesaurusEntry, saveThesaurusEntry, thesaurusEntryPath, type TextSave } from '../lib/db'
import { parseWords } from '../lib/thesaurus'
import { useAutosave } from '../lib/useAutosave'

export default function ThesaurusEntryPage() {
  const { entryId = '' } = useParams()
  const uid = useUid()
  const navigate = useNavigate()
  const location = useLocation()
  // 執筆画面のパネルから来た場合はそこへ戻る（アプリ内のパスのみ受け付ける。"//" や "/\" は外部扱いになり得るので除外）
  const from = (location.state as { from?: unknown } | null)?.from
  const backTo = typeof from === 'string' && /^\/(?![/\\])/.test(from) ? from : '/thesaurus'

  const save = useCallback((v: TextSave) => saveThesaurusEntry(uid, entryId, v), [uid, entryId])
  const doc = useAutosave(thesaurusEntryPath(uid, entryId), save)
  const wordCount = useMemo(() => parseWords(doc.body).length, [doc.body])

  const remove = () => {
    if (!confirm(`類語グループ「${doc.title || '見出しなし'}」を削除しますか？`)) return
    doc.discard()
    deleteThesaurusEntry(uid, entryId)
    navigate(backTo, { replace: true })
  }

  return (
    <EditorScreen
      doc={doc}
      backTo={backTo}
      titlePlaceholder="見出し語（例：笑う）"
      bodyPlaceholder={'1行に1語。「：」の後ろはメモ\n\n微笑む：声を出さずに\n嗤う：あざけって\n吹き出す、噴き出す\n破顔する'}
      synonyms={false}
      autocorrect={false}
      countLabel={`${wordCount}語`}
      menu={
        <button className="menu-item danger" onClick={remove}>
          <Icon name="trash" size={16} />
          このグループを削除
        </button>
      }
    />
  )
}
