function init() {
  els.wallDate.textContent = todayLabel();
  els.todayLabel.textContent = todayLabel();
  renderStars();
  renderMoodPreview();
  bindEvents();
  prefillIdentity();
  updateMood();

  if (!ready) {
    els.wallConfigBanner.hidden = false;
    els.configBanner.hidden = false;
    els.btnSubmit.disabled = true;
    if(els.btnGoWrite) els.btnGoWrite.disabled = true;
    els.wallLoading.hidden = true;
    els.tagsLoading.hidden = true;
    els.tagsFailed.hidden = false;
    els.tagsFailed.textContent = '系统尚未配置完成，表现项目暂不可用，请联系老师。';
    return;
  }
  loadTags();
  loadClasses();
  Nav.enable();   // RSK-10：初始化完成，之后打开子视图才计入返回栈
}

/* =====================================================================
 * 班级头像墙
 * ===================================================================== */

async function loadClasses() {
  // v127：① 本地班级缓存秒取 → 立即进墙（网络随后静默刷新，首屏不再等网络）
  let cached = [];
  try { cached = JSON.parse(localStorage.getItem('sp_classes') || '[]'); } catch (e) {}
  if (!cached.length) { try { const v = await window.Offline.get('classes'); cached = (v && v.data) || []; } catch (e2) {} }
  if (cached.length) {
    state.classes = cached;
    enterWallFlow();
  }

  // ② 后台网络刷新班级列表（成功则更新下拉；失败且有缓存则保持缓存界面）
  let data = null, error = null;
  try {
    const res = await supabase.from('student_directory').select('class');
    data = res.data; error = res.error || null;
  } catch (e) { error = e; }
  // 视图查询失败（旧设备/权限被改动）→ 尝试直接读 student_info 兜底
  if (error || !data || !data.length) {
    try {
      const r2 = await supabase.from('student_info').select('class');
      if (!r2.error && r2.data && r2.data.length) { data = r2.data; error = null; }
      else if (!error) error = r2.error;
    } catch (e2) { if (!error) error = e2; }
  }
  if (error || !data || !data.length) {
    if (!state.classes.length) {
      try { state.classes = JSON.parse(localStorage.getItem('sp_classes') || '[]'); } catch(e) { state.classes = []; }
      if (!state.classes.length) { try { const v = await window.Offline.get('classes'); state.classes = (v && v.data) || []; } catch(e2) {} }
      if (!state.classes.length) {
        els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">班级名单加载失败：'
          + esc((error && error.message) || '网络异常')
          + '<br><button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="loadClasses()">🔄 重新加载</button></span>';
        return;
      }
      enterWallFlow();
      return;
    }
    return;   // 有缓存：保持已进入的界面
  }
  state.classes = Array.from(new Set((data || []).map(x => x.class))).sort();
  try { localStorage.setItem('sp_classes', JSON.stringify(state.classes)); } catch(e) {}
  try { await window.Offline.set('classes', { data: state.classes }); } catch(e) {}
  if (!state.classes.length) {
    els.wallLoading.hidden = true;
    els.wallEmpty.hidden = false;
    if(els.btnGoWrite) els.btnGoWrite.disabled = true;
    return;
  }
  // 网络成功：更新班级下拉（若缓存先行时尚未进墙，则进墙）
  els.wallClass.innerHTML = state.classes
    .map(c => `<option value="${esc(c)}"${c === state.currentClass ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');
  if (!state._wallEntered) enterWallFlow();
}

// v127：班级列表就绪后进入班级墙（缓存先行与网络成功两条路径共用）
function enterWallFlow() {
  let saved = '', savedMe = '';
  try { const o = JSON.parse(localStorage.getItem('sp_identity') || '{}'); saved = o.class || ''; savedMe = o.studentName || ''; } catch (e) {}
  const params = new URLSearchParams(location.search);
  const fromUrl = (params.get('class') || '').trim();
  state.currentClass = state.classes.includes(fromUrl) ? fromUrl
                    : state.classes.includes(saved) ? saved
                    : state.classes[0];

  // 老师预览模式：?readonly=1&student=姓名 —— 自动以该学生身份打开，禁止提交
  state.readonly = params.get('readonly') === '1';
  state.previewName = (params.get('student') || '').trim();

  els.wallClass.innerHTML = state.classes
    .map(c => `<option value="${esc(c)}"${c === state.currentClass ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');

  // 设备信任门：没记住身份且非老师预览 → 先选名字
  if (!savedMe && !state.readonly) {
    showDeviceGate();
    state._wallEntered = true;
    return;
  }

  state._wallEntered = true;
  loadWall().then(() => {
    if (state.readonly && state.previewName) {
      showForm(state.previewName);
      applyReadonlyMode();
    }
  });
  flushPending();
}

function showDeviceGate() {
  const gate = document.getElementById('deviceGate');
  const clsSel = document.getElementById('gateClass');
  const nameInput = document.getElementById('gateName');
  const err = document.getElementById('gateError');
  wallView.hidden = true;
  gate.hidden = false;
  clsSel.innerHTML = state.classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  let roster = [];
  const loadRoster = async () => {
    const cls = clsSel.value;
    let data = null;
    try {
      const res = await supabase.rpc('get_class_roster', { p_class: cls });
      data = (res && res.data) || null;
    } catch (e) { data = null; }
    if (!data) {
      // 离线：用班级墙缓存里的名单做校验
      try {
        const wall = await window.Offline.get('wall_' + cls);
        data = ((wall && wall.roster) || []).map(s => ({ student_name: s.student_name }));
      } catch (e2) { data = null; }
    }
    roster = (data||[]).map(s => (s.student_name||'').trim());
  };
  clsSel.addEventListener('change', loadRoster);
  loadRoster();
  const go = async () => {
    const cls = clsSel.value;
    const name = (nameInput.value || '').trim();
    if (!name) { err.textContent = '请输入姓名'; return; }
    if (!roster.length) {
      err.textContent = '离线且暂无名单缓存：暂时无法校验姓名，请确认与老师登记的完全一致。';
    } else if (!roster.includes(name)) {
      err.textContent = '名单里没有这个名字，请核对班级和姓名'; return;
    }
    localStorage.setItem('sp_identity', JSON.stringify({ class: cls, studentName: name }));
    state.currentClass = cls;
    gate.hidden = true; wallView.hidden = false;
    Nav.push('wall');   // RSK-10：进入班级墙 = 打开子视图
    loadWall();
    // v111：联网时后台预缓存本班全量（名单/每人任务状态/成就头像），断网体验与在线一致
    if (window.Precache && window.Offline && window.Offline.online) {
      setTimeout(() => {
        window.Precache.runStudent(cls, p => {
          if (p && p.done === p.total) toast('📥 本班数据已缓存到本机，断网也能完整使用 ✅');
        });
      }, 600);
    }
  };
  document.getElementById('gateGo').addEventListener('click', go);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

function applyReadonlyMode() {
  // 隐藏提交按钮，顶部加预览提示
  const banner = document.createElement('div');
  banner.className = 'preview-banner';
  banner.innerHTML = '👁 老师预览模式（只读）——你看到的就是这位学生看到的页面，不能提交记录';
  const card = document.querySelector('.identity-card') || document.querySelector('main');
  if (card && !document.querySelector('.preview-banner')) card.prepend(banner);
  if (els.btnSubmit) {
    els.btnSubmit.style.display = 'none';
    const tip = document.createElement('div');
    tip.className = 'text-muted';
    tip.style.cssText = 'margin-top:10px;text-align:center;';
    tip.textContent = '（预览模式下不能提交，仅供老师查看效果）';
    els.formView.appendChild(tip);
  }
}

async function loadWall() {
  els.wallEmpty.hidden = true;
  const cls = state.currentClass;
  if (!cls) { els.wallEmpty.hidden = false; return; }
  const sem = els.wallSemester ? els.wallSemester.value : '';

  // v127：① 先渲染本地缓存 → 首屏秒开（网络数据随后静默刷新）
  let cache = null;
  try { cache = await window.Offline.get('wall_' + cls); } catch (e) {}
  if (!cache) { try { cache = JSON.parse(localStorage.getItem('sp_wall_cache_' + cls) || 'null'); } catch (e2) { cache = null; } }
  const hasCache = !!(cache && Array.isArray(cache.roster) && cache.roster.length);
  if (hasCache) {
    state.roster = cache.roster || [];
    state.records = cache.records || [];
    state.seatMap = cache.seatMap || {};
    state.todayTaskDefs = cache.tasks || [];
    state.todayTaskSubs = cache.subs || [];
    renderWall();   // 本地数据立即渲染
  } else {
    els.matesGrid.hidden = true;
    els.wallLoading.hidden = false;
    els.wallLoading.innerHTML = '<span class="spinner"></span>正在加载同学们…';
  }

  // ② 后台静默拉取最新数据；失败则保持缓存显示
  const recQ = supabase.from('daily_record')
      .select('id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at')
      .eq('class', cls);
  if (sem && sem !== '全部') recQ.eq('semester', sem);
  let rosterRes = {}, recordRes = {}, taskDefRes = {};
  try {
    [rosterRes, recordRes, taskDefRes] = await Promise.all([
      supabase.from('student_directory')
        .select('*')
        .eq('class', cls)
        .order('student_name'),
      recQ
        .order('record_date', { ascending: false })
        .order('create_at', { ascending: false })
        .limit(1000),
      supabase.from('daily_task')
        .select('id,title,task_type')
        .eq('class', cls).eq('task_date', todayStr())
    ]);
  } catch (e) {
    // 断网/网络错误：标记失败，走缓存（已在上面渲染过缓存则不打扰）
    rosterRes.error = { message: 'offline' };
    recordRes.error = { message: 'offline' };
  }

  if (rosterRes.error || recordRes.error) {
    els.wallLoading.hidden = true;
    if (!hasCache) {
      els.wallLoading.hidden = false;
      els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">数据加载失败，请稍后刷新重试。</span>';
    }
    return;   // 有缓存：静默保持已渲染的缓存界面
  }
  state.roster = rosterRes.data || [];
  state.records = recordRes.data || [];
  // 座位表：只有在线真正拿到数据才重建；离线/失败保留缓存值（否则座位布局丢失且会被空表覆盖）
  try {
    const seatRes = await supabase.from('seat_grid').select('seat_row,seat_col,student_name').eq('class', state.currentClass);
    if (seatRes && !seatRes.error && seatRes.data && seatRes.data.length) {
      const m = {};
      seatRes.data.forEach(s => { m[s.student_name] = (s.seat_row*6 + s.seat_col); });
      state.seatMap = m;
    }
  } catch(e) {}
  // 今日任务：在线拿到数据才覆盖；离线保留缓存值（离线也显示已发布任务）
  if (taskDefRes && !taskDefRes.error && taskDefRes.data) {
    state.todayTaskDefs = taskDefRes.data || [];
  }
  // task_submission 没有 task_date/class 列，按当天任务 id 查提交
  let todayTaskSubs = [];
  if (state.todayTaskDefs.length) {
    const ids = state.todayTaskDefs.map(t => t.id);
    const subRes = await supabase.rpc('get_today_subs', { p_task_ids: ids });
    todayTaskSubs = (subRes && subRes.data) || [];
  }
  state.todayTaskSubs = todayTaskSubs;
  try { localStorage.setItem('sp_wall_cache_' + cls, JSON.stringify({ roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs })); } catch(e) {}
  await window.Offline.set('wall_' + cls, { roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, subs: todayTaskSubs });
  if (!state.roster.length) {
    els.wallEmpty.hidden = false;
    return;
  }
  els.wallLoading.hidden = true;
  renderWall();   // 静默重绘为最新数据
}

function renderWall() {
  const recs = state.records;
  // v128(RSK-08)：今日判定以服务端日期为准（提交后校正），设备日期错误不导致错日
  const today = state.serverToday || todayStr();

  // 全班汇总（未打星的记录不计入平均星级）
  const classRated = recs.filter(r => Number(r.self_evaluation) > 0);
  const classAvg = classRated.length
    ? (classRated.reduce((s, r) => s + Number(r.self_evaluation), 0) / classRated.length).toFixed(1)
    : null;
  const classToday = recs.filter(r => r.record_date === today).length;

  // 班级整体经验 = 全班学生经验总和；400/1000/2000/3000 升级
  const classXp = state.roster.reduce((s, x) => s + (Number(x.xp) || 0), 0);
  const CLASS_LEVELS = [0, 400, 1000, 2000, 3000];
  let classLv = 1;
  CLASS_LEVELS.forEach((th, i) => { if (classXp >= th) classLv = i + 1; });
  const nextNeed = CLASS_LEVELS[classLv] || null;
  const classLvText = nextNeed ? `Lv${classLv} · 再${nextNeed - classXp}升Lv${classLv+1}` : `Lv${classLv} · 满级`;

  let html = '';

  // 全班汇总卡放到标题栏左侧
  const classCard = `<button class="mate mate-class-all" data-detail="__all__" style="width:100%;margin:0;">
      <span class="mate-avatar">🌈</span>
      <span class="mate-badge xp-badge">🧡 ${classXp} 经验</span>
      <span class="mate-name">全班 ${classLvText}</span>
    </button>`;
  const slot = document.getElementById('wallClassCard');
  if (slot) slot.innerHTML = classCard;

  // 按座位编排：空位保留，按 seat_row*6+col 定位
  // v128(RSK-07)：槽位数动态计算（默认 42 格；学生/座位超 42 时按 6 列向上扩展），超员不错位
  // 注意：seatMap 为 { 学生名: 槽位索引 }，取槽位索引必须用 Object.values()（key 是姓名，Number(姓名)=NaN）
  const useSeat = state.seatMap && Object.keys(state.seatMap).length;
  const slotOf = {};
  if (useSeat) Object.entries(state.seatMap).forEach(([n,i]) => slotOf[i] = n);
  const seatSlots = useSeat ? Object.values(state.seatMap).map(Number) : [];
  const maxSeatSlot = seatSlots.length ? Math.max.apply(null, seatSlots) : -1;
  const slotCount = Math.max(42, Math.ceil(Math.max(state.roster.length, maxSeatSlot + 1) / 6) * 6);
  const ordered = [];
  if (useSeat) {
    for (let i=0;i<slotCount;i++) {
      const n = slotOf[i];
      if (n) ordered.push(state.roster.find(s=>s.student_name===n));
      else ordered.push(null); // 空位占位
    }
    state.roster.forEach(s => {
      const placed = Object.values(state.seatMap).some(v => v === state.seatMap[s.student_name]);
      if (!placed) ordered.push(s);
    });
  } else {
    state.roster.forEach(s=>ordered.push(s));
  }
  ordered.forEach((s) => {
    if (!s) { html += `<div class="mate seat-empty"></div>`; return; }
    const mine = recs.filter(r => r.student_name === s.student_name);
    const mineRated = mine.filter(r => Number(r.self_evaluation) > 0);
    const avg = mineRated.length
      ? (mineRated.reduce((sum, r) => sum + Number(r.self_evaluation), 0) / mineRated.length).toFixed(1)
      : null;
    const todayRecs = mine.filter(r => r.record_date === today);
    const todayRec = todayRecs.length ? todayRecs[todayRecs.length - 1] : null;
    const todayMood = todayRec && todayRec.behavior ? MOOD_MAP[todayRec.behavior.mood] : null;
    // 今日任务完成情况
    const totalTasks = (state.todayTaskDefs || []).length;
    const subMap = {};
    (state.todayTaskSubs || []).forEach(x => { if (x.student_name === s.student_name && x.grade && x.grade !== 'none') subMap[x.task_id] = x.grade; });
    const doneTasks = Object.keys(subMap).length;
    const taskBadge = totalTasks ? `<span class="mate-badge task-badge" title="今日任务完成 ${doneTasks}/${totalTasks}">📋 ${doneTasks}/${totalTasks}</span>` : '';
    const todayLevel = todayMood
      ? Number(Object.keys(MOOD_LEVELS).find(l => MOOD_LEVELS[l].key === todayMood.key)) || 3
      : 0;

    const av = avatarForName(s.student_name, s.avatar);
    const ringCls = todayLevel ? ` mood-l${todayLevel}` : '';
    const frameCls = s.frame ? ` framed frame-${s.frame}` : '';
    const lvBadge = (Number(s.level) || 1) > 1
      ? `<span class="mate-lv">Lv${Number(s.level)}</span>` : '';
    // v134(RSK-11)：表情移到姓名前、等级移到姓名后，头像框不再被遮挡
    const moodInline = todayMood
      ? `<span class="mate-today" title="今日心情：${todayMood.label}">${todayMood.emoji}</span>` : '';

    html += `<button class="mate" data-detail="${esc(s.student_name)}">
        <span class="mate-avatar${ringCls}${frameCls}${AVATAR_PARTICLES[av.key] ? ' ap-breathe' : ''} ${av.kind === 'img' ? 'is-img' : ''}" style="background:${av.bg};${AVATAR_PARTICLES[av.key] ? `--glow:${AVATAR_PARTICLES[av.key].glow};` : ''}">${avatarInner(av)}${avatarParticlesHTML(s.avatar)}${frameParticlesHTML(s.frame)}</span>
        <span class="mate-badge ${todayRecs.length ? 'done-badge' : 'count-badge'}">今日${todayRecs.length}条</span>
        ${taskBadge}
        <span class="mate-name">${moodInline}${esc(s.student_name)}${lvBadge}</span>
      </button>`;
  });

  els.matesGrid.classList.toggle('seat-mode', !!useSeat);
  els.matesGrid.innerHTML = html;
  els.matesGrid.hidden = false;

  // 班级经验进度 + 今日完成进度
  const doneToday = state.roster.filter(s => recs.some(r => r.student_name === s.student_name && r.record_date === today)).length;
  const total = state.roster.length || 1;
  const cp = id => document.getElementById(id);
  if (cp('cpXp')) {
    cp('cpXp').textContent = classXp;
    const prevXp = CLASS_LEVELS[classLv - 1] || 0;
    const nextXp = CLASS_LEVELS[classLv] || null;
    cp('cpNext').textContent = nextXp ? `Lv${classLv} → 再${nextXp - classXp} 升 Lv${classLv+1}` : `Lv${classLv} 满级`;
    const pct = nextXp ? Math.min(100, (classXp - prevXp) / (nextXp - prevXp) * 100) : 100;
    cp('cpFill').style.width = pct + '%';
    cp('cpDone').textContent = doneToday;
    cp('cpTotal').textContent = state.roster.length;
    const p2 = Math.round(doneToday / total * 100);
    cp('cpPct').textContent = p2 + '%';
    cp('cpFillGreen').style.width = p2 + '%';
  }

  $$('.mate', els.matesGrid).forEach(btn => {
    btn.addEventListener('click', () => {
      sfx.tap();
      const key = btn.dataset.detail;
      if (key === '__all__') openClassDetail(classAvg, classToday);
      else openStudentDetail(key);
    });
  });
}

function openStudentDetail(name) {
  const rows = state.records
    .filter(r => r.student_name === name)
    .sort((a, b) => (a.record_date < b.record_date ? 1 : a.record_date > b.record_date ? -1 :
                      (a.create_at < b.create_at ? 1 : -1)));
  const rosterRow = state.roster.find(s => s.student_name === name);
  const av = avatarForName(name, rosterRow && rosterRow.avatar);
  paintAvatar(els.detailAvatar, av);
  applyFrameTo(els.detailAvatar, rosterRow && rosterRow.frame);
  els.detailName.textContent = name;
  const rated = rows.filter(r => Number(r.self_evaluation) > 0);
  const avg = rated.length
    ? (rated.reduce((s, r) => s + Number(r.self_evaluation), 0) / rated.length).toFixed(1)
    : null;
  els.detailSub.textContent = rows.length
    ? `共 ${rows.length} 条记录${avg ? ' · 平均 ⭐' + avg : ''}`
    : '还没有提交过表现记录';
  els.detailBody.innerHTML = renderRecordTimeline(rows);
  state.detailName = name;
  els.detailFoot.hidden = false;
  els.detailModal.classList.add('show');
  Nav.push('detail');   // RSK-10：打开详情弹窗
}

function openClassDetail(avg, todayCount) {
  els.detailAvatar.textContent = '🌈';
  els.detailAvatar.style.background = 'linear-gradient(135deg,#ffe6c9,#d8f0e2)';
  els.detailName.textContent = state.currentClass + ' · 全班';
  els.detailSub.textContent = `共 ${state.records.length} 条记录 · 今日 ${todayCount} 条`;
  els.detailBody.innerHTML = renderRecordTimeline(state.records);
  state.detailName = '';
  els.detailFoot.hidden = true;
  els.detailModal.classList.add('show');
  Nav.push('detail');   // RSK-10：打开班级详情弹窗
}

function renderClassRanking() {
  const byName = new Map();
  state.records.forEach(r => {
    if (!(Number(r.self_evaluation) > 0)) return;
    if (!byName.has(r.student_name)) byName.set(r.student_name, { name: r.student_name, sum: 0, n: 0 });
    const x = byName.get(r.student_name);
    x.sum += Number(r.self_evaluation);
    x.n += 1;
  });
  const list = Array.from(byName.values())
    .map(x => ({ name: x.name, avg: x.sum / x.n, n: x.n }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n)
    .slice(0, 10);
  if (!list.length) return '';
  const medals = ['🥇', '🥈', '🥉'];
  return `<div class="detail-day-head"><span>⭐ 平均星级榜（前10名）</span></div>
    <div class="detail-rec">${list.map((x, i) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13.5px;">
        <span style="width:26px;text-align:center;">${medals[i] || (i + 1)}</span>
        <b style="flex:1;">${esc(x.name)}</b>
        <span style="color:#b5791b;font-weight:700;">⭐${x.avg.toFixed(1)}</span>
        <span class="text-muted" style="font-size:12px;">${x.n}条</span>
      </div>`).join('')}</div>`;
}

function renderRecordTimeline(rows) {
  if (!rows.length) {
    return '<div class="empty" style="padding:24px 10px;">还没有表现记录，快去提交今天的第一条吧！</div>';
  }
  // 按日期分组（入参已按日期、时间倒序）
  const groups = [];
  const map = new Map();
  rows.forEach(r => {
    if (!map.has(r.record_date)) {
      const g = { date: r.record_date, rows: [] };
      map.set(r.record_date, g);
      groups.push(g);
    }
    map.get(r.record_date).rows.push(r);
  });

  let html = '';
  groups.forEach(g => {
    html += `<div class="detail-day-head"><span>${formatDate(g.date)}</span><span>${g.rows.length} 条</span></div>`;
    g.rows.forEach(r => {
      const starCount = Number(r.self_evaluation) || 0;
      const stars = starCount
        ? '★'.repeat(starCount) + '☆'.repeat(5 - starCount)
        : '<span class="text-muted" style="letter-spacing:0;">本次未打星</span>';
      const mood = MOOD_MAP[r.behavior && r.behavior.mood];

      let itemsHtml = '';
      const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items : [];
      if (items.length) {
        itemsHtml = '<ul class="detail-items">';
        items.forEach(it => {
          const neg = it.category === 'negative';
          const liCls = neg ? ' class="is-neg"' : '';
          const tick = neg
            ? '<span class="neg-tick">!</span>'
            : '<span class="tick">✓</span>';
          if (it.type === 'text') {
            itemsHtml += `<li${liCls}><b>${esc(it.label || '')}：</b>${esc(it.value || '')}</li>`;
          } else if (it.value) {
            itemsHtml += `<li${liCls}>${tick}${esc(it.label || '')} <span class="sub-val">· ${esc(it.value)}</span></li>`;
          } else {
            itemsHtml += `<li${liCls}>${tick}${esc(it.label || '')}</li>`;
          }
        });
        itemsHtml += '</ul>';
      }

      const comment = (r.teacher_comment || '').trim();
      const commentHtml = comment
        ? `<div class="detail-comment"><b>老师评语：</b>${esc(comment)}</div>`
        : '';

      html += `<div class="detail-rec">
          <div class="detail-rec-line">
            <span>${mood ? mood.emoji + ' ' + mood.label : ''}</span>
            <span class="rec-time">${formatTime(r.create_at)}</span>
          </div>
          <div class="detail-stars">${stars}</div>
          ${itemsHtml}
          ${commentHtml}
        </div>`;
    });
  });
  return html;
}

/* =====================================================================
 * 自评表单（原有逻辑）
 * ===================================================================== */

function renderStars() {
  if (!els.starsRow) return; // 打星模块已移除
  els.starsRow.innerHTML = '';
}

/* ---------- 头像（emoji 或校园图片；按姓名稳定取卡通动物 + 底色兜底） ---------- */
function avatarForName(name, saved) {
  const h = hashCode(String(name || ''));
  const mod = n => ((h % n) + n) % n;
  let key = saved && String(saved).trim() ? String(saved).trim() : '';
  key = migrateLegacyAvatar(key);   // v140：旧 Q 版头像 key 自动迁移到新写实款
  if (isImgKey(key)) {
    return { kind: 'img', key, src: AVATAR_BASE + avatarFile(key), bg: '#ffffff' };
  }
  // 未保存过头像：按姓名稳定分配一个小动物
  const animal = AVATARS[mod(AVATARS.length)];
  return { kind: 'img', key: animal, src: AVATAR_BASE + animal + '.webp', bg: '#ffffff' };
}
function avatarInner(av) {
  return av.kind === 'img'
    ? `<img class="avatar-img" src="${av.src}" alt="" loading="lazy">`
    : av.emoji;
}
function paintAvatar(el, av) {
  if (!el) return;
  el.innerHTML = avatarInner(av);
  el.style.background = av.bg;
  attachAvatarFx(el, av.key);
}

// 当前表单里"这个学生"的头像：优先本次选择，其次名单里已保存的，最后按姓名分配
function currentAvatar() {
  const name = (els.inpName && els.inpName.value || '').trim();
  if (state.myAvatar) return avatarForName(name || '我', state.myAvatar);
  const row = state.roster.find(s =>
    s.student_name === name && (!state.currentClass || s.class === state.currentClass));
  return avatarForName(name || '我', row && row.avatar);
}

// 当前学生的等级/经验（名单行）
function currentRosterRow() {
  const name = (els.inpName && els.inpName.value || '').trim();
  return state.roster.find(s =>
    s.student_name === name && (!state.currentClass || s.class === state.currentClass)) || null;
}

/* ---------- 今日心情：由勾选的积极/消极表现自动计算（5 档） ---------- */
function calcMoodLevel() {
  let delta = 0;
  for (const t of state.tags) {
    const score = Number(t.score) || (t.category === 'negative' ? -1 : 1);
    if (t.tag_type === 'check') {
      if (state.checkChosen[t.id]) delta += score;
    } else if ((state.textValues[t.id] || '').trim()) {
      delta += score;
    }
  }
  return Math.min(5, Math.max(1, 3 + delta));
}

function updateMood() {
  state.moodLevel = calcMoodLevel();
  renderStars();
  renderMoodPreview();
}

function renderMoodPreview() {
  const level = state.moodLevel || 3;
  const m = MOOD_BY_LEVEL(level);
  const av = currentAvatar();
  els.mpAvatar.innerHTML = `${avatarInner(av)}<span class="mp-badge">${m.emoji}</span>`;
  els.mpAvatar.style.background = av.bg;
  attachAvatarFx(els.mpAvatar, av.key);
  paintAvatar(els.identityAvatarEmoji, av);
  paintAvatar(els.avatarModalEmoji, av);
  els.mpLevel.textContent = `${m.emoji} ${m.label}`;
  renderIdentityLevel();
  const card = document.getElementById('moodPreviewCard');
  if (card) {
    card.classList.remove('lvl1', 'lvl2', 'lvl3', 'lvl4', 'lvl5');
    card.classList.add('lvl' + level);
  }
  if (els.moodMeter) {
    els.moodMeter.querySelectorAll('span').forEach(s =>
      s.classList.toggle('on', Number(s.dataset.l) <= level));
  }
}

// 身份卡上的等级徽章 + 经验进度条（外层 frame 槽位为后续头像框预留）
function renderIdentityLevel() {
  const row = currentRosterRow();
  const lv = row ? (Number(row.level) || 1) : 1;
  const xp = row ? (Number(row.xp) || 0) : 0;
  const p = xpProgress(xp, lv);
  if (els.identityLevel) els.identityLevel.textContent = 'Lv.' + lv;
  if (els.identityXpFill) els.identityXpFill.style.width = p.pct + '%';
  if (els.identityXpText) {
    els.identityXpText.textContent = p.maxed
      ? `经验 ${xp} · 已满级 🏆`
      : `经验 ${xp} · 再得 ${p.left} 点升到 Lv.${lv + 1}`;
  }
  const wrap = document.querySelector('.identity-avatar');
  if (wrap) {
    wrap.classList.remove('frame-l3', 'frame-l4', 'frame-l5');
    if (!row || !row.frame) {
      if (lv >= 3) wrap.classList.add('frame-l' + Math.min(5, lv));
    }
  }
  applyFrameTo(els.identityAvatarEmoji, row && row.frame);
}