
/* ---------------- v137(RSK-13)：头像框粒子注入 ----------------
   配置见文件顶部 FRAME_PARTICLES/FP_SHAPE_CLS/FP_ANIM_CLS */

/* ---------------- v139：写实少年头像粒子 + 呼吸光效 ----------------
   配置见文件顶部 AVATAR_PARTICLES；ap-layer 相对头像容器 130%，粒子环带贴合头像圆形外缘 */

/* 生成一个头像粒子（相对 .ap-layer，宽=头像容器×1.3） */
function apOne(cfg, i) {
  const ang = Math.random() * Math.PI * 2;
  const rad = 34 + Math.random() * 10;            // 相对 ap-layer 宽度的环带：落在头像圆边缘内外
  const cx = 50 + Math.cos(ang) * rad;
  const cy = 50 + Math.sin(ang) * rad;
  const s  = 1.0 + Math.random() * 1.7;           // 粒子大小
  const c  = cfg.colors[i % cfg.colors.length];
  const shape = cfg.shapes[i % cfg.shapes.length];
  const dur = 2.6 + Math.random() * 2.6;
  const delay = -Math.random() * 5.5;
  const cls = 'fp-p ' + (FP_SHAPE_CLS[shape] || '') + ' ' + (FP_ANIM_CLS[cfg.anim] || 'fp-a-float');
  const glow = shape === 'star' || shape === 'ember' ? `box-shadow:0 0 ${s * 1.8}px ${c};` : `box-shadow:0 0 ${s * 1.1}px ${c};`;
  return `<i class="${cls}" style="left:${cx.toFixed(1)}%;top:${cy.toFixed(1)}%;width:${s.toFixed(2)}%;height:${s.toFixed(2)}%;background:${c};${glow}animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;"></i>`;
}

/* 字符串版：班级墙卡片头像（renderWall 拼接用） */
function avatarParticlesHTML(key) {
  const cfg = AVATAR_PARTICLES[key];
  if (!cfg) return '';
  let h = `<span class="ap-layer">`;
  for (let i = 0; i < cfg.n; i++) h += apOne(cfg, i);
  return h + '</span>';
}

/* DOM 版：为头像容器挂粒子层 + 呼吸光效（身份头像/详情头像/选择器预览） */
function attachAvatarFx(el, key) {
  if (!el) return;
  el.classList.remove('ap-breathe');
  el.style.setProperty('--glow', '0,0,0');
  el.querySelectorAll(':scope > .ap-layer').forEach(x => x.remove());
  const cfg = AVATAR_PARTICLES[key];
  if (!cfg) return;
  el.classList.add('ap-breathe');
  el.style.setProperty('--glow', cfg.glow);
  let h = '<span class="ap-layer">';
  for (let i = 0; i < cfg.n; i++) h += apOne(cfg, i);
  el.insertAdjacentHTML('beforeend', h + '</span>');
}

/* 生成一个粒子的内联样式（相对 .fp-layer，宽=元素直径×1.76） */
function fpOne(cfg, i, W) {
  const ang = Math.random() * Math.PI * 2;
  const rad = 26 + Math.random() * 8;            // 相对 fp-layer 宽度的百分比环带
  const cx = 50 + Math.cos(ang) * rad;
  const cy = 50 + Math.sin(ang) * rad;
  const s  = 1.2 + Math.random() * 1.9;          // 相对 fp-layer 宽度的百分比大小
  const c  = cfg.colors[i % cfg.colors.length];
  const shape = cfg.shapes[i % cfg.shapes.length];
  const dur = 2.8 + Math.random() * 2.8;
  const delay = -Math.random() * 5.5;
  const cls = 'fp-p ' + (FP_SHAPE_CLS[shape] || '') + ' ' + (FP_ANIM_CLS[cfg.anim] || 'fp-a-float');
  const glow = shape === 'star' || shape === 'ember' ? `box-shadow:0 0 ${s * 1.8}px ${c};` : `box-shadow:0 0 ${s * 1.1}px ${c};`;
  return `<i class="${cls}" style="left:${cx.toFixed(1)}%;top:${cy.toFixed(1)}%;width:${s.toFixed(2)}%;height:${s.toFixed(2)}%;background:${c};${glow}animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;"></i>`;
}

