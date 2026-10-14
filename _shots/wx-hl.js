(() => {
  const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
  const w = document.getElementById('wallView'); if (w) w.hidden = false;
  const f = document.getElementById('formView'); if (f) f.hidden = true;
  document.documentElement.setAttribute('data-weather', 'sunny');
  document.querySelectorAll('.plant img').forEach(i => { i.style.opacity = '0.95'; i.style.outline = '4px solid red'; });
})();
