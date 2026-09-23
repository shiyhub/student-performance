/**
 * 学生端逻辑：班级头像墙（浏览全班/自己的表现）+ 自评提交
 * 数据权限（anon）：
 *   - student_directory 视图：只读，仅班级+学生姓名（不含家长姓名）
 *   - daily_record：可 SELECT 全班记录（头像墙）、仅可 INSERT 自己的新记录
 *   - behavior_tags：只读启用标签
 * Supabase SDK 通过 js/vendor/supabase.js 本地引入（全局 window.supabase）
 */
const supabase = window.supabase
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
  : null;
const ready = !!supabase &&
  !String((window.SUPABASE_CONFIG || {}).url || '').includes('YOUR_PROJECT_REF');

const $ = (sel, root) => (root || document).querySelector(sel);

// 心情 5 档（索引即等级 1~5），由勾选项自动计算：3 起步，积极 +1，消极 -1
const MOOD_LEVELS = {
  1: { key: 'sad',    emoji: '😢', label: '需要加油' },
  2: { key: 'down',   emoji: '😟', label: '有点低落' },
  3: { key: 'normal', emoji: '😐', label: '一般' },
  4: { key: 'good',   emoji: '🙂', label: '不错' },
  5: { key: 'happy',  emoji: '😄', label: '很棒' }
};
const MOOD_MAP = Object.fromEntries(Object.values(MOOD_LEVELS).map(m => [m.key, m]));
const MOOD_BY_LEVEL = l => MOOD_LEVELS[Math.min(5, Math.max(1, l))];
const STAR_TEXT = ['', '还需加油', '继续努力', '还不错', '很棒', '超级棒'];
const PRAISE = {
  happy:  ['太棒啦！明天也要保持好心情！', '你今天闪闪发光，继续加油！'],
  good:   ['做得不错，为你点赞！', '稳稳进步中，明天会更好！'],
  normal: ['记录下来就是进步，明天加油！', '没关系，每天进步一点点！'],
  down:   ['明天试着多做一个积极的小表现吧！', '有一点小低落很正常，老师陪着你！'],
  sad:    ['愿意说出来就很勇敢，老师和家长都爱你！', '明天会是新的一天，陪你一起加油！']
};
const AVATARS = Array.from({ length: 24 }, (_, i) => 'animal' + (i + 1));

/* ---------- 校园头像（24 款，3 级解锁）与经验等级 ---------- */
const AVATAR_BASE = 'assets/avatars/';
const CAMPUS_GROUPS = [
  { name: '女生款', prefix: 'girl',    count: 8 },
  { name: '男生款', prefix: 'boy',     count: 8 },
  { name: '中性款', prefix: 'neutral', count: 8 }
];
const CAMPUS_KEYS = CAMPUS_GROUPS.reduce((arr, g) => {
  for (let i = 1; i <= g.count; i++) arr.push(g.prefix + i);
  return arr;
}, []);
const CAMPUS_UNLOCK_LEVEL = 3;
const LEGEND_UNLOCK_LEVEL = 6;
const LEGEND_GROUPS = [
  { name: '赛博少年',   prefix: 'cyber',  count: 8 },
  { name: '机甲少年',   prefix: 'mecha',  count: 8 },
  { name: '假面骑士',   prefix: 'rider',  count: 8 },
  { name: '光之英雄',   prefix: 'ultra',  count: 8 },
  { name: '魔法少女',   prefix: 'magic',  count: 8 },
  { name: '科幻角色',   prefix: 'star',   count: 8 }
];
// 7 级典藏头像
const MASTER_UNLOCK_LEVEL = 7;
const MASTER_GROUPS = [
  { name: '国风少年',   prefix: 'guofeng', count: 9 },
  { name: '多巴胺甜妹', prefix: 'dou',     count: 9 },
  { name: '猫系少女',   prefix: 'cat',     count: 9 }
];
const LEGEND_KEYS = LEGEND_GROUPS.reduce((arr, g) => {
  for (let i = 1; i <= g.count; i++) arr.push(g.prefix + i);
  return arr;
}, []);
const MASTER_KEYS = MASTER_GROUPS.reduce((arr, g) => {
  for (let i = 1; i <= g.count; i++) arr.push(g.prefix + i);
  return arr;
}, []);
const EMOJI_CHANGE_LIMIT = 2;
// 各级所需经验下限：L1=0 / L2=20 / L3=60 / L4=120 / L5=200 / L6=400（与数据库 level_from_xp 同口径）
const XP_LEVELS = [0, 20, 60, 120, 200, 400, 600];
const XP_PER_POSITIVE = 2;
const IMG_KEY_RE = /^(girl[1-8]|boy[1-8]|neutral[1-8]|cyber[1-8]|mecha[1-8]|rider[1-8]|ultra[1-8]|magic[1-8]|star[1-8]|animal([1-9]|1[0-9]|2[0-4]))$/;
function isImgKey(k) { return IMG_KEY_RE.test(String(k || '')); }
function isAnimalKey(k) { return /^animal([1-9]|1[0-9]|2[0-4])$/.test(String(k || '')); }
function isLegendKey(k) { return /^(cyber|mecha|rider|ultra|magic|star)[1-8]$/.test(String(k || '')); }
function levelFromXp(xp) {
  let lv = 1;
  for (let i = 0; i < XP_LEVELS.length; i++) if ((xp || 0) >= XP_LEVELS[i]) lv = i + 1;
  return lv;
}
function xpProgress(xp, level) {
  if (level >= XP_LEVELS.length) return { pct: 100, left: 0, maxed: true };
  const lo = XP_LEVELS[level - 1], hi = XP_LEVELS[level];
  return { pct: Math.min(100, Math.max(0, ((xp - lo) / (hi - lo)) * 100)), left: hi - (xp || 0), maxed: false };
}
const sfx = window.SFX || {
  tap(){}, back(){}, star(){}, tagOn(){}, tagOff(){}, sub(){}, moodUp(){}, moodDown(){}, pick(){}, success(){}, oops(){}
};