/* 字符串版：班级墙卡片头像（renderWall 拼接用） */
function frameParticlesHTML(key) {
  const cfg = FRAME_PARTICLES[key];
  if (!cfg) return '';
  let h = `<span class="fp-layer fp-${key}">`;
  for (let i = 0; i < cfg.n; i++) h += fpOne(cfg, i, 0);
  return h + '</span>';
}

/* DOM 版：applyFrameTo 后为元素挂粒子层（身份头像/详情头像） */
function attachParticles(el, key) {
  if (!el) return;
  el.querySelectorAll(':scope > .fp-layer').forEach(x => x.remove());
  const cfg = FRAME_PARTICLES[key];
  if (!cfg) return;
  const layer = document.createElement('span');
  layer.className = 'fp-layer fp-' + key;
  layer.innerHTML = frameParticlesHTML(key);
  el.appendChild(layer);
}

/* ---------------- v160：头像框独立页面 + 解锁逻辑重写 ----------------
   学生端头像框从头像区拆出：个人主页头像下方「更换头像框」入口 → 独立页面 #frameView。
   解锁集合 calcUnlockedFrames 与 95/96 号服务端口径完全一致；
   打开页面时强制 loadProfile() 刷新，避免旧缓存导致 7 级不解锁。 */
function calcUnlockedFrames(profile) {
  const achs = (profile && profile.achievements) || [];
  const lv = Number(profile && profile.level) || 1;
  const has = k => achs.some(a => a.key === k && a.unlocked);
  /* v152.9：bronze/silver 按「累计记录天数」判定（与服务端 72 号同口径，周末不上课连续不可达） */
  const totD = Number(profile && profile.metrics && profile.metrics.total_days) || 0;
  const un = new Set(['none']);
  if (totD >= 10) un.add('bronze');
  if (totD >= 30) un.add('silver');
  if (lv >= 5) un.add('gold');
  if (lv >= 7) un.add('rainbow');   // 服务端 43/47/29：rainbow = Lv.7 满级
  if (has('active20')) un.add('star');
  if (has('perfect5')) un.add('heart');
  if (has('top3')) un.add('crown');
  /* v130：12 款游戏风（服务端 43 号同口径） */
  if (lv >= 2) { un.add('tac'); un.add('sakura'); }
  if (lv >= 3) { un.add('gun'); un.add('pixie'); }
  if (lv >= 4) { un.add('mecha'); un.add('magic'); }
  if (lv >= 5) { un.add('wolf'); un.add('rose'); un.add('fairy'); }
  if (lv >= 6) { un.add('dragon'); un.add('queen'); un.add('princess'); }
  /* v142：七风格进阶（v160 补全，原来 7 级以上全漏） */
  if (lv >= 7) { un.add('huadian'); un.add('blossom'); }
  if (lv >= 8) { un.add('ink'); un.add('spring'); }
  if (lv >= 9) { un.add('redlily'); un.add('mask'); }
  if (lv >= 10) { un.add('neonwolf'); }
  /* 新 15 款（95 号 SQL 同口径：魔法星空 Lv.7 / 兽耳小铺 Lv.8） */
  if (lv >= 7) { ['ice','moon','crystal','silk','goldwing','kitty'].forEach(k => un.add(k)); }
  if (lv >= 8) { ['devilcat','angelcat','clover','neko','sweets','goth','broken','mono','tech'].forEach(k => un.add(k)); }
  return un;
}

// 解锁兜底：档案接口失败/缓存为空时，用班级墙 roster 里的真实等级重算，
// 避免"进入页面全部锁定"的误导（roster 来自 get_wall_data，必带 level）
function ensureProfileUnlocked() {
  const p = state.profile;
  if (p && Array.isArray(p.unlocked_frames) && p.unlocked_frames.length > 0) return;
  const row = currentRosterRow();
  const lv = (row && Number(row.level)) || 1;
  state.profile = Object.assign({}, p || {}, {
    level: lv,
    unlocked_frames: Array.from(calcUnlockedFrames({ level: lv, metrics: {}, achievements: [] }))
  });
}

function frameNameOf(key) {
  const f = FRAMES.find(x => x.key === key);
  return f ? f.name : (key === 'none' ? '无框' : key);
}

