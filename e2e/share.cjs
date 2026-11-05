// 作品の共有（編集可・閲覧のみ）の動作確認。前提は e2e/README.md の sync.cjs と同じ
// 共有相手のアカウントが要るので、テスト中だけエミュレーターのルールの許可リストにテスト用アドレスを足す
// （ルールのファイルは書き換えない。終わったら元のルールを読み込ませ直す）
const fs = require('fs')
const path = require('path')
const { launch, docText, ownerEmail } = require('./browser.cjs')
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const PROJECT = 'demo-novel'
const EMU = 'http://127.0.0.1:8080'
const FS = `${EMU}/v1/projects/${PROJECT}/databases/(default)/documents`
const OWNER = ownerEmail()
const EDITOR = 'share-editor@example.com'
const VIEWER = 'share-viewer@example.com'
const OTHER = 'share-other@example.com' // ログインはできるが共有されていない

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.local.rules'), 'utf8')
const TEST_RULES = RULES.replace(
  /(request\.auth\.token\.email in \[)/,
  `$1'${EDITOR}', '${VIEWER}', '${OTHER}', `,
)
if (TEST_RULES === RULES) throw new Error('firestore.local.rules の許可リストが見つかりません')

async function loadRules(content) {
  const res = await fetch(`${EMU}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  })
  if (!res.ok) throw new Error(`ルールを読み込めません: ${res.status} ${await res.text()}`)
}

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + JSON.stringify(detail) : ''}`)
  if (!ok) failures++
}

// エミュレーターは署名なしの ID トークンを受け付ける。アプリの __emulatorSignIn と同じく sub = アドレス
function token(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: email,
    user_id: email,
    email,
    email_verified: true,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: 'google.com' },
  })}.`
}
/** ルールを通した REST の書き込み。戻り値は HTTP ステータス */
async function patchAs(email, docPath, fields, mask) {
  const q = mask.map((f) => `updateMask.fieldPaths=${f}`).join('&')
  const res = await fetch(`${FS}/${docPath}?${q}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token(email)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  return res.status
}
async function getAs(email, docPath) {
  const res = await fetch(`${FS}/${docPath}`, { headers: { Authorization: `Bearer ${token(email)}` } })
  return res.status
}

async function signedIn(browser, email) {
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE + '/')
  await page.waitForFunction(() => window.__emulatorSignIn)
  await page.evaluate((e) => window.__emulatorSignIn(e), email)
  await page.waitForSelector('text=新しい作品')
  return page
}
const waitSynced = (p) =>
  p.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout: 20000 })