/* ---------- 页面元素 ---------- */
const els = {
  // 墙
  wallView: $('#wallView'),
  formView: $('#formView'),
  wallDate: $('#wallDate'),
  wallConfigBanner: $('#wallConfigBanner'),
  wallClass: $('#wallClass'),
  wallSemester: $('#wallSemester'),
  wallLoading: $('#wallLoading'),
  matesGrid: $('#matesGrid'),
  wallEmpty: $('#wallEmpty'),
  btnGoWrite: $('#btnGoWrite'),
  btnBackWall: $('#btnBackWall'),
  // 详情弹窗
  detailModal: $('#detailModal'),
  detailAvatar: $('#detailAvatar'),
  detailName: $('#detailName'),
  detailSub: $('#detailSub'),
  detailBody: $('#detailBody'),
  detailFoot: $('#detailFoot'),
  btnDetailWrite: $('#btnDetailWrite'),
  btnDetailClose: $('#btnDetailClose'),
  // 头像选择
  btnPickAvatar: $('#btnPickAvatar'),
  identityAvatarEmoji: $('#identityAvatarEmoji'),
  identityLevel: $('#identityLevel'),
  identityXpFill: $('#identityXpFill'),
  identityXpText: $('#identityXpText'),
  avatarModal: $('#avatarModal'),
  avatarModalEmoji: $('#avatarModalEmoji'),
  avatarPicker: $('#avatarPicker'),
  avatarHint: $('#avatarHint'),
  btnAvatarClose: $('#btnAvatarClose'),
  btnSound: $('#btnSound'),
  // 表单
  todayLabel: $('#todayLabel'),
  configBanner: $('#configBanner'),
  inpClass: $('#inpClass'),
  inpName: $('#inpName'),
  starsRow: $('#starsRow'),
  starCaption: $('#starCaption'),
  mpAvatar: $('#mpAvatar'),
  mpBadge: $('#mpBadge'),
  mpLevel: $('#mpLevel'),
  moodMeter: $('#moodMeter'),
  tagsLoading: $('#tagsLoading'),
  tagsBox: $('#tagsBox'),
  tagsFailed: $('#tagsFailed'),
  posGrid: $('#posGrid'),
  negGrid: $('#negGrid'),
  negGroup: $('#negGroup'),
  textTagsBox: $('#textTagsBox'),
  btnSubmit: $('#btnSubmit'),
  successOverlay: $('#successOverlay'),
  successMsg: $('#successMsg'),
  btnAgain: $('#btnAgain'),
  btnWallFromSuccess: $('#btnWallFromSuccess'),
  confettiBox: $('#confettiBox'),
  taskCard: $('#taskCard'),
  taskBody: $('#taskBody'),
  reciteTaskCard: $('#reciteTaskCard'), reciteTaskBody: $('#reciteTaskBody'),
  dictationTaskCard: $('#dictationTaskCard'), dictationTaskBody: $('#dictationTaskBody'),
  pastTaskCard: $('#pastTaskCard'),
  pastTaskBody: $('#pastTaskBody')
};

