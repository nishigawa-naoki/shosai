// 旧形式（一覧用の文書に本文を持っていた）からの移行の確認。前提は e2e/README.md の sync.cjs と同じ
// 旧形式のデータはエミュレーターの管理者権限（ルールを通さない）で直接作る
const { launch, docText, ownerEmail } = require('./browser.cjs')
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const FS = 'http://127.0.0.1:8080/v1/projects/demo-novel/databases/(default)/documents'
const EMAIL = ownerEmail()

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + JSON.stringify(detail) : ''}`)
  if (!ok) failures++
}

// Firestore REST の値の形に変換
const toValue = (v) =>
  typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'string' ? { stringValue: v } : { nullValue: null }
async function put(path, data) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]))
  const res = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
}
async function get(path) {
  const res = await fetch(`${FS}/${path}`, { headers: { Authorization: 'Bearer owner' } })
  if (res.status === 404) return null
  const j = await res.json()
  return Object.fromEntries(Object.entries(j.fields ?? {}).map(([k, v]) => [k, Object.values(v)[0]]))
}

;(async () => {
  const browser = await launch()
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
  await page.goto(BASE + '/')
  await page.waitForFunction(() => window.__emulatorSignIn)
  const uid = await page.evaluate(async (e) => (await window.__emulatorSignIn(e)).user.uid, EMAIL)
  await page.waitForSelector('text=新しい作品')

  const stamp = Date.now()
  const w1 = `legacy-a-${stamp}`
  const w2 = `legacy-b-${stamp}`
  for (const w of [w1, w2]) await put(`users/${uid}/works/${w}`, { title: `旧作品${w === w1 ? 'A' : 'B'}`, createdAt: 1, updatedAt: stamp })
  await put(`users/${uid}/works/${w1}/episodes/e1`, { title: '旧第一話', body: '旧形式の本文です', order: 1, charCount: 8, updatedAt: 100 })
  await put(`users/${uid}/works/${w1}/notes/n1`, { kind: 'character', title: '旧メモ', body: '旧形式のメモ本文', order: 1, updatedAt: 100 })
  await put(`users/${uid}/works/${w2}/episodes/e2`, { title: '直接開く話', body: '一覧を通さずに開く本文', order: 1, charCount: 11, updatedAt: 100 })

  // ---- 作品を開くと移行される ----
  await page.goto(`${BASE}/works/${w1}`)
  await page.waitForSelector('text=旧第一話')
  await page.waitForTimeout(1500)
  const meta1 = await get(`users/${uid}/works/${w1}/episodes/e1`)
  const body1 = await get(`users/${uid}/works/${w1}/episodeBodies/e1`)
  check('一覧用の文書から本文が消える', meta1 && !('body' in meta1), meta1)
  check('本文の文書に移る', body1?.body === '旧形式の本文です' && body1?.title === '旧第一話', body1)
  check('文字数は一覧用に残る', meta1?.charCount === '8', meta1?.charCount)
  const noteMeta = await get(`users/${uid}/works/${w1}/notes/n1`)
  const noteBody = await get(`users/${uid}/works/${w1}/noteBodies/n1`)
  check('メモも移る（本文・種類・プレビュー）', noteBody?.body === '旧形式のメモ本文' && noteBody?.kind === 'character' && noteMeta?.preview === '旧形式のメモ本文' && !('body' in noteMeta), { noteMeta, noteBody })

  await page.click('text=旧第一話')
  await page.waitForSelector('.cm-content')
  await page.waitForTimeout(500)
  check('移行した話を開くと本文が出る', (await docText(page)) === '旧形式の本文です', await docText(page))

  // ---- 書いて戻ると、一覧の文字数・タイトルが更新される ----
  await page.click('.cm-content')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('追記')
  await page.fill('.title-input', '新しい題')
  await page.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout: 15000 })
  await page.click('[aria-label="戻る"]')
  await page.waitForSelector('text=新しい題')
  await page.waitForTimeout(800)
  const row = await page.$eval('.list-row', (e) => e.textContent)
  check('戻ると一覧のタイトル・文字数が新しい', row.includes('新しい題') && row.includes('10字'), row)

  // ---- 一覧を通さずに旧形式の話を直接開く ----
  await page.goto(`${BASE}/works/${w2}/episodes/e2`)
  await page.waitForSelector('.cm-content', { timeout: 15000 })
  await page.waitForTimeout(500)
  check('直接開いた旧形式の話も読める', (await docText(page)) === '一覧を通さずに開く本文', await docText(page))
  check('「見つかりません」は出ない', !(await page.$('text=見つかりませんでした')))

  // ---- 書き出しは本文の文書から読む ----
  await page.goto(`${BASE}/works/${w1}`)
  await page.waitForSelector('text=テキストで書き出し')
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=テキストで書き出し')])
  const exported = require('fs').readFileSync(await download.path(), 'utf8')
  check('書き出しに本文が入る', exported.includes('旧形式の本文です追記') && exported.includes('新しい題'), exported)

  // ---- 旧版のアプリの書き込み（ルール）----
  // 旧版は一覧用の文書へ title/body/baseUpdatedAt を書く。利用者本人のトークンで REST から再現する
  const token = await page.evaluate(async (e) => (await window.__emulatorSignIn(e)).user.getIdToken(), EMAIL)
  const legacyWrite = async (path, base, body = 'あ') => {
    const fields = { title: toValue('旧版'), body: toValue(body), baseUpdatedAt: toValue(base), updatedAt: toValue(Date.now()) }
    const mask = ['title', 'body', 'baseUpdatedAt', 'updatedAt'].map((f) => `updateMask.fieldPaths=${f}`).join('&')
    const res = await fetch(`${FS}/${path}?${mask}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    })
    return res.status
  }
  const migratedMeta = await get(`users/${uid}/works/${w1}/episodes/e1`)
  check(
    '移行済みの話へ旧版が本文を書き戻すのは拒否される',
    (await legacyWrite(`users/${uid}/works/${w1}/episodes/e1`, Number(migratedMeta.updatedAt))) === 403,
  )
  const bodyAfter = await get(`users/${uid}/works/${w1}/episodeBodies/e1`)
  check('本文の文書は無事', bodyAfter?.body === '旧形式の本文です追記', bodyAfter?.body)
  await put(`users/${uid}/works/${w1}/episodes/e9`, { title: '未移行', body: '未移行の本文', order: 9, charCount: 6, updatedAt: 500 })
  check('まだ移行していない話への旧版の書き込みは、版が合えば通る', (await legacyWrite(`users/${uid}/works/${w1}/episodes/e9`, 500)) === 200)
  check('版が合わなければ拒否される', (await legacyWrite(`users/${uid}/works/${w1}/episodes/e9`, 1, '別の内容')) === 403)

  // ---- 移行済みの印 ----
  const work1 = await get(`users/${uid}/works/${w1}`)
  check('作品に移行済みの印が付く', work1?.bodiesSplit === true, work1)

  // ---- 本文の文書と一覧用の文書の両方に違う本文がある（旧版が並行して書いた）→ 捨てずに資料として退避 ----
  const w3 = `legacy-c-${stamp}`
  await put(`users/${uid}/works/${w3}`, { title: '旧作品C', createdAt: 1, updatedAt: stamp })
  await put(`users/${uid}/works/${w3}/episodes/e3`, { title: '並行', body: '旧版で書いた本文', order: 1, charCount: 8, updatedAt: 300 })
  await put(`users/${uid}/works/${w3}/episodeBodies/e3`, { title: '並行', body: '新しい版の本文', updatedAt: 200 })
  await page.goto(`${BASE}/works/${w3}`)
  await page.waitForSelector('text=並行')
  await page.waitForTimeout(2000)
  const e3body = await get(`users/${uid}/works/${w3}/episodeBodies/e3`)
  const e3meta = await get(`users/${uid}/works/${w3}/episodes/e3`)
  check('既存の本文の文書は上書きしない', e3body?.body === '新しい版の本文', e3body?.body)
  check('一覧用の文書から本文が消える', e3meta && !('body' in e3meta), e3meta)
  await page.click('text=設定・資料')
  const rescued = await page.waitForSelector('text=【旧版で書かれた本文】並行', { timeout: 10000 }).then(Boolean, () => false)
  check('旧版の本文は資料のメモとして残る', rescued)
  if (rescued) {
    await page.click('text=【旧版で書かれた本文】並行')
    await page.waitForSelector('.cm-content')
    await page.waitForTimeout(500)
    check('資料のメモに旧版の本文が入っている', (await docText(page)) === '旧版で書いた本文', await docText(page))
  }

  // ---- 書いてすぐタブを閉じても、一覧の文字数が最新になる ----
  const ctx = page.context()
  const p2 = await ctx.newPage()
  await p2.goto(`${BASE}/works/${w2}/episodes/e2`)
  await p2.waitForSelector('.cm-content')
  await p2.click('.cm-content')
  await p2.keyboard.press('Control+End')
  await p2.keyboard.type('一')
  await p2.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout: 15000 })
  await p2.keyboard.type('二三四五') // 前回の一覧の書き込みから 15 秒以内・タイトルは同じ
  await p2.waitForTimeout(100)
  await p2.close({ runBeforeUnload: true }) // 自動保存の待ち時間（0.8秒）より前に閉じる
  const p3 = await ctx.newPage()
  await p3.goto(`${BASE}/works/${w2}`)
  await p3.waitForSelector('.list-row')
  await p3.waitForTimeout(3000)
  const row2 = await p3.$eval('.list-row', (e) => e.textContent)
  check('すぐ閉じても一覧の文字数が最新（11+5=16字）', row2.includes('16字'), row2)
  await p3.close()

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
  await browser.close()
  process.exit(failures ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
