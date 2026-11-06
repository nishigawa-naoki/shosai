import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db } from './firebase'
import { AUTOCORRECT_DEFAULTS, type AutocorrectOptions } from './autocorrectRules'
import type { DocFormat } from './markdown'
import { countChars } from './text'
import { removeBackupsUnder } from './useAutosave'

/**
 * 各ドキュメント（話・メモ・類語グループ）の形式。未設定の場合は種類ごとの既定値を使う
 * （本文: plain / 設定メモ・資料: markdown / 類語帳: plain）
 */
export function setDocFormat(path: string, format: DocFormat) {
  updateDoc(doc(db, path), { format }).catch((e) => console.error(e))
}

// ---- 型 ----
// 日時はクライアント時刻のミリ秒。オフライン時でも即座に並び順が確定するように serverTimestamp は使わない。
//
// 話・メモは「一覧用の文書」（episodes / notes：タイトル・文字数・順番などの小さな情報）と
// 「本文の文書」（episodeBodies / noteBodies：タイトル・本文・形式・版）に分けて持つ。
// 一覧の画面は本文を読み込まないので、長編でも軽い。本文の文書のタイトルが正で、一覧用はその写し。

export type Work = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 本文を本文の文書に分けた形式へ移行済み */
  bodiesSplit?: boolean
  /** 共有相手のアドレス（閲覧のみ＋編集可）。書き換えられるのは持ち主だけ */
  sharedWith?: string[]
  /** 共有相手のうち、編集もできる人 */
  editors?: string[]
  /** 持ち主のアドレス（共有された側の一覧に出す）。共有を設定したときに書く */
  ownerEmail?: string
}

/** 共有された作品（一覧用）。ownerUid は持ち主のユーザー ID */
export type SharedWork = Work & { ownerUid: string }

export type ShareRole = 'edit' | 'view'
export type Share = { email: string; role: ShareRole }
export const SHARE_ROLE_LABEL: Record<ShareRole, string> = { edit: '編集可', view: '閲覧のみ' }
/** ルールの上限と同じ */
export const MAX_SHARES = 20

export const normalizeEmail = (s: string) => s.trim().toLowerCase()

export function sharesOf(work: Work): Share[] {
  const editors = new Set(work.editors ?? [])
  return (work.sharedWith ?? []).map((email) => ({ email, role: editors.has(email) ? 'edit' : 'view' }))
}

/** 作品に対する自分の権限。null は権限なし（共有が解除された・まだ読み込んでいない） */
export type WorkRole = 'owner' | ShareRole
export function roleOf(work: Work | null, email: string | null | undefined): ShareRole | null {
  if (!work || !email) return null
  if (work.editors?.includes(email) && work.sharedWith?.includes(email)) return 'edit'
  return work.sharedWith?.includes(email) ? 'view' : null
}

/** 話の一覧用の情報 */
export type Episode = {
  id: string
  title: string
  order: number
  charCount: number
  updatedAt: number
  /** 旧形式（本文を一覧用の文書に持っていた）の名残。移行が済めば無い */
  body?: string
  /**
   * 'chapter' は章の見出し（本文の文書を持たない）。話の一覧の中に並べ、次の見出しまでの話がその章に入る。
   * 見出しより前の話はどの章にも入らない
   */
  kind?: 'chapter'
}

export const isChapter = (e: Episode) => e.kind === 'chapter'

export type NoteKind = 'character' | 'setting' | 'document'
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  character: 'キャラクター',
  setting: '設定・用語',
  document: '資料',
}

/** メモの一覧用の情報 */
export type Note = {
  id: string
  kind: NoteKind
  title: string
  /** 一覧に出す本文の冒頭 */
  preview?: string
  order: number
  updatedAt: number
  /** 旧形式の名残。移行が済めば無い */
  body?: string
}

const PREVIEW_LENGTH = 40
export const makePreview = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH)

/** 類語帳の1グループ。body は1行1語（「語：メモ」形式も可）。作品をまたいで共通 */
export type ThesaurusEntry = { id: string; title: string; body: string; updatedAt: number }