const state = {
  // 墙
  classes: [],
  currentClass: '',
  roster: [],
  records: [],
  detailName: '',
  // 表单
  stars: 0,
  moodLevel: 3,
  myAvatar: null,    // 学生本次选择/已保存的头像 emoji（null 时按姓名自动分配）
  tags: [],
  checkChosen: {},   // 勾选型标签：{ [tagId]: true }
  checkOption: {},   // 勾选型标签选中的二级选项：{ [tagId]: '数学课堂作业' }
  textValues: {},
  doneItems: {}   // 当天已提交过的二级项：{ [tagId]: Set(已选value) }
};

init();

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
}

/* =====================================================================
 * 班级头像墙
 * ===================================================================== */

async function loadClasses() {
  const { data, error } = await supabase
    .from('student_directory')
    .select('class');
  if (error) {
    try { state.classes = JSON.parse(localStorage.getItem('sp_classes') || '[]'); } catch(e) { state.classes = []; }
    if (!state.classes.length) {
      els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">班级名单加载失败，请稍后刷新重试。</span>';
      return;
    }
  } else {
    state.classes = Array.from(new Set((data || []).map(x => x.class))).sort();
    try { localStorage.setItem('sp_classes', JSON.stringify(state.classes)); } catch(e) {}
  }
  if (!state.classes.length) {
    els.wallLoading.hidden = true;
    els.wallEmpty.hidden = false;
    if(els.btnGoWrite) els.btnGoWrite.disabled = true;
    return;
  }

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
    return;
  }

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
    const { data } = await supabase.from('student_info').select('student_name').eq('class', cls).order('student_name');
    roster = (data||[]).map(s => (s.student_name||'').trim());
  };
  clsSel.addEventListener('change', loadRoster);
  loadRoster();
  const go = async () => {
    const cls = clsSel.value;
    const name = (nameInput.value || '').trim();
    if (!name) { err.textContent = '请输入姓名'; return; }
    if (!roster.includes(name)) { err.textContent = '名单里没有这个名字，请核对班级和姓名'; return; }
    localStorage.setItem('sp_identity', JSON.stringify({ class: cls, studentName: name }));
    state.currentClass = cls;
    gate.hidden = true; wallView.hidden = false;
    loadWall();
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
  els.matesGrid.hidden = true;
  els.wallLoading.hidden = false;
  els.wallLoading.innerHTML = '<span class="spinner"></span>正在加载同学们…';

  const cls = state.currentClass;
  const sem = els.wallSemester ? els.wallSemester.value : '';
  const recQ = supabase.from('daily_record')
      .select('id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at')
      .eq('class', cls);
  if (sem && sem !== '全部') recQ.eq('semester', sem);
  const [rosterRes, recordRes, taskDefRes] = await Promise.all([
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

  els.wallLoading.hidden = true;
  if (rosterRes.error || recordRes.error) {
    // 离线：用上次缓存的名单继续渲染
    const cache = JSON.parse(localStorage.getItem('sp_wall_cache_' + cls) || 'null');
    if (cache) {
      state.roster = cache.roster || [];
      state.records = cache.records || [];
      state.seatMap = cache.seatMap || {};
      state.todayTaskDefs = cache.tasks || [];
      state.todayTaskSubs = [];
      els.wallLoading.innerHTML = '<div class="banner banner-info" style="margin:0;">当前离线，显示上次缓存数据，提交会自动保存。</div>';
    } else {
      els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">数据加载失败，请稍后刷新重试。</span>';
      return;
    }
  } else {
    state.roster = rosterRes.data || [];
    state.records = recordRes.data || [];
  }
  state.seatMap = {};
  try {
    const seatRes = await supabase.from('seat_grid').select('seat_row,seat_col,student_name').eq('class', state.currentClass);
    (seatRes.data||[]).forEach(s => { state.seatMap[s.student_name] = (s.seat_row*6 + s.seat_col); });
  } catch(e) {}
  state.todayTaskDefs = taskDefRes.data || [];
  // task_submission 没有 task_date/class 列，按当天任务 id 查提交
  let todayTaskSubs = [];
  if (state.todayTaskDefs.length) {
    const ids = state.todayTaskDefs.map(t => t.id);
    const subRes = await supabase.from('task_submission')
      .select('student_name,grade,task_id')
      .in('task_id', ids);
    todayTaskSubs = subRes.data || [];
  }
  state.todayTaskSubs = todayTaskSubs;
  try { localStorage.setItem('sp_wall_cache_' + cls, JSON.stringify({ roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs })); } catch(e) {}
  if (!state.roster.length) {
    els.wallEmpty.hidden = false;
    return;
  }
  renderWall();
}

function renderWall() {
  const recs = state.records;
  const today = todayStr();

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
  const useSeat = state.seatMap && Object.keys(state.seatMap).length;
  const slotOf = {};
  if (useSeat) Object.entries(state.seatMap).forEach(([n,i]) => slotOf[i] = n);
  const ordered = [];
  if (useSeat) {
    for (let i=0;i<42;i++) {
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
    const lvBadge = (Number(s.level) || 1) > 1
      ? `<span class="mate-lv">Lv${Number(s.level)}</span>` : '';

    html += `<button class="mate" data-detail="${esc(s.student_name)}">
        <span class="mate-avatar${ringCls} ${av.kind === 'img' ? 'is-img' : ''}" style="background:${av.bg}">${avatarInner(av)}</span>
        ${lvBadge}
        ${todayMood ? `<span class="mate-today lvl-${todayLevel}" title="今日心情：${todayMood.label}">${todayMood.emoji}</span>` : ''}
        <span class="mate-badge ${todayRecs.length ? 'done-badge' : 'count-badge'}">今日${todayRecs.length}条</span>
        ${taskBadge}
        <span class="mate-name">${esc(s.student_name)}</span>
      </button>`;
  });

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
  const key = saved && String(saved).trim() ? String(saved).trim() : '';
  if (isImgKey(key)) {
    return { kind: 'img', key, src: AVATAR_BASE + key + '.webp', bg: '#ffffff' };
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
    if (lv >= 3) wrap.classList.add('frame-l' + lv);
  }
}

async function loadTags() {
  const { data, error } = await supabase
    .from('behavior_tags')
    .select('id, label, tag_type, options, category, score, sort_order, history_unique')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  els.tagsLoading.hidden = true;
  if (error || !data) {
    els.tagsFailed.hidden = false;
    return;
  }
  // 兼容旧数据
  data.forEach(t => {
    if (!Array.isArray(t.options)) t.options = [];
    if (t.category !== 'negative') t.category = 'positive';
    if (typeof t.score !== 'number') t.score = t.category === 'negative' ? -1 : 1;
  });
  state.tags = data;
  await loadDoneItems();
  els.posGrid.innerHTML = '';
  els.negGrid.innerHTML = '';
  els.textTagsBox.innerHTML = '';

  let hasNeg = false;
  data.forEach(t => {
    if (t.tag_type === 'check') {
      const node = buildCheckTag(t);
      if (t.category === 'negative') { els.negGrid.appendChild(node); hasNeg = true; }
      else els.posGrid.appendChild(node);
    } else {
      els.textTagsBox.appendChild(buildTextTag(t));
    }
  });
  els.negGroup.hidden = !hasNeg;

  if (!data.length) {
    els.posGrid.innerHTML = '<span class="text-muted">老师还没有设置表现标签。</span>';
  }
  els.tagsBox.hidden = false;
  updateMood();
}

// 加载已提交过的二级项，历史唯一的标签置灰不可重复得分
async function loadDoneItems() {
  state.doneItems = {};
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return;
  try {
    const { data } = await supabase.from('daily_record')
      .select('behavior')
      .eq('class', cls).eq('student_name', name)
      .order('create_at', { ascending: false })
      .limit(500);
    (data || []).forEach(r => {
      const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items : [];
      items.forEach(it => {
        const tid = it.id;
        if (it.value) {
          if (!state.doneItems[tid]) state.doneItems[tid] = new Set();
          state.doneItems[tid].add(it.value);
        }
      });
    });
  } catch (e) { /* 忽略 */ }
}

function buildCheckTag(t) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-tag' + (t.category === 'negative' ? ' is-neg' : '');

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip' + (t.category === 'negative' ? ' chip-neg' : '');
  chip.textContent = t.label;
  chip.addEventListener('click', () => toggleCheckTag(t, chip, wrap));
  wrap.appendChild(chip);

  if (t.options.length) {
    const sub = document.createElement('div');
    sub.className = 'sub-options';
    sub.hidden = true;
    const hint = document.createElement('div');
    hint.className = 'sub-hint';
    hint.textContent = '再选一个具体的 👇';
    sub.appendChild(hint);
    t.options.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sub-chip';
      b.textContent = opt;
      // 历史唯一标签：打过的具体二级项永久置灰
      const doneSet = state.doneItems[t.id];
      if (t.history_unique !== false && doneSet && doneSet.has(opt)) {
        b.classList.add('done');
        b.disabled = true;
        b.textContent = opt + ' ✓';
      }
      b.addEventListener('click', () => {
        sfx.sub();
        if (!Array.isArray(state.checkOption[t.id])) state.checkOption[t.id] = [];
        const arr = state.checkOption[t.id];
        const ix = arr.indexOf(opt);
        if (ix >= 0) { arr.splice(ix, 1); b.classList.remove('active'); }
        else { arr.push(opt); b.classList.add('active'); }
        // 一级标签显示已选数量
        chip.textContent = arr.length ? `${t.label}（已选${arr.length}）` : t.label;
      });
      sub.appendChild(b);
    });
    wrap.appendChild(sub);
  }
  return wrap;
}

