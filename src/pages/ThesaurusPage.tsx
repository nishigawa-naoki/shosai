import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useUid } from '../lib/auth'
import { createThesaurusEntry, thesaurusPath, useCollection, type ThesaurusEntry } from '../lib/db'
import { searchThesaurus } from '../lib/thesaurus'

export default function ThesaurusPage() {
  const uid = useUid()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { items, loading } = useCollection<ThesaurusEntry>(thesaurusPath(uid), 'updatedAt', 'desc')
  const results = useMemo(() => searchThesaurus(items, query), [items, query])

  const add = () => navigate(`/thesaurus/${createThesaurusEntry(uid, query.trim())}`)

  return (
    <div className="page">
      <header className="topbar">
        <Link to="/" className="icon-btn" aria-label="作品一覧" title="作品一覧">
          <Icon name="back" />
        </Link>
        <span className="topbar-label">類語帳</span>
      </header>
      <div className="page-title">
        <h1>類語帳</h1>
        <button className="primary" onClick={add}>
          <Icon name="plus" size={16} />
          グループ
        </button>
      </div>

      <label className="search-field">
        <Icon name="search" size={16} />
        <input
          className="search-input"
          type="search"
          value={query}
          placeholder="語で検索（ひらがな・カタカナ区別なし）"
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </label>

      {loading ? (
        <p className="muted">読み込み中…</p>
      ) : results.length === 0 ? (
        <p className="muted">
          {query ? '該当するグループはありません。' : '「＋ グループ」から、見出し語と類語をまとめて登録できます。'}
        </p>
      ) : (
        <ul className="list">
          {results.map(({ entry, words }) => (
            <li key={entry.id}>
              <Link to={`/thesaurus/${entry.id}`} className="list-item column">
                <span className="list-title">{entry.title || '（見出しなし）'}</span>
                <span className="muted small preview-line">{words.map((w) => w.word).join('、')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
