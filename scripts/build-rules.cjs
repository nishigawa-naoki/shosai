// firestore.rules（ひな形）の許可リストに allowlist.local.json のアドレスを入れて、firestore.local.rules を作る。
// 実際のアドレスはリポジトリに含めないため、どちらの .local もコミットしない（.gitignore）
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const listPath = path.join(root, 'allowlist.local.json')
const MARKER = /\/\* ALLOWLIST \*\/[^\]]*/

function fail(msg) {
  console.error(`build-rules: ${msg}`)
  process.exit(1)
}

if (!fs.existsSync(listPath)) {
  fail('allowlist.local.json がありません。allowlist.example.json をコピーして、ログインを許すアドレスを書いてください（先頭は所有者）')
}
let emails
try {
  emails = JSON.parse(fs.readFileSync(listPath, 'utf8'))
} catch (e) {
  fail(`allowlist.local.json を読めません: ${e.message}`)
}
// ルールの文字列に埋め込むので、引用符などを含むものは受け付けない
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
if (!Array.isArray(emails) || emails.length === 0) fail('allowlist.local.json はアドレスの配列にしてください')
const bad = emails.filter((e) => typeof e !== 'string' || !EMAIL.test(e))
if (bad.length) fail(`アドレスの形式が正しくありません: ${bad.join(', ')}`)

const template = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
if (!MARKER.test(template)) fail('firestore.rules に /* ALLOWLIST */ の目印がありません')
const out = template.replace(MARKER, emails.map((e) => `'${e.toLowerCase()}'`).join(', '))
const header = '// 自動生成（scripts/build-rules.cjs）。編集は firestore.rules と allowlist.local.json に行う\n'
fs.writeFileSync(path.join(root, 'firestore.local.rules'), header + out)
console.log(`build-rules: firestore.local.rules を作成（${emails.length} 件）`)
