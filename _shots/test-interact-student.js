async () => {
  const out = { scene: {}, bindings: {}, viewStates: {} };
  try { localStorage.setItem('sp_identity', JSON.stringify({ class: '六年级一班', studentName: '卿泽懿' })); } catch (e) {}
  const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
  if (typeof enterWallFlow === 'function') enterWallFlow();
  // 等待星光墙
  for (let i = 0; i < 50; i++) {
    const grid = document.getElementById('matesGrid');
    if (grid && grid.children.length > 0) break;
    await new Promise(r => setTimeout(r, 300));
  }
  const grid = document.getElementById('matesGrid');
  out.scene.wall = { rendered: !!grid && grid.children.length, cards: grid ? grid.children.length : 0 };
  // 检查 mate 卡片是否有 click 绑定（点学生进表单）
  const m = grid && grid.querySelector('button.mate');
  if (m) {
    const cloned = m.cloneNode(true);
    out.bindings.mateCard = { hasOnClick: (m.onclick !== null) || !!m.getAttribute('onclick') };
    // 触发真实 click 看是否打开表单
    if (typeof showForm === 'function') { try { showForm('卿泽懿'); } catch (e) { out.scene.formErr = String(e).slice(0,120); } }
    for (let i = 0; i < 40; i++) {
      const fv = document.getElementById('formView');
      if (fv && !fv.hidden) break;
      await new Promise(r => setTimeout(r, 300));
    }
    const fv = document.getElementById('formView');
    const tags = document.getElementById('tagsBox');
    const tasks = document.getElementById('taskCard');
    out.scene.form = { opened: !!fv && !fv.hidden,
      tagsBox: !!tags && tags.children.length > 0,
      tagsCount: tags ? tags.children.length : 0,
      taskCard: !!tasks && !tasks.hidden };
    // 返回墙
    const btnBack = document.getElementById('btnBackWall');
    if (btnBack) { try { btnBack.click(); } catch (e) {} }
    await new Promise(r => setTimeout(r, 400));
    const wv = document.getElementById('wallView');
    out.scene.backToWall = !!(wv && !wv.hidden && grid && !grid.hidden);
  }
  // 天气切换按钮
  const ws = document.getElementById('weatherSwitch');
  out.bindings.weatherSwitch = { exists: !!ws, hasClick: !!(ws && (ws.onclick || ws.getAttribute('onclick'))) };
  // 视图互斥检查
  out.viewStates = {
    gate: document.getElementById('deviceGate') ? !document.getElementById('deviceGate').hidden : null,
    wall: document.getElementById('wallView') ? !document.getElementById('wallView').hidden : null,
    form: document.getElementById('formView') ? !document.getElementById('formView').hidden : null
  };
  window.__testResult = out;
}
