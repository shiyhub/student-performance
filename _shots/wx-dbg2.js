(() => {
  const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
  const w = document.getElementById('wallView'); if (w) w.hidden = false;
  const f = document.getElementById('formView'); if (f) f.hidden = true;
  document.documentElement.setAttribute('data-weather', 'sunny');
  const dbg = [];
  ['flowerLeft','flowerRight','cloudLeft','cloudRight'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) { dbg.push(id + ': 不存在'); return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    dbg.push(id + ' x=' + Math.round(r.x) + ' y=' + Math.round(r.y) + ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height) + ' op=' + cs.opacity + ' anim=' + cs.animationName + ' done=' + el.complete + ' nw=' + el.naturalWidth + ' ns=' + el.src.split('/').pop());
  });
  const pl = document.querySelector('.plant-left');
  if (pl) dbg.push('plant-left w=' + Math.round(pl.getBoundingClientRect().width) + ' op=' + getComputedStyle(pl).opacity + ' left=' + getComputedStyle(pl).left);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;background:#111;color:#0f0;font:11px monospace;z-index:99999;padding:8px;white-space:pre-wrap';
  d.textContent = dbg.join('\n');
  document.body.appendChild(d);
})();