// ---- パス ----

export const thesaurusPath = (uid: string) => `users/${uid}/thesaurus`
export const thesaurusEntryPath = (uid: string, id: string) => `${thesaurusPath(uid)}/${id}`

export const worksPath = (uid: string) => `users/${uid}/works`
export const workPath = (uid: string, workId: string) => `${worksPath(uid)}/${workId}`
export const episodesPath = (uid: string, workId: string) => `${workPath(uid, workId)}/episodes`
export const episodePath = (uid: string, workId: string, id: string) => `${episodesPath(uid, workId)}/${id}`
export const episodeBodiesPath = (uid: string, workId: string) => `${workPath(uid, workId)}/episodeBodies`
export const episodeBodyPath = (uid: string, workId: string, id: string) => `${episodeBodiesPath(uid, workId)}/${id}`
export const notesPath = (uid: string, workId: string) => `${workPath(uid, workId)}/notes`
export const notePath = (uid: string, workId: string, id: string) => `${notesPath(uid, workId)}/${id}`
export const noteBodiesPath = (uid: string, workId: string) => `${workPath(uid, workId)}/noteBodies`
export const noteBodyPath = (uid: string, workId: string, id: string) => `${noteBodiesPath(uid, workId)}/${id}`

// ---- 購読フック ----

export function useCollection<T extends { id: string }>(
  path: string | null,
  orderField: string,
  dir: 'asc' | 'desc' = 'asc',
) {
  const [state, setState] = useState<{ path: string | null; items: T[]; loading: boolean; error: string | null }>({
    path,
    items: [],
    loading: true,
    error: null,
  })
  useEffect(() => {
    if (!path) return
    const q = query(collection(db, path), orderBy(orderField, dir))
    return onSnapshot(
      q,
      (snap) =>
        setState({
          path,
          items: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T),
          loading: false,
          error: null,
        }),
      (err) => {
        console.error(err)
        setState({ path, items: [], loading: false, error: err.code })
      },
    )
  }, [path, orderField, dir])
  // path が変わった直後は前の結果を返さない
  return state.path === path ? state : { path, items: [] as T[], loading: true, error: null }
}

export function useDocument<T extends { id: string }>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; loading: boolean }>({
    path,
    data: null,
    loading: true,
  })
  useEffect(() => {
    if (!path) return
    return onSnapshot(
      doc(db, path),
      (snap) =>
        setState({
          path,
          data: snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null,
          loading: false,
        }),
      (err) => {
        console.error(err)
        // 端末のキャッシュから先に表示した内容も捨てる（共有が解除された作品などを表示し続けない）
        setState({ path, data: null, loading: false })
      },
    )
  }, [path])
  return state.path === path ? state : { path, data: null as T | null, loading: true }
}

/** 自分に共有された作品の一覧（更新が新しい順） */
export function useSharedWorks(email: string | null | undefined) {
  const [state, setState] = useState<{ email: string | null; items: SharedWork[]; loading: boolean }>({
    email: null,
    items: [],
    loading: true,
  })
  useEffect(() => {
    if (!email) return
    const q = query(collectionGroup(db, 'works'), where('sharedWith', 'array-contains', email))
    return onSnapshot(
      q,
      (snap) =>
        setState({
          email,
          loading: false,
          items: snap.docs
            .map((d) => ({ ...d.data(), id: d.id, ownerUid: d.ref.parent.parent!.id }) as SharedWork)
            .sort((a, b) => b.updatedAt - a.updatedAt),
        }),
      (err) => {
        console.error(err)
        setState({ email, items: [], loading: false })
      },
    )
  }, [email])
  return state.email === email ? state : { email, items: [] as SharedWork[], loading: true }
}

/** 共有の設定を書き換える（持ち主のみ）。shares 全体で置き換える */
export function setShares(ownerUid: string, workId: string, ownerEmail: string, shares: Share[]) {
  return updateDoc(doc(db, workPath(ownerUid, workId)), {
    sharedWith: shares.map((s) => s.email),
    editors: shares.filter((s) => s.role === 'edit').map((s) => s.email),
    ownerEmail,
  })
}