function buildTextTag(t) {
  const wrap = document.createElement('div');
  wrap.className = 'text-tag';
  const label = document.createElement('label');
  label.textContent = t.label;
  const input = document.createElement('textarea');
  input.className = 'input';
  input.rows = 3;
  input.maxLength = 600;
  input.placeholder = '填写今天的内容（选填，最多 600 字）';
  input.addEventListener('input', () => { state.textValues[t.id] = input.value; updateMood(); });
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

// 勾选 / 取消勾选；带二级选项的联动展开/收起；随后重算心情并播放音效
function toggleCheckTag(tag, chip, wrap) {
  const sub = wrap.querySelector('.sub-options');
  const wasLevel = state.moodLevel;
  const turningOn = !state.checkChosen[tag.id];
  if (!turningOn) {
    delete state.checkChosen[tag.id];
    delete state.checkOption[tag.id];
    chip.classList.remove('active');
    if (sub) {
      sub.hidden = true;
      sub.querySelectorAll('.sub-chip.active').forEach(x => x.classList.remove('active'));
    }
    sfx.tagOff();
  } else {
    state.checkChosen[tag.id] = true;
    chip.classList.add('active');
    if (sub) sub.hidden = false;
    sfx.tagOn(tag.category !== 'negative');
  }
  updateMood();
  if (state.moodLevel > wasLevel) sfx.moodUp();
  else if (state.moodLevel < wasLevel) sfx.moodDown();
}

function bindEvents() {
  // 墙 ↔ 表单
  if(els.btnGoWrite) els.btnGoWrite.addEventListener('click', () => { sfx.tap(); showForm(); });
  els.btnBackWall.addEventListener('click', () => { sfx.back(); showWall(); });
  els.wallClass.addEventListener('change', () => {
    state.currentClass = els.wallClass.value;
    try {
      const saved = JSON.parse(localStorage.getItem('sp_identity') || '{}');
      saved.class = state.currentClass;
      localStorage.setItem('sp_identity', JSON.stringify(saved));
    } catch (e) {}
    loadWall();
  });
  els.wallSemester?.addEventListener('change', () => {
    try { localStorage.setItem('sp_semester', els.wallSemester.value); } catch(e){}
    loadWall();
  });
  // 详情弹窗
  els.btnDetailClose.addEventListener('click', () => { sfx.back(); closeDetail(); });
  els.detailModal.addEventListener('click', e => { if (e.target === els.detailModal) { sfx.back(); closeDetail(); } });
  els.btnDetailWrite.addEventListener('click', () => {
    if (!state.detailName) return;
    const name = state.detailName;
    sfx.tap();
    closeDetail();
    showForm(name);
  });
  // 姓名变化时回到该姓名已保存的头像（手动改名场景）
  let taskTimer = null;
  els.inpName.addEventListener('input', () => {
    state.myAvatar = null; renderMoodPreview();
    clearTimeout(taskTimer);
    taskTimer = setTimeout(loadStudentTask, 400);
  });

  // 头像选择
  els.btnPickAvatar.addEventListener('click', () => { sfx.tap(); openAvatarPicker(); });
  els.btnAvatarClose.addEventListener('click', () => { sfx.back(); els.avatarModal.classList.remove('show'); });
  els.avatarModal.addEventListener('click', e => {
    if (e.target === els.avatarModal) { sfx.back(); els.avatarModal.classList.remove('show'); }
  });

  // 音效开关
  updateSoundButton();
  els.btnSound.addEventListener('click', () => {
    const next = !sfx.muted;
    sfx.setMuted(next);
    updateSoundButton();
    if (!next) sfx.pick();
  });

  // 提交
  els.btnSubmit.addEventListener('click', onSubmit);
  els.btnAgain.addEventListener('click', () => { sfx.tap(); els.successOverlay.classList.remove('show'); });
  els.btnWallFromSuccess.addEventListener('click', () => { sfx.tap(); els.successOverlay.classList.remove('show'); showWall(); });
}

function updateSoundButton() {
  if (!els.btnSound) return;
  els.btnSound.textContent = sfx.muted ? '🔇' : '🔊';
  els.btnSound.classList.toggle('is-off', !!sfx.muted);
}

/* ---------------- 头像选择 ---------------- */

function openAvatarPicker() {
  const cur = currentAvatar();
  const row = currentRosterRow();
  const lv = row ? (Number(row.level) || 1) : 1;
  els.avatarPicker.innerHTML = '';

  // —— 小动物头像（免费，每天限换 2 次）——
  const emojiSec = document.createElement('div');
  emojiSec.className = 'avatar-sec';
  emojiSec.innerHTML = `<div class="avatar-sec-title">🐾 小动物头像<span class="avatar-sec-tip">每天可换 ${EMOJI_CHANGE_LIMIT} 次</span></div>`;
  const emojiGrid = document.createElement('div');
  emojiGrid.className = 'avatar-grid avatar-grid-img';
  AVATARS.forEach(key => {
    emojiGrid.appendChild(buildImgChoice(key, cur.key, true, 0));
  });
  emojiSec.appendChild(emojiGrid);
  els.avatarPicker.appendChild(emojiSec);

  // —— 校园头像（3 级解锁）——
  const campusUnlocked = lv >= CAMPUS_UNLOCK_LEVEL;
  const campusSec = document.createElement('div');
  campusSec.className = 'avatar-sec campus';
  campusSec.innerHTML = campusUnlocked
    ? `<div class="avatar-sec-title">🏫 校园头像<span class="avatar-sec-tip ok">已解锁，可随意更换</span></div>`
    : `<div class="avatar-sec-title">🔒 校园头像<span class="avatar-sec-tip">升到 Lv.${CAMPUS_UNLOCK_LEVEL} 解锁（多记录积极表现赚经验吧）</span></div>`;
  const campusGrid = document.createElement('div');
  campusGrid.className = 'avatar-grid avatar-grid-img';
  CAMPUS_GROUPS.forEach(g => {
    for (let i = 1; i <= g.count; i++) {
      campusGrid.appendChild(buildImgChoice(g.prefix + i, cur.key, campusUnlocked, CAMPUS_UNLOCK_LEVEL));
    }
  });
  campusSec.appendChild(campusGrid);
  els.avatarPicker.appendChild(campusSec);

  // —— 典藏头像（6 级解锁）——
  const legendUnlocked = lv >= LEGEND_UNLOCK_LEVEL;
  const legendSec = document.createElement('div');
  legendSec.className = 'avatar-sec campus legend';
  legendSec.innerHTML = legendUnlocked
    ? `<div class="avatar-sec-title">🌟 典藏头像<span class="avatar-sec-tip ok">Lv.${LEGEND_UNLOCK_LEVEL} 已解锁，可随意更换</span></div>`
    : `<div class="avatar-sec-title">🔒 典藏头像<span class="avatar-sec-tip">升到 Lv.${LEGEND_UNLOCK_LEVEL} 解锁（再攒经验吧）</span></div>`;
  const legendGrid = document.createElement('div');
  legendGrid.className = 'legend-groups';
  LEGEND_GROUPS.forEach(g => {
    const sub = document.createElement('div');
    sub.className = 'avatar-sub-group';
    sub.innerHTML = `<div class="avatar-sub-title">${g.name}</div>`;
    const row = document.createElement('div');
    row.className = 'avatar-grid avatar-grid-img legend-row';
    for (let i = 1; i <= g.count; i++) {
      row.appendChild(buildImgChoice(g.prefix + i, cur.key, legendUnlocked, LEGEND_UNLOCK_LEVEL));
    }
    sub.appendChild(row);
    legendGrid.appendChild(sub);
  });
  legendSec.appendChild(legendGrid);
  els.avatarPicker.appendChild(legendSec);

  // —— 大师典藏（7 级解锁）——
  const masterUnlocked = lv >= MASTER_UNLOCK_LEVEL;
  const masterSec = document.createElement('div');
  masterSec.className = 'avatar-sec campus legend master';
  masterSec.innerHTML = masterUnlocked
    ? `<div class="avatar-sec-title">👑 大师典藏<span class="avatar-sec-tip ok">Lv.${MASTER_UNLOCK_LEVEL} 已解锁</span></div>`
    : `<div class="avatar-sec-title">🔒 大师典藏<span class="avatar-sec-tip">升到 Lv.${MASTER_UNLOCK_LEVEL} 解锁</span></div>`;
  const masterGrid = document.createElement('div');
  masterGrid.className = 'legend-groups';
  MASTER_GROUPS.forEach(g => {
    const sub = document.createElement('div');
    sub.className = 'avatar-sub-group';
    sub.innerHTML = `<div class="avatar-sub-title">${g.name}</div>`;
    const row = document.createElement('div');
    row.className = 'avatar-grid avatar-grid-img legend-row';
    for (let i = 1; i <= g.count; i++) {
      row.appendChild(buildImgChoice(g.prefix + i, cur.key, masterUnlocked, MASTER_UNLOCK_LEVEL));
    }
    sub.appendChild(row);
    masterGrid.appendChild(sub);
  });
  masterSec.appendChild(masterGrid);
  els.avatarPicker.appendChild(masterSec);

  renderMoodPreview();
  els.avatarModal.classList.add('show');
}

function buildEmojiChoice(emoji, selectedKey) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'avatar-choice' + (emoji === selectedKey ? ' selected' : '');
  b.textContent = emoji;
  b.addEventListener('click', () => onChooseAvatar(emoji, b));
  return b;
}

