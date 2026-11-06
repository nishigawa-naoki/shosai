import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUid } from '../lib/auth'
import { setDocFormat, useSettings } from '../lib/db'
import type { DocFormat } from '../lib/markdown'
import { useFontSize } from '../lib/prefs'
import { useTheme } from '../lib/theme'
import { countChars, formatCount } from '../lib/text'
import type { useAutosave } from '../lib/useAutosave'
import { isChunkLoadError, reloadOnceForUpdate } from './ChunkErrorBoundary'
import Editor, { type EditorApi } from './Editor'
import Icon from './Icon'
import SynonymPanel from './SynonymPanel'
import UnsavedBackups from './UnsavedBackups'

type Props = {
  doc: ReturnType<typeof useAutosave>
  backTo: string
  titlePlaceholder: string
  bodyPlaceholder: string
  /** タイトル行の下に出す追加UI */
  extra?: ReactNode
  /** メニュー内に出す追加ボタン */
  menu?: ReactNode
  /** 類語帳ボタンを出すか（既定: 出す） */
  synonyms?: boolean
  /** フッター左の表示（既定: 文字数） */
  countLabel?: string
  /** ドキュメントに形式が保存されていないときの形式 */
  defaultFormat?: DocFormat
  /** 自動修正（設定で有効にした項目）を使うか。類語帳など文章でないものでは使わない */
  autocorrect?: boolean
  /** 旧形式のデータを移している最中（「見つかりません」ではなく読み込み中として扱う） */
  migrating?: boolean
  /** 閲覧のみ（共有された作品で編集の権限が無い） */
  readOnly?: boolean
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export default function EditorScreen({
  doc,
  backTo,
  titlePlaceholder,
  bodyPlaceholder,
  extra,
  menu,
  synonyms = true,
  countLabel,
  defaultFormat = 'plain',
  autocorrect = true,
  migrating = false,
  readOnly = false,
}: Props) {
  const font = useFontSize()
  const theme = useTheme()
  const online = useOnline()
  const { settings, update: updateSettings } = useSettings(useUid())
  const editor = useRef<EditorApi>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const format: DocFormat = doc.data?.format === 'markdown' || doc.data?.format === 'plain' ? doc.data.format : defaultFormat
  const isMarkdown = format === 'markdown'
  const showPreview = isMarkdown && preview
  // プレビューの描画処理（marked・DOMPurify）は、プレビューを開いたときに初めて読み込む
  const [previewHtml, setPreviewHtml] = useState('')
  useEffect(() => {
    if (!showPreview) return
    let alive = true
    import('../lib/markdownRender')
      .then(({ renderMarkdown }) => alive && setPreviewHtml(renderMarkdown(doc.body)))
      .catch((e) => {
        if (isChunkLoadError(e) && reloadOnceForUpdate()) return
        if (alive) setPreviewHtml('<p>プレビューを読み込めませんでした。アプリを開き直してください。</p>')
      })
    return () => {
      alive = false
    }
  }, [showPreview, doc.body])
  // null: 閉じている / string: 開いている（初期検索語）
  const [synQuery, setSynQuery] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // 長文で入力のたびに数え直すと重いので、入力より低い優先度で数える
  const deferredBody = useDeferredValue(doc.body)
  const count = useMemo(() => countChars(deferredBody), [deferredBody])

  if (doc.missing && !migrating) {
    return (
      <div className="page center">
        <p>
          {doc.missingOffline
            ? 'オフラインのため、この端末ではまだ読み込めません。オンラインのときに開いてください。'
            : '見つかりませんでした。'}
        </p>
        {/* 編集中に他の端末で削除されると、直前の入力は保存できずに端末に残る。ここで控える・捨てる */}
        {!doc.missingOffline && <UnsavedBackups path={doc.path} />}
        <Link to={backTo}>戻る</Link>
      </div>
    )
  }
  if (!doc.loaded || doc.missing) return <div className="page muted">読み込み中…</div>

  const status = readOnly
    ? '閲覧のみ'
    : doc.problem
    ? '未保存'
    : !online
      ? 'オフライン（端末に保存済み）'
      : doc.synced
        ? '同期済み'
        : '保存中…'

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(doc.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('コピーできませんでした')
    }
  }

  return (
    <div className="editor-screen">
      <header className="editor-header">
        <Link to={backTo} className="icon-btn" aria-label="戻る" title="戻る">
          <Icon name="back" />
        </Link>
        <input
          className="title-input"
          value={doc.title}
          placeholder={titlePlaceholder}
          onChange={(e) => doc.setTitle(e.target.value)}
          readOnly={readOnly}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {isMarkdown && (
          <button
            className={`icon-btn${showPreview ? ' active' : ''}`}
            aria-label={showPreview ? '編集に戻る' : 'プレビュー'}
            title={showPreview ? '編集に戻る' : 'プレビュー'}
            onClick={() => setPreview((p) => !p)}
          >
            <Icon name={showPreview ? 'pencil' : 'eye'} />
          </button>
        )}
        {synonyms && !readOnly && !showPreview && (
          <button
            className="icon-btn"
            aria-label="類語帳"
            title="類語帳（選択中の語で検索）"
            // mousedown でフォーカスを奪わない（PCで選択範囲を保つ）
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSynQuery(editor.current?.getSelection().trim().split('\n')[0] ?? '')}
          >
            <Icon name="book" />
          </button>
        )}
        <button
          className={`icon-btn${menuOpen ? ' active' : ''}`}
          aria-label="メニュー"
          title="メニュー"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="more" />
        </button>
      </header>
      {menuOpen && (
        <div className="editor-menu" onClick={() => setMenuOpen(false)}>
          <div className="editor-menu-panel" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <Icon name="type" size={16} />
              <span>文字サイズ</span>
              <span className="stepper">
                <button onClick={font.dec} aria-label="小さく">
                  A−
                </button>
                <span className="stepper-value">{font.size}</span>
                <button onClick={font.inc} aria-label="大きく">
                  A＋
                </button>
              </span>
            </div>
            <div className="row">
              <Icon name={theme.resolved === 'dark' ? 'moon' : 'sun'} size={16} />
              <span>表示</span>
              <button className="ghost small-btn" onClick={theme.toggle}>
                {theme.resolved === 'dark' ? 'ライトにする' : 'ダークにする'}
              </button>
            </div>
            <div className="menu-sep" />
            <label className="row toggle">
              <Icon name="file" size={16} />
              <span>Markdown</span>
              <input
                type="checkbox"
                className="switch"
                checked={isMarkdown}
                disabled={readOnly}
                onChange={(e) => {
                  setDocFormat(doc.path, e.target.checked ? 'markdown' : 'plain')
                  if (!e.target.checked) setPreview(false)
                }}
              />
            </label>
            {isMarkdown && (
              <label className="row toggle sub">
                <span>
                  入力補助
                  <span className="muted small block">リスト・引用の自動継続（全体設定）</span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.markdownAssist}
                  onChange={(e) => updateSettings({ markdownAssist: e.target.checked })}
                />
              </label>
            )}
            <div className="menu-sep" />
            <button className="menu-item" onClick={copyBody}>
              <Icon name="copy" size={16} />
              {copied ? 'コピーしました' : '本文をコピー'}
            </button>
            <Link to="/settings" className="menu-item">
              <Icon name="settings" size={16} />
              自動修正などの設定
            </Link>
            {menu && <div className="menu-sep" />}
            {menu}
          </div>
        </div>
      )}
      {doc.problem && readOnly && (
        // 編集中に「閲覧のみ」に変えられた：手元の版はもう保存できないので、控えるか捨てるかだけを選ばせる
        <div className="problem-banner" role="alert">
          <p>編集の権限が「閲覧のみ」に変わったため、直前の編集内容を保存できませんでした。</p>
          <p className="small">必要なら本文をコピーして控えてから、サーバーの版を読み込んでください。</p>
          <div className="problem-actions">
            <button className="primary" onClick={copyBody}>
              {copied ? 'コピーしました' : '本文をコピー'}
            </button>
            <button onClick={() => confirm('この画面の内容を捨てて、サーバーの版を読み込みます。') && doc.takeServer()}>
              サーバーの版を読み込む
            </button>
          </div>
        </div>
      )}
      {doc.problem && !readOnly && (
        <div className="problem-banner" role="alert">
          <p>{doc.problem}</p>
          <p className="small">
            この画面の内容は端末に残してあります（自動保存は止まっています）。どちらの版を残すか選んでください。
          </p>
          <div className="problem-actions">
            <button className="primary" onClick={doc.keepMine}>
              この画面の版で保存
            </button>
            <button
              onClick={() =>
                confirm('この画面の内容を捨てて、サーバーの最新版を読み込みます。\n必要ならメニューの「本文をコピー」で先に控えてください。') &&
                doc.takeServer()
              }
            >
              サーバーの版を読み込む
            </button>
          </div>
        </div>
      )}
      {extra}
      <main className="editor-main">
        {/* プレビュー中もエディタは破棄せず隠すだけ（Undo 履歴を保つ） */}
        <div className="editor-pane" hidden={showPreview}>
          <Editor
            value={doc.body}
            onChange={doc.setBody}
            placeholder={bodyPlaceholder}
            apiRef={editor}
            markdown={isMarkdown}
            markdownAssist={settings.markdownAssist}
            autocorrect={autocorrect ? settings.autocorrect : undefined}
            readOnly={readOnly}
          />
        </div>
        {showPreview && <div className="md-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />}
      </main>
      {synQuery !== null && (
        <SynonymPanel
          initialQuery={synQuery}
          onClose={() => setSynQuery(null)}
          onPick={(word) => {
            setSynQuery(null)
            editor.current?.replaceSelection(word)
          }}
        />
      )}
      <footer className="editor-footer">
        <span className="count">{countLabel ?? formatCount(count)}</span>
        <span className={`status ${readOnly ? '' : doc.problem || !online ? 'offline' : doc.synced ? 'ok' : 'saving'}`}>
          {status}
        </span>
      </footer>
    </div>
  )
}
