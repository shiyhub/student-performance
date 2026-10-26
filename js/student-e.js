window.addEventListener('online', flushPending);

function resetSelections() {
  state.stars = 0;
  state.checkChosen = {};
  state.checkOption = {};
  state.textValues = {};
  renderStars();
  if (els.starCaption) els.starCaption.textContent = '';
  [els.posGrid, els.negGrid].forEach(grid => {
    grid.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
    grid.querySelectorAll('.sub-chip.active').forEach(c => c.classList.remove('active'));
    grid.querySelectorAll('.sub-options').forEach(s => { s.hidden = true; });
  });
  els.textTagsBox.querySelectorAll('input').forEach(i => { i.value = ''; });
  updateMood();
}

function prefillIdentity() {
  try {
    const saved = JSON.parse(localStorage.getItem('sp_identity') || 'null');
    if (saved) {
      els.inpClass.value = saved.class || '';
      els.inpName.value = saved.studentName || '';
    }
  } catch (e) {}
}

/* ---------- 鼓励动画 ---------- */

function celebrate(gainedXp, leveledUp) {
  const emojis = ['⭐', '🌟', '✨', '🎉', '💛', '🌈', '👏', '🚌', '📚'];
  els.confettiBox.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.fontSize = (16 + Math.random() * 20) + 'px';
    piece.style.animationDuration = (2.4 + Math.random() * 2) + 's';
    piece.style.animationDelay = (Math.random() * 0.7) + 's';
    els.confettiBox.appendChild(piece);
  }
  let msg;
  if (leveledUp) {
    const row = currentRosterRow();
    msg = `🎉 升级啦！你现在是 Lv.${row ? row.level : ''}，新头像已经解锁，快去挑一个吧！`;
  } else if (gainedXp > 0) {
    msg = `太棒啦！本次获得 ${gainedXp} 点经验 🌟`;
  } else {
    const pool = PRAISE[MOOD_BY_LEVEL(state.moodLevel).key] || PRAISE.good;
    msg = pool[Math.floor(Math.random() * pool.length)];
  }
  els.successMsg.textContent = msg;
  els.successOverlay.classList.add('show');
  Nav.push('success');   // RSK-10：提交成功浮层
  // 点任意处跳过庆祝
  const dismiss = () => {
    els.successOverlay.classList.remove('show');
    els.confettiBox.innerHTML = '';
    els.successOverlay.removeEventListener('click', dismiss);
  };
  els.successOverlay.addEventListener('click', dismiss);
  setTimeout(dismiss, 5200);
}

