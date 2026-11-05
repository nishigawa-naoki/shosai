// 動作確認スクリプト共通：手元のブラウザ（Chromium 系）を探して起動する
const fs = require('fs')
const { chromium } = require('playwright-core')

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/opt/pw-browsers/chromium', // リモート実行環境
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
]

function launch() {
  const executablePath = CANDIDATES.find((p) => p && fs.existsSync(p))
  if (!executablePath) throw new Error('ブラウザが見つかりません。BROWSER_PATH を指定してください')
  return chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
}

/**
 * エディタの本文を取り出す。innerText は空行を二重に数え、placeholder の文字も拾うので、
 * 行要素ごとに placeholder を除いて読む
 */
function docText(page) {
  return page.$$eval('.cm-content .cm-line', (lines) =>
    lines
      .map((l) =>
        [...l.childNodes]
          .filter((n) => !(n.nodeType === 1 && n.classList.contains('cm-placeholder')))
          .map((n) => (n.nodeName === 'BR' ? '' : n.textContent))
          .join(''),
      )
      .join('\n'),
  )
}

/**
 * 使っているルール（firestore.local.rules：npm run rules で作る）の許可リストの先頭（所有者）のアドレス。
 * エミュレーターは任意のアドレスでログインできるので、ルールを書き換えずにこのアドレスでログインする
 */
function ownerEmail() {
  const rules = fs.readFileSync(require('path').join(__dirname, '..', 'firestore.local.rules'), 'utf8')
  const m = rules.match(/request\.auth\.token\.email in \[\s*'([^']+)'/)
  if (!m) throw new Error('firestore.local.rules から所有者のアドレスを読み取れません。先に npm run rules を実行してください')
  return m[1]
}

module.exports = { launch, docText, ownerEmail }