// 预览区刷新（独立页面顶部的当前佩戴预览）
function updateFramePreview(frameKey) {
  if (!els.framePreviewAvatar) return;
  const av = currentAvatar();
  paintAvatar(els.framePreviewAvatar, av);
  applyFrameTo(els.framePreviewAvatar, frameKey || state.myFrame || 'none');
  if (els.framePreviewLevel) {
    els.framePreviewLevel.textContent = 'Lv.' + (Number(state.profile && state.profile.level) || 1);
  }
}

// 渲染独立页面：全部头像框网格（解锁/锁定/当前佩戴）
function renderFramePage() {
  const grid = els.framePageGrid;
  if (!grid) return;
  const row = currentRosterRow();
  const curFrame = state.myFrame || (row && row.frame) || 'none';
  ensureProfileUnlocked();
  const unlockedSet = new Set((state.profile && state.profile.unlocked_frames) || ['none']);
  // 顶部预览
  updateFramePreview(curFrame);
  if (els.framePreviewName) {
    const cls = (els.inpClass.value || '').trim();
    const nm = (els.inpName.value || '').trim();
    els.framePreviewName.textContent = cls ? cls + ' · ' + nm : (nm || '未选择学生');
  }
  if (els.framePreviewTip) {
    els.framePreviewTip.textContent =
      (state.profile && state.profile.ok !== false) ? `当前佩戴：${frameNameOf(curFrame)}` : '先回主页填好班级和姓名，再进来挑头像框';
  }
  // 网格
  grid.innerHTML = '';
  FRAMES.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'frame-choice fc-' + f.key + (f.key === curFrame ? ' selected' : '');
    const unlocked = f.key === 'none' || unlockedSet.has(f.key);
    b.innerHTML = `<span class="fc-ring"></span>` +
      (unlocked ? '' : `<span class="fc-lock">🔒<em>${f.need}</em></span>`);
    b.addEventListener('click', () => {
      if (!unlocked) { sfx.oops(); toast(`这个头像框还没解锁：${f.need}`); return; }
      onChooseFrame(f.key, b);
    });
    grid.appendChild(b);
  });
  // 已解锁计数
  if (els.frameCountTip) {
    const total = FRAMES.length;
    const got = FRAMES.filter(f => f.key === 'none' || unlockedSet.has(f.key)).length;
    els.frameCountTip.textContent = `已解锁 ${got}/${total}`;
  }
}

// 打开独立头像框页：先强制刷新 profile（服务端最新等级 → 解锁状态），再渲染
async function openFramePage() {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) { toast('请先回主页填好班级和姓名'); return; }
  sfx.tap();
  if (els.wallView) els.wallView.hidden = true;
  if (els.formView) els.formView.hidden = true;
  if (els.frameView) els.frameView.hidden = false;
  window.scrollTo(0, 0);
  if (els.frameConfigBanner) els.frameConfigBanner.hidden = !!ready;
  await loadProfile();          // 关键：打开即刷新，不再吃旧缓存
  ensureProfileUnlocked();      // 档案失败时用 roster 等级兜底，避免全锁定
  renderFramePage();
  if (typeof Nav !== 'undefined' && Nav.push) Nav.push('frames');
}

function closeFramePage() {
  sfx.back();
  if (els.frameView) els.frameView.hidden = true;
  if (els.formView) els.formView.hidden = false;
  window.scrollTo(0, 0);
  if (typeof Nav !== 'undefined' && Nav.pop) Nav.pop();
}

function buildFrameSection() {
  const sec = document.createElement('div');
  sec.className = 'avatar-sec';
  sec.innerHTML = `<div class="avatar-sec-title">✨ 头像框<span class="avatar-sec-tip">达成成就自动解锁，点一下佩戴</span></div>`;
  const grid = document.createElement('div');
  grid.className = 'frame-grid';
  const row = currentRosterRow();
  const curFrame = state.myFrame || (row && row.frame) || 'none';
  const unlockedSet = new Set((state.profile && state.profile.unlocked_frames) || calcUnlockedFrames(state.profile));
  FRAMES.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'frame-choice fc-' + f.key + (f.key === curFrame ? ' selected' : '');
    const unlocked = f.key === 'none' || unlockedSet.has(f.key);
    b.innerHTML = `<span class="fc-ring"></span>` +
      (unlocked ? '' : `<span class="fc-lock">🔒<em>${f.need}</em></span>`);
    b.addEventListener('click', () => {
      if (!unlocked) { sfx.oops(); toast(`这个头像框还没解锁：${f.need}`); return; }
      onChooseFrame(f.key, b);
    });
    grid.appendChild(b);
  });
  sec.appendChild(grid);
  els.avatarPicker.appendChild(sec);
}

