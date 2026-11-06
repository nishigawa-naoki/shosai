import { doc, onSnapshot, type DocumentData } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TextSave } from './db'
import { db } from './firebase'

export type TitleBody = { title: string; body: string }

const SAVE_DELAY_MS = 800

// ---- 送信中の内容の退避 ----
// 書き込みがサーバーに拒否されると、Firestore は端末内の内容をサーバーの版に巻き戻す。
// アプリを閉じた後に拒否されることもあるので、確定するまでの内容を localStorage に残しておく。

const BACKUP_PREFIX = 'novel-editor:unsaved:'
/** updatedAt: 送ろうとした版 / base: その編集の元にした版（古い退避には無い） */
type Backup = TitleBody & { updatedAt: number; base?: number | null }
/** 元の版が分からない（＝開き直したときに必ず確認する）ことを表す値 */
const UNKNOWN_BASE = -1

function readBackup(path: string): Backup | null {
  try {
    const raw = localStorage.getItem(BACKUP_PREFIX + path)
    return raw ? (JSON.parse(raw) as Backup) : null
  } catch {
    return null
  }
}

function writeBackup(path: string, v: Backup) {
  try {
    localStorage.setItem(BACKUP_PREFIX + path, JSON.stringify(v))
  } catch {
    // 容量超過などで残せなくても保存処理は続ける。
    // ひとつ前の版の退避が残っていると、開き直したときにそちらを新しい版と取り違えるので消す
    try {
      localStorage.removeItem(BACKUP_PREFIX + path)
    } catch {
      /* noop */
    }
  }
}

/** updatedAt を指定した場合は、その版の退避だけを消す（後から送った版の退避は残す） */
function removeBackup(path: string, updatedAt?: number) {
  try {
    if (updatedAt !== undefined && readBackup(path)?.updatedAt !== updatedAt) return
    localStorage.removeItem(BACKUP_PREFIX + path)
  } catch {
    /* noop */
  }
}

function backupKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(BACKUP_PREFIX))
  } catch {
    return []
  }
}

/** サーバーに保存できていない編集が端末に残っているか */
export function hasUnsavedBackups(): boolean {
  return backupKeys().length > 0
}

export function clearUnsavedBackups() {
  backupKeys().forEach((k) => localStorage.removeItem(k))
}

/** 削除した文書（とその配下）の退避を消す。pathPrefix は文書のパス */
export function removeBackupsUnder(pathPrefix: string) {
  const key = BACKUP_PREFIX + pathPrefix
  backupKeys()
    .filter((k) => k === key || k.startsWith(key + '/'))
    .forEach((k) => localStorage.removeItem(k))
}

/** 文書（とその配下）の退避の一覧。共有が解除されて開けなくなった作品の、保存できなかった編集を見せるため */
export function backupsUnder(pathPrefix: string): (TitleBody & { path: string })[] {
  const key = BACKUP_PREFIX + pathPrefix
  return backupKeys()
    .filter((k) => k === key || k.startsWith(key + '/'))
    .flatMap((k) => {
      const path = k.slice(BACKUP_PREFIX.length)
      const b = readBackup(path)
      return b ? [{ path, title: b.title, body: b.body }] : []
    })
}

function describeError(e: unknown): string {
  const code = (e as { code?: string }).code ?? ''
  if (code === 'permission-denied') {
    return '保存できませんでした。他の端末で先に更新されたか、共有された作品で編集の権限が無くなった可能性があります。'
  }
  if (code === 'invalid-argument' || code === 'resource-exhausted') {
    return '文章が長すぎて保存できませんでした（1つの文書は約1MBまで）。短くしてから「この画面の版で保存」を押してください。'
  }
  if (code === 'not-found') return '保存先の文書が削除されています。'
  return `保存できませんでした（${code || 'unknown'}）。`
}

/**
 * タイトル＋本文を持つドキュメントを開いて編集・自動保存する。
 * - 入力が止まって SAVE_DELAY_MS 後に保存。画面離脱・バックグラウンド化で即保存
 * - 未保存・送信中の入力が無いときだけ、他端末からの更新を取り込む
 * - 保存は「編集の元にした版」を添えて送り、他端末の更新を上書きしそうなときはルールで拒否される。
 *   拒否・失敗したら手元の内容を残したまま problem を立て、利用者に選ばせる
 */
