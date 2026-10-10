/* 离线 Service Worker：缓存网页外壳，断网也能打开
 * 策略：网络优先 + 缓存兜底 —— 在线永远拿到最新版本（JS/CSS/页面），
 *       断网时自动回退到最近一次缓存的资源，避免"旧默认数据/旧代码"。
 */
const CACHE = 'sp-cache-v5';
const ASSETS = [
  './',
  './index.html',
  './parent.html',
  './teacher.html',
  './css/common.css',
  './css/student.css',
  './css/parent.css',
  './css/teacher.css',
  './js/config.js',
  './js/offline.js',
  './js/student.js',
  './js/parent.js',
  './js/teacher.js',
  './js/vendor/supabase.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* 网络优先：先请求网络（拿到最新数据/代码），成功就更新缓存；
 * 断网时回退到缓存（含 API GET 数据的最近快照）。API 域名（supabase）不拦截，永远走网络。 */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.includes('supabase.co')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(cached => cached || caches.match('./index.html'))
    )
  );
});
