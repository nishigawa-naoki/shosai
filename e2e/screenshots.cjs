// README 用のスクリーンショットを撮る（docs/screenshots/ に保存）。前提は e2e/README.md の sync.cjs と同じ
// 写るのはすべてエミュレーター上のデモデータ（example.com のアカウントと、ここで書いた架空の文章）。
// デモ用のアカウントでログインできるよう、実行中だけエミュレーターの許可リストに足し、終わったら元のルールに戻す
const fs = require('fs')
const path = require('path')
const { launch } = require('./browser.cjs')

const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const PROJECT = 'demo-novel'
const EMU = 'http://127.0.0.1:8080'
const FS = `${EMU}/v1/projects/${PROJECT}/databases/(default)/documents`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}`
const OUT = path.join(__dirname, '..', 'docs', 'screenshots')
const AUTHOR = 'author@example.com'
const FRIEND = 'friend@example.com'

const root = path.join(__dirname, '..')
const rulesFile = fs.existsSync(path.join(root, 'firestore.local.rules')) ? 'firestore.local.rules' : 'firestore.rules'
const RULES = fs.readFileSync(path.join(root, rulesFile), 'utf8')
const DEMO_RULES = RULES.replace(/(request\.auth\.token\.email in \[)/, `$1'${AUTHOR}', '${FRIEND}', `)
if (DEMO_RULES === RULES) throw new Error(`${rulesFile} の許可リストが見つかりません`)

async function loadRules(content) {
  const res = await fetch(`${EMU}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  })
  if (!res.ok) throw new Error(`ルールを読み込めません: ${res.status}`)
}

// ---- デモデータ（管理者権限でルールを通さずに書く） ----
const toValue = (v) => {
  if (v === null) return { nullValue: null }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  return { stringValue: String(v) }
}
async function put(docPath, data) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]))
  const res = await fetch(`${FS}/${docPath}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`${docPath}: ${res.status} ${await res.text()}`)
}
async function uidOf(email) {
  const res = await fetch(`${AUTH}/accounts:query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnUserInfo: true }),
  })
  const user = (await res.json()).userInfo?.find((u) => u.email === email)
  if (!user) throw new Error(`${email} のアカウントがありません`)
  return user.localId
}
const countChars = (s) => [...s].filter((c) => !/\s/.test(c)).length
const preview = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 40)

const NOW = Date.now()
const MIN = 60 * 1000

const EPISODES = [
  { chapter: '第一章　岬の町' },
  {
    title: '届かなかった手紙',
    body: `　岬の灯台に、もう誰も住んでいないことは知っていた。
　それでも汐里は、坂道の途中で足を止めて、白い塔を見上げずにはいられなかった。

「ここに手紙を出しても、届かないんだよ」
　郵便局の窓口で、老いた局員はそう言って笑った。
　宛名は「灯台守さま」。差出人の欄は空白のまま。消印は、十年前の夏の日付だった。

　汐里は封筒を光にかざした。薄い便箋が一枚だけ、透けて見える。
　読んではいけない、と思った。けれど、指はもう封を切りかけていた。`,
  },
  {
    title: '潮騒の聞こえる部屋',
    body: `　下宿の二階からは、夜になると波の音だけが聞こえた。
　汐里は机に便箋を広げ、何度も同じ一行を読み返した。

　――あなたが灯りを守ってくれたから、わたしは帰ってこられました。

　誰が、誰に宛てた言葉なのだろう。`,
  },
  { chapter: '第二章　十年前の夏' },
  {
    title: '古いアルバム',
    body: `　図書館の郷土資料室には、町の古い写真がまとめて保管されていた。
　ページをめくるたびに、色あせた夏がこぼれ落ちてくる。`,
  },
]

const NOTES = [
  {
    kind: 'character',
    title: '汐里（しおり）',
    body: `## 基本
- 21歳。美大を休学して、祖母の暮らした港町に来た
- 口癖は「たぶん、だけど」

## 性格
- 人の気持ちに敏感で、言葉を選びすぎて黙ってしまう
- 古いものを捨てられない`,
  },
  {
    kind: 'setting',
    title: '岬の灯台',
    body: `## 概要
十年前に無人化された白い灯台。いまは町の観光名所。

## メモ
- 最後の灯台守は、町の誰も行き先を知らない
- 夜になると、なぜか一度だけ灯りが点くという噂がある`,
  },
  {
    kind: 'document',
    title: 'プロット',
    body: `## 第一章
1. 汐里が宛先のない手紙を見つける
2. 郵便局員から灯台守の話を聞く

## 第二章
1. 十年前の夏の写真
2. **手紙の差出人** にたどり着く`,
  },
]

const THESAURUS = [
  { title: '見る', body: '眺める\n見つめる：じっと\n見上げる\n仰ぐ\n一瞥する：ちらりと\n目を凝らす' },
  { title: '静か', body: 'しんとした\nひっそり\n閑散\n森閑：文語的\n水を打ったような' },
]

