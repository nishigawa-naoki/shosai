// 保存の失敗からの回復の確認（前提は e2e/README.md の sync.cjs と同じ）
// - 衝突を「この画面の版で保存」で解決したとき、一覧のタイトル・文字数も書き直される
// - 編集中に他の端末で削除されたとき、保存できなかった入力を「見つかりませんでした」の画面で控えられる
// - Markdown のプレビューで、スキーム省略（//host）の外部リンクも別タブで開く
const { launch, ownerEmail } = require('./browser.cjs')
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const EMAIL = ownerEmail()
const PROJECT = 'demo-novel'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`

/** エミュレーターの管理者権限で文書を消す（もう1台の端末からの削除を、間を置かずに起こすため） */
async function adminDelete(docPath) {
  const res = await fetch(`${FS}/${docPath}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })
  if (!res.ok) throw new Error(`${docPath}: ${res.status}`)
}
async function uidOf(email) {
  const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnUserInfo: true }),
  })
  return (await res.json()).userInfo.find((u) => u.email === email).localId
}

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + JSON.stringify(detail) : ''}`)
  if (!ok) failures++
}

async function signedIn(browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '' : undefined))
  await page.goto(BASE + '/')
  await page.waitForFunction(() => window.__emulatorSignIn)
  await page.evaluate((e) => window.__emulatorSignIn(e), EMAIL)
  await page.waitForSelector('text=新しい作品')
  return page
}
const waitSynced = (p) =>
  p.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout: 20000 })
async function typeAtEnd(p, s) {
  await p.click('.cm-content')
  await p.keyboard.press('Control+End')
  await p.keyboard.type(s)
}

;(async () => {
  const browser = await launch()
  try {
    const A = await signedIn(browser)
    await A.click('text=新しい作品')
    await A.fill('.modal .text-input', '回復テスト')
    await A.click('.modal button[type=submit]')
    await A.waitForURL(/\/works\/[^/]+$/)
    const workUrl = A.url()
    await A.click('text=話を追加')
    await A.waitForURL(/episodes/)
    const epUrl = A.url()
    await A.fill('.title-input', '元の題')
    await typeAtEnd(A, 'はじめ')
    await waitSynced(A)

    // ---- 衝突の解決で一覧も書き直される ----
    const B = await signedIn(browser)
    await B.goto(epUrl)
    await B.waitForSelector('.cm-content')
    await waitSynced(B)
    await A.context().setOffline(true)
    await A.fill('.title-input', '新しい題')
    await typeAtEnd(A, '（Aの追記）')
    await A.waitForTimeout(1500)
    await typeAtEnd(B, '（Bの追記）')
    await waitSynced(B)
    await A.context().setOffline(false)
    await A.waitForSelector('.problem-banner', { timeout: 30000 })
    await A.click('text=この画面の版で保存')
    await waitSynced(A)
    await A.goto(workUrl)
    await A.waitForSelector('.list-item')
    const title = await A.textContent('.list-item .list-title')
    check('衝突を解決すると一覧のタイトルも新しくなる', title === '新しい題', title)

    // ---- 編集中に他の端末で削除された ----
    await A.goto(epUrl)
    await A.waitForSelector('.cm-content')
    await waitSynced(A)
    await A.context().setOffline(true)
    await typeAtEnd(A, '（削除直前の入力）')
    await A.waitForTimeout(1500)
    // setOffline は張られたままの通信を切らないことがあり、そのときは入力がもう保存されている（退避が消える）。
    // その回は「保存できなかった入力」が無いので、この確認の対象外にする
    const pending = await A.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('novel-editor:unsaved:')))
    await B.goto(epUrl)
    await B.waitForSelector('.cm-content')
    await B.click('button[aria-label="メニュー"]')
    await B.click('text=この話を削除')
    await B.waitForURL(/\/works\/[^/]+$/)
    // B の削除がサーバーに届いてから A をオンラインに戻す（先に戻すと A の入力が先に保存され、その後で削除される）
    {
      const [, , wId, , eId] = new URL(epUrl).pathname.split('/')
      const bodyPath = `users/${await uidOf(EMAIL)}/works/${wId}/episodeBodies/${eId}`
      for (let i = 0; i < 50; i++) {
        const res = await fetch(`${FS}/${bodyPath}`, { headers: { Authorization: 'Bearer owner' } })
        if (res.status === 404) break
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    await A.context().setOffline(false)
    await A.waitForSelector('text=見つかりませんでした', { timeout: 30000 })
    if (pending) {
      await A.waitForSelector('text=保存できなかった編集内容', { timeout: 5000 }).catch(() => {})
      check('削除された文書の未保存の入力が案内される', !!(await A.$('text=保存できなかった編集内容')))
      await A.click('.problem-banner button:has-text("捨てる")')
      const left = await A.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('novel-editor:unsaved:')))
      check('捨てると退避が消える', left.length === 0, left)
    } else {
      console.log('SKIP  削除された文書の未保存の入力（オフラインにできず、入力が先に保存された）')
    }

    // ---- オンラインのまま、保存の待ち時間中に削除が届いた ----
    await A.goto(workUrl)
    await A.click('text=話を追加')
    await A.waitForURL(/episodes/)
    await A.waitForSelector('.cm-content')
    await waitSynced(A)
    const [, , workId, , epId] = new URL(A.url()).pathname.split('/')
    const uid = await uidOf(EMAIL)
    await typeAtEnd(A, '待ち時間中の入力')
    // 自動保存（入力が止まって 800ms 後）より前に、他の端末で削除されたことにする
    await adminDelete(`users/${uid}/works/${workId}/episodes/${epId}`)
    await adminDelete(`users/${uid}/works/${workId}/episodeBodies/${epId}`)
    await A.waitForSelector('text=見つかりませんでした', { timeout: 30000 })
    await A.waitForSelector('text=保存できなかった編集内容', { timeout: 5000 }).catch(() => {})
    check('保存の待ち時間中に削除されても、直前の入力が案内される', !!(await A.$('text=保存できなかった編集内容')))
    await A.click('.problem-banner button:has-text("捨てる")')

    // ---- Markdown のリンク ----
    await A.goto(workUrl + '?tab=notes')
    await A.click('.note-group >> nth=0 >> button:has-text("追加")')
    await A.waitForURL(/notes/)
    await typeAtEnd(A, '[外部](//example.com/x) [内部](/settings)')
    await A.click('button[aria-label="プレビュー"]')
    await A.waitForSelector('.md-preview a')
    const links = await A.$$eval('.md-preview a', (as) => as.map((a) => [a.textContent, a.getAttribute('target')]))
    check(
      'スキーム省略の外部リンクは別タブ、アプリ内のリンクは同じタブ',
      JSON.stringify(links) === JSON.stringify([['外部', '_blank'], ['内部', null]]),
      links,
    )
  } finally {
    await browser.close()
  }
  console.log(failures ? `\n${failures} 件失敗` : '\nALL PASSED')
  process.exit(failures ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
