import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands'
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { autocorrectExtension } from '../lib/autocorrect'
import { AUTOCORRECT_DEFAULTS, type AutocorrectOptions } from '../lib/autocorrectRules'
import { markdownAssistExtension, markdownExtension } from '../lib/markdown'

function languageExtensions(markdown: boolean, assist: boolean) {
  if (!markdown) return []
  return assist ? [markdownExtension, markdownAssistExtension] : markdownExtension
}

export type EditorApi = {
  /** 選択中の文字列（無ければ空文字） */
  getSelection: () => string
  /** 選択範囲（無ければカーソル位置）を text で置き換える */
  replaceSelection: (text: string) => void
}

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  apiRef?: Ref<EditorApi>
  /** Markdown の色付けを有効にする */
  markdown?: boolean
  /** Markdown の入力補助（リスト継続など）を有効にする。markdown が true のときのみ効く */
  markdownAssist?: boolean
  /** 小説向けの自動修正。Markdown モードでは使わない（記法の記号を壊すため） */
  autocorrect?: AutocorrectOptions
  /** 閲覧のみ（文字の選択・コピーはできる） */
  readOnly?: boolean
}

const readOnlyExtensions = (readOnly: boolean) =>
  readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []

/** 外部（他端末の更新など）から差し替えた変更の印。onChange を発火させない */
const External = Annotation.define<boolean>()

/**
 * 素の入力に徹したエディタ。
 * basicSetup は使わない（括弧の自動補完・入力補完・自動インデントなどを含むため）。
 */
export default function Editor({
  value,
  onChange,
  placeholder,
  apiRef,
  markdown = false,
  markdownAssist = false,
  autocorrect = AUTOCORRECT_DEFAULTS,
  readOnly = false,
}: Props) {
  const readOnlySlot = useRef(new Compartment())
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const language = useRef(new Compartment())
  const correction = useRef(new Compartment())
  const correctionExt = () => autocorrectExtension(markdown ? AUTOCORRECT_DEFAULTS : autocorrect)
  // 設定オブジェクトは毎回作り直されるので、中身で比較する
  const autocorrectKey = JSON.stringify(markdown ? AUTOCORRECT_DEFAULTS : autocorrect)
  const placeholderSlot = useRef(new Compartment())
  /** エディタから最後に onChange で渡した文字列。value がこれと同じなら外部からの変更ではない */
  const lastEmitted = useRef(value)

  useImperativeHandle(
    apiRef,
    () => ({
      getSelection: () => {
        const v = view.current
        if (!v) return ''
        const { from, to } = v.state.selection.main
        return v.state.sliceDoc(from, to)
      },
      replaceSelection: (text) => {
        const v = view.current
        if (!v) return
        v.dispatch({ ...v.state.replaceSelection(text), scrollIntoView: true })
        v.focus()
      },
    }),
    [],
  )
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            // 既定の Enter は前行の字下げ（全角スペース含む）を引き継ぐので、単純な改行に置き換える
            { key: 'Enter', run: insertNewline },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          readOnlySlot.current.of(readOnlyExtensions(readOnly)),
          language.current.of(languageExtensions(markdown, markdownAssist)),
          correction.current.of(correctionExt()),
          EditorView.contentAttributes.of({
            autocorrect: 'off',
            autocapitalize: 'off',
            autocomplete: 'off',
            spellcheck: 'false',
            'data-gramm': 'false',
          }),
          placeholderSlot.current.of(placeholderExt(placeholder ?? '')),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            if (u.transactions.some((t) => t.annotation(External))) return
            const text = u.state.doc.toString()
            lastEmitted.current = text
            onChangeRef.current(text)
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // 初期化は一度だけ。以降の value 変更は下の effect で反映する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure(languageExtensions(markdown, markdownAssist)) })
  }, [markdown, markdownAssist])

  useEffect(() => {
    view.current?.dispatch({ effects: correction.current.reconfigure(correctionExt()) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autocorrectKey])

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(readOnlyExtensions(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    view.current?.dispatch({ effects: placeholderSlot.current.reconfigure(placeholderExt(placeholder ?? '')) })
  }, [placeholder])

  // 外部（他端末の更新など）からの value の変更を反映する。
  // 自分の入力の結果（lastEmitted と同じ）なら何もしない（入力のたびに全文を比較しないため）
  useEffect(() => {
    const v = view.current
    if (!v || value === lastEmitted.current) return
    lastEmitted.current = value
    const current = v.state.doc.toString()
    if (current === value) return
    // 先頭と末尾の一致部分を除いた区間だけを差し替え、カーソル位置・スクロール位置を保つ
    let start = 0
    const max = Math.min(current.length, value.length)
    while (start < max && current.charCodeAt(start) === value.charCodeAt(start)) start++
    let end = 0
    while (
      end < max - start &&
      current.charCodeAt(current.length - 1 - end) === value.charCodeAt(value.length - 1 - end)
    ) {
      end++
    }
    v.dispatch({
      changes: { from: start, to: current.length - end, insert: value.slice(start, value.length - end) },
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    })
  }, [value])

  return <div className="editor" ref={host} />
}