// ---- アカウント共通の設定（端末間で同期） ----

export type Settings = {
  /** Markdown モードでの入力補助（リスト継続など） */
  markdownAssist: boolean
  /** 小説向けの自動修正（項目ごと。既定はすべて無効） */
  autocorrect: AutocorrectOptions
}

const DEFAULT_SETTINGS: Settings = { markdownAssist: false, autocorrect: AUTOCORRECT_DEFAULTS }

type SettingsPatch = { markdownAssist?: boolean; autocorrect?: Partial<AutocorrectOptions> }

export const settingsPath = (uid: string) => `users/${uid}/meta/settings`

export function useSettings(uid: string) {
  const { data, loading } = useDocument<Partial<Settings> & { id: string }>(settingsPath(uid))
  // 書き込みの反映を待たずに画面へ反映する（チェックボックスが一瞬戻るのを防ぐ）
  const [local, setLocal] = useState<SettingsPatch>({})
  const settings: Settings = {
    markdownAssist: local.markdownAssist ?? data?.markdownAssist ?? DEFAULT_SETTINGS.markdownAssist,
    autocorrect: { ...AUTOCORRECT_DEFAULTS, ...data?.autocorrect, ...local.autocorrect },
  }
  /** 変えた項目だけを送る（merge なので他の項目・他端末で変えた項目は上書きしない） */
  const update = (patch: SettingsPatch) => {
    setLocal((l) => ({ ...l, ...patch, autocorrect: { ...l.autocorrect, ...patch.autocorrect } }))
    setDoc(doc(db, settingsPath(uid)), patch, { merge: true })
      // 届いたら手元の上書きを外す（以後は他の端末での変更もそのまま反映する）。その間に変えた項目は残す
      .then(() =>
        setLocal((l) => {
          const next: SettingsPatch = { ...l, autocorrect: { ...l.autocorrect } }
          if (patch.markdownAssist !== undefined && l.markdownAssist === patch.markdownAssist) delete next.markdownAssist
          for (const [k, v] of Object.entries(patch.autocorrect ?? {}) as [keyof AutocorrectOptions, boolean][]) {
            if (next.autocorrect?.[k] === v) delete next.autocorrect[k]
          }
          return next
        }),
      )
      .catch((e) => console.error(e))
  }
  return { settings, update, loading }
}

// ---- 書き込み ----
// オフライン時、書き込みの Promise はサーバー到達まで resolve しない。
// ローカルキャッシュへは即時反映されるので、await せずに投げっぱなしにする。

const report = (e: unknown) => console.error(e)

function newId(path: string) {
  return doc(collection(db, path)).id
}

export function createWork(uid: string, title: string): string {
  const id = newId(worksPath(uid))
  const now = Date.now()
  setDoc(doc(db, workPath(uid, id)), { title, createdAt: now, updatedAt: now, bodiesSplit: true }).catch(report)
  return id
}

export function renameWork(uid: string, workId: string, title: string) {
  updateDoc(doc(db, workPath(uid, workId)), { title, updatedAt: Date.now() }).catch(report)
}

export async function deleteWork(uid: string, workId: string) {
  // 本文の文書は一覧用の文書と同じ id なので、一覧用だけを読んでパスを組み立てる
  // （本文まで読むと、長編では読み取り件数と通信量がかさむ）
  const [eps, notes] = await Promise.all(
    [episodesPath, notesPath].map((p) => getDocs(collection(db, p(uid, workId)))),
  )
  const paths = new Set<string>([
    ...[eps, notes].flatMap((s) => s.docs.map((d) => d.ref.path)),
    // 章の見出しは本文の文書を持たない（無い文書の削除も書き込みとして数えられる）
    ...eps.docs.filter((d) => d.data().kind !== 'chapter').map((d) => episodeBodyPath(uid, workId, d.id)),
    ...notes.docs.map((d) => noteBodyPath(uid, workId, d.id)),
  ])
  const refs = [...paths].map((p) => doc(db, p))
  // writeBatch は 500 件まで
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db)
    refs.slice(i, i + 450).forEach((r) => batch.delete(r))
    batch.commit().catch(report)
  }
  deleteDoc(doc(db, workPath(uid, workId))).catch(report)
  removeBackupsUnder(workPath(uid, workId))
}