async function onChooseFrame(key, btn) {
  sfx.pick();
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { toast('请先填好班级和姓名'); return; }
  const inPage = !!(els.frameView && !els.frameView.hidden);
  const grid = inPage ? els.framePageGrid : els.avatarPicker;
  const wr = await runWrite({ name: 'set_student_frame', params: { p_class: cls, p_student: name, p_frame: key } });
  if (!wr.ok) { toast('保存失败，请重试'); return; }
  if (wr.queued) {
    state.myFrame = key;
    const row = currentRosterRow();
    if (row) row.frame = key;
    if (grid) grid.querySelectorAll('.frame-choice').forEach(x => x.classList.toggle('selected', x === btn));
    applyFrameTo(els.identityAvatarEmoji, key);
    if (inPage) { updateFramePreview(key); } else { setTimeout(() => els.avatarModal.classList.remove('show'), 260); }
    toast('已离线选好，联网后自动同步 ✅');
    return;
  }
  if (!wr.res || wr.res.ok === false) {
    const locked = wr.res && (wr.res.reason === 'locked' || wr.res.reason === 'locked_tier');
    if (locked) {
      toast('这个头像框还没解锁哦，继续加油～');
      if (inPage) { await loadProfile(); renderFramePage(); }  // 服务端拒绝时刷新解锁状态
    } else {
      toast('保存失败，请重试');
    }
    return;
  }
  state.myFrame = key;
  const row = currentRosterRow();
  if (row) row.frame = key;
  if (grid) grid.querySelectorAll('.frame-choice').forEach(x => x.classList.toggle('selected', x === btn));
  applyFrameTo(els.identityAvatarEmoji, key);
  if (inPage) { updateFramePreview(key); } else { setTimeout(() => els.avatarModal.classList.remove('show'), 260); }
  toast(key === 'none' ? '已取下头像框' : '头像框戴好啦，真好看！');
}

/* ---------------- v105：成就 ---------------- */
async function loadProfile() {
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!ready || !cls || !name) { if (els.achCard) els.achCard.hidden = true; return; }
  let data;
  try {
    const r = await supabase.rpc('get_student_profile', { p_class: cls, p_student: name });
    if (r.error) throw r.error;
    data = r.data;
    if (data) await window.Offline.set('profile_' + cls + '_' + name, { data });
  } catch (e) {
    const v = await window.Offline.get('profile_' + cls + '_' + name);
    data = (v && v.data) || null;
    if (!data) { if (els.achCard) els.achCard.hidden = true; return; }
  }
  if (!data || data.ok === false) { if (els.achCard) els.achCard.hidden = true; return; }

  state.profile = data;
  state.myFrame = data.frame || 'none';

  // 已解锁头像框集合：统一走 calcUnlockedFrames（v160：补全 7/8/9/10 级七风格 + 15 款新框，修复 7 级不解锁）
  const achs = data.achievements || [];
  data.unlocked_frames = Array.from(calcUnlockedFrames(data));

  renderAchievements(achs);
  applyFrameTo(els.identityAvatarEmoji, state.myFrame);

  // 新解锁成就：对比本机已见列表，逐个弹提示
  const seenKey = 'sp_seen_ach_' + cls + '_' + name;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch (e) {}
  const seenSet = new Set(seen);
  const fresh = achs.filter(a => a.unlocked && !seenSet.has(a.key));
  if (fresh.length) fresh.forEach(a => toast(`🏅 解锁成就「${a.name}」${a.icon}`));
  if (fresh.length) sfx.success();
  try { localStorage.setItem(seenKey, JSON.stringify(achs.filter(a => a.unlocked).map(a => a.key))); } catch (e) {}
}

function renderAchievements(achs) {
  if (!els.achGrid) return;
  els.achCard.hidden = false;
  const done = achs.filter(a => a.unlocked).length;
  els.achCount.textContent = `${done}/${achs.length}`;
  els.achGrid.innerHTML = achs.map(a => `
    <div class="ach-item ${a.unlocked ? 'unlocked' : 'locked'}">
      <div class="ach-ic">${a.unlocked ? a.icon : '🔒'}</div>
      <div class="ach-n">${esc(a.name)}</div>
      <div class="ach-p">${a.unlocked ? esc(a.desc) : `${a.cur}/${a.target}`}</div>
    </div>`).join('');
}

