// 公開サイトの簡易確認：ページが開き、ログイン画面が出て、エラーが出ないこと
// node e2e/smoke.cjs [URL]
const { launch } = require('./browser.cjs')

const URL = process.argv[2] ?? 'https://shosai-app.web.app/'

;(async () => {
  const browser = await launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(URL, { waitUntil: 'networkidle' })
  const title = await page.title()
  const login = await page.waitForSelector('text=Google でログイン', { timeout: 15000 }).then(Boolean, () => false)
  const setupNeeded = await page.$('text=セットアップが必要です').then(Boolean)
  const sw = await page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration()))
  const manifest = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null)

  console.log(`title: ${title}`)
  console.log(`${login ? 'PASS' : 'FAIL'}  ログイン画面が出る`)
  console.log(`${!setupNeeded ? 'PASS' : 'FAIL'}  Firebase の設定が読み込まれている`)
  console.log(`${manifest ? 'PASS' : 'FAIL'}  PWA の manifest がある (${manifest})`)
  console.log(`${sw ? 'PASS' : 'INFO'}  Service Worker の登録 (${sw})`)
  console.log(errors.length ? `ERRORS:\n  ${errors.join('\n  ')}` : 'エラーなし')
  await browser.close()
  process.exit(login && !setupNeeded ? 0 : 1)
})()
