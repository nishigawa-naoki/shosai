import { Link } from 'react-router-dom'
import Icon, { type IconName } from '../components/Icon'
import { useUid } from '../lib/auth'
import { AUTOCORRECT_ITEMS } from '../lib/autocorrectRules'
import { useSettings } from '../lib/db'
import { useTheme, type ThemePref } from '../lib/theme'

const THEME_OPTIONS: { value: ThemePref; label: string; icon: IconName }[] = [
  { value: 'light', label: 'ライト', icon: 'sun' },
  { value: 'dark', label: 'ダーク', icon: 'moon' },
  { value: 'system', label: '自動', icon: 'monitor' },
]

/** 表示と入力補助の設定（表示は端末ごと、入力補助は端末間で同期） */
export default function SettingsPage() {
  // 読み込み前に操作すると既定値を元に書き込んでしまうので、読み込むまで操作させない
  const { settings, update, loading } = useSettings(useUid())
  const theme = useTheme()

  return (
    <div className="page">
      <header className="topbar">
        <Link to="/" className="icon-btn" aria-label="作品一覧" title="作品一覧">
          <Icon name="back" />
        </Link>
        <span className="topbar-label">設定</span>
      </header>
      <div className="page-title">
        <h1>設定</h1>
      </div>

      <section className="settings-section theme-section">
        <h2>表示</h2>
        <p className="muted small">この端末だけの設定です。「自動」は端末のライト／ダークに合わせます。</p>
        <div className="segmented" role="radiogroup" aria-label="表示の明るさ">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={theme.pref === o.value}
              className={theme.pref === o.value ? 'active' : ''}
              onClick={() => theme.setPref(o.value)}
            >
              <Icon name={o.icon} size={16} />
              {o.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section autocorrect-section">
        <h2>自動修正</h2>
        <p className="muted small">
          本文・設定メモで、入力した箇所だけを直します（Markdown の文書と類語帳では使いません）。直した直後に Ctrl+Z
          で、修正だけを取り消せます。すべての端末で共通です。
        </p>
        <ul className="list">
          {AUTOCORRECT_ITEMS.map((item) => (
            <li key={item.key}>
              <label className="setting-row">
                <span className="setting-text">
                  <span>{item.label}</span>
                  <span className="muted small">{item.example}</span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.autocorrect[item.key]}
                  disabled={loading}
                  onChange={(e) => update({ autocorrect: { [item.key]: e.target.checked } })}
                />
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-section">
        <h2>Markdown</h2>
        <ul className="list">
          <li>
            <label className="setting-row">
              <span className="setting-text">
                <span>入力補助</span>
                <span className="muted small">リスト・引用の記号を改行時に引き継ぐ</span>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={settings.markdownAssist}
                disabled={loading}
                onChange={(e) => update({ markdownAssist: e.target.checked })}
              />
            </label>
          </li>
        </ul>
      </section>
    </div>
  )
}