export function createEpisode(uid: string, workId: string, order: number, reorder: [string, number][] = []): string {
  const id = newId(episodesPath(uid, workId))
  const now = Date.now()
  let batch = writeBatch(db)
  batch.set(doc(db, episodePath(uid, workId, id)), { title: '', order, charCount: 0, updatedAt: now })
  batch.set(doc(db, episodeBodyPath(uid, workId, id)), { title: '', body: '', updatedAt: now, baseUpdatedAt: null })
  batch.update(doc(db, workPath(uid, workId)), { updatedAt: now })
  // 並びの振り直し。writeBatch は 500 件までなので、多ければ分ける
  reorder.forEach(([itemId, o], i) => {
    if (i > 0 && i % 450 === 0) {
      batch.commit().catch(report)
      batch = writeBatch(db)
    }
    batch.update(doc(db, episodePath(uid, workId, itemId)), { order: o })
  })
  batch.commit().catch(report)
  return id
}

/**
 * 一覧の position 番目に話を挿入する（章の途中への追加）。
 * 間の値の order を使うと、挿入を繰り返すうちに小数の精度が尽きて隣と同じ値になり、並びが崩れる。
 * そこで一覧の order を 1,2,3… に振り直し、変わった分だけ同じ一括書き込みで書く
 */
export function insertEpisode(uid: string, workId: string, items: { id: string; order: number }[], position: number) {
  const reorder: [string, number][] = []
  items.forEach((item, i) => {
    const o = i < position ? i + 1 : i + 2
    if (item.order !== o) reorder.push([item.id, o])
  })
  return createEpisode(uid, workId, position + 1, reorder)
}

/** 章の見出しを作る。order は一覧の中の位置（話と共通の並び） */
export function createChapter(uid: string, workId: string, order: number, title: string) {
  const id = newId(episodesPath(uid, workId))
  setDoc(doc(db, episodePath(uid, workId, id)), {
    kind: 'chapter',
    title,
    order,
    charCount: 0,
    updatedAt: Date.now(),
  }).catch(report)
}

export function renameChapter(uid: string, workId: string, id: string, title: string) {
  updateDoc(doc(db, episodePath(uid, workId, id)), { title }).catch(report)
}

/** 見出しだけを消す（章の中の話はそのまま残り、前の章に入る） */
export function deleteChapter(uid: string, workId: string, id: string) {
  deleteDoc(doc(db, episodePath(uid, workId, id))).catch(report)
}

/**
 * タイトル・本文の保存内容。
 * baseUpdatedAt は「この編集の元にした版の updatedAt」。Firestore ルールで、
 * サーバー上の最新版と一致しない（＝他端末の更新を知らずに上書きしようとしている）書き込みを拒否する。
 */
export type TextSave = { title: string; body: string; updatedAt: number; baseUpdatedAt: number | null }

const textFields = (v: TextSave) => ({
  title: v.title,
  body: v.body,
  updatedAt: v.updatedAt,
  baseUpdatedAt: v.baseUpdatedAt,
})

export type EpisodeMeta = { title: string; charCount: number }

/**
 * 本文を保存する。一覧用の情報（meta）と作品の更新日時（touchWork）は、毎回書くと書き込みが増えるので
 * 呼び出し側で間引き、必要なときだけ同じ一括書き込みに含める（本文が拒否されたら一覧も更新されない）
 */
