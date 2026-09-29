/* ============================================================
 * offline.js —— v107 统一离线数据层
 * ------------------------------------------------------------
 * 目标：断网时系统核心功能照常可用，联网后自动同步。
 * 存储：IndexedDB（本地数据量大，localStorage 装不下）
 *   - kv    表：数据快照缓存（名单/标签/墙/任务/档案等）
 *   - queue 表：待同步的写操作队列（提交表现/任务评改/换头像/戴头像框）
 * 用法：
 *   Offline.get(key) / Offline.set(key, value)
 *   Offline.enqueue({ name, params })  → 写操作入队
 *   Offline.drain(runner)              → 尝试逐条同步，成功出队
 *   Offline.online                     → 当前是否在线（含事件监听）
 * ============================================================ */
(function () {
  'use strict';
  const DB_NAME = 'sp-offline', DB_VER = 1;
  let db = null;
  let online = navigator.onLine;
  const subs = new Set();

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    });
  }
  function tx(store, mode, fn) {
    return open().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let r;
      try { r = fn(s); } catch (err) { reject(err); return; }
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const Offline = {
    get online() { return online; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    _setOnline(v) {
      online = v;
      subs.forEach(f => { try { f(v); } catch (e) {} });
    },
    // —— 数据快照 ——
    async get(key) {
      try { const r = await tx('kv', 'readonly', s => s.get(key)); return r ? r.val : undefined; }
      catch (e) { return undefined; }
    },
    async set(key, val) {
      try { await tx('kv', 'readwrite', s => s.put({ key, val: val === undefined ? null : val, ts: Date.now() })); return true; }
      catch (e) { return false; }
    },
    async del(key) {
      try { await tx('kv', 'readwrite', s => s.delete(key)); return true; }
      catch (e) { return false; }
    },
    // —— 写操作队列 ——
    async enqueue(op) {
      try { await tx('queue', 'readwrite', s => s.add(Object.assign({ ts: Date.now() }, op))); return true; }
      catch (e) { return false; }
    },
    async queueLen() {
      try { const r = await tx('queue', 'readonly', s => s.count()); return r || 0; }
      catch (e) { return 0; }
    },
    // runner(op) 应返回 { ok: true/false }；ok=true 出队，否则保留下轮重试
    async drain(runner, limit) {
      let ops = [];
      try { ops = await tx('queue', 'readonly', s => s.getAll()); } catch (e) { return 0; }
      if (!ops.length) return 0;
      if (limit && ops.length > limit) ops = ops.slice(0, limit);
      let done = 0;
      for (const op of ops) {
        try {
          const r = await runner(op);
          if (r && r.ok) { await tx('queue', 'readwrite', s => s.delete(op.id)); done++; }
        } catch (e) { /* 保留，下轮重试 */ }
      }
      return done;
    }
  };
  window.Offline = Offline;

  window.addEventListener('online', () => Offline._setOnline(true));
  window.addEventListener('offline', () => Offline._setOnline(false));
})();
