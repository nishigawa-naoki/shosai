import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

export type DocFormat = 'plain' | 'markdown'

/** エディタ上の見た目。記法の文字そのものは残し、薄く表示する */
const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '0.9em' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--muted)' },
])

/**
 * Markdown モードの拡張。
 * addKeymap: false で、リスト記号の自動継続などの入力補助は入れない。
 */
export const markdownExtension: Extension = [
  markdown({ base: markdownLanguage, addKeymap: false, completeHTMLTags: false }),
  syntaxHighlighting(highlight),
]

/**
 * Markdown の入力補助（設定でオンにしたときだけ）。
 * - Enter: リスト・引用の記号を次の行に引き継ぐ／番号付きリストの振り直し／空の項目で記号を外す
 * - Backspace: 行頭の記号を一段ずつ消す
 * リスト・引用の外では何もせず、通常の Enter（単純な改行）に処理を渡す。
 * エディタ本体の Enter 定義より優先させるため Prec.high にする。
 */
export const markdownAssistExtension: Extension = Prec.high(keymap.of(markdownKeymap))
