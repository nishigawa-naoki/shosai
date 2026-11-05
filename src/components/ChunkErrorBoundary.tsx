import { Component, type ReactNode } from 'react'

const RELOAD_KEY = 'novel-editor:chunk-reload-at'
/** 再読み込みを始めた（ページが切り替わるまでの間、案内を出さない） */
let reloading = false

/** 部品（JS）の読み込みに失敗したエラーか。アプリの更新直後に、古い画面から消えた部品を読みに行くと起きる */
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  return (
    e?.name === 'ChunkLoadError' ||
    /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload/i.test(
      e?.message ?? '',
    )
  )
}

/** 一度だけ再読み込みする（直前に再読み込みしたばかりなら繰り返さない） */
export function reloadOnceForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 10_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* 保存できなくても再読み込みはする */
  }
  reloading = true
  location.reload()
  return true
}

type State = { failed: boolean; error: unknown }

/**
 * 画面の描画で起きたエラーを受け止め、真っ白にしない。
 * 部品の読み込み失敗なら一度だけ自動で再読み込みする。それ以外のエラーは再読み込みせず案内を出す。
 * 画面を移ったら（呼び出し側で key を変えて）元に戻る
 */
export default class ChunkErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
    if (isChunkLoadError(error)) reloadOnceForUpdate()
  }

  render() {
    if (!this.state.failed) return this.props.children
    if (reloading) return <div className="page muted">読み込み中…</div>
    const chunk = isChunkLoadError(this.state.error)
    return (
      <div className="page center">
        <p>
          {chunk
            ? '画面を読み込めませんでした。アプリが更新された可能性があります。'
            : '画面の表示中に問題が起きました。書いた内容は端末に保存されています。'}
        </p>
        <button className="primary" onClick={() => location.reload()}>
          再読み込み
        </button>
      </div>
    )
  }
}