function showForm(presetName) {
  if (!state.currentClass) { toast('请先选择班级'); return; }
  els.inpClass.value = state.currentClass;
  if (presetName) {
    els.inpName.value = presetName;
    try {
      localStorage.setItem('sp_identity',
        JSON.stringify({ class: state.currentClass, studentName: presetName }));
    } catch (e) {}
  }
  state.myAvatar = null;   // 进入表单先显示该学生已保存的头像
  els.wallView.hidden = true;
  els.formView.hidden = false;
  loadProfile();           // v105：拉取成就与已解锁头像框
  window.scrollTo({ top: 0 });
  updateMood();
  if (!els.inpName.value) els.inpName.focus();
  resetSelections();
  loadTags();
  loadStudentTask();
  loadPastTasks();
  updateSubmitStatus();
  loadTodayTasks();
  loadPersonalTasks();
  loadChallengeTasks();   // v152：修复学生端挑战任务卡片从不加载的问题（原 showForm 未调用）
}

// v114：显示"今天是否已提交"（离线时用缓存判断，让学生知道填过没有，避免重复填报）
async function updateSubmitStatus() {
  const el = els.submitStatus;
  if (!el) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { el.hidden = true; return; }
  const today = todayStr();
  let myToday = [];
  if (!window.Offline || !window.Offline.online) {
    const v = await window.Offline.get('wall_' + cls);
    myToday = ((v && v.records) || []).filter(r => r.student_name === name && r.record_date === today);
    if (!myToday.length) {
      const v2 = await window.Offline.get('records_all_' + cls);
      myToday = ((v2 && v2.data) || []).filter(r => r.student_name === name && r.record_date === today);
    }
  } else {
    myToday = (state.records || []).filter(r => r.student_name === name && r.record_date === today);
  }
  if (myToday.length) {
    el.hidden = false;
    el.textContent = `✅ 今天已提交 ${myToday.length} 次，可继续补充表现（不会重复加分）`;
    el.className = 'submit-status submit-status-ok';
  } else {
    el.hidden = true;
    el.className = 'submit-status';
  }
}

