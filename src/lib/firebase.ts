import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { firebaseConfig } from './config'

// このモジュールは設定が揃っている場合のみ import される（main.tsx 参照）
export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// IndexedDB にキャッシュし、オフラインでも読み書きできるようにする。
// オンライン復帰時に自動で同期される。
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// 開発用：VITE_USE_EMULATOR=true のときはローカルの Firebase エミュレーターにつなぐ（本番ビルドからは除去される）
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  // 自動テスト用：ポップアップを経ずに任意のメールでログインする（エミュレーターは署名なしのトークンを受け付ける）
  Object.assign(window, {
    __emulatorSignIn: (email: string) =>
      signInWithCredential(
        auth,
        GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })),
      ),
  })
}
