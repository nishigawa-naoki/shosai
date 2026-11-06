// Markdown のプレビュー描画。プレビューを開いたときだけ読み込む（marked・DOMPurify を初回の読み込みに含めない）
import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** アプリと別の場所を指すリンクか。`//example.com` のようなスキーム省略の URL も外部として扱う */
function isExternal(href: string) {
  try {
    return new URL(href, location.href).origin !== location.origin
  } catch {
    return false
  }
}

// 外部リンクは別タブ（PWA ではアプリ内ブラウザ）で開き、アプリ自体が遷移しないようにする
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const href = node.getAttribute('href')
  if (node.tagName === 'A' && href && isExternal(href)) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const SANITIZE_OPTIONS = {
  // 文書の表示に不要で、画面の偽装に使えるものは除く
  FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option', 'style'],
  FORBID_ATTR: ['style'],
}

/** プレビュー用 HTML。1回の改行もそのまま改行として扱う（小説本文向け） */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true, async: false })
  return DOMPurify.sanitize(html, SANITIZE_OPTIONS)
}