function buildImgChoice(key, selectedKey, unlocked, lockLevel) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'avatar-choice avatar-choice-img'
    + (key === selectedKey ? ' selected' : '')
    + (unlocked ? '' : ' locked');
  b.innerHTML = unlocked
    ? `<img src="${AVATAR_BASE}${key}.webp" alt="" loading="lazy">`
    : `<img src="${AVATAR_BASE}${key}.webp" alt="" loading="lazy"><span class="avatar-lock">🔒<em>Lv${lockLevel}</em></span>`;
  b.addEventListener('click', () => {
    if (!unlocked) {
      sfx.oops();
      toast(`这款头像要升到 Lv.${lockLevel} 才能用哦，继续加油～`);
      return;
    }
    onChooseAvatar(key, b);
  });
  return b;
}

async function onChooseAvatar(key, btn) {
  sfx.pick();
  const res = await persistAvatar(key);
  if (!res || res.ok === false) {
    const reason = res && res.reason;
    sfx.oops();
    if (reason === 'locked') {
      toast(`校园头像要升到 Lv.${CAMPUS_UNLOCK_LEVEL} 才能用哦`);
    } else if (reason === 'locked_legend') {
      toast(`典藏头像要升到 Lv.${LEGEND_UNLOCK_LEVEL} 才能解锁哦`);
    } else if (reason === 'limit') {
      toast(`表情头像今天只能换 ${EMOJI_CHANGE_LIMIT} 次，明天再来换吧～`);
    } else if (reason === 'no_student') {
      toast('请先在下面填好班级和姓名，再换头像');
    } else {
      toast('头像没有保存成功，请稍后再试');
    }
    return; // 服务端拒绝：不更新本地选择
  }

  state.myAvatar = key;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  const row = state.roster.find(s => s.class === cls && s.student_name === name);
  if (row) row.avatar = key;

  els.avatarPicker.querySelectorAll('.avatar-choice').forEach(x =>
    x.classList.toggle('selected', x === btn));
  renderMoodPreview();

  if (typeof res.changes_left === 'number' && res.changes_left >= 0 && !isImgKey(key)) {
    toast(res.changes_left > 0 ? `换好啦！今天还能换 ${res.changes_left} 次` : '换好啦！今天的更换次数用完了');
  }
  // 稍作停留让孩子看到"选中"反馈，再关闭
  setTimeout(() => els.avatarModal.classList.remove('show'), 260);
}

