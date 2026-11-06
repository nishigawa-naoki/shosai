import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ChunkErrorBoundary from './components/ChunkErrorBoundary'
import Icon from './components/Icon'
import MovedNotice from './components/MovedNotice'
import { AuthProvider, signIn, useAuth } from './lib/auth'
import { WorkScopeRoute } from './lib/workScope'
import WorkPage from './pages/WorkPage'
import WorksPage from './pages/WorksPage'

// エディタ（CodeMirror など）を使う画面は、開いたときに初めて読み込む。一覧の画面を軽くするため
const EpisodePage = lazy(() => import('./pages/EpisodePage'))
const NotePage = lazy(() => import('./pages/NotePage'))
const ThesaurusEntryPage = lazy(() => import('./pages/ThesaurusEntryPage'))
const ThesaurusPage = lazy(() => import('./pages/ThesaurusPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function Login() {
  const [error, setError] = useState('')
  return (
    <div className="login">
      <MovedNotice />
      <div className="login-card">
        <span className="login-mark">
          <Icon name="feather" size={28} />
        </span>
        <h1>執筆帳</h1>
        <p className="muted">書くことに集中するための、自分だけの原稿帳。</p>
        <button className="primary login-btn" onClick={() => signIn().catch((e) => setError(String(e?.message ?? e)))}>
          Google でログイン
        </button>
        {error && <p className="error small">{error}</p>}
      </div>
    </div>
  )
}

function Routed() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page muted">…</div>
  if (!user) return <Login />
  return (
    // 画面を移ったらエラー表示を解除する
    <ChunkErrorBoundary key={location.pathname}>
    <Suspense fallback={<div className="page muted">読み込み中…</div>}>
      <Routes>
      <Route path="/" element={<WorksPage />} />
      {/* 自分の作品と、共有された作品（持ち主の ID を URL に含む）。中の画面は同じ */}
      {['/works/:workId', '/shared/:ownerUid/:workId'].map((path) => (
        <Route key={path} path={path} element={<WorkScopeRoute />}>
          <Route index element={<WorkPage />} />
          <Route path="episodes/:episodeId" element={<EpisodePage />} />
          <Route path="notes/:noteId" element={<NotePage />} />
        </Route>
      ))}
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/thesaurus" element={<ThesaurusPage />} />
      <Route path="/thesaurus/:entryId" element={<ThesaurusEntryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ChunkErrorBoundary>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
    </AuthProvider>
  )
}
