/* 离线 Service Worker：缓存网页外壳，断网也能打开
 * 策略：网络优先 + 缓存兜底 —— 在线永远拿到最新版本（JS/CSS/页面），
 *       断网时自动回退到最近一次缓存的资源，避免"旧默认数据/旧代码"。
 */
const CACHE = 'sp-cache-v57';
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
  './js/vendor/supabase.js',
  './assets/avatars/animal1.webp',
  './assets/avatars/animal2.webp',
  './assets/avatars/animal3.webp',
  './assets/avatars/animal4.webp',
  './assets/avatars/animal5.webp',
  './assets/avatars/animal6.webp',
  './assets/avatars/animal7.webp',
  './assets/avatars/animal8.webp',
  './assets/avatars/animal9.webp',
  './assets/avatars/animal10.webp',
  './assets/avatars/animal11.webp',
  './assets/avatars/animal12.webp',
  './assets/avatars/animal13.webp',
  './assets/avatars/animal14.webp',
  './assets/avatars/animal15.webp',
  './assets/avatars/animal16.webp',
  './assets/avatars/animal17.webp',
  './assets/avatars/animal18.webp',
  './assets/avatars/animal19.webp',
  './assets/avatars/animal20.webp',
  './assets/avatars/animal21.webp',
  './assets/avatars/animal22.webp',
  './assets/avatars/animal23.webp',
  './assets/avatars/animal24.webp',
  './assets/avatars/girl1.webp',
  './assets/avatars/girl2.webp',
  './assets/avatars/girl3.webp',
  './assets/avatars/girl4.webp',
  './assets/avatars/girl5.webp',
  './assets/avatars/girl6.webp',
  './assets/avatars/girl7.webp',
  './assets/avatars/girl8.webp',
  './assets/avatars/boy1.webp',
  './assets/avatars/boy2.webp',
  './assets/avatars/boy3.webp',
  './assets/avatars/boy4.webp',
  './assets/avatars/boy5.webp',
  './assets/avatars/boy6.webp',
  './assets/avatars/boy7.webp',
  './assets/avatars/boy8.webp',
  './assets/avatars/neutral1.webp',
  './assets/avatars/neutral2.webp',
  './assets/avatars/neutral3.webp',
  './assets/avatars/neutral4.webp',
  './assets/avatars/neutral5.webp',
  './assets/avatars/neutral6.webp',
  './assets/avatars/neutral7.webp',
  './assets/avatars/neutral8.webp',
  './assets/avatars/sweet1.webp',
  './assets/avatars/sweet1-s.webp',
  './assets/avatars/sweet2.webp',
  './assets/avatars/sweet2-s.webp',
  './assets/avatars/sweet3.webp',
  './assets/avatars/sweet4.webp',
  './assets/avatars/sweet5.webp',
  './assets/avatars/sweet5-s.webp',
  './assets/avatars/sweet6.webp',
  './assets/avatars/sweet6-s.webp',
  './assets/avatars/sweet7.webp',
  './assets/avatars/sweet7-s.webp',
  './assets/avatars/sweet8.webp',
  './assets/avatars/sweet8-s.webp',
  './assets/avatars/sweet9.webp',
  './assets/avatars/sweet9-s.webp',
  './assets/avatars/sweet10.webp',
  './assets/avatars/sweet10-s.webp',
  './assets/avatars/sweet11.svg',
  './assets/avatars/sweet12.svg',
  './assets/avatars/sweet13.svg',
  './assets/avatars/sweet14.svg',
  './assets/avatars/sweet15.svg',
  './assets/avatars/sweet16.svg',
  './assets/avatars/sweet17.svg',
  './assets/avatars/sweet18.svg',
  './assets/avatars/sweet19.webp',
  './assets/avatars/sweet20.webp',
  './assets/avatars/sweet21.webp',
  './assets/avatars/sweet22.webp',
  './assets/avatars/sweet19-s.webp',
  './assets/avatars/sweet20-s.webp',
  './assets/avatars/sweet21-s.webp',
  './assets/avatars/sweet22-s.webp',
  './assets/avatars/game1.webp',
  './assets/avatars/game1-s.webp',
  './assets/avatars/game2.webp',
  './assets/avatars/game2-s.webp',
  './assets/avatars/game3.webp',
  './assets/avatars/game3-s.webp',
  './assets/avatars/game4.webp',
  './assets/avatars/game4-s.webp',
  './assets/avatars/game5.webp',
  './assets/avatars/game5-s.webp',
  './assets/avatars/game6.webp',
  './assets/avatars/game6-s.webp',
  './assets/avatars/game7.webp',
  './assets/avatars/game7-s.webp',
  './assets/avatars/game8.webp',
  './assets/avatars/game8-s.webp',
  './assets/avatars/game9.svg',
  './assets/avatars/game10.svg',
  './assets/avatars/game11.svg',
  './assets/avatars/game12.svg',
  './assets/avatars/game13.svg',
  './assets/avatars/game14.svg',
  './assets/avatars/game15.svg',
  './assets/avatars/nature1.webp',
  './assets/avatars/nature1-s.webp',
  './assets/avatars/nature2.webp',
  './assets/avatars/nature2-s.webp',
  './assets/avatars/nature3.webp',
  './assets/avatars/nature3-s.webp',
  './assets/avatars/nature4.webp',
  './assets/avatars/mecha1.webp',
  './assets/avatars/mecha1-s.webp',
  './assets/avatars/mecha2.webp',
  './assets/avatars/mecha2-s.webp',
  './assets/avatars/mecha3.webp',
  './assets/avatars/mecha4.webp',
  './assets/avatars/mecha4-s.webp',
  './assets/avatars/fantasy1.webp',
  './assets/avatars/fantasy1-s.webp',
  './assets/avatars/fantasy2.webp',
  './assets/avatars/fantasy3.webp',
  './assets/avatars/fantasy3-s.webp',
  './assets/avatars/fantasy4.webp',
  './assets/avatars/fantasy5.webp',
  './assets/avatars/fantasy5-s.webp',
  './assets/avatars/fantasy6.webp',
  './assets/avatars/fantasy6-s.webp',
  './assets/avatars/fantasy7.webp',
  './assets/avatars/fantasy7-s.webp',
  './assets/avatars/fantasy8.webp',
  './assets/avatars/fantasy8-s.webp',
  './assets/avatars/fantasy9.webp',
  './assets/avatars/fantasy9-s.webp',
  './assets/avatars/fantasy10.webp',
  './assets/avatars/fantasy10-s.webp',
  './assets/avatars/fantasy11.webp',
  './assets/avatars/fantasy11-s.webp',
  './assets/avatars/warrior1.webp',
  './assets/avatars/warrior1-s.webp',
  './assets/avatars/warrior2.webp',
  './assets/avatars/warrior2-s.webp',
  './assets/avatars/warrior3.webp',
  './assets/avatars/warrior3-s.webp',
  './assets/avatars/warrior4.webp',
  './assets/avatars/warrior4-s.webp',
  './assets/avatars/warrior5.webp',
  './assets/avatars/warrior5-s.webp',
  './assets/avatars/xian1.webp',
  './assets/avatars/xian1-s.webp',
  './assets/avatars/xian2.webp',
  './assets/avatars/xian2-s.webp',
  './assets/avatars/xian3.webp',
  './assets/avatars/xian3-s.webp',
  './assets/avatars/xian4.webp',
  './assets/avatars/xian4-s.webp',
  './assets/avatars/xian5.webp',
  './assets/avatars/xian5-s.webp',
  './assets/frames/frame-bronze.png',
  './assets/frames/frame-silver.png',
  './assets/frames/frame-gold.png',
  './assets/frames/frame-rainbow.png',
  './assets/frames/frame-star.png',
  './assets/frames/frame-heart.png',
  './assets/frames/frame-crown.png',
  './assets/frames/frame-tac.png',
  './assets/frames/frame-gun.png',
  './assets/frames/frame-dragon.png',
  './assets/frames/frame-mecha.png',
  './assets/frames/frame-wolf.png',
  './assets/frames/frame-sakura.png',
  './assets/frames/frame-magic.png',
  './assets/frames/frame-princess.png',
  './assets/frames/frame-queen.png',
  './assets/frames/frame-rose.png',
  './assets/frames/frame-fairy.png',
  './assets/frames/frame-pixie.png',
  './assets/frames/frame-huadian.png',
  './assets/frames/frame-blossom.png',
  './assets/frames/frame-ink.png',
  './assets/frames/frame-spring.png',
  './assets/frames/frame-redlily.png',
  './assets/frames/frame-mask.png',
  './assets/frames/frame-neonwolf.png',
  './assets/frames/corner-gold.webp',
  './assets/avatars/game16.webp',
  './assets/avatars/game16-s.webp',
  './assets/avatars/game17.webp',
  './assets/avatars/game17-s.webp',
  './assets/avatars/nature5.webp',
  './assets/avatars/nature5-s.webp',
  './assets/avatars/nature6.webp',
  './assets/avatars/nature6-s.webp',
  './assets/avatars/nature7.webp',
  './assets/avatars/nature7-s.webp',
  './assets/avatars/nature8.webp',
  './assets/avatars/nature8-s.webp',
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
