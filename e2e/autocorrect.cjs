// 自動修正・作品作成ダイアログ・設定画面の動作確認（前提は e2e/README.md の sync.cjs と同じ）
const { launch, docText, ownerEmail } = require('./browser.cjs')
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const EMAIL = ownerEmail()

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + JSON.stringify(detail) : ''}`)
  if (!ok) failures++
}
const text = docText
const clear = async (p) => {
  await p.click('.cm-content')
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
}

;(async () => {
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
  await page.goto(BASE + '/')
  await page.waitForFunction(() => window.__emulatorSignIn)
  await page.evaluate((e) => window.__emulatorSignIn(e), EMAIL)
  await page.waitForSelector('text=新しい作品')

  // 前回の実行で有効のまま残っていても、既定（すべて無効）から始める
  await page.goto(BASE + '/settings')
  await page.waitForSelector('.setting-row')
  await page.waitForTimeout(800)
  for (const b of await page.$$('.autocorrect-section input[type=checkbox]')) if (await b.isChecked()) await b.click()
  await page.waitForTimeout(500)
  await page.goto(BASE + '/')

  // ---- 作品作成はアプリ内のダイアログ ----
  let nativeDialog = false
  page.on('dialog', (d) => {
    if (d.type() === 'prompt') nativeDialog = true
    d.accept()
  })
  await page.click('text=新しい作品')
  await page.waitForSelector('.modal .text-input')
  check('作品作成でアプリ内のダイアログが開く', !nativeDialog)
  await page.fill('.modal .text-input', 'ダイアログ作品')
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/works\/[^/]+$/)
  const h1Is = (s) =>
    page
      .waitForFunction((t) => document.querySelector('.page-header h1')?.textContent === t, s, { timeout: 10000 })
      .then(() => true, () => false)
  check('Enter で作成され、作品名が入る', await h1Is('ダイアログ作品'))
  await page.click('text=名前を変更')
  await page.fill('.modal .text-input', '改名した作品')
  await page.click('.modal button[type=submit]')
  check('名前の変更もダイアログで行える', await h1Is('改名した作品'))
  check('ダイアログが閉じる', !(await page.$('.modal')))
  const workUrl = new URL(page.url()).pathname

  // ---- 既定（すべて無効）では何も直さない ----
  await page.click('text=話を追加')
  await page.waitForURL(/episodes/)
  const epUrl = new URL(page.url()).pathname
  await page.click('.cm-content')
  await page.keyboard.type('えっ!何...「')
  await page.keyboard.press('Enter')
  await page.keyboard.type('次')
  await page.waitForTimeout(200)
  check('既定ではすべて無効（入力のまま）', (await text(page)) === 'えっ!何...「\n次', await text(page))

  // ---- 設定画面で全部有効にする ----
  await page.goto(BASE + '/settings')
  await page.waitForSelector('.setting-row')
  await page.waitForTimeout(800)
  const boxes = await page.$$('.autocorrect-section input[type=checkbox]')
  for (const b of boxes) if (!(await b.isChecked())) await b.click()
  check('設定画面に自動修正の項目が7つある', boxes.length === 7, boxes.length)
  await page.waitForTimeout(500)
  await page.goto(BASE + epUrl)
  await page.waitForSelector('.cm-content')
  await page.waitForTimeout(1500)
  // 直前に入力してすぐ別ページへ移った（書き込みが届く前に閉じた）が、他端末は触っていない
  check('すぐ閉じても、開き直すと確認なしで内容が戻り保存される', !(await page.$('.problem-banner')) && (await text(page)) === 'えっ!何...「\n次', await text(page))
  check('その後「同期済み」になる', await page.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout: 15000 }).then(() => true, () => false))

  const cases = [
    ['三点リーダー', '彼は...', '彼は……'],
    ['ダッシュ', 'それは--', 'それは――'],
    ['！の後に空白（全角化も）', 'えっ!何', 'えっ！　何'],
    ['閉じ括弧の補完と二重防止', '「はい。」', '「はい」'],
    ['会話文の行頭は字下げしない', '\n「よし」', '\n「よし」'],
  ]
  for (const [label, input, want] of cases) {
    await clear(page)
    await page.keyboard.type(input)
    await page.waitForTimeout(150)
    const got = await text(page)
    // 字下げ有効時、Enter の後は全角スペースが入る（括弧で始めたら外れる）
    check(`自動修正: ${label}`, got === want, got)
  }

  await clear(page)
  await page.keyboard.type('一行目')
  await page.keyboard.press('Enter')
  await page.keyboard.type('二行目')
  await page.waitForTimeout(150)
  check('字下げ: 改行で段落頭に全角スペース', (await text(page)) === '一行目\n　二行目', await text(page))

  await clear(page)
  await page.keyboard.type('彼は...')
  await page.waitForTimeout(150)
  await page.keyboard.press('Control+Z')
  await page.waitForTimeout(150)
  check('Ctrl+Z で修正だけ取り消せる', (await text(page)) === '彼は...', await text(page))

  // Markdown モードでは自動修正しない
  await clear(page)
  await page.click('[aria-label="メニュー"]')
  await page.click('.toggle >> input')
  await page.click('.editor-menu')
  await page.click('.cm-content')
  await page.keyboard.type('--- ...')
  await page.waitForTimeout(150)
  check('Markdown モードでは直さない', (await text(page)) === '--- ...', await text(page))

  // 見た目の確認用
  await page.click('[aria-label="メニュー"]')
  await page.click('.toggle >> input')
  await page.click('.editor-menu')
  await clear(page)
  await page.keyboard.type('「ここが書く場所」')
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'novel-editor-editor.png') })

  // 後片付け：設定を元に戻す
  await page.goto(BASE + '/settings')
  await page.waitForSelector('.setting-row')
  await page.waitForTimeout(800)
  for (const b of await page.$$('.autocorrect-section input[type=checkbox]')) if (await b.isChecked()) await b.click()
  await page.waitForTimeout(500)
  void workUrl

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
  await browser.close()
  process.exit(failures ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