// 经 RPC 保存头像；返回服务端 jsonb 判定结果（含 ok / reason / level / xp / changes_left）
async function persistAvatar(key) {
  if (!ready) return { ok: false, reason: 'not_ready' };
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) return { ok: false, reason: 'no_identity' };
  try {
    const { data, error } = await supabase.rpc('set_student_avatar', {
      p_class: cls,
      p_student: name,
      p_avatar: key
    });
    if (error) return { ok: false, reason: 'error' };
    return data || { ok: false, reason: 'error' };
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
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
  window.scrollTo({ top: 0 });
  updateMood();
  if (!els.inpName.value) els.inpName.focus();
  resetSelections();
  loadTags();
  loadStudentTask();
  loadPastTasks();
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
    const { data: tasks } = await supabase.from('daily_task')
      .select('id,title,detail,task_date,task_type,due_time')
      .eq('class', cls).gte('task_date', sinceStr).lt('task_date', todayStr())
      .order('task_date', { ascending: false });
    const taskIds = (tasks||[]).map(t => t.id);
    const subs = taskIds.length
      ? (await supabase.from('task_submission').select('task_id,grade').in('task_id', taskIds).eq('student_name', name)).data || []
      : [];
    const gradeMap = {}; subs.forEach(s => gradeMap[s.task_id] = s.grade);
    const gLabel = { none:'⏳未完成', done:'✅完成', good:'👍优秀A', perfect:'🏆完美A+' };
    if (!(tasks||[]).length) { els.pastTaskBody.innerHTML = '<p class="text-muted">近7天没有往日任务。</p>'; return; }
    const now = new Date(); now.setHours(0,0,0,0);
    els.pastTaskBody.innerHTML = (tasks||[]).map(t => {
      const cur = gradeMap[t.id];
      // 截止判断：有 due_time 用它；没有则默认任务发布后一周
      let dueDate = t.due_time ? new Date(t.due_time) : null;
      if (!dueDate && t.task_date) { dueDate = new Date(t.task_date); dueDate.setDate(dueDate.getDate() + 7); }
      const active = dueDate ? dueDate >= now : false;
      const dueStr = t.due_time ? ` 截止${String(t.due_time).slice(0,10)}`
                  : (t.task_date ? ` 截止${(()=>{const d=new Date(t.task_date);d.setDate(d.getDate()+7);return d.toISOString().slice(0,10);})()}` : '');
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
        const res = await supabase.rpc('submit_task', {
          p_class: cls, p_student: name, p_task_id: taskId, p_grade: grade
        });
        if (res.error) { sfx.oops(); toast('保存失败：' + res.error.message); return; }
        const d = res.data || {};
        sfx.pick();
        const xpGain = (d.xp_delta || 0) > 0 ? ` 经验+${d.xp_delta}` : '';
        toast(grade === 'perfect' ? `太棒啦！${xpGain}` : grade === 'good' ? `真不错！${xpGain}` : '已保存');
        const row = state.roster.find(s => s.class === cls && s.student_name === name);
        if (row && typeof d.xp === 'number') { row.xp = d.xp; row.level = d.level; }
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
    loadTags();   // 刷新当天已打项，立即置灰
    loadWall();   // 提交后立刻刷新班级墙：今日条数、经验、老师评语同步
  } catch (e) {
    // 断网/网络错误：先存本机，联网自动补传（按人按天合并，不会重复加经验）
    const offline = !navigator.onLine || /fetch|network|Failed to fetch|NetworkError|Load failed|timeout/i.test((e && e.message) || '');
    if (offline) {
      try {
        const q = JSON.parse(localStorage.getItem('sp_pending') || '[]');
        q.push({ cls, name, mood: MOOD_BY_LEVEL(state.moodLevel).key, items, at: Date.now() });
        localStorage.setItem('sp_pending', JSON.stringify(q));
        sfx.pick();
        toast('📡 当前没网，已先保存到本机，联网后自动上传');
      } catch (e2) { sfx.oops(); toast('网络异常'); }
    } else {
      sfx.oops();
      toast('提交失败：' + ((e && e.message) || '请稍后再试'));
    }
  } finally {
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = '提交今天的表现 🎈';
  }
}

// 启动时 + 联网时，把本机待上传的记录补传
async function flushPending() {
  let q = [];
  try { q = JSON.parse(localStorage.getItem('sp_pending') || '[]'); } catch (e) {}
  if (!q.length || !navigator.onLine) return;
  const left = [];
  for (const p of q) {
    try {
      await supabase.rpc('submit_today', { p_class: p.cls, p_student: p.name, p_mood: p.mood, p_items: p.items });
    } catch (e) { left.push(p); }
  }
  localStorage.setItem('sp_pending', JSON.stringify(left));
  if (q.length - left.length > 0) { toast('📡 已自动上传 ' + (q.length-left.length) + ' 条离线记录'); loadWall(); }
}
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

let toastTimer;
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
    const r = await supabase.rpc('get_today_task', { p_class: cls, p_student: name });
    data = r.data;
  } catch (e) { data = null; }
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
      return `<div class="stu-task">
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
  const res = await supabase.rpc('submit_task', {
    p_class: cls, p_student: name, p_task_id: taskId, p_grade: grade
  });
  if (res.error) { sfx.oops(); toast('保存失败，请重试'); return; }
  const d = res.data || {};
  sfx.pick();
  const resultEl = document.querySelector(`[data-result="${taskId}"]`);
  if (resultEl) {
    if (grade === 'none') {
      resultEl.textContent = '好的，继续加油把任务完成吧！';
    } else {
      const xpGain = (d.xp_delta || 0) > 0 ? ' 经验+' + d.xp_delta : '';
      resultEl.textContent = grade === 'perfect' ? `太棒啦，完美完成！${xpGain}`
                          : grade === 'good'    ? `真不错，继续保持！${xpGain}`
                          :                       `完成啦，辛苦啦！${xpGain}`;
      if (d.mood_awarded) resultEl.textContent += ' 心情+1 😊';
    }
  }
  const row = state.roster.find(s => s.class === cls && s.student_name === name);
  if (row && typeof d.xp === 'number') { row.xp = d.xp; row.level = d.level; }
  renderIdentityLevel();
  loadStudentTask();
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
