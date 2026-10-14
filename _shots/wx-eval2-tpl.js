(() => {
  try { localStorage.setItem('sp_identity', JSON.stringify({ class: '六年级一班', studentName: '卿泽懿' })); } catch (e) {}
  const showWall = () => {
    const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
    const w = document.getElementById('wallView'); if (w) w.hidden = false;
    const f = document.getElementById('formView'); if (f) f.hidden = true;
    const ld = document.getElementById('wallLoading'); if (ld) ld.hidden = true;
    const empty = document.getElementById('wallEmpty'); if (empty) empty.hidden = true;
    const grid = document.getElementById('matesGrid');
    if (grid && grid.children.length === 0) {
      const names = [['卿泽懿','Lv3','🦊','#ffe9c4,#ffd9a8','今日2条','📋 3/3'],['杨丽琪','Lv2','🐼','#d9f0e6,#b7e2cf','今日1条','📋 2/3'],['杨紫菡','Lv2','🐰','#eef1ee,#dfe6e2','今日0条','📋 1/3'],['卿瑶','Lv2','🐨','#e3f0fa,#c8e2f5','今日2条','📋 3/3'],['谭欣龙','Lv2','🦁','#f3e8d8,#ead9c0','今日0条',''],['杨沐晴','Lv2','🐯','#ffe6d6,#ffd0b8','今日1条','📋 2/3'],['杨鑫','Lv1','🐵','#fbe9d8,#f6d9bd','今日0条',''],['王星宇','Lv1','🐷','#eef1ee,#dfe6e2','今日0条',''],['卿梓桐','Lv1','🐸','#d9f0e6,#b7e2cf','今日1条','']];
      grid.innerHTML = names.map(n => '<button class="mate"><span class="mate-avatar mood-l3" style="background:linear-gradient(135deg,' + n[3] + ')">' + n[2] + '</span><span class="mate-badge count-badge">' + n[4] + '</span>' + (n[5] ? '<span class="mate-badge task-badge">' + n[5] + '</span>' : '') + '<span class="mate-name">😊' + n[0] + '<span class="mate-lv">' + n[1] + '</span></span></button>').join('');
      grid.hidden = false;
    }
  };
  document.documentElement.setAttribute('data-weather', '__WX__');
  showWall();
  setTimeout(showWall, 1400);
  setTimeout(showWall, 3000);
})();
