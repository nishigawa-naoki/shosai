/**
 * 小説向けの自動修正ルール（エディタに依存しない純粋な関数）。
 * どのルールも既定は無効。設定で個別に有効にする。
 *
 * 参考にした一般的な執筆ツール・原稿作法：
 * - 段落頭の字下げ（会話文の鉤括弧で始まる行は字下げしない）
 * - 鉤括弧などの閉じ忘れ防止（開き括弧で閉じ括弧を補う）
 * - 感嘆符・疑問符の後は全角スペースを空ける（直後が閉じ括弧・記号なら空けない）
 * - 三点リーダーは2つ続けて「……」、ダッシュは2つ続けて「――」
 * - 「！」「？」は全角
 * - 閉じ括弧の直前の句点は付けない（「はい。」→「はい」）
 */

export type AutocorrectOptions = {
  /** 改行したら段落頭に全角スペースを入れる。鉤括弧で始めたら字下げを外す */
  indent: boolean
  /** 開き括弧を入力したら閉じ括弧を補う */
  closeBrackets: boolean
  /** ！？の後に文字が続いたら全角スペースを入れる */
  spaceAfterMark: boolean
  /** ...／・・・／。。。／単独の… を「……」にする */
  ellipsis: boolean
  /** --／——／── を「――」にする */
  dash: boolean
  /** 日本語の直後の ! ? を全角にする */
  fullwidthMark: boolean
  /** 閉じ括弧の直前の句点を消す */
  periodBeforeClose: boolean
}

export const AUTOCORRECT_DEFAULTS: AutocorrectOptions = {
  indent: false,
  closeBrackets: false,
  spaceAfterMark: false,
  ellipsis: false,
  dash: false,
  fullwidthMark: false,
  periodBeforeClose: false,
}

export const AUTOCORRECT_ITEMS: { key: keyof AutocorrectOptions; label: string; example: string }[] = [
  { key: 'indent', label: '段落頭の字下げ', example: '改行 → 「　」を自動で入れる（「 で始めたら外す）' },
  { key: 'closeBrackets', label: '括弧を閉じる', example: '「 → 「」' },
  { key: 'spaceAfterMark', label: '！？の後に空白', example: 'えっ！何 → えっ！　何' },
  { key: 'ellipsis', label: '三点リーダー', example: '... ・・・ … → ……' },
  { key: 'dash', label: 'ダッシュ', example: '-- → ――' },
  { key: 'fullwidthMark', label: '！？を全角に', example: 'えっ! → えっ！' },
  { key: 'periodBeforeClose', label: '閉じ括弧前の句点を削除', example: '「はい。」 → 「はい」' },
]

export const isAnyAutocorrectEnabled = (o: AutocorrectOptions) => Object.values(o).some(Boolean)

export const BRACKET_PAIRS: Record<string, string> = {
  '「': '」',
  '『': '』',
  '（': '）',
  '【': '】',
  '〈': '〉',
  '《': '》',
  '〔': '〕',
  '［': '］',
  '｛': '｝',
}
const CLOSERS = new Set(Object.values(BRACKET_PAIRS))

export type TextChange = { from: number; to: number; insert: string }

/**
 * 1行分のテキストに対し、直前に入力された範囲に関わる修正を求める。
 * @param line 行のテキスト
 * @param edited 入力された範囲（行内の位置。from〜to）
 * @param cursor カーソル位置（行内。閉じ括弧の補完に使う）
 * @returns 行内の位置での変更（重ならない・位置順）
 */
