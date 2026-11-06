import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth'
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth, db, googleProvider } from './firebase'
import { clearUnsavedBackups, hasUnsavedBackups } from './useAutosave'

type AuthState = { user: User | null; loading: boolean }

const AuthContext = createContext<AuthState>({ user: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true })
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), [])
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

/** ログイン済み画面でのみ使う */
export function useUid(): string {
  const { user } = useAuth()
  if (!user) throw new Error('Not signed in')
  return user.uid
}

export async function signIn() {
  try {
    await signInWithPopup(auth, googleProvider)
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, googleProvider)
    } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      throw e
    }
  }
}

const PENDING_WRITES_TIMEOUT_MS = 8000

/**
 * ログアウトし、端末に残っている原稿のキャッシュ（IndexedDB）も消す。
 * 未同期の変更が送り切れない場合（オフラインなど）は確認してから進める。
 * 戻り値 false: 利用者が中止した
 */
export async function logOut(): Promise<boolean> {
  const sent = await Promise.race([
    waitForPendingWrites(db).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), PENDING_WRITES_TIMEOUT_MS)),
  ])
  if (
    (!sent || hasUnsavedBackups()) &&
    !confirm('まだサーバーに保存できていない変更があります。\nこのままログアウトすると、その変更は失われます。続けますか？')
  ) {
    return false
  }

  clearUnsavedBackups()
  await signOut(auth)
  await terminate(db)
  try {
    await clearIndexedDbPersistence(db)
  } catch (e) {
    // 同じアプリを別タブで開いていると消去できない
    console.error(e)
    alert('端末内のデータを消去できませんでした。このアプリを開いている他のタブを閉じてから、もう一度開き直してください。')
  }
  location.reload()
  return true
}
