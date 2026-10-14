(() => {
  // 注入身份态 + 强制展示班级墙（仅截图验证用）
  try { localStorage.setItem('sp_identity', JSON.stringify({ class: '六年级一班', studentName: '卿泽懿' })); } catch (e) {}
  try { localStorage.setItem('sp_semester', '2026秋'); } catch (e) {}
  const showWall = () => {
    const g = document.getElementById('deviceGate'); if (g) g.hidden = true;
    const w = document.getElementById('wallView'); if (w) w.hidden = false;
    const f = document.getElementById('formView'); if (f) f.hidden = true;
    const ld = document.getElementById('wallLoading'); if (ld) ld.hidden = true;
    const empty = document.getElementById('wallEmpty'); if (empty) empty.hidden = true;
    const grid = document.getElementById('matesGrid');
    if (grid && grid.children.length === 0) {
      const cards = [
        '<button class="mate"><span class="mate-avatar mood-l5" style="background:linear-gradient(135deg,#ffe9c4,#ffd9a8)">🦊</span><span class="mate-badge">今日2条</span><span class="mate-badge task-badge">📋 3/3</span><span class="mate-name">😊卿泽懿<span class="mate-lv">Lv3</span></span></button>',
        '<button class="mate"><span class="mate-avatar mood-l4" style="background:linear-gradient(135deg,#d9f0e6,#b7e2cf)">🐼</span><span class="mate-badge">今日1条</span><span class="mate-badge task-badge">📋 2/3</span><span class="mate-name">😄杨丽琪<span class="mate-lv">Lv2</span></span></button>',
        '<button class="mate"><span class="mate-avatar mood-l3" style="background:linear-gradient(135deg,#eef1ee,#dfe6e2)">🐰</span><span class="mate-badge count-badge">今日0条</span><span class="mate-badge task-badge">📋 1/3</span><span class="mate-name">😐杨紫菡</span></button>',
        '<button class="mate"><span class="mate-avatar mood-l4" style="background:linear-gradient(135deg,#e3f0fa,#c8e2f5)">🐨</span><span class="mate-badge">今日2条</span><span class="mate-badge task-badge">📋 3/3</span><span class="mate-name">😄卿瑶<span class="mate-lv">Lv2</span></span></button>',
        '<button class="mate"><span class="mate-avatar mood-l3" style="background:linear-gradient(135deg,#f3e8d8,#ead9c0)">🦁</span><span class="mate-badge count-badge">今日0条</span><span class="mate-name">🙂谭欣龙<span class="mate-lv">Lv2</span></span></button>',
        '<button class="mate"><span class="mate-avatar mood-l5" style="background:linear-gradient(135deg,#ffe6d6,#ffd0b8)">🐯</span><span class="mate-badge">今日1条</span><span class="mate-badge task-badge">📋 2/3</span><span class="mate-name">😊杨沐晴<span class="mate-lv">Lv2</span></span></button>',
        '<button class="mate"><span class="mate-avatar mood-l2" style="background:linear-gradient(135deg,#fbe9d8,#f6d9bd)">🐵</span><span class="mate-badge count-badge">今日0条</span><span class="mate-name">🙁杨鑫<span class="mate-lv">Lv1</span></span></button>',
        '<button class="mate"><span class="mate-avatar mood-l3" style="background:linear-gradient(135deg,#eef1ee,#dfe6e2)">🐷</span><span class="mate-badge count-badge">今日0条</span><span class="mate-name">🙂王星宇<span class="mate-lv">Lv1</span></span></button>',
        '<button class="mate"><span class="mate-avatar mood-l4" style="background:linear-gradient(135deg,#d9f0e6,#b7e2cf)">🐸</span><span class="mate-badge">今日1条</span><span class="mate-name">😄卿梓桐<span class="mate-lv">Lv1</span></span></button>'
      ];
      grid.innerHTML = cards.join('');
      grid.hidden = false;
    }
  };
  showWall();
  setTimeout(showWall, 1200);
  setTimeout(showWall, 3000);
})();