async function loadPastTasks() {
  if (!els.pastTaskCard) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { els.pastTaskCard.hidden = true; return; }
  els.pastTaskCard.hidden = false;
  const since = new Date(); since.setDate(since.getDate() - 6);
  const p = n => String(n).padStart(2, '0');
  const sinceStr = `${since.getFullYear()}-${p(since.getMonth()+1)}-${p(since.getDate())}`;
  try {
    // 往日任务列表：离线/失败时用最近缓存（sp_past_<cls>）
    let tasks = null;
    try {
      const r = await supabase.from('daily_task')
        .select('id,title,detail,task_date,task_type,due_time')
        .eq('class', cls).gte('task_date', sinceStr).lt('task_date', todayStr())
        .order('task_date', { ascending: false });
      tasks = r.data;
      if (!r.error && tasks) { try { localStorage.setItem('sp_past_' + cls, JSON.stringify(tasks)); } catch(e) {} }
    } catch (e) { tasks = null; }
    if (!tasks) { try { tasks = JSON.parse(localStorage.getItem('sp_past_' + cls) || '[]'); } catch(e2) { tasks = []; } }
    const taskIds = tasks.map(t => t.id);
    // 提交记录：走专用 RPC get_my_task_subs（security definer，绕过 RLS，只返回该生自己的提交）
    // v129：此前直查 task_submission 被 RLS 过滤为空 → 往日任务永远显示"已截止"（RSK-09）
    let subs = null;
    try {
      const r = await supabase.rpc('get_my_task_subs', { p_student: name });
      subs = r && r.data;
      if (!r || r.error || !subs) {
        try { subs = JSON.parse(localStorage.getItem('sp_past_subs_' + cls + '_' + name) || '[]'); } catch(e2) { subs = []; }
      } else {
        try { localStorage.setItem('sp_past_subs_' + cls + '_' + name, JSON.stringify(subs)); } catch(e) {}
      }
    } catch(e) {
      try { subs = JSON.parse(localStorage.getItem('sp_past_subs_' + cls + '_' + name) || '[]'); } catch(e2) { subs = []; }
    }
    const gradeMap = {}; subs.forEach(s => gradeMap[s.task_id] = s.grade);
    const gLabel = { none:'⏳未完成', done:'✅完成', good:'👍优秀A', perfect:'🏆完美A+' };
    if (!(tasks||[]).length) { els.pastTaskBody.innerHTML = '<p class="text-muted">近7天没有往日任务。</p>'; return; }
    const now = new Date(); now.setHours(0,0,0,0);
    // 截止日期按本地时区解析（'YYYY-MM-DD' 字符串若用 new Date 会被当 UTC，导致当天任务上午就"已截止"）
    const parseLocalDate = dStr => {
      const m = String(dStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dStr);
    };
    const fmtLocal = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    els.pastTaskBody.innerHTML = (tasks||[]).map(t => {
      const cur = gradeMap[t.id];
      // 截止判断：有 due_time 用它；没有则默认任务发布后一周
      let dueDate = t.due_time ? parseLocalDate(t.due_time) : null;
      if (!dueDate && t.task_date) { dueDate = parseLocalDate(t.task_date); dueDate.setDate(dueDate.getDate() + 7); }
      const active = dueDate ? dueDate >= now : false;
      const dueStr = t.due_time ? ` 截止${String(t.due_time).slice(0,10)}`
                  : (t.task_date ? ` 截止${(()=>{const d=parseLocalDate(t.task_date);d.setDate(d.getDate()+7);return fmtLocal(d);})()}` : '');
      const head = `<div class="past-line1">${t.task_type==='homework'?'🏠':'🏫'} ${(t.task_date||'').slice(5)} ${esc(t.title)}${dueStr}</div>`;
      if (!active) {
        return `<div class="past-row">${head}<div class="past-grade">${gLabel[cur] || '已截止'}</div></div>`;
      }
      const btns = TASK_GRADES.map(g =>
        `<button type="button" class="stu-task-grade sm ${g.key === cur ? 'on' : ''}" data-grade="${g.key}" data-task="${t.id}">${g.icon} ${g.label}</button>`
      ).join('');
      return `<div class="past-row active stack">${head}<div class="past-grade">${btns}</div><div class="stu-task-result" data-result="past-${t.id}"></div></div>`;
    }).join('');
    els.pastTaskBody.querySelectorAll('.stu-task-grade').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (state.readonly) { sfx.oops(); toast('预览模式不能提交哦～'); return; }
        const grade = btn.dataset.grade, taskId = btn.dataset.task;
        const wr = await runWrite({ name: 'submit_task', params: { p_class: cls, p_student: name, p_task_id: taskId, p_grade: grade } });
        if (!wr.ok) { sfx.oops(); toast('保存失败，请重试'); return; }
        const d = wr.res || {};
        sfx.pick();
        const xpGain = (d.xp_delta || 0) > 0 ? ` 经验+${d.xp_delta}` : '';
        toast(wr.queued ? '已离线保存，联网后自动同步 ✅' : (grade === 'perfect' ? `太棒啦！${xpGain}` : grade === 'good' ? `真不错！${xpGain}` : '已保存'));
        const pastResult = document.querySelector(`[data-result="past-${taskId}"]`);
        if (pastResult) pastResult.textContent = wr.queued ? '已离线保存，联网后自动同步 ✅' : '';
        // 离线：同步更新本地往日任务缓存，重渲染时按钮/状态即时反映
        if (wr.queued) {
          try {
            const key = 'sp_past_subs_' + cls + '_' + name;
            const subs = JSON.parse(localStorage.getItem(key) || '[]');
            const i = subs.findIndex(x => x.task_id === taskId);
            if (i >= 0) subs[i].grade = grade; else subs.push({ task_id: taskId, grade });
            localStorage.setItem(key, JSON.stringify(subs));
          } catch (e) {}
        }
        const row = state.roster.find(s => s.class === cls && s.student_name === name);
        if (!wr.queued && row && typeof d.xp === 'number') { row.xp = d.xp; row.level = d.level; }
        renderIdentityLevel();
        loadPastTasks();
        loadWall();
      });
    });
  } catch(e) { els.pastTaskBody.innerHTML = ''; }
}
function showWall() {
  els.formView.hidden = true;
  els.wallView.hidden = false;
  window.scrollTo({ top: 0 });
  loadWall();
}
function closeDetail() { els.detailModal.classList.remove('show'); }

