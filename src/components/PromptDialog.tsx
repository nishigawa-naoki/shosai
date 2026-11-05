import { useId, useRef, useState } from 'react'

type Props = {
  title: string
  initialValue?: string
  placeholder?: string
  okLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
  /** 指定すると左端に削除ボタンを出す（確認は呼び出し側で行う） */
  onDelete?: () => void
  deleteLabel?: string
}

/** 1行の文字列を入力してもらうダイアログ（ブラウザの prompt の代わり） */
export default function PromptDialog({
  title,
  initialValue = '',
  placeholder,
  okLabel = 'OK',
  onSubmit,
  onCancel,
  onDelete,
  deleteLabel = '削除',
}: Props) {
  const [value, setValue] = useState(initialValue)
  const composing = useRef(false)
  const titleId = useId()

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(value)
        }}
        onKeyDown={(e) => {
          // 変換中の Esc は変換の取り消しなので、ダイアログは閉じない
          if (e.key === 'Escape' && !composing.current && !e.nativeEvent.isComposing) onCancel()
          // 日本語入力の変換確定の Enter で送信しない（Safari は確定後に keydown が来ることがある）
          if (e.key === 'Enter' && (composing.current || e.nativeEvent.isComposing || e.keyCode === 229)) {
            e.preventDefault()
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <input
          className="text-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="modal-actions">
          {onDelete && (
            <button type="button" className="ghost danger modal-delete" onClick={onDelete}>
              {deleteLabel}
            </button>
          )}
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className="primary">
            {okLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