export function saveEpisode(
  uid: string,
  workId: string,
  id: string,
  v: TextSave,
  opts: { meta: EpisodeMeta | null; touchWork: boolean },
) {
  const batch = writeBatch(db)
  batch.update(doc(db, episodeBodyPath(uid, workId, id)), textFields(v))
  if (opts.meta) batch.update(doc(db, episodePath(uid, workId, id)), { ...opts.meta, updatedAt: v.updatedAt })
  if (opts.touchWork) batch.update(doc(db, workPath(uid, workId)), { updatedAt: v.updatedAt })
  return batch.commit()
}

/** 画面を離れるときなど、間引いて書いていなかった一覧用の情報だけを書く */
export function updateEpisodeMeta(uid: string, workId: string, id: string, meta: EpisodeMeta) {
  updateDoc(doc(db, episodePath(uid, workId, id)), { ...meta }).catch(report)
}

export function deleteEpisode(uid: string, workId: string, id: string) {
  const batch = writeBatch(db)
  batch.delete(doc(db, episodePath(uid, workId, id)))
  batch.delete(doc(db, episodeBodyPath(uid, workId, id)))
  batch.commit().catch(report)
  removeBackupsUnder(episodeBodyPath(uid, workId, id))
}

/** 書き出し用：作品の全話の本文をまとめて読む（一覧の画面では読まない） */
export async function loadEpisodeBodies(uid: string, workId: string): Promise<Map<string, string>> {
  const ref = collection(db, episodeBodiesPath(uid, workId))
  // オフラインでは端末に読み込み済みの分しか取れない。足りないかどうかは呼び出し側で確認する
  const snap = await getDocsFromServer(ref).catch(() => getDocsFromCache(ref))
  return new Map(snap.docs.map((d) => [d.id, String(d.data().body ?? '')]))
}

/**
 * 一覧の from 番目を to 番目へ移し、order を 1,2,3… に振り直す（話・メモ共通）。
 * 別端末でオフライン中に追加して order が重複していても、これで解消される。変わった分だけ書き込む。
 */
export function moveItem(collectionPath: string, items: { id: string; order: number }[], from: number, to: number) {
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  const batch = writeBatch(db)
  let changed = 0
  next.forEach((item, i) => {
    if (item.order !== i + 1) {
      batch.update(doc(db, `${collectionPath}/${item.id}`), { order: i + 1 })
      changed++
    }
  })
  if (changed > 0) batch.commit().catch(report)
}

export function createNote(uid: string, workId: string, kind: NoteKind, order: number): string {
  const id = newId(notesPath(uid, workId))
  const now = Date.now()
  const batch = writeBatch(db)
  batch.set(doc(db, notePath(uid, workId, id)), { kind, title: '', preview: '', order, updatedAt: now })
  batch.set(doc(db, noteBodyPath(uid, workId, id)), { kind, title: '', body: '', updatedAt: now, baseUpdatedAt: null })
  batch.commit().catch(report)
  return id
}

export type NoteMeta = { title: string; preview: string }

export function saveNoteText(uid: string, workId: string, id: string, v: TextSave, meta: NoteMeta | null) {
  const batch = writeBatch(db)
  batch.update(doc(db, noteBodyPath(uid, workId, id)), textFields(v))
  if (meta) batch.update(doc(db, notePath(uid, workId, id)), { ...meta, updatedAt: v.updatedAt })
  return batch.commit()
}

export function updateNoteMeta(uid: string, workId: string, id: string, meta: NoteMeta) {
  updateDoc(doc(db, notePath(uid, workId, id)), { ...meta }).catch(report)
}

/** 種類の変更（一覧用と本文の両方）。updatedAt は本文の版を表すので変えない（変えると編集中の画面が衝突扱いになる） */
export function setNoteKind(uid: string, workId: string, id: string, kind: NoteKind) {
  const batch = writeBatch(db)
  batch.update(doc(db, notePath(uid, workId, id)), { kind })
  batch.update(doc(db, noteBodyPath(uid, workId, id)), { kind })
  batch.commit().catch(report)
}

export function deleteNote(uid: string, workId: string, id: string) {
  const batch = writeBatch(db)
  batch.delete(doc(db, notePath(uid, workId, id)))
  batch.delete(doc(db, noteBodyPath(uid, workId, id)))
  batch.commit().catch(report)
  removeBackupsUnder(noteBodyPath(uid, workId, id))
}