export function useAutosave(path: string, save: (v: TextSave) => Promise<void>) {
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  /** 文書が無いのは、オフラインで端末にまだ読み込んでいないため（サーバーには有るかもしれない） */
  const [missingOffline, setMissingOffline] = useState(false)
  const [synced, setSynced] = useState(true)
  const [title, setTitleState] = useState('')
  const [body, setBodyState] = useState('')
  const [data, setData] = useState<DocumentData | null>(null)
  const [problem, setProblemState] = useState<string | null>(null)

  const latest = useRef<TitleBody>({ title: '', body: '' })
  const dirty = useRef(false)
  const inflight = useRef(0)
  /** 手元の文章の元になった版の updatedAt */
  const base = useRef<number | null>(null)
  /** 最後に見えたサーバー側の版（未送信の書き込みを含まない） */
  const server = useRef<{ v: TitleBody; updatedAt: number | null } | null>(null)
  const problemRef = useRef<string | null>(null)
  const loadedRef = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])

  const setProblem = useCallback((p: string | null) => {
    problemRef.current = p
    setProblemState(p)
  }, [])

  const apply = useCallback((v: TitleBody) => {
    latest.current = v
    setTitleState(v.title)
    setBodyState(v.body)
  }, [])

  const flush = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    if (!dirty.current) return
    dirty.current = false
    const v = latest.current
    const updatedAt = Date.now()
    // 問題の解決待ちの間は送らず、端末に退避するだけ（元の版は不明扱いにして、開き直しても確認を求める）
    writeBackup(path, { ...v, updatedAt, base: problemRef.current ? UNKNOWN_BASE : base.current })
    if (problemRef.current) return

    const input: TextSave = { ...v, updatedAt, baseUpdatedAt: base.current }
    base.current = updatedAt
    inflight.current++
    setSynced(false)
    saveRef.current(input).then(
      () => {
        inflight.current--
        removeBackup(path, updatedAt)
        if (inflight.current === 0 && !dirty.current) setSynced(true)
      },
      (e) => {
        inflight.current--
        console.error(e)
        setProblem(describeError(e))
      },
    )
  }, [path, setProblem])

  useEffect(() => {
    loadedRef.current = false
    setLoaded(false)
    setMissing(false)
    return onSnapshot(doc(db, path), { includeMetadataChanges: true }, (snap) => {
      if (!snap.exists()) {
        setMissing(true)
        setMissingOffline(snap.metadata.fromCache)
        return
      }
      setMissing(false)
      const d = snap.data()
      setData(d)
      const pending = snap.metadata.hasPendingWrites
      const remote: TitleBody = { title: d.title ?? '', body: d.body ?? '' }
      const remoteUpdatedAt = typeof d.updatedAt === 'number' ? d.updatedAt : null
      if (!pending) server.current = { v: remote, updatedAt: remoteUpdatedAt }

      const idle = !pending && inflight.current === 0 && !dirty.current
      setSynced(idle)

      if (!loadedRef.current) {
        loadedRef.current = true
        setLoaded(true)
        const backup = readBackup(path)
        // 退避の版が文書の版と違う＝前回の編集内容が保存されていない（拒否された・送らずに止めていた）。
        // pending でも、未送信分が本文の書き込みなら d.updatedAt はその版になり退避と一致するので、
        // 一致しない場合は本文以外の書き込み（形式・種類・並び順）が残っているだけで、退避の方が新しい
        if (backup && backup.updatedAt !== remoteUpdatedAt) {
          apply(backup)
          if (!pending && backup.base === remoteUpdatedAt) {
            // 文書はこの編集の元にした版のまま＝他の端末は触っていない。
            // 書き込みが届く前に画面を閉じただけなので、確認せずにそのまま保存し直す
            base.current = remoteUpdatedAt
            dirty.current = true
            flush()
            return
          }
          base.current = pending ? null : remoteUpdatedAt
          setProblem('前回の編集内容がサーバーに保存されていません。他の端末で更新された可能性があります。')
          return
        }
        if (backup && !pending) removeBackup(path)
        // pending の場合、d は端末内の未送信分を含んだ内容。updatedAt もその版のもの
        apply(remote)
        base.current = remoteUpdatedAt
        return
      }

      if (!idle || problemRef.current) return
      const backup = readBackup(path)
      if (backup) {
        if (backup.updatedAt === remoteUpdatedAt) {
          removeBackup(path)
        } else {
          // 端末に残っていた未送信分が拒否され、サーバーの版に巻き戻された
          setProblem('編集内容をサーバーに保存できませんでした。他の端末で更新された可能性があります。')
          return
        }
      }
      if (remote.title !== latest.current.title || remote.body !== latest.current.body) apply(remote)
      base.current = remoteUpdatedAt
    })
  }, [path, apply, setProblem, flush])

  const schedule = useCallback(() => {
    dirty.current = true
    setSynced(false)
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
  }, [flush])

  const setTitle = useCallback(
    (v: string) => {
      latest.current = { ...latest.current, title: v }
      setTitleState(v)
      schedule()
    },
    [schedule],
  )

  const setBody = useCallback(
    (v: string) => {
      latest.current = { ...latest.current, body: v }
      setBodyState(v)
      schedule()
    },
    [schedule],
  )

  /** 問題の解決：手元の版でサーバーの最新版を上書きする */
  const keepMine = useCallback(() => {
    base.current = server.current?.updatedAt ?? null
    setProblem(null)
    dirty.current = true
    flush()
  }, [flush, setProblem])

  /** 問題の解決：手元の版を捨て、サーバーの最新版を読み込む */
  const takeServer = useCallback(() => {
    const s = server.current
    if (!s) return
    if (timer.current !== undefined) clearTimeout(timer.current)
    dirty.current = false
    removeBackup(path)
    setProblem(null)
    apply(s.v)
    base.current = s.updatedAt
    setSynced(inflight.current === 0)
  }, [path, apply, setProblem])

  /** 文書を削除する直前に呼ぶ：未保存の入力を捨て、離脱時の保存や退避の作り直しをさせない */
  const discard = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
    dirty.current = false
    setProblem(null)
    removeBackup(path)
  }, [path, setProblem])

  // 離脱・バックグラウンド化で即保存
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  return {
    path,
    loaded,
    missing,
    missingOffline,
    synced,
    title,
    body,
    setTitle,
    setBody,
    data,
    problem,
    keepMine,
    takeServer,
    discard,
  }
}
