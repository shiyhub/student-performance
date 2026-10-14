async () => {
  try { localStorage.setItem('sp_identity', JSON.stringify({ class: '六年级一班', studentName: '卿泽懿' })); } catch (e) {}
  document.documentElement.setAttribute('data-weather', 'sunny');
  const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
  if (typeof enterWallFlow === 'function') enterWallFlow();
  for (let i = 0; i < 60; i++) {
    const grid = document.getElementById('matesGrid');
    const ld = document.getElementById('wallLoading');
    if (grid && grid.children.length > 0 && ld && ld.hidden) break;
    await new Promise(r => setTimeout(r, 300));
  }
}