// ---- 旧形式からの移行 ----
// 以前は一覧用の文書（episodes / notes）に本文も持っていた。本文の文書へ移し、一覧用からは本文を消す。

type LegacyKind = 'episode' | 'note'

/**
 * 1件を移す。読み取りから書き込みまでの間に旧版のアプリが本文を書いても失わないよう、トランザクションで行う
 * （割り込まれたら読み直してやり直す）。
 * 本文の文書がすでにあり、一覧用の文書にも違う本文が残っている場合（旧版が並行して書いたなど）は、
 * どちらも捨てずに、一覧用の文書の本文を「資料」のメモとして残す。
 */
async function migrateOne(kind: LegacyKind, metaRef: DocumentReference, bodyRef: DocumentReference): Promise<boolean> {
  const workRef = metaRef.parent.parent!
  return runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(metaRef)
    const bodySnap = await tx.get(bodyRef)
    if (!metaSnap.exists()) return false
    const legacy = metaSnap.data()
    if (!('body' in legacy)) return false // 旧形式ではない、またはすでに移行済み（他の端末が先に移した）
    const body = String(legacy.body ?? '')
    const updatedAt = typeof legacy.updatedAt === 'number' ? legacy.updatedAt : Date.now()
    const title = String(legacy.title ?? '')

    if (!bodySnap.exists()) {
      const text: DocumentData = { title, body, updatedAt, baseUpdatedAt: null }
      if (legacy.format) text.format = legacy.format
      if (kind === 'note') text.kind = legacy.kind ?? 'character'
      tx.set(bodyRef, text)
    } else if (String(bodySnap.data().body ?? '') !== body) {
      // 本文の文書が正。ただし一覧用に残っていた違う本文も、資料のメモとして退避する
      const rescueId = doc(collection(workRef, 'notes')).id
      const now = Date.now()
      const rescueTitle = `【旧版で書かれた本文】${title || '無題'}`
      tx.set(doc(workRef, 'notes', rescueId), { kind: 'document', title: rescueTitle, preview: makePreview(body), order: now, updatedAt: now })
      tx.set(doc(workRef, 'noteBodies', rescueId), {
        kind: 'document',
        title: rescueTitle,
        body,
        updatedAt: now,
        baseUpdatedAt: null,
      })
    }
    const metaPatch: DocumentData = { body: deleteField(), baseUpdatedAt: deleteField(), format: deleteField() }
    if (kind === 'episode') metaPatch.charCount = countChars(bodySnap.exists() ? String(bodySnap.data().body ?? '') : body)
    else metaPatch.preview = makePreview(bodySnap.exists() ? String(bodySnap.data().body ?? '') : body)
    tx.update(metaRef, metaPatch)
    return true
  })
}

/** 作品を開いたときに呼ぶ：旧形式の話・メモが残っていれば移す（無ければ一覧の問い合わせ1回だけ） */
export async function migrateLegacyBodies(uid: string, workId: string) {
  const targets: [LegacyKind, string, (u: string, w: string, id: string) => string][] = [
    ['episode', episodesPath(uid, workId), episodeBodyPath],
    ['note', notesPath(uid, workId), noteBodyPath],
  ]
  try {
    for (const [kind, metaPath, bodyPathOf] of targets) {
      // 端末内キャッシュだけでは見落とすので、サーバーに問い合わせる（オフラインなら次の機会に）
      const snap = await getDocsFromServer(query(collection(db, metaPath), where('body', '!=', null)))
      for (const d of snap.docs) {
        await migrateOne(kind, d.ref, doc(db, bodyPathOf(uid, workId, d.id)))
      }
    }
    // 移行済みの印。以後この作品を開いても問い合わせない（旧版で後から作られた話は、開いたときに1件ずつ移す）
    await updateDoc(doc(db, workPath(uid, workId)), { bodiesSplit: true })
  } catch (e) {
    report(e)
  }
}