async function onSubmit() {
  if (!ready) return toast('系统尚未配置完成，请联系老师');
  if (state.readonly) { sfx.oops(); return toast('老师预览模式下不能提交记录哦～'); }
  const norm = s => String(s || '').replace(/[\u3000\s]+/g, ' ').trim();
  const cls = norm(els.inpClass.value);
  const name = norm(els.inpName.value);
  if (!cls) { sfx.oops(); return toast('请先填写班级'); }
  if (!name) { sfx.oops(); return toast('请先填写姓名'); }
  updateMood();

  const items = [];
  const tagXpOf = t => {
    const v = Number(t.xp_value);
    if (Number.isFinite(v)) return v;
    return t.category === 'negative' ? 0 : 2;
  };
  for (const t of state.tags) {
    if (t.tag_type === 'check') {
      if (state.checkChosen[t.id]) {
        const opts = state.checkOption[t.id];
        const subArr = Array.isArray(opts) ? opts : (opts ? [opts] : []);
        if (Array.isArray(t.options) && t.options.length && !subArr.length) {
          sfx.oops();
          return toast(`请为「${t.label}」再选一个具体项目`);
        }
        const subVal = subArr.join('、');
        if (Array.isArray(t.options) && t.options.length) {
          // 有二级选项：一级标题本身不加经验，按选中的二级数量逐个加
          subArr.forEach(opt => {
            items.push({ id: t.id, label: t.label, type: 'check', value: opt, category: t.category || 'positive', xp: tagXpOf(t) });
          });
        } else {
          items.push({ id: t.id, label: t.label, type: 'check', value: subVal || null, category: t.category || 'positive', xp: tagXpOf(t) });
        }
      }
    } else {
      const v = (state.textValues[t.id] || '').trim();
      if (v) items.push({ id: t.id, label: t.label, type: 'text', value: v.slice(0, 600), category: t.category || 'positive', xp: tagXpOf(t) });
    }
  }

  // 不允许提交空白表现（星级可以不打，但至少要选一个小表现）
  if (!items.length) {
    sfx.oops();
    return toast('还没有选择任何表现哦，先选一个今天的小表现吧～');
  }

  els.btnSubmit.disabled = true;
  els.btnSubmit.textContent = '正在提交…';
  try {
    // v107：离线时直接入队，联网后自动同步（按人按天合并，不会重复加经验）
    if (!window.Offline || !window.Offline.online) {
      const q = await window.Offline.enqueue({
        name: 'submit_today',
        params: { p_class: cls, p_student: name, p_mood: MOOD_BY_LEVEL(state.moodLevel).key, p_items: items }
      });
      if (q) {
        sfx.success();
        toast('📡 没网也帮你存好了！联网后自动上传，经验不会丢');
        applyLocalSubmitFeedback(cls, name, items);   // v123：记录合并+即时置灰+缓存持久化
        resetSelections();
        renderMoodPreview();
        updateSubmitStatus();   // v114：本地立即标记"今天已提交"（合并后记录已包含本次）
        celebrate(0, false);    // v114：离线提交也显示成功浮层，学生明确知道已填报
      } else { sfx.oops(); toast('本机存储失败，请换设备试试'); }
      return;
    }
    const { data: valid, error: rpcError } = await supabase.rpc('is_valid_student', {
      p_class: cls,
      p_student: name
    });
    if (rpcError) throw rpcError;
    if (!valid) {
      sfx.oops();
      toast('没有找到你的名字哦，请检查班级和姓名，或请老师确认名单');
      return;
    }

    const { data: subRes, error: insertError } = await supabase.rpc('submit_today', {
      p_class: cls,
      p_student: name,
      p_mood: MOOD_BY_LEVEL(state.moodLevel).key,
      p_items: items
    });
    if (insertError) {
      if (isNetErr(insertError)) {
        const q = await window.Offline.enqueue({ name: 'submit_today', params: { p_class: cls, p_student: name, p_mood: MOOD_BY_LEVEL(state.moodLevel).key, p_items: items } });
        if (q) { sfx.success(); toast('📡 没网也帮你存好了！联网后自动上传，经验不会丢'); applyLocalSubmitFeedback(cls, name, items); resetSelections(); renderMoodPreview(); updateSubmitStatus(); celebrate(0, false); return; }
      }
      sfx.oops();
      if (/row-level security|policy|is_valid_student/i.test(insertError.message)) {
        toast('名单中没有找到对应班级和姓名，请请老师确认');
      } else {
        throw insertError;
      }
      return;
    }
    if (!subRes || subRes.ok === false) {
      sfx.oops();
      toast(subRes && subRes.reason === 'no_student'
        ? '没有找到你的名字，请检查班级和姓名'
        : '提交失败，请重试');
      return;
    }
    // 合并模式下提示
    if (subRes.merged) {
      // 当天已有记录，本次为补充合并
    }

    // 以服务端返回的差额经验为准（合并场景只加新增部分）
    const gainedXp = Number(subRes.xp_delta || 0);
    let leveledUp = false;
    if (gainedXp > 0) {
      const row = state.roster.find(s => s.class === cls && s.student_name === name);
      if (row) {
        const beforeLv = Number(row.level) || 1;
        row.xp = Number(subRes.xp != null ? subRes.xp : (Number(row.xp) || 0) + gainedXp);
        row.level = subRes.level || levelFromXp(row.xp);
        leveledUp = row.level > beforeLv;
      }
    }

    try { localStorage.setItem('sp_identity', JSON.stringify({ class: cls, studentName: name })); } catch (e) {}
    sfx.success();
    celebrate(gainedXp, leveledUp);
    resetSelections();
    renderMoodPreview();
    // 方案A：本地增量更新，不再全量重拉（提交秒级完成）
    // v128(RSK-08)：以服务端 record_date 为"今日"基准，墙的今日判定与服务端一致
    if (subRes.record_date) state.serverToday = String(subRes.record_date).slice(0, 10);
    mergeLocalRecord(cls, name, items, MOOD_BY_LEVEL(state.moodLevel).key, state.serverToday);
    // 置灰：本次提交的不可重复项直接加入 doneItems（本地），标签区就地重渲染
    items.forEach(it => {
      const tg = (state.tags || []).find(x => String(x.id) === String(it.id));
      if (tg && tg.history_unique !== false) {
        if (!state.doneItems[tg.id]) state.doneItems[tg.id] = new Set();
        state.doneItems[tg.id].add(it.value || null);
      }
    });
    renderTagGrid();
    renderWall();  // 本地重绘头像墙（经验/条数/评语即时更新）
    // v145(RSK-15)：提交成功即同步本地墙缓存（带 cachedAt，刷新不丢本次记录）
    try {
      const wallSnap = { roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, cachedAt: Date.now() };
      localStorage.setItem('sp_wall_cache_' + cls, JSON.stringify(wallSnap));
      window.Offline.set('wall_' + cls, Object.assign({}, wallSnap, { subs: state.todayTaskSubs }));
    } catch (eCache) {}
    loadProfile();// 成就/头像框（单请求，轻量）
    // 后台静默全量同步一次（多设备/教师评语一致性，不阻塞界面）
    if (window.Offline && window.Offline.online) {
      setTimeout(() => { try { loadWall(); } catch (e3) {} }, 2500);
    }
  } catch (e) {
    // 断网/网络错误：先入队，联网自动补传（按人按天合并，不会重复加经验）
    const offline = isNetErr(e);
    if (offline) {
      const q = await window.Offline.enqueue({ name: 'submit_today', params: { p_class: cls, p_student: name, p_mood: MOOD_BY_LEVEL(state.moodLevel).key, p_items: items } });
      if (q) { sfx.success(); toast('📡 没网也帮你存好了！联网后自动上传，经验不会丢'); applyLocalSubmitFeedback(cls, name, items); resetSelections(); renderMoodPreview(); updateSubmitStatus(); celebrate(0, false); }
      else { sfx.oops(); toast('本机存储失败，请换设备试试'); }
    } else {
      sfx.oops();
      toast('提交失败：' + ((e && e.message) || '请稍后再试'));
    }
  } finally {
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = '提交今天的表现 🎈';
  }
}

// 启动时 + 联网时，把本机待上传的操作补传（统一队列）
async function flushPending() {
  await flushOfflineQueue();
}