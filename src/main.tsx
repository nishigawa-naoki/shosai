import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import ChunkErrorBoundary, { reloadOnceForUpdate } from './components/ChunkErrorBoundary'
import UpdateBanner from './components/UpdateBanner'
import { isFirebaseConfigured } from './lib/config'
import { applyTheme } from './lib/theme'
import './index.css'

// 描画前に明るさの設定を反映（ちらつき防止）
applyTheme()

// 部品の先読みに失敗した（更新直後に古い版の JS を読みに行った）ときは、一度だけ再読み込みする。
// アプリ本体（App）の読み込みにも効くよう、最初に登録する
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnceForUpdate()) e.preventDefault()
})

// iPhone / iPad の Safari は、16px 未満の入力欄にフォーカスすると自動で拡大する。
// maximum-scale=1 で止められる（iOS では指でのピンチ拡大は引き続き使える）。
// Android では同じ指定でピンチ拡大まで止まってしまうので、iOS のときだけ付ける
const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
if (isIOS) {
  const viewport = document.querySelector('meta[name="viewport"]')
  viewport?.setAttribute('content', `${viewport.getAttribute('content')}, maximum-scale=1`)
}

// Firebase の設定が無い状態で初期化するとエラーになるため、設定済みのときだけ読み込む
const App = lazy(() => import('./App'))

function SetupNeeded() {
  return (
    <div className="page">
      <h1>セットアップが必要です</h1>
      <p>
        <code>.env.local</code> に Firebase の設定がありません。README の手順に沿って設定してから開発サーバーを再起動してください。
      </p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UpdateBanner />
    {isFirebaseConfigured ? (
      // アプリ本体を読み込めなかったときも真っ白にしない（再読み込み・案内を出す）
      <ChunkErrorBoundary>
        <Suspense fallback={<div className="page muted">読み込み中…</div>}>
          <App />
        </Suspense>
      </ChunkErrorBoundary>
    ) : (
      <SetupNeeded />
    )}
  </StrictMode>,
)
