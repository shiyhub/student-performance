(() => {
  const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
  const w = document.getElementById('wallView'); if (w) w.hidden = false;
  const f = document.getElementById('formView'); if (f) f.hidden = true;
  ['flowerLeft','flowerRight','cloudLeft','cloudRight'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) { console.log(id, '不存在'); return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    console.log(id, JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),opacity:cs.opacity,anim:cs.animationName,src:(el.src||'').split('/').pop(),complete:el.complete,nw:el.naturalWidth}));
  });
  const deco = document.getElementById('skyDeco');
  console.log('deco children', deco ? deco.children.length : 'none');
  const pl = document.querySelector('.plant-left');
  const pr = document.querySelector('.plant-right');
  if (pl) console.log('plant-left', JSON.stringify({w:pl.getBoundingClientRect().width, op:getComputedStyle(pl).opacity, left:getComputedStyle(pl).left, bottom:getComputedStyle(pl).bottom}));
  if (pr) console.log('plant-right', JSON.stringify({w:pr.getBoundingClientRect().width, op:getComputedStyle(pr).opacity}));
})();
