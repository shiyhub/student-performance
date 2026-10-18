/* 离线 Service Worker：缓存网页外壳，断网也能打开
 * 策略：网络优先 + 缓存兜底 —— 在线永远拿到最新版本（JS/CSS/页面），
 *       断网时自动回退到最近一次缓存的资源，避免"旧默认数据/旧代码"。
 */
const CACHE = 'sp-cache-v48';
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
  './js/precache.js',
  './js/sound.js',
  './js/exam.js',
  './js/student.js',
  './js/student-b.js',
  './js/student-c.js',
  './js/student-d.js',
  './js/student-e.js',
  './js/parent.js',
  './js/teacher.js',
  './js/vendor/supabase.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== 'sp-api-v1').map(k => caches.delete(k))).then(() => self.clients.claim())));
});

/* 网络优先：先请求网络（拿到最新数据/代码），成功就更新缓存；
 * 断网时回退到缓存（含 API GET 数据的最近快照）。
 * v145(RSK-15 方案 D)：Supabase 海外节点 API 读请求 SWR 兜底——
 *   supabase-js 的 rest/v1 查询是 GET（URL 带 select 参数），纳入缓存；
 *   rpc 调用与 insert/update/delete 均为 POST/PATCH/DELETE（写请求不缓存，直连网络，不丢数据）。 */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // —— API 读请求（rest/v1 GET 查询）：网络优先 + 8s 超时，失败回退 30s 内缓存 ——
  if (e.request.method === 'GET' && url.hostname.includes('supabase.co')
      && url.pathname.includes('/rest/v1/') && url.searchParams.has('select')) {
    e.respondWith((async () => {
      const cache = await caches.open('sp-api-v1');
      const cached = await cache.match(e.request);
      let ts = 0;
      if (cached) { try { ts = Number(cached.headers.get('x-sp-ts') || 0); } catch (e2) {} }
      const fresh = cached && (Date.now() - ts) < 30000;
      try {
        const res = await Promise.race([
          fetch(e.request),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sw-api-timeout')), 8000))
        ]);
        if (res && res.ok) {
          const copy = res.clone();
          const headers = new Headers(copy.headers);
          headers.set('x-sp-ts', String(Date.now()));
          headers.delete('content-encoding');
          headers.delete('content-length');
          const body = await copy.arrayBuffer();
          cache.put(e.request, new Response(body, { status: copy.status, statusText: copy.statusText, headers }));
        }
        return res;
      } catch (err) {
        if (fresh) return cached;
        throw err;   // 无缓存或已过期：交给页面既有回退（Offline 缓存 / 错误提示）
      }
    })());
    return;
  }
  // —— 其余静态资源（页面/JS/CSS/图片）：网络优先 + 缓存兜底；API 写请求不拦截 ——
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