/** 本文の文書が無いときに呼ぶ：その1件が旧形式なら移す。移したら true */
export async function migrateLegacyDoc(uid: string, workId: string, kind: LegacyKind, id: string): Promise<boolean> {
  const metaRef = doc(db, kind === 'episode' ? episodePath(uid, workId, id) : notePath(uid, workId, id))
  const bodyRef = doc(db, kind === 'episode' ? episodeBodyPath(uid, workId, id) : noteBodyPath(uid, workId, id))
  try {
    return await migrateOne(kind, metaRef, bodyRef)
  } catch (e) {
    report(e)
    return false
  }
}

/**
 * 一覧用の情報の書き込みを間引く。
 * - take(meta, now)：保存のたびに呼ぶ。タイトルが変わったとき、前回から intervalMs 以上たったとき、
 *   または画面が隠れようとしている（タブを閉じる・アプリを終了する：この後に書く機会がない）ときに true
 * - 画面を離れる・バックグラウンドになるときに、書いていない最新の情報を write で書く
 */
export function useListMetaSync<T extends { title: string }>(write: (m: T) => void, intervalMs = 15000) {
  const last = useRef<{ key: string; title: string; at: number } | null>(null)
  const latest = useRef<T | null>(null)
  const writeRef = useRef(write)
  useEffect(() => {
    writeRef.current = write
  }, [write])

  const take = useCallback(
    (m: T, now: number) => {
      latest.current = m
      const key = JSON.stringify(m)
      const l = last.current
      const closing = document.visibilityState === 'hidden'
      if (l && (l.key === key || (!closing && l.title === m.title && now - l.at < intervalMs))) return false
      last.current = { key, title: m.title, at: now }
      return true
    },
    [intervalMs],
  )

  useEffect(() => {
    // 同じ画面の自動保存（useAutosave）も離脱時・バックグラウンド化時に保存する。その保存で最新の情報が渡されてから書く。
    // ブラウザのイベントでは受け取り処理ごとにマイクロタスクが走るので、queueMicrotask では自動保存より先になる。
    // setTimeout で、同じイベントの受け取り処理がすべて終わった後に回す
    const write = () => {
      const m = latest.current
      if (!m) return
      const key = JSON.stringify(m)
      if (last.current?.key === key) return
      last.current = { key, title: m.title, at: Date.now() }
      writeRef.current(m)
    }
    const flush = () => setTimeout(write)
    const onHide = () => document.visibilityState === 'hidden' && flush()
    // ページを閉じる・再読み込みするときはタイマーが動かないので、その場で書く
    // （自動保存は先に来る visibilitychange で済んでいる。書き込みは端末内のキューに入り、次の起動時に送られる）
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', write)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', write)
      flush()
    }
  }, [])

  /** 文書を削除するときに呼ぶ（離脱時に削除済みの文書へ書かない） */
  const cancel = useCallback(() => {
    latest.current = null
  }, [])

  /**
   * take で含めた書き込みが拒否・失敗したときに呼ぶ。書いたことにしたままだと、
   * 衝突を解決して保存し直しても一覧の情報が書かれず、本文とずれたまま残る
   */
  const forget = useCallback(() => {
    last.current = null
  }, [])

  // 毎回新しいオブジェクトを返すと、これを使う保存処理が描画のたびに作り直される
  return useMemo(() => ({ take, cancel, forget }), [take, cancel, forget])
}

export function createThesaurusEntry(uid: string, title = ''): string {
  const id = newId(thesaurusPath(uid))
  setDoc(doc(db, thesaurusEntryPath(uid, id)), { title, body: '', updatedAt: Date.now() }).catch(report)
  return id
}

export function saveThesaurusEntry(uid: string, id: string, v: TextSave) {
  return updateDoc(doc(db, thesaurusEntryPath(uid, id)), textFields(v))
}

export function deleteThesaurusEntry(uid: string, id: string) {
  deleteDoc(doc(db, thesaurusEntryPath(uid, id))).catch(report)
  removeBackupsUnder(thesaurusEntryPath(uid, id))
}
