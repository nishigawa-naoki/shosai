import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useUid } from '../lib/auth'
import Icon from './Icon'
import { createThesaurusEntry, thesaurusPath, useCollection, type ThesaurusEntry } from '../lib/db'
import { searchThesaurus } from '../lib/thesaurus'

type Props = {
  initialQuery: string
  /** 語をタップしたとき（エディタの選択範囲を置き換える） */
  onPick: (word: string) => void
  onClose: () => void
}

/** エディタ上に出す類語帳の検索パネル */
export default function SynonymPanel({ initialQuery, onPick, onClose }: Props) {
  const uid = useUid()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState(initialQuery)
  const { items, loading } = useCollection<ThesaurusEntry>(thesaurusPath(uid), 'updatedAt', 'desc')
  const results = useMemo(() => searchThesaurus(items, query), [items, query])
  const from = { from: location.pathname + location.search }

  const create = () => {
    const id = createThesaurusEntry(uid, query.trim())
    navigate(`/thesaurus/${id}`, { state: from })
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="類語帳">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <label className="search-field">
          <Icon name="search" size={16} />
          <input
            className="search-input"
            type="search"
            value={query}
            placeholder="類語帳を検索"
            onChange={(e) => setQuery(e.target.value)}
            autoFocus={!initialQuery}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          </label>
          <button className="icon-btn" aria-label="閉じる" title="閉じる" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">
          {loading ? (
            <p className="muted small">読み込み中…</p>
          ) : results.length === 0 ? (
            <p className="muted small">
              {query ? `「${query}」を含むグループはありません。` : '類語帳はまだ空です。'}
            </p>
          ) : (
            results.map(({ entry, words }) => (
              <section key={entry.id} className="syn-group">
                <div className="syn-group-head">
                  <button className="syn-word head" onClick={() => onPick(entry.title)} disabled={!entry.title}>
                    {entry.title || '（見出しなし）'}
                  </button>
                  <Link to={`/thesaurus/${entry.id}`} state={from} className="muted small">
                    編集
                  </Link>
                </div>
                <div className="syn-words">
                  {words.map((w, i) => (
                    <button key={i} className="syn-word" onClick={() => onPick(w.word)} title={w.note || undefined}>
                      {w.word}
                      {w.note && <span className="syn-note">{w.note}</span>}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
          <button className="sheet-add" onClick={create}>
            ＋ {query.trim() ? `「${query.trim()}」の` : '新しい'}類語グループを作る
          </button>
        </div>
      </div>
    </div>
  )
}