export function computeCorrections(
  line: string,
  edited: { from: number; to: number },
  cursor: number,
  o: AutocorrectOptions,
): TextChange[] {
  const out: TextChange[] = []
  /** 位置 i の文字を今入力したか */
  const typedAt = (i: number) => i >= edited.from && i < edited.to

  /**
   * 今入力した文字で完成した一致（＝一致の最後の文字を今入力した）だけを直す。
   * 既存の文章や、Ctrl+Z で修正を取り消した箇所の後ろに書き足しても、改めて直さない
   */
  const eachMatch = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0].length > 0 && typedAt(m.index + m[0].length - 1)) fn(m)
      if (m[0].length === 0) re.lastIndex++
    }
  }
  const isAscii = (ch: string | undefined) => ch !== undefined && ch.charCodeAt(0) <= 0x7f

  if (o.fullwidthMark) {
    eachMatch(/[!?]/g, (m) => {
      const prev = line[m.index - 1]
      // 英文（"Hello!" など）や URL は対象外。直前が ASCII 以外のときだけ
      if (prev !== undefined && prev.charCodeAt(0) > 0x7f) {
        out.push({ from: m.index, to: m.index + 1, insert: m[0] === '!' ? '！' : '？' })
      }
    })
  }

  if (o.ellipsis) {
    eachMatch(/\.{3}|。{3}|・{3}|(?<!…)…(?!…)/g, (m) => out.push({ from: m.index, to: m.index + m[0].length, insert: '……' }))
  }

  if (o.dash) {
    eachMatch(/--|——|──|－－/g, (m) => out.push({ from: m.index, to: m.index + m[0].length, insert: '――' }))
  }

  if (o.periodBeforeClose) {
    // 閉じ括弧を打った時点で、その直前の句点を消す（句点を打った時点では消さない。
    // 補った閉じ括弧の手前で台詞を書いている途中の句点まで消えてしまうため）
    const re = /[。．]([」』）])/g
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (typedAt(m.index + 1)) out.push({ from: m.index, to: m.index + 1, insert: '' })
    }
  }

  if (o.spaceAfterMark) {
    // 直後が閉じ括弧・記号・空白・行末なら空けない。直後の文字を今打ったときだけ
    const re = /[!?！？]+(?=[^!?！？」』）)】〉》〕］｝\s　…―])/g
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const at = m.index + m[0].length
      // 半角の !? は英文・URL（"Hello!W"、"?q="）の可能性があるので、直前が日本語のときだけ
      if (/[!?]/.test(m[0]) && isAscii(line[m.index - 1])) continue
      if (typedAt(at)) out.push({ from: at, to: at, insert: '　' })
    }
  }

  if (o.closeBrackets && cursor === edited.to && cursor > 0) {
    // 今入力した範囲の中で閉じられていない開き括弧を探す。
    // 日本語入力では「「こんにちは」のように括弧と文字がまとめて確定されることがある
    const open: string[] = []
    for (const ch of line.slice(edited.from, edited.to)) {
      if (ch in BRACKET_PAIRS) open.push(ch)
      else if (CLOSERS.has(ch) && open.length && BRACKET_PAIRS[open[open.length - 1]] === ch) open.pop()
    }
    const typed = line[cursor - 1]
    if (open.length) {
      const closers = open.reverse().map((ch) => BRACKET_PAIRS[ch]).join('')
      if (!line.startsWith(closers, cursor)) out.push({ from: cursor, to: cursor, insert: closers })
    } else if (CLOSERS.has(typed) && line[cursor] === typed) {
      // 補った閉じ括弧の手前で同じ閉じ括弧を打った：二重にしない
      out.push({ from: cursor, to: cursor + 1, insert: '' })
    }
  }

  if (o.indent && line[0] === '　' && line[1] in BRACKET_PAIRS && typedAt(1)) {
    // 字下げした行を鉤括弧で始めた（会話文）→ 字下げを外す
    out.push({ from: 0, to: 1, insert: '' })
  }

  // 重なるものは先に見つかった方を優先し、位置順に並べる
  const accepted: TextChange[] = []
  for (const c of out) {
    const overlaps = accepted.some((a) => c.from < a.to && a.from < c.to)
    if (!overlaps) accepted.push(c)
  }
  return accepted.sort((a, b) => a.from - b.from || a.to - b.to)
}

/** 段落頭の字下げ：Enter で入れる文字列と、今の行を空にするか */
export function indentOnEnter(lineText: string, cursorInLine: number): { clearLine: boolean; insert: string } {
  // 字下げだけの行（何も書かずに改行した）なら、その行の字下げは消して次の行へ
  if (lineText === '　' && cursorInLine === 1) return { clearLine: true, insert: '\n　' }
  return { clearLine: false, insert: '\n　' }
}
