import { Annotation, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { computeCorrections, indentOnEnter, isAnyAutocorrectEnabled, type AutocorrectOptions } from './autocorrectRules'

/** 自動修正による変更の印（自分の修正に反応して再修正しないため） */
const Autocorrected = Annotation.define<boolean>()

type Range = { from: number; to: number }

/**
 * 入力のたびに、入力された箇所の周辺だけを直す。
 * 日本語入力の変換中は文書を書き換えると変換が壊れるので、変換が確定するまで待ってから直す。
 */
function correctionPlugin(o: AutocorrectOptions) {
  return ViewPlugin.fromClass(
    class {
      pending: Range[] = []
      scheduled = false
      view: EditorView

      constructor(view: EditorView) {
        this.view = view
      }

      update(u: ViewUpdate) {
        if (u.docChanged) {
          this.pending = this.pending.map((r) => ({ from: u.changes.mapPos(r.from, -1), to: u.changes.mapPos(r.to, 1) }))
          const typed = u.transactions.some((tr) => tr.isUserEvent('input.type') && !tr.annotation(Autocorrected))
          if (typed) u.changes.iterChangedRanges((_fa, _ta, fromB, toB) => this.pending.push({ from: fromB, to: toB }))
        }
        if (this.pending.length && !this.view.composing && !this.scheduled) {
          this.scheduled = true
          // 更新処理の最中には dispatch できないので、終わってから直す
          queueMicrotask(() => {
            this.scheduled = false
            if (this.view.composing) return
            const ranges = this.pending
            this.pending = []
            this.apply(ranges)
          })
        }
      }

      apply(ranges: Range[]) {
        const { state } = this.view
        const head = state.selection.main.head
        const changes: { from: number; to: number; insert: string }[] = []
        const doneLines = new Set<number>()
        for (const r of ranges) {
          const from = Math.min(r.from, state.doc.length)
          const to = Math.min(r.to, state.doc.length)
          const first = state.doc.lineAt(from).number
          const last = state.doc.lineAt(to).number
          for (let n = first; n <= last; n++) {
            if (doneLines.has(n)) continue
            doneLines.add(n)
            const line = state.doc.line(n)
            const edited = { from: Math.max(from, line.from) - line.from, to: Math.min(to, line.to) - line.from }
            const cursor = head >= line.from && head <= line.to ? head - line.from : -1
            for (const c of computeCorrections(line.text, edited, cursor, o)) {
              changes.push({ from: line.from + c.from, to: line.from + c.to, insert: c.insert })
            }
          }
        }
        if (!changes.length) return
        const set = state.changes(changes)
        this.view.dispatch({
          changes: set,
          // 補った閉じ括弧の手前にカーソルを置く（挿入位置ちょうどのカーソルは左に寄せる）
          selection: { anchor: set.mapPos(head, -1) },
          annotations: Autocorrected.of(true),
          userEvent: 'input.autocorrect',
        })
      }
    },
  )
}

/** 段落頭の字下げ：Enter で全角スペースを入れる */
function indentKeymap(): Extension {
  return Prec.high(
    keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          const { state } = view
          if (state.selection.ranges.length !== 1) return false
          const { from, to } = state.selection.main
          const line = state.doc.lineAt(from)
          const { clearLine, insert } = indentOnEnter(line.text, from - line.from)
          const change = clearLine ? { from: line.from, to: line.to, insert } : { from, to, insert }
          view.dispatch({
            changes: change,
            selection: { anchor: change.from + insert.length },
            scrollIntoView: true,
            userEvent: 'input',
          })
          return true
        },
      },
    ]),
  )
}

/** 有効な項目の分だけ拡張を返す（すべて無効なら何も足さない） */
export function autocorrectExtension(o: AutocorrectOptions): Extension {
  if (!isAnyAutocorrectEnabled(o)) return []
  const ext: Extension[] = [correctionPlugin(o)]
  if (o.indent) ext.push(indentKeymap())
  return ext
}
