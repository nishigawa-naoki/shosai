import { useId, useState } from 'react'
import { MAX_SHARES, normalizeEmail, SHARE_ROLE_LABEL, type Share, type ShareRole } from '../lib/db'
import Icon from './Icon'

type Props = {
  initial: Share[]
  /** 自分のアドレス（自分は追加できない） */
  selfEmail: string
  onSave: (shares: Share[]) => void
  onCancel: () => void
}

const ROLES: ShareRole[] = ['edit', 'view']
// 厳密な検査はしない（打ち間違いに気づける程度）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function RoleChips({ role, onChange, label }: { role: ShareRole; onChange: (r: ShareRole) => void; label: string }) {
  return (
    <span className="role-chips" role="group" aria-label={label}>
      {ROLES.map((r) => (
        <button
          key={r}
          type="button"
          className={r === role ? 'chip active' : 'chip'}
          aria-pressed={r === role}
          onClick={() => onChange(r)}
        >
          {SHARE_ROLE_LABEL[r]}
        </button>
      ))}
    </span>
  )
}

/** 作品の共有相手と権限（編集可・閲覧のみ）を設定するダイアログ */
export default function ShareDialog({ initial, selfEmail, onSave, onCancel }: Props) {
  const [shares, setShares] = useState<Share[]>(initial)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('view')
  const [error, setError] = useState('')
  const titleId = useId()

  const add = () => {
    const e = normalizeEmail(email)
    if (!e) return
    if (!EMAIL_RE.test(e)) return setError('メールアドレスの形式が正しくありません')
    if (e === normalizeEmail(selfEmail)) return setError('自分のアドレスは追加できません')
    if (shares.some((s) => s.email === e)) return setError('すでに追加されています')
    if (shares.length >= MAX_SHARES) return setError(`共有できるのは ${MAX_SHARES} 人までです`)
    setShares([...shares, { email: e, role }])
    setEmail('')
    setError('')
  }

  const changed = JSON.stringify(shares) !== JSON.stringify(initial)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && !e.nativeEvent.isComposing && onCancel()}
      >
        <h2 id={titleId}>作品を共有</h2>
        <p className="muted small">
          相手のアドレスがログイン許可リストに入っていないと、ここで追加しても相手には見えません。
          作品名の変更・削除・共有の設定は持ち主だけができます。
        </p>

        <form
          className="share-add"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <input
            className="text-input"
            type="email"
            inputMode="email"
            value={email}
            placeholder="相手の Google アカウントのアドレス"
            aria-label="共有相手のメールアドレス"
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
          <div className="share-add-row">
            <RoleChips role={role} onChange={setRole} label="追加する相手の権限" />
            <button type="submit" disabled={!email.trim()}>
              <Icon name="plus" size={16} />
              追加
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
        </form>

        {shares.length === 0 ? (
          <p className="muted small empty-inline">まだ誰とも共有していません</p>
        ) : (
          <ul className="share-list">
            {shares.map((s) => (
              <li key={s.email}>
                <span className="share-email">{s.email}</span>
                <RoleChips
                  role={s.role}
                  label={`${s.email} の権限`}
                  onChange={(r) => setShares(shares.map((x) => (x.email === s.email ? { ...x, role: r } : x)))}
                />
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label={`${s.email} との共有を解除`}
                  title="共有を解除"
                  onClick={() => setShares(shares.filter((x) => x.email !== s.email))}
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            disabled={!changed && !email.trim()}
            onClick={() =>
              // 入力しただけで「追加」していないアドレスを黙って捨てない
              email.trim() ? setError('入力中のアドレスを「追加」してから保存してください') : onSave(shares)
            }
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
