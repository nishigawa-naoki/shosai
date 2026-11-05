// 2台の端末（A=PC, B=スマホ）での同期・衝突の動作確認。前提は e2e/README.md を参照
const { launch, docText, ownerEmail } = require('./browser.cjs')
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
// 本番と同じルール（firestore.local.rules）をそのまま使い、そこに書かれた所有者のアドレスでログインする
// （エミュレーターは任意のアドレスでログインできるので、ルールを書き換える必要はない）
const EMAIL = ownerEmail()

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

async function open(ctx, url) {
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'テスト作品' : undefined))
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
  await page.goto(BASE + url)
  return page
}
const text = docText
const status = (p) => p.$eval('.status', (e) => e.textContent)
const hasBanner = (p) => p.$('.problem-banner').then(Boolean)
async function waitSynced(p, timeout = 20000) {
  await p.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout })
}
async function typeAtEnd(p, s) {
  await p.click('.cm-content')
  await p.keyboard.press('Control+End')
  await p.keyboard.type(s)
}

;(async () => {
  const browser = await launch()
  const ctxA = await browser.newContext() // PC
  const ctxB = await browser.newContext() // スマホ

  // ---- ログイン・作品と話の作成 ----
  let A = await open(ctxA, '/')
  await A.waitForFunction(() => window.__emulatorSignIn)
  await A.evaluate((e) => window.__emulatorSignIn(e), EMAIL)
  await A.click('text=新しい作品')
  await A.fill('.modal .text-input', 'テスト作品')
  await A.click('.modal button[type=submit]')
  await A.waitForURL(/\/works\/[^/]+$/)
  await A.click('text=話を追加')
  await A.waitForURL(/episodes/)
  const epUrl = new URL(A.url()).pathname
  const workUrl = epUrl.replace(/\/episodes\/.*/, '')
  await typeAtEnd(A, 'はじめ')
  await waitSynced(A)
  check('A: 初回保存が同期済みになる', true)

  let B = await open(ctxB, '/')
  await B.waitForFunction(() => window.__emulatorSignIn)
  await B.evaluate((e) => window.__emulatorSignIn(e), EMAIL)
  await B.waitForSelector('text=作品')
  await B.goto(BASE + epUrl)
  await B.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'はじめ', null, { timeout: 15000 })
  check('B: 同じ話を開くと A の内容が見える', true)

  // ---- S1: 古い画面（オフライン中）からの上書きを防ぐ ----
  await ctxB.setOffline(true)
  await B.waitForTimeout(1500)
  await typeAtEnd(A, 'PC追記')
  await waitSynced(A)
  await typeAtEnd(B, 'x')
  await B.waitForTimeout(1500) // 自動保存（未送信のまま端末に溜まる）
  await ctxB.setOffline(false)
  await B.waitForSelector('.problem-banner', { timeout: 30000 }).catch(() => {})
  check('S1: B に衝突のバナーが出る', await hasBanner(B))
  check('S1: B の画面の内容は残る', (await text(B)) === 'はじめx', JSON.stringify(await text(B)))
  await A.waitForTimeout(2000)
  check('S1: A（新しい版）は上書きされない', (await text(A)) === 'はじめPC追記', JSON.stringify(await text(A)))

  // 解決：B の版で保存 → A に反映される
  await B.click('text=この画面の版で保存')
  await waitSynced(B)
  await A.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'はじめx', null, { timeout: 15000 }).catch(() => {})
  check('S1: 「この画面の版で保存」で A にも反映される', (await text(A)) === 'はじめx', JSON.stringify(await text(A)))
  check('S1: B のバナーが消える', !(await hasBanner(B)))

  // ---- S2: 他端末の更新を取り込んでもカーソルが先頭に飛ばない ----
  await B.click('.cm-content')
  await B.keyboard.press('Control+Home')
  await B.keyboard.type('前')
  await waitSynced(B)
  await A.waitForFunction(() => document.querySelector('.cm-content')?.textContent === '前はじめx', null, { timeout: 15000 }).catch(() => {})
  await A.keyboard.type('Z') // A はフォーカスしたまま。カーソルは末尾にあるはず
  await A.waitForTimeout(300)
  check('S2: A のカーソル位置が保たれる', (await text(A)) === '前はじめxZ', JSON.stringify(await text(A)))
  await waitSynced(A)

  // ---- S5: オフラインで書いたまま閉じ、その間に他端末が更新 → 開き直すと検出 ----
  await B.waitForFunction(() => document.querySelector('.cm-content')?.textContent === '前はじめxZ', null, { timeout: 15000 }).catch(() => {})
  await ctxB.setOffline(true)
  await B.waitForTimeout(1500)
  await typeAtEnd(B, '（電車で）')
  await B.waitForTimeout(1500)
  await B.close()
  await typeAtEnd(A, '（PCで）')
  await waitSynced(A)
  await ctxB.setOffline(false)
  B = await open(ctxB, epUrl)
  await B.waitForSelector('.problem-banner', { timeout: 30000 }).catch(() => {})
  check('S5: 開き直した B に衝突のバナーが出る', await hasBanner(B))
  check('S5: B の内容（電車で）は残る', (await text(B)).includes('（電車で）'), JSON.stringify(await text(B)))
  await A.waitForTimeout(1500)
  check('S5: A（PCで）は上書きされない', (await text(A)).endsWith('（PCで）'), JSON.stringify(await text(A)))
  await B.click('text=サーバーの版を読み込む')
  await B.waitForTimeout(500)
  check('S5: 「サーバーの版を読み込む」で A の版になる', (await text(B)) === (await text(A)), JSON.stringify(await text(B)))
  check('S5: 退避データが消える', await B.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith('novel-editor:unsaved:'))))

  // ---- 通常の連続編集で誤検出しない ----
  for (const s of ['一', '二', '三']) {
    await typeAtEnd(A, s)
    await waitSynced(A)
  }
  check('連続編集で誤って衝突扱いにならない', !(await hasBanner(A)))

  // ---- S3: 大きすぎる文書 → 画面の内容は消えずにバナー ----
  await A.click('.cm-content')
  await A.keyboard.press('Control+End')
  await A.keyboard.insertText('あ'.repeat(400000))
  await A.waitForSelector('.problem-banner', { timeout: 30000 }).catch(() => {})
  const big = await A.evaluate(() => document.querySelector('.cm-content').cmView?.view?.state.doc.length ?? -1)
  check('S3: 保存失敗のバナーが出る', await hasBanner(A), (await A.$eval('.problem-banner p', (e) => e.textContent).catch(() => '')))
  check('S3: 入力した長文は画面に残る', big === -1 ? (await status(A)) === '未保存' : big > 400000, `len=${big}`)
  await A.click('text=サーバーの版を読み込む')

  // ---- メモ：種類を変えても衝突扱いにならない ----
  await A.goto(BASE + workUrl + '?tab=notes')
  await A.click('.note-group:nth-of-type(3) >> text=追加')
  await A.waitForURL(/notes/)
  await typeAtEnd(A, 'メモ')
  await waitSynced(A)
  await A.click('.chip >> text=キャラクター')
  await A.waitForTimeout(500)
  await typeAtEnd(A, '2')
  await waitSynced(A)
  check('メモの種類変更後の編集で衝突扱いにならない', !(await hasBanner(A)))

  // placeholder の切り替え（空のメモで確認）
  await A.goto(BASE + workUrl + '?tab=notes')
  await A.click('.note-group:nth-of-type(1) >> text=追加')
  await A.waitForURL(/notes/)
  await A.waitForSelector('.cm-placeholder')
  const before = await A.$eval('.cm-placeholder', (e) => e.textContent)
  await A.click('.chip >> text=資料')
  await A.waitForFunction((b) => document.querySelector('.cm-placeholder')?.textContent !== b, before, { timeout: 5000 }).catch(() => {})
  const after = await A.$eval('.cm-placeholder', (e) => e.textContent)
  check('placeholder が種類に合わせて変わる', before !== after, `${before} → ${after}`)

  // ---- 並べ替え ----
  await A.goto(BASE + workUrl)
  await A.click('text=話を追加')
  await A.waitForURL(/episodes/)
  await typeAtEnd(A, '第二話の本文')
  await A.fill('.title-input', '第二話')
  await waitSynced(A)
  await A.goto(BASE + workUrl)
  await A.waitForSelector('.list-row >> nth=1')
  const titles = () => A.$$eval('.list-row .list-title', (els) => els.map((e) => e.textContent))
  const t0 = await titles()
  await A.click('.list-row >> nth=1 >> [aria-label="上へ"]')
  await A.waitForTimeout(800)
  const t1 = await titles()
  check('並べ替えで順番が入れ替わる', t0[1].includes('第二話') && t1[0].includes('第二話'), JSON.stringify([t0, t1]))

  // ---- R2: 衝突中に書き足し → オフラインで形式変更（本文以外の未送信）→ 開き直しても退避の内容が出る ----
  await A.goto(BASE + epUrl)
  await A.waitForSelector('.cm-content')
  await waitSynced(A)
  await B.goto(BASE + epUrl)
  await B.waitForSelector('.cm-content')
  await waitSynced(B)
  await ctxB.setOffline(true)
  await B.waitForTimeout(1500)
  await typeAtEnd(A, '【A更新】')
  await waitSynced(A)
  await typeAtEnd(B, '【B1】')
  await B.waitForTimeout(1500)
  await ctxB.setOffline(false)
  await B.waitForSelector('.problem-banner', { timeout: 30000 })
  await typeAtEnd(B, '【B2】') // 衝突中の書き足し（退避のみ）
  await B.waitForTimeout(1500)
  await ctxB.setOffline(true)
  await B.waitForTimeout(1500)
  await B.click('[aria-label="メニュー"]')
  await B.click('.toggle >> input') // Markdown 切り替え（本文以外の未送信の書き込み）
  await B.waitForTimeout(500)
  await B.close()
  // 開発サーバーには SW が無いので、ページは読めるようにして Firestore への通信だけ遮断する（＝Firestore はオフライン）
  await ctxB.route('http://127.0.0.1:8080/**', (r) => r.abort())
  await ctxB.setOffline(false)
  B = await open(ctxB, epUrl)
  await B.waitForSelector('.cm-content', { timeout: 15000 })
  await B.waitForTimeout(1000)
  const r2 = await text(B)
  check('R2: 開き直すと退避の内容（B1・B2）が表示される', r2.includes('【B1】') && r2.includes('【B2】'), JSON.stringify(r2))
  check('R2: 衝突のバナーが出る', await hasBanner(B))
  await ctxB.unroute('http://127.0.0.1:8080/**')
  await B.waitForTimeout(3000)
  await B.click('text=この画面の版で保存')
  await waitSynced(B)
  await A.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('【B2】'), null, { timeout: 15000 }).catch(() => {})
  check('R2: 「この画面の版で保存」で B2 まで A に反映される', (await text(A)).includes('【B2】'), JSON.stringify(await text(A)))

  // ---- R3: 入力直後に削除しても退避が残らない ----
  await A.goto(BASE + workUrl)
  await A.click('text=話を追加')
  await A.waitForURL(/episodes/)
  await typeAtEnd(A, '消す話')
  await A.click('[aria-label="メニュー"]')
  await A.click('text=この話を削除')
  await A.waitForURL(/\/works\/[^/]+$/)
  await A.waitForTimeout(1500)
  const left = await A.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('novel-editor:unsaved:')))
  check('R3: 削除後に退避が残らない', left.length === 0, JSON.stringify(left))

  // ---- 所有者以外のアカウント：利用できない旨を表示する ----
  const ctxC = await browser.newContext()
  const C = await open(ctxC, '/')
  await C.waitForFunction(() => window.__emulatorSignIn)
  await C.evaluate(() => window.__emulatorSignIn('stranger@example.com'))
  const denied = await C.waitForSelector('text=このアカウントでは利用できません', { timeout: 15000 }).then(Boolean, () => false)
  check('所有者以外でログインすると「利用できません」と表示される', denied)

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
  await browser.close()
  process.exit(failures ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