;(async () => {
  await loadRules(TEST_RULES)
  const browser = await launch()
  try {
    // ---- 持ち主：作品・話・メモを作って共有する ----
    const A = await signedIn(browser, OWNER)
    await A.click('text=新しい作品')
    await A.fill('.modal .text-input', '共有テスト作品')
    await A.click('.modal button[type=submit]')
    await A.waitForURL(/\/works\/[^/]+$/)
    const workId = new URL(A.url()).pathname.split('/').pop()
    await A.click('text=話を追加')
    await A.waitForURL(/episodes/)
    const episodeId = new URL(A.url()).pathname.split('/').pop()
    await A.click('.cm-content')
    await A.keyboard.type('持ち主の本文')
    await waitSynced(A)
    await A.click('a[aria-label="戻る"]')
    await A.waitForURL(/\/works\/[^/]+$/)

    await A.click('button:has-text("共有")')
    const dialog = '.share-modal'
    await A.fill(`${dialog} input[type=email]`, OWNER)
    await A.click(`${dialog} .share-add button[type=submit]`)
    check('自分のアドレスは追加できない', (await A.textContent(`${dialog} .error`))?.includes('自分'))
    await A.fill(`${dialog} input[type=email]`, ` ${EDITOR.toUpperCase()} `)
    await A.click(`${dialog} .share-add .chip:has-text("編集可")`)
    await A.click(`${dialog} .share-add button[type=submit]`)
    await A.fill(`${dialog} input[type=email]`, VIEWER)
    await A.click(`${dialog} .share-add .chip:has-text("閲覧のみ")`)
    await A.click(`${dialog} .share-add button[type=submit]`)
    const listed = await A.$$eval(`${dialog} .share-email`, (els) => els.map((e) => e.textContent))
    check('共有相手が小文字に揃えて一覧に入る', JSON.stringify(listed) === JSON.stringify([EDITOR, VIEWER]), listed)
    await A.click(`${dialog} button.primary:has-text("保存")`)
    await A.waitForSelector('button:has-text("共有中（2人）")')
    check('持ち主の画面に共有人数が出る', true)

    // ---- 編集可の相手 ----
    const E = await signedIn(browser, EDITOR)
    await E.waitForSelector('.shared-works .work-card')
    const card = await E.textContent('.shared-works .work-card')
    check('共有された作品が一覧に出る（権限・持ち主つき）', card.includes('共有テスト作品') && card.includes('編集可') && card.includes(OWNER), card)
    await E.click('.shared-works .work-card')
    await E.waitForURL(/\/shared\/[^/]+\/[^/]+$/)
    const ownerUid = new URL(E.url()).pathname.split('/')[2]
    await E.waitForSelector('.list-item:has-text("無題")')
    check('編集可：名前の変更・共有・削除のボタンが無い', !(await E.$('text=名前を変更')) && !(await E.$('button:has-text("共有")')) && !(await E.$('text=作品を削除')))
    check('編集可：話を追加できる', !!(await E.$('text=話を追加')))
    await E.click('.list-item:has-text("無題")')
    await E.waitForURL(/\/shared\/.+\/episodes\//)
    await E.click('.cm-content')
    await E.keyboard.press('Control+End')
    await E.keyboard.type('＋編集者の追記')
    await waitSynced(E)
    check('編集可：本文を保存できる', true)

    await A.click('.list-item:has-text("無題")')
    await A.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('編集者の追記'), null, { timeout: 10000 })
    check('持ち主の画面に編集者の変更が反映される', (await docText(A)) === '持ち主の本文＋編集者の追記', await docText(A))

    // ---- 閲覧のみの相手 ----
    const V = await signedIn(browser, VIEWER)
    await V.waitForSelector('.shared-works .work-card')
    check('閲覧のみ：一覧に「閲覧のみ」と出る', (await V.textContent('.shared-works .work-card')).includes('閲覧のみ'))
    await V.click('.shared-works .work-card')
    await V.waitForURL(/\/shared\//)
    await V.waitForSelector('.list-item:has-text("無題")')
    check('閲覧のみ：作品の見出しに「閲覧のみ」と出る', (await V.textContent('.page-header .badge')) === '閲覧のみ')
    check('閲覧のみ：話を追加・並べ替えのボタンが無い', !(await V.$('text=話を追加')) && !(await V.$('.order-btns')))
    await V.click('.list-item:has-text("無題")')
    await V.waitForSelector('.cm-content')
    check('閲覧のみ：本文が読める', (await docText(V)) === '持ち主の本文＋編集者の追記')
    check('閲覧のみ：状態に「閲覧のみ」と出る', (await V.textContent('.status')) === '閲覧のみ')
    check('閲覧のみ：本文は編集できない', (await V.getAttribute('.cm-content', 'contenteditable')) === 'false')
    check('閲覧のみ：タイトルは編集できない', (await V.getAttribute('.title-input', 'readonly')) !== null)

    // ---- ルールでの拒否（アプリを通さない書き込み） ----
    const epBody = `users/${ownerUid}/works/${workId}/episodeBodies/${episodeId}`
    const work = `users/${ownerUid}/works/${workId}`
    check('ルール：閲覧のみは本文を書けない', (await patchAs(VIEWER, epBody, { format: { stringValue: 'markdown' } }, ['format'])) === 403)
    check('ルール：編集可でも作品名は変えられない', (await patchAs(EDITOR, work, { title: { stringValue: 'x' } }, ['title'])) === 403)
    check(
      'ルール：編集可でも共有の設定は変えられない',
      (await patchAs(EDITOR, work, { editors: { arrayValue: { values: [{ stringValue: VIEWER }] } } }, ['editors'])) === 403,
    )
    check('ルール：編集可は更新日時を書ける', (await patchAs(EDITOR, work, { updatedAt: { integerValue: String(Date.now()) } }, ['updatedAt'])) === 200)
    check('ルール：共有されていない人は読めない', (await getAs(OTHER, epBody)) === 403 && (await getAs(OTHER, work)) === 403)
    check('ルール：許可リスト外の人は読めない', (await getAs('stranger@example.com', work)) === 403)

    // ---- 共有の解除 ----
    await A.click('a[aria-label="戻る"]')
    await A.click('button:has-text("共有中")')
    await A.click(`${dialog} button[aria-label="${VIEWER} との共有を解除"]`)
    await A.click(`${dialog} button.primary:has-text("保存")`)
    await A.waitForSelector('button:has-text("共有中（1人）")')
    await V.goto(BASE + `/shared/${ownerUid}/${workId}`)
    await V.waitForSelector('text=共有が解除されています', { timeout: 10000 })
    check('解除された相手は作品を開けない', true)
    await V.goto(BASE + '/')
    await V.waitForSelector('text=新しい作品')
    await V.waitForTimeout(1500)
    check('解除された相手の一覧から消える', !(await V.$('.shared-works')))
    check('ルール：解除後は読めない', (await getAs(VIEWER, epBody)) === 403)

    // ---- 編集中に共有を解除された：保存できなかった入力を控えられる ----
    // 送信が届く前に解除されるよう、編集者をオフラインにして入力し、解除してからオンラインに戻す
    await E.context().setOffline(true)
    await E.click('.cm-content')
    await E.keyboard.press('Control+End')
    await E.keyboard.type('＋解除直前の入力')
    await E.waitForTimeout(1500) // 自動保存（端末への退避）を待つ
    await A.click('button:has-text("共有中")')
    await A.click(`${dialog} button[aria-label="${EDITOR} との共有を解除"]`)
    await A.click(`${dialog} button.primary:has-text("保存")`)
    await A.waitForSelector('.page-header button:text-is("共有")')
    await A.waitForTimeout(1000)
    await E.context().setOffline(false)
    await E.waitForSelector('text=共有が解除されています', { timeout: 30000 })
    await E.waitForSelector('text=保存できなかった編集内容', { timeout: 5000 }).catch(() => {})
    check('編集中に解除：保存できなかった入力が案内される', !!(await E.$('text=保存できなかった編集内容')))
    await E.click('button:has-text("捨てる")')
    check('編集中に解除：捨てると退避が消える', !(await E.$('text=保存できなかった編集内容')))
    check('ルール：解除後の編集者は本文を書けない', (await patchAs(EDITOR, epBody, { format: { stringValue: 'plain' } }, ['format'])) === 403)

    check('持ち主の一覧には「共有された作品」が出ない', !(await (await signedIn(browser, OWNER)).$('.shared-works')))
  } finally {
    await browser.close()
    await loadRules(RULES)
  }
  console.log(failures ? `\n${failures} 件失敗` : '\nすべて成功')
  process.exit(failures ? 1 : 0)
})().catch(async (e) => {
  console.error(e)
  await loadRules(RULES).catch(() => {})
  process.exit(1)
})