async function seed(authorUid, friendUid) {
  const work = `users/${authorUid}/works/demo-lighthouse`
  let order = 0
  for (const [i, e] of EPISODES.entries()) {
    order++
    const id = `demo-ep-${i}`
    const updatedAt = NOW - (EPISODES.length - i) * MIN
    if (e.chapter) {
      await put(`${work}/episodes/${id}`, { kind: 'chapter', title: e.chapter, order, charCount: 0, updatedAt })
    } else {
      await put(`${work}/episodes/${id}`, { title: e.title, order, charCount: countChars(e.body), updatedAt })
      await put(`${work}/episodeBodies/${id}`, { title: e.title, body: e.body, updatedAt, baseUpdatedAt: null })
    }
  }
  for (const [i, n] of NOTES.entries()) {
    const id = `demo-note-${i}`
    const updatedAt = NOW - (10 + i) * MIN
    await put(`${work}/notes/${id}`, { kind: n.kind, title: n.title, preview: preview(n.body), order: i + 1, updatedAt })
    await put(`${work}/noteBodies/${id}`, {
      kind: n.kind,
      title: n.title,
      body: n.body,
      updatedAt,
      baseUpdatedAt: null,
      format: 'markdown',
    })
  }
  await put(work, {
    title: '灯台守への手紙',
    createdAt: NOW - 30 * 24 * 60 * MIN,
    updatedAt: NOW - MIN,
    bodiesSplit: true,
    sharedWith: [FRIEND],
    editors: [FRIEND],
    ownerEmail: AUTHOR,
  })
  const others = [
    ['demo-summer', '夏の終わりの短編集', 3 * 60],
    ['demo-essay', '散歩のエッセイ（下書き）', 2 * 24 * 60],
  ]
  for (const [id, title, ago] of others) {
    await put(`users/${authorUid}/works/${id}`, {
      title,
      createdAt: NOW - 40 * 24 * 60 * MIN,
      updatedAt: NOW - ago * MIN,
      bodiesSplit: true,
    })
  }
  for (const [i, t] of THESAURUS.entries()) {
    await put(`users/${authorUid}/thesaurus/demo-syn-${i}`, { ...t, updatedAt: NOW - i * MIN })
  }
  // 友人から共有された作品（作品一覧の「共有された作品」に出る）
  await put(`users/${friendUid}/works/demo-cafe`, {
    title: '雨の街の喫茶店',
    createdAt: NOW - 20 * 24 * 60 * MIN,
    updatedAt: NOW - 50 * MIN,
    bodiesSplit: true,
    sharedWith: [AUTHOR],
    editors: [],
    ownerEmail: FRIEND,
  })
}

// ---- 撮影 ----
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }
const DESKTOP = { viewport: { width: 1280, height: 600 }, deviceScaleFactor: 1.5 }

async function signedIn(browser, email, options, theme = 'light') {
  const ctx = await browser.newContext(options)
  await ctx.addInitScript((t) => localStorage.setItem('novel-editor:theme', t), theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE + '/')
  await page.waitForFunction(() => window.__emulatorSignIn)
  await page.evaluate((e) => window.__emulatorSignIn(e), email)
  await page.waitForSelector('text=新しい作品')
  return page
}
async function shot(page, name) {
  await page.waitForTimeout(600) // 描画・フォントの読み込みを待つ
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log(`saved docs/screenshots/${name}.png`)
}
const waitSynced = (p) =>
  p.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout: 20000 })

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  await loadRules(DEMO_RULES)
  const browser = await launch()
  try {
    // アカウントを作ってからデータを入れる
    const friendPage = await signedIn(browser, FRIEND, MOBILE)
    let page = await signedIn(browser, AUTHOR, MOBILE)
    await seed(await uidOf(AUTHOR), await uidOf(FRIEND))
    await friendPage.context().close()
    await page.context().close()

    // 作品一覧（PC）
    const desk = await signedIn(browser, AUTHOR, DESKTOP)
    await desk.waitForSelector('.shared-works .work-card')
    await shot(desk, 'works')

    // 作品（章立て）
    page = await signedIn(browser, AUTHOR, MOBILE)
    await page.goto(BASE + '/works/demo-lighthouse')
    await page.waitForSelector('text=第二章')
    await shot(page, 'chapters')

    // 執筆画面
    await page.goto(BASE + '/works/demo-lighthouse/episodes/demo-ep-1')
    await page.waitForSelector('.cm-content')
    await waitSynced(page)
    await shot(page, 'editor')

    // 類語帳
    await page.click('button[aria-label="類語帳"]')
    await page.fill('.sheet .search-input', '見')
    await page.waitForSelector('.syn-group')
    await shot(page, 'synonyms')

    // 共有の設定
    await page.goto(BASE + '/works/demo-lighthouse')
    await page.click('button:has-text("共有")')
    await page.fill('.share-modal input[type=email]', 'reader@example.com')
    await shot(page, 'share')

    // 編集の衝突（もう1台の端末 B で、オフライン中に書いた内容が拒否される）
    const B = await signedIn(browser, AUTHOR, MOBILE)
    const conflictUrl = BASE + '/works/demo-lighthouse/episodes/demo-ep-2'
    await page.goto(conflictUrl)
    await B.goto(conflictUrl)
    await page.waitForSelector('.cm-content')
    await B.waitForSelector('.cm-content')
    await waitSynced(B)
    await B.context().setOffline(true)
    await B.click('.cm-content')
    await B.keyboard.press('Control+End')
    await B.keyboard.type('\n　電車の中で書き足した一行。')
    await B.waitForTimeout(1500)
    await page.click('.cm-content')
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n　ＰＣで書き足した一行。')
    await waitSynced(page)
    await B.context().setOffline(false)
    await B.waitForSelector('.problem-banner', { timeout: 30000 })
    await B.evaluate(() => document.activeElement?.blur())
    await shot(B, 'conflict')

    // 設定メモ（Markdown のプレビュー・ダークテーマ）
    const dark = await signedIn(browser, AUTHOR, MOBILE, 'dark')
    await dark.goto(BASE + '/works/demo-lighthouse/notes/demo-note-0')
    await dark.waitForSelector('.cm-content')
    await dark.click('button[aria-label="プレビュー"]')
    await dark.waitForSelector('.md-preview h2')
    await shot(dark, 'note-dark')
  } finally {
    await browser.close()
    await loadRules(RULES)
  }
})().catch(async (e) => {
  console.error(e)
  await loadRules(RULES).catch(() => {})
  process.exit(1)
})
