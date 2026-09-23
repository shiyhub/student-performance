/* 离线 Service Worker：缓存网页外壳，断网也能打开 */
const CACHE = 'sp-cache-v1';
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

/* 静态资源缓存优先；数据接口（supabase）永远走网络 */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.includes('supabase.co')) return;
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
