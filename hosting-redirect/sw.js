// 以前の URL にインストールされたアプリの Service Worker を止める。
// 旧版の Service Worker は端末内に保存したアプリで画面を返すため、そのままではサーバー側の転送が効かない。
// 更新の確認でこのファイルに置き換わると、自分を解除し、保存したアプリを消して、開いている画面を読み込み直す
// （読み込み直すと転送用のページが返り、新しい URL へ移る）
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister()
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      const windows = await self.clients.matchAll({ type: 'window' })
      windows.forEach((w) => w.navigate(w.url))
    })(),
  )
})
