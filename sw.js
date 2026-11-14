/* 离线 Service Worker：缓存网页外壳，断网也能打开
 * 策略：网络优先 + 缓存兜底 —— 在线永远拿到最新版本（JS/CSS/页面），
 *       断网时自动回退到最近一次缓存的资源，避免"旧默认数据/旧代码"。
 */
const CACHE = 'sp-cache-v82';
const ASSETS = [
  './',
  './index.html',
  './parent.html',
  './teacher.html',
  './css/common.css',
  './css/icons.css',
  './css/student.css',
  './css/parent.css',
  './css/teacher.css',
  './js/config.js',
  './js/icons.js',
  './js/device.js',
  './js/offline.js',
  './js/precache.js',
  './js/sound.js',
  './js/exam.js',
  './js/student.js',
  './js/parent.js',
  './js/teacher.js',
  './js/vendor/supabase.js',
  './js/vendor/xlsx.mini.min.js',
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
  './assets/avatars/mecha5.webp',
  './assets/avatars/mecha5-s.webp',
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
  './assets/avatars/warrior6.webp',
  './assets/avatars/warrior6-s.webp',
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
  './assets/avatars/chibi1.webp',
  './assets/avatars/chibi1-s.webp',
  './assets/avatars/chibi2.webp',
  './assets/avatars/chibi2-s.webp',
  './assets/avatars/chibi3.webp',
  './assets/avatars/chibi3-s.webp',
  './assets/avatars/chibi4.webp',
  './assets/avatars/chibi4-s.webp',
  './assets/avatars/moe1.webp',
  './assets/avatars/moe1-s.webp',
  './assets/avatars/moe2.webp',
  './assets/avatars/moe2-s.webp',
  './assets/avatars/moe3.webp',
  './assets/avatars/moe3-s.webp',
  './assets/avatars/moe4.webp',
  './assets/avatars/moe4-s.webp',
  './assets/avatars/moe5.webp',
  './assets/avatars/moe5-s.webp',
  './assets/avatars/moe6.webp',
  './assets/avatars/moe6-s.webp',
  './assets/avatars/moe7.webp',
  './assets/avatars/moe7-s.webp',
  './assets/avatars/moe8.webp',
  './assets/avatars/moe8-s.webp',
  './assets/avatars/moe9.webp',
  './assets/avatars/moe9-s.webp',
  './assets/avatars/moe10.webp',
  './assets/avatars/moe10-s.webp',
  './assets/frames/frame-bronze.webp',
  './assets/frames/frame-silver.webp',
  './assets/frames/frame-gold.webp',
  './assets/frames/frame-rainbow.webp',
  './assets/frames/frame-star.webp',
  './assets/frames/frame-heart.webp',
  './assets/frames/frame-crown.webp',
  './assets/frames/frame-tac.webp',
  './assets/frames/frame-gun.webp',
  './assets/frames/frame-dragon.webp',
  './assets/frames/frame-mecha.webp',
  './assets/frames/frame-wolf.webp',
  './assets/frames/frame-sakura.webp',
  './assets/frames/frame-magic.webp',
  './assets/frames/frame-princess.webp',
  './assets/frames/frame-queen.webp',
  './assets/frames/frame-rose.webp',
  './assets/frames/frame-fairy.webp',
  './assets/frames/frame-pixie.webp',
  './assets/frames/frame-huadian.webp',
  './assets/frames/frame-blossom.webp',
  './assets/frames/frame-ink.webp',
  './assets/frames/frame-spring.webp',
  './assets/frames/frame-redlily.webp',
  './assets/frames/frame-mask.webp',
  './assets/frames/frame-neonwolf.webp',
  './assets/frames/frame-cyber.webp',
  './assets/frames/frame-pulse.webp',
  './assets/frames/frame-unicorn.webp',
  './assets/frames/frame-onyx.webp',
  './assets/frames/frame-rosefeather.webp',
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
  './assets/avatars/doll.webp',
  './assets/avatars/doll-s.webp',
  './assets/avatars/flower.webp',
  './assets/avatars/flower-s.webp',
  './assets/avatars/twin.webp',
  './assets/avatars/twin-s.webp',
  './assets/avatars/lotus.webp',
  './assets/avatars/lotus-s.webp',
  './assets/avatars/horn.webp',
  './assets/avatars/horn-s.webp',
  './assets/avatars/bunny.webp',
  './assets/avatars/bunny-s.webp',
  './assets/avatars/gothic.webp',
  './assets/avatars/gothic-s.webp',
];

/* v170：预缓存分层 + 限并发
 * 旧实现 Promise.all(254 条) 会瞬间发起 250+ 个请求（合计 13MB），
 * 在校园网/热点下会挤占连接池，把页面自己的 js/config.js 等关键请求挤到超时或被重置。
 * 现改为：核心资源（外壳 + 小动物头像）限并发 4 先装；装扮类大图延后限并发 2 补装。 */
const CORE_ASSETS = ASSETS.filter(u => !/\/assets\/(frames\/frame-|avatars\/(?!animal[0-9]+(-s)?\.))/.test(u));
const EXTRA_ASSETS = ASSETS.filter(u => CORE_ASSETS.indexOf(u) === -1);

async function precache(list, limit) {
  const c = await caches.open(CACHE);
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      try { await c.add(u); } catch (e) { /* 单个缺失不影响其余 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try { await precache(CORE_ASSETS, 4); } catch (err) {}
    await self.skipWaiting();
    // 页面加载完、网络空闲后再补装装扮类资源；失败无影响（用到时会按需缓存）
    setTimeout(() => { precache(EXTRA_ASSETS, 2).catch(() => {}); }, 15000);
  })());
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
          try {
            const copy = res.clone();
            const headers = new Headers(copy.headers);
            headers.set('x-sp-ts', String(Date.now()));
            headers.delete('content-encoding');
            headers.delete('content-length');
            const body = await copy.arrayBuffer();
            await cache.put(e.request, new Response(body, { status: copy.status, statusText: copy.statusText, headers }));
          } catch (ce) { /* 缓存写入失败不影响返回网络数据 */ }
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
