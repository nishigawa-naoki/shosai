// 章立て（話の一覧の中の章の見出し）の動作確認。前提は e2e/README.md の sync.cjs と同じ
const fs = require('fs')
const { launch, ownerEmail } = require('./browser.cjs')
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + JSON.stringify(detail) : ''}`)
  if (!ok) failures++
}

/** 話の一覧の各行（章は「#章名」、話は「番号:タイトル」） */
const rows = (p) =>
  p.$$eval('section .list > li', (lis) =>
    lis.map((li) =>
      li.classList.contains('chapter-row')
        ? `#${li.querySelector('.chapter-title').textContent}`
        : `${li.querySelector('.ep-no').textContent}:${li.querySelector('.list-title').textContent}${li.classList.contains('in-chapter') ? '' : '(章外)'}`,
    ),
  )
async function waitRows(p, expected) {
  await p
    .waitForFunction(
      (n) => document.querySelectorAll('section .list > li').length === n,
      expected.length,
      { timeout: 10000 },
    )
    .catch(() => {})
  return rows(p)
}

;(async () => {
  const browser = await launch()
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE + '/')
  await page.waitForFunction(() => window.__emulatorSignIn)
  await page.evaluate((e) => window.__emulatorSignIn(e), ownerEmail())
  await page.click('text=新しい作品')
  await page.fill('.modal .text-input', '章立てテスト')
  await page.click('.modal button[type=submit]')
  await page.waitForURL(/\/works\/[^/]+$/)
  const workUrl = page.url()

  // 話を追加して、タイトルと本文を書いて戻る
  async function writeEpisode(title, body) {
    await page.waitForURL(/episodes/)
    await page.fill('.title-input', title)
    await page.click('.cm-content')
    await page.keyboard.type(body)
    await page.waitForFunction(() => document.querySelector('.status')?.textContent === '同期済み', null, { timeout: 20000 })
    await page.goto(workUrl)
    await page.waitForSelector('text=話を追加')
  }
  async function addChapter(name) {
    await page.click('.section-actions button:has-text("章を追加")')
    await page.fill('.modal .text-input', name)
    await page.click('.modal button[type=submit]')
  }

  await page.click('text=話を追加')
  await writeEpisode('プロローグ', 'あいう')
  await addChapter('第一章')
  await page.click('text=話を追加')
  await writeEpisode('一話', 'かきくけ')
  await addChapter('第二章')
  await page.click('text=話を追加')
  await writeEpisode('三話', 'さし')

  let r = await waitRows(page, Array(5))
  check('章と話が順に並び、話は通し番号', JSON.stringify(r) === JSON.stringify(['1:プロローグ(章外)', '#第一章', '2:一話', '#第二章', '3:三話']), r)
  check('一覧の集計に章の数が出る', (await page.textContent('.stats')).replace(/\s/g, '').startsWith('2章・3話・9字'), await page.textContent('.stats'))
  const firstChapter = 'section .list > li.chapter-row >> nth=0'
  check('章ごとに話数・文字数が出る', (await page.textContent(`${firstChapter} >> .count`)).includes('1話'), await page.textContent(`${firstChapter} >> .count`))

  // 章の途中（第一章の最後）に話を追加
  await page.click(`${firstChapter} >> button[aria-label="この章の最後に話を追加"]`)
  await writeEpisode('二話', 'た')
  r = await waitRows(page, Array(6))
  check('「この章の最後に話を追加」で章の末尾に入る', JSON.stringify(r) === JSON.stringify(['1:プロローグ(章外)', '#第一章', '2:一話', '3:二話', '#第二章', '4:三話']), r)

  // 名前の変更
  await page.click(`${firstChapter} >> button[aria-label="章の名前を変更・削除"]`)
  await page.fill('.modal .text-input', '第一章　はじまり')
  await page.click('.modal button[type=submit]')
  await page.waitForSelector('text=第一章　はじまり')
  check('章の名前を変えられる', true)

  // 並べ替え：第二章の見出しを1つ上へ → 二話が第二章に入る
  const second = 'section .list > li.chapter-row >> nth=1'
  await page.click(`${second} >> button[aria-label="上へ"]`)
  await page.waitForFunction(() => document.querySelectorAll('section .list > li')[3]?.classList.contains('chapter-row'))
  r = await rows(page)
  check('見出しを動かすと章の区切りが変わる', JSON.stringify(r) === JSON.stringify(['1:プロローグ(章外)', '#第一章　はじまり', '2:一話', '#第二章', '3:二話', '4:三話']), r)

  // 書き出し
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=テキストで書き出し')])
  const text = fs.readFileSync(await download.path(), 'utf8')
  check(
    '書き出しに章の名前が入る',
    text === ['章立てテスト', 'プロローグ\n\nあいう', '■ 第一章　はじまり', '一話\n\nかきくけ', '■ 第二章', '二話\n\nた', '三話\n\nさし'].join('\n\n\n'),
    text,
  )

  // 章の削除：見出しだけ消え、話は残る
  await page.click(`${firstChapter} >> button[aria-label="章の名前を変更・削除"]`)
  await page.click('.modal button:has-text("章を削除")')
  r = await waitRows(page, Array(5))
  check('章を削除しても話は残る', JSON.stringify(r) === JSON.stringify(['1:プロローグ(章外)', '2:一話(章外)', '#第二章', '3:二話', '4:三話']), r)

  // 開き直しても同じ（サーバーに保存されている）
  await page.reload()
  await page.waitForSelector('text=第二章')
  r = await waitRows(page, Array(5))
  check('開き直しても章立てが保たれる', JSON.stringify(r) === JSON.stringify(['1:プロローグ(章外)', '2:一話(章外)', '#第二章', '3:二話', '4:三話']), r)

  // 最後でない章に続けて追加しても、次の章へはみ出さない
  await addChapter('第三章')
  await page.waitForSelector('text=第三章')
  for (let n = 0; n < 3; n++) {
    await page.click('section .list > li.chapter-row >> nth=0 >> button[aria-label="この章の最後に話を追加"]')
    await page.waitForURL(/episodes/)
    await page.goto(workUrl)
    await page.waitForSelector('text=第三章')
  }
  r = await waitRows(page, Array(9))
  check(
    '同じ章に続けて追加しても章の中に並ぶ',
    JSON.stringify(r) === JSON.stringify(['1:プロローグ(章外)', '2:一話(章外)', '#第二章', '3:二話', '4:三話', '5:無題', '6:無題', '7:無題', '#第三章']),
    r,
  )

  await browser.close()
  console.log(failures ? `\n${failures} 件失敗` : '\nALL PASSED')
  process.exit(failures ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