/* ---------- 工具 ---------- */

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayLabel() {
  const d = new Date();
  const w = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${w[d.getDay()]}`;
}
function formatDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const isToday = y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate();
  return `${m}月${d}日 星期${['日','一','二','三','四','五','六'][date.getDay()]}${isToday ? '（今天）' : ''}`;
}
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ================= 今日学习任务 ================= */
const TASK_GRADES = [
  { key: 'none',    label: '还没做',   icon: '⏳' },
  { key: 'done',    label: '完成了',   icon: '✅' },
  { key: 'good',    label: '优秀 A',   icon: '👍' },
  { key: 'perfect', label: '完美 A+',  icon: '🏆' }
];

async function loadStudentTask() {
  if (!els.taskCard) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { els.taskCard.hidden = true; return; }
  els.taskCard.hidden = false;
  els.taskBody.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载今日任务…</div>';
  let data;
  try {
    // SDK 网络失败返回 {data:null,error} 而不抛异常：必须显式检查 error，否则离线不回退缓存
    const r = await supabase.rpc('get_today_task', { p_class: cls, p_student: name });
    if (r && !r.error && r.data) {
      data = r.data;
      await window.Offline.set('task_' + cls + '_' + name, { data });
      try { localStorage.setItem('sp_task_' + cls + '_' + name, JSON.stringify(data)); } catch(e) {}
    } else { data = null; }
  } catch (e) { data = null; }
  if (!data) {
    // v111：任务缓存按 班级+姓名 隔离，避免离线时 A 的完成状态显示给 B
    const v = await window.Offline.get('task_' + cls + '_' + name);
    data = (v && v.data) || null;
    if (!data) { try { data = JSON.parse(localStorage.getItem('sp_task_' + cls + '_' + name) || 'null'); } catch(e2) { data = null; } }
  }
  if (!data) {
    // v114 兜底：个人任务缓存缺失时（如预缓存未完成），用班级墙里的今日任务定义，状态显示"还没做"
    const w = await window.Offline.get('wall_' + cls);
    const wt = (w && w.tasks) || [];
    if (wt.length) {
      data = { tasks: wt.map(t => ({ id: t.id, title: t.title, detail: t.detail, task_type: t.task_type, my_grade: 'none' })) };
    }
  }
  const tasks = (data && data.tasks) || [];
  const normal = tasks.filter(t => t.task_type !== 'recite' && t.task_type !== 'dictation');
  const recite = tasks.filter(t => t.task_type === 'recite');
  const dict = tasks.filter(t => t.task_type === 'dictation');

  function cardHtml(list, short) {
    if (!list.length) return null;
    return list.map(t => {
      const my = t.my_grade || 'none';
      const grades = short
        ? [['none','⏳ 未完成'],['done','✅ 完成']]
        : [['none','⏳ 还没做'],['done','✅ 完成了'],['good','👍 优秀 A'],['perfect','🏆 完美 A+']];
      const done = my && my !== 'none';
      return `<div class="stu-task${done ? ' done' : ''}">
        <div class="stu-task-title">${escapeHtml(t.title)}</div>
        ${t.detail ? `<div class="stu-task-detail">${escapeHtml(t.detail)}</div>` : ''}
        <div class="stu-task-grades">` +
        grades.map(([k,label]) => `<button type="button" class="stu-task-grade ${k===my?'on':''}" data-grade="${k}" data-task="${t.id}">${label}</button>`).join('') +
        `</div><div class="stu-task-result" data-result="${t.id}"></div></div>`;
    }).join('');
  }

  els.taskCard.hidden = !normal.length;
  els.taskBody.innerHTML = normal.length ? cardHtml(normal, false) : '';
  els.reciteTaskCard.hidden = !recite.length;
  els.reciteTaskBody.innerHTML = recite.length ? cardHtml(recite, true) : '';
  els.dictationTaskCard.hidden = !dict.length;
  els.dictationTaskBody.innerHTML = dict.length ? cardHtml(dict, true) : '';

  document.querySelectorAll('.stu-task-grade').forEach(btn => {
    btn.addEventListener('click', () => onPickTaskGrade(btn.dataset.grade, btn.dataset.task, btn));
  });
}

async function onPickTaskGrade(grade, taskId, btn) {
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (state.readonly) { sfx.oops(); toast('预览模式不能提交哦～'); return; }
  // "还没做"也提交：用于撤销之前的评分、回退经验
  const wr = await runWrite({ name: 'submit_task', params: { p_class: cls, p_student: name, p_task_id: taskId, p_grade: grade } });
  if (!wr.ok) { sfx.oops(); toast('保存失败，请重试'); return; }
  const d = wr.res || {};
  sfx.pick();
  // 已评(非"还没做")任务卡片置灰；撤销评分则恢复
  const cardEl = btn.closest('.stu-task');
  if (cardEl) cardEl.classList.toggle('done', grade !== 'none');
  const resultEl = document.querySelector(`[data-result="${taskId}"]`);
  if (resultEl) {
    if (grade === 'none') {
      resultEl.textContent = '好的，继续加油把任务完成吧！';
    } else if (wr.queued) {
      resultEl.textContent = '已离线保存，联网后自动同步 ✅';
      // 离线：本地即时反映状态（按钮高亮 + 缓存），联网后以服务端为准
      document.querySelectorAll(`.stu-task-grade[data-task="${taskId}"]`).forEach(b => b.classList.toggle('on', b.dataset.grade === grade));
      try {
        const v = await window.Offline.get('task_' + cls + '_' + name);
        if (v && v.data && Array.isArray(v.data.tasks)) {
          v.data.tasks.forEach(t => { if (t.id === taskId) t.my_grade = grade; });
          await window.Offline.set('task_' + cls + '_' + name, v);
          try { localStorage.setItem('sp_task_' + cls + '_' + name, JSON.stringify(v.data)); } catch (e2) {}
        }
      } catch (e3) {}
    } else {
      const xpGain = (d.xp_delta || 0) > 0 ? ' 经验+' + d.xp_delta : '';
      resultEl.textContent = grade === 'perfect' ? `太棒啦，完美完成！${xpGain}`
                          : grade === 'good'    ? `真不错，继续保持！${xpGain}`
                          :                       `完成啦，辛苦啦！${xpGain}`;
      if (d.mood_awarded) resultEl.textContent += ' 心情+1 😊';
    }
  }
  const row = state.roster.find(s => s.class === cls && s.student_name === name);
  if (!wr.queued && row && typeof d.xp === 'number') { row.xp = d.xp; row.level = d.level; }
  renderIdentityLevel();
  loadProfile();
  loadStudentTask();
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============ 天气联动主题（v21：自动读洞口县实时天气，可手动切换兜底） ============ */
(function () {
  var THEMES = ['sunny', 'cloudy', 'rainy', 'snowy'];
  var LABELS = { sunny: '晴', cloudy: '多云', rainy: '雨', snowy: '雪' };
  var root = document.documentElement;
  var deco = document.getElementById('skyDeco');
  var btn = document.getElementById('weatherSwitch');
  var flowerL = document.getElementById('flowerLeft');
  var flowerR = document.getElementById('flowerRight');
  if (!deco || !btn) return;
  var AUTO_KEY = 'sp_weather_auto';

  function codeToTheme(c) {
    c = Number(c);
    if (c === 0 || c === 1) return 'sunny';
    if (c === 2 || c === 3 || c === 45 || c === 48) return 'cloudy';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) return 'rainy';
    if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return 'snowy';
    return 'sunny';
  }

  // 分层均匀分布：n 个粒子把区域均匀分层，每层内随机抖动（近似均匀）
  function layerPos(i, n, jitter) {
    var seg = 100 / n;
    return seg * i + (Math.random() - 0.5) * seg * (jitter || 1);
  }

  /* ============ v3.0：雨/雪 Canvas 粒子引擎 ============
     参考雪花粒子系统：球面随机发射 · 左右摆动飘落 · additive 叠加发光 ·
     淡入淡出 · 密度按面积自适应 · DPR≤2 · reduced-motion 停用 */
  var wxCanvas = document.getElementById('wxCanvas');
  var wxCtx = wxCanvas ? wxCanvas.getContext('2d') : null;
  var wxParticles = [];
  var wxMode = '';            // '' | 'rain' | 'snow'
  var wxRunning = false;
  var wxRafId = 0, wxLastT = 0, wxAcc = 0;
  var wxDPR = Math.min(window.devicePixelRatio || 1, 2);
  var wxW = 0, wxH = 0, wxMax = 400;
  var wxReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var WX_CFG = {
    rain: { rate: 160, lifeMin: 1.0, lifeMax: 2.2, sizeMin: 3.0, sizeMax: 5.5,
            vyMin: 520, vyMax: 840, vxMin: -30, vxMax: 30, swayAmp: 10, swayFreq: 1.4,
            areaPer: 1200, lenK: 4 },
    snow: { rate: 40, lifeMin: 8, lifeMax: 20, sizeMin: 2, sizeMax: 30,
            vyMin: 40, vyMax: 75, vxMin: -25, vxMax: -8, swayAmp: 27, swayFreq: 0.9,
            areaPer: 4800, lenK: 2.1 }
  };

  function wxResize() {
    if (!wxCanvas || !wxCtx) return;
    wxW = window.innerWidth; wxH = window.innerHeight;
    wxCanvas.width = Math.round(wxW * wxDPR);
    wxCanvas.height = Math.round(wxH * wxDPR);
    wxCanvas.style.width = wxW + 'px';
    wxCanvas.style.height = wxH + 'px';
    wxCtx.setTransform(wxDPR, 0, 0, wxDPR, 0, 0);
    var cfg = WX_CFG[wxMode];
    wxMax = cfg ? Math.max(120, Math.min(900, Math.round((wxW * wxH) / cfg.areaPer))) : 400;
  }

  function wxSpawn(force) {
    var cfg = WX_CFG[wxMode];
    if (!cfg || wxParticles.length >= wxMax) return;
    var p = {
      x: Math.random() * wxW * 1.12 - wxW * 0.06,
      y: force ? Math.random() * wxH * 0.5 : -20 - Math.random() * wxH * 0.06,
      life: 0,
      maxLife: (cfg.lifeMin + Math.random() * (cfg.lifeMax - cfg.lifeMin)) * 60,
      size: cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin),
      vx: cfg.vxMin + Math.random() * (cfg.vxMax - cfg.vxMin),
      vy: cfg.vyMin + Math.random() * (cfg.vyMax - cfg.vyMin),
      swayAmp: cfg.swayAmp * (0.6 + Math.random() * 0.8),
      swayFreq: cfg.swayFreq + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.7 + Math.random() * 0.3,
      shade: Math.random()
    };
    wxParticles.push(p);
  }

  function wxDraw(p, t) {
    var cfg = WX_CFG[wxMode];
    if (!cfg) return;
    var fadeIn = Math.min(p.life / (0.1 * 60), 1);          // 0.1s 淡入
    var fadeOut = Math.min((p.maxLife - p.life) / (0.12 * 60), 1);
    var a = p.alpha * fadeIn * fadeOut;
    if (a <= 0.01) return;
    var sway = Math.sin(t * p.swayFreq + p.phase) * p.swayAmp;
    var x = p.x + sway, y = p.y;
    var r = p.size * (wxW / 1920);                          // 按视口缩放
    if (r < 0.8) r = 0.8;
    if (r > 26) r = 26;
    if (wxMode === 'rain') {
      // 雨点：发光光点 + 短雨痕（参考发光点风格，浅色底上保证可见）
      var len = r * cfg.lenK;
      var g = wxCtx.createLinearGradient(x, y - len, x, y);
      g.addColorStop(0, 'rgba(196,226,248,0)');
      g.addColorStop(1, 'rgba(216,238,252,' + (a * 0.8) + ')');
      wxCtx.strokeStyle = g;
      wxCtx.lineWidth = Math.max(1.2, r * 0.5);
      wxCtx.lineCap = 'round';
      wxCtx.beginPath();
      wxCtx.moveTo(x, y - len); wxCtx.lineTo(x, y);
      wxCtx.stroke();
      var gg = wxCtx.createRadialGradient(x, y, 0, x, y, r * 4.2);
      gg.addColorStop(0, 'rgba(234,246,254,' + a + ')');
      gg.addColorStop(0.55, 'rgba(206,232,250,' + (a * 0.55) + ')');
      gg.addColorStop(1, 'rgba(206,232,250,0)');
      wxCtx.fillStyle = gg;
      wxCtx.beginPath(); wxCtx.arc(x, y, r * 4.2, 0, Math.PI * 2); wxCtx.fill();
    } else {
      // 雪花：柔和发光光点（白→淡灰蓝，chromaticdot 风格）
      var gg2 = wxCtx.createRadialGradient(x, y, 0, x, y, r * 2.1);
      var t0 = 0.85 + p.shade * 0.15;
      if (p.shade > 0.72) {
        gg2.addColorStop(0, 'rgba(' + Math.round(232 + (1 - t0) * 23) + ',' + Math.round(247 + (1 - t0) * 8) + ',255,' + a + ')');
        gg2.addColorStop(0.45, 'rgba(216,240,255,' + (a * 0.55) + ')');
      } else {
        gg2.addColorStop(0, 'rgba(255,255,255,' + a + ')');
        gg2.addColorStop(0.45, 'rgba(236,246,252,' + (a * 0.5) + ')');
      }
      gg2.addColorStop(1, 'rgba(230,244,252,0)');
      wxCtx.fillStyle = gg2;
      wxCtx.beginPath(); wxCtx.arc(x, y, r * 2.1, 0, Math.PI * 2); wxCtx.fill();
    }
  }

  function wxFrame(now) {
    if (!wxRunning) return;              // 停止后不再自续 raf（避免双循环）
    wxRafId = requestAnimationFrame(wxFrame);
    var dt = Math.min((now - wxLastT) / 1000, 0.05);
    wxLastT = now;
    var cfg = WX_CFG[wxMode];
    if (!cfg) return;
    wxAcc += cfg.rate * dt;
    while (wxAcc >= 1) { wxSpawn(false); wxAcc -= 1; }
    if (wxParticles.length < wxMax * 0.5 && Math.random() < 0.3) wxSpawn(false);
    wxCtx.clearRect(0, 0, wxW, wxH);
    wxCtx.globalCompositeOperation = 'lighter';            // additive 叠加
    var t = now / 1000;
    var i = wxParticles.length;
    while (i--) {
      var p = wxParticles[i];
      p.life += dt * 60;                       // 帧单位寿命
      p.x += p.vx * dt;                        // vx/vy 为 px/秒
      p.y += p.vy * dt;
      if (p.life >= p.maxLife || p.y > wxH + 60 || p.x < -160 || p.x > wxW + 160) {
        wxParticles.splice(i, 1); continue;
      }
      wxDraw(p, t);
    }
    wxCtx.globalCompositeOperation = 'source-over';
  }

  function wxStart(mode) {
    if (!wxCanvas || !wxCtx || wxReduced) return;
    if (wxMode === mode && wxRunning) return;
    wxMode = mode;
    wxParticles = [];
    wxAcc = 0;
    wxResize();
    for (var k = 0; k < Math.min(90, wxMax); k++) wxSpawn(true);
    if (!wxRunning) {
      wxRunning = true;
      wxLastT = performance.now();
      wxRafId = requestAnimationFrame(wxFrame);
    }
  }

  function wxStop() {
    if (wxMode === '' && !wxRunning) return;
    wxMode = '';
    wxRunning = false;
    wxParticles = [];
    if (wxCtx) wxCtx.clearRect(0, 0, wxW, wxH);
  }

  window.addEventListener('resize', wxResize);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { wxRunning = false; }
    else if (wxMode) { wxRunning = true; wxLastT = performance.now(); }
  });

  function renderDeco(w) {
    deco.innerHTML = '';
    var narrow = window.innerWidth <= 900;
    var i, el;
    if (w === 'sunny') {
      var n = narrow ? 16 : 30;
      for (i = 0; i < n; i++) {
        el = document.createElement('span');
        el.className = 'star' + (i % 3 === 0 ? ' tw' : '');
        el.style.left = Math.max(0, Math.min(100, layerPos(i, n, 1.4))) + '%';
        el.style.top = Math.max(0, Math.min(100, layerPos((i * 7) % n, n, 1.4))) + '%';
        el.style.width = el.style.height = (2 + Math.random() * 3.5) + 'px';
        el.style.animationDuration = (6 + Math.random() * 8) + 's';
        el.style.animationDelay = (Math.random() * 8) + 's';
        deco.appendChild(el);
      }
      /* 太阳光斑：大号柔和金色光晕，均匀分布于页面（卡片后方） */
      var gn = narrow ? 2 : 4;
      var glowLeft = narrow ? [15, 85] : [6, 32, 68, 94];
      for (i = 0; i < gn; i++) {
        el = document.createElement('span');
        el.className = 'sun-glow';
        el.style.left = glowLeft[i] + '%';
        el.style.top = (8 + i * 22 + Math.random() * 8) + '%';
        el.style.width = el.style.height = (narrow ? 90 : 150 + i * 40) + 'px';
        el.style.animationDelay = (Math.random() * 4) + 's';
        deco.appendChild(el);
      }
    }
    if (w === 'rainy') {
      wxStart('rain');     // v3.0：Canvas 雨滴粒子（发光雨丝）
      return;
    }
    if (w === 'snowy') {
      wxStart('snow');     // v3.0：Canvas 雪花粒子（发光光点）
      return;
    }
    wxStop();
  }

  function setTheme(w, manual) {
    if (THEMES.indexOf(w) < 0) w = 'sunny';
    root.setAttribute('data-weather', w);
    if (flowerL) flowerL.src = 'assets/flowers/flower-' + w + '.png';
    if (flowerR) flowerR.src = 'assets/flowers/flower-' + w + '.png';
    renderDeco(w);
    btn.title = '天气主题：' + (LABELS[w] || w) + '（自动跟随洞口县天气，点按可切换）';
    if (manual) {
      try { localStorage.setItem(AUTO_KEY, w + ':' + Date.now()); } catch (e) {}
    }
  }

  // 手动切换（演示/离线兜底；点击后 30 分钟内保持手动，之后恢复自动）
  var manualUntil = 0;
  var savedTheme = 'sunny';
  try {
    var mv = localStorage.getItem(AUTO_KEY);
    if (mv && mv.indexOf(':') > 0) {
      var parts = mv.split(':');
      manualUntil = Number(parts[1]) || 0;
      if (manualUntil > Date.now()) savedTheme = parts[0];
    }
  } catch (e) {}
  // 初始立即应用（默认/记忆主题），避免等待天气接口期间页面保持裸状态
  setTheme(savedTheme, false);
  btn.addEventListener('click', function () {
    var cur = root.getAttribute('data-weather') || 'sunny';
    var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    manualUntil = Date.now() + 30 * 60 * 1000;
    setTheme(next, true);
  });

  // 自动获取湖南省洞口县实时天气（Open-Meteo，免 key、支持跨域）
  var done = false;
  function fetchWeather() {
    if (done) return;
    done = true;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 7000) : null;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=27.0572&longitude=110.5759&current_weather=true', ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var code = d && d.current_weather && d.current_weather.weathercode;
        if (code !== undefined) setTheme(codeToTheme(code), false);
      })
      .catch(function () {
        if (Date.now() >= manualUntil) setTheme('sunny', false);  // 获取失败且未手动指定 → 默认晴天
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  fetchWeather();
})();
init();