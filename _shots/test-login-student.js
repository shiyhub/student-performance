(() => {
  try { localStorage.setItem('sp_identity', JSON.stringify({ class: '六年级一班', studentName: '卿泽懿' })); } catch (e) {}
  document.documentElement.setAttribute('data-weather', 'sunny');
  const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
  const run = () => { if (typeof enterWallFlow === 'function') enterWallFlow(); };
  run();
  setTimeout(run, 2500);
  setTimeout(run, 4500);
})();
