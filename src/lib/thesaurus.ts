import type { ThesaurusEntry } from './db'

export type Word = { word: string; note: string }

/**
 * 類語グループの本文を語のリストにする。
 * - 1行1語。「微笑む：声を出さずに」のように ：/:/タブ の後ろはメモ
 * - 「笑う、微笑む、嗤う」のように読点・カンマ区切りで1行に複数語も可（メモは各語に付く）
 * - Markdown で書いた場合: 見出し行（#）は語として扱わず、行頭のリスト記号は取り除く
 */
export function parseWords(body: string): Word[] {
  const out: Word[] = []
  for (const raw of body.split('\n')) {
    const line = raw
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(.*?)[：:\t](.*)$/)
    const head = m ? m[1] : line
    const note = m ? m[2].trim() : ''
    for (const w of head.split(/[、，,]/)) {
      const word = w.trim()
      if (word) out.push({ word, note })
    }
  }
  return out
}

/** 検索用の正規化：カタカナ→ひらがな、英字小文字化、空白除去 */
export function normalize(s: string): string {
  return s
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
    .replace(/\s/g, '')
}

export type SearchResult = { entry: ThesaurusEntry; words: Word[]; exact: boolean }

export function searchThesaurus(entries: ThesaurusEntry[], query: string): SearchResult[] {
  const q = normalize(query)
  const results: SearchResult[] = []
  for (const entry of entries) {
    const words = parseWords(entry.body)
    const keys = [entry.title, ...words.map((w) => w.word)].map(normalize)
    if (q && !keys.some((k) => k.includes(q))) continue
    results.push({ entry, words, exact: !!q && keys.some((k) => k === q) })
  }
  // 完全一致を先頭に、あとは見出しの五十音（Unicode）順
  return results.sort(
    (a, b) => Number(b.exact) - Number(a.exact) || a.entry.title.localeCompare(b.entry.title, 'ja'),
  )
}
