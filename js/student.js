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
const LEGEND_KEYS = LEGEND_GROUPS.reduce((arr, g) => {
  for (let i = 1; i <= g.count; i++) arr.push(g.prefix + i);
  return arr;
}, []);
const EMOJI_CHANGE_LIMIT = 2;
// 各级所需经验下限：L1=0 / L2=20 / L3=60 / L4=120 / L5=200 / L6=400（与数据库 level_from_xp 同口径）
const XP_LEVELS = [0, 20, 60, 120, 200, 400];
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
  taskBody: $('#taskBody')
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
  textValues: {}
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
    els.btnGoWrite.disabled = true;
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
    els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">班级名单加载失败，请稍后刷新重试。</span>';
    return;
  }
  state.classes = Array.from(new Set((data || []).map(x => x.class))).sort();
  if (!state.classes.length) {
    els.wallLoading.hidden = true;
    els.wallEmpty.hidden = false;
    els.btnGoWrite.disabled = true;
    return;
  }

  let saved = '';
  try { saved = (JSON.parse(localStorage.getItem('sp_identity') || '{}')).class || ''; } catch (e) {}
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
  loadWall().then(() => {
    if (state.readonly && state.previewName) {
      showForm(state.previewName);
      applyReadonlyMode();
    }
  });
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
  const [rosterRes, recordRes] = await Promise.all([
    supabase.from('student_directory')
      .select('*')
      .eq('class', cls)
      .order('student_name'),
    supabase.from('daily_record')
      .select('id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at')
      .eq('class', cls)
      .order('record_date', { ascending: false })
      .order('create_at', { ascending: false })
      .limit(1000)
  ]);

  els.wallLoading.hidden = true;
  if (rosterRes.error || recordRes.error) {
    els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">数据加载失败，请稍后刷新重试。</span>';
    return;
  }
  state.roster = rosterRes.data || [];
  state.records = recordRes.data || [];
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

  let html = '';

  // 全班汇总卡
  html += `<button class="mate mate-class-all" data-detail="__all__">
      <span class="mate-avatar">🌈</span>
      <span class="mate-badge count-badge">${recs.length} 条记录</span>
      <span class="mate-name">全班${classAvg ? ' ⭐' + classAvg : ''}</span>
    </button>`;

  // 每个同学
  state.roster.forEach((s, i) => {
    const mine = recs.filter(r => r.student_name === s.student_name);
    const mineRated = mine.filter(r => Number(r.self_evaluation) > 0);
    const avg = mineRated.length
      ? (mineRated.reduce((sum, r) => sum + Number(r.self_evaluation), 0) / mineRated.length).toFixed(1)
      : null;
    const todayRecs = mine.filter(r => r.record_date === today);
    const todayRec = todayRecs.length ? todayRecs[todayRecs.length - 1] : null;
    const todayMood = todayRec && todayRec.behavior ? MOOD_MAP[todayRec.behavior.mood] : null;
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
        ${avg ? `<span class="mate-badge">⭐${avg}</span>` : `<span class="mate-badge count-badge">未记录</span>`}
        <span class="mate-name">${esc(s.student_name)}</span>
      </button>`;
  });

  els.matesGrid.innerHTML = html;
  els.matesGrid.hidden = false;

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
  els.detailSub.textContent = `共 ${state.records.length} 条记录 · 今日 ${todayCount} 条${avg ? ' · 平均 ⭐' + avg : ''}`;
  els.detailBody.innerHTML = renderClassRanking() + renderRecordTimeline(state.records);
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
  els.starsRow.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'star-btn' + (i <= state.stars ? '' : ' off');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', i + '星');
    b.innerHTML = '<span class="star-shape">★</span>';
    b.addEventListener('click', () => {
      // 再点一次当前星级 = 清空（打星选填，不打星也能提交）
      state.stars = (state.stars === i) ? 0 : i;
      sfx.star(state.stars);
      renderStars();
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
      els.starCaption.textContent = state.stars
        ? STAR_TEXT[state.stars]
        : '可以不打星，直接选今天的小表现就行';
    });
    els.starsRow.appendChild(b);
  }
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
    .select('id, label, tag_type, options, category, score, sort_order')
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
      b.addEventListener('click', () => {
        sfx.sub();
        state.checkOption[t.id] = opt;
        sub.querySelectorAll('.sub-chip').forEach(x =>
          x.classList.toggle('active', x === b));
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
  const input = document.createElement('input');
  input.className = 'input';
  input.type = 'text';
  input.maxLength = 100;
  input.placeholder = '填写今天的内容（选填）';
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
  els.btnGoWrite.addEventListener('click', () => { sfx.tap(); showForm(); });
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
  loadStudentTask();
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
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
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
        const subVal = (state.checkOption[t.id] || '').trim();
        if (Array.isArray(t.options) && t.options.length && !subVal) {
          sfx.oops();
          return toast(`请为「${t.label}」再选一个具体项目`);
        }
        items.push({ id: t.id, label: t.label, type: 'check', value: subVal || null, category: t.category || 'positive', xp: tagXpOf(t) });
      }
    } else {
      const v = (state.textValues[t.id] || '').trim();
      if (v) items.push({ id: t.id, label: t.label, type: 'text', value: v.slice(0, 100), category: t.category || 'positive', xp: tagXpOf(t) });
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

    const { error: insertError } = await supabase.from('daily_record').insert({
      class: cls,
      student_name: name,
      record_date: todayStr(),
      self_evaluation: state.stars || null,   // 打星选填
      behavior: { mood: MOOD_BY_LEVEL(state.moodLevel).key, items }
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

    // 乐观更新经验/等级（数据库触发器会按各标签配置的 xp_value 做同样的累加）
    const gainedXp = items.reduce((s, i) => s + (Number(i.xp) || 0), 0);
    let leveledUp = false;
    if (gainedXp > 0) {
      const row = state.roster.find(s => s.class === cls && s.student_name === name);
      if (row) {
        const beforeLv = Number(row.level) || 1;
        row.xp = (Number(row.xp) || 0) + gainedXp;
        row.level = levelFromXp(row.xp);
        leveledUp = row.level > beforeLv;
      }
    }

    try { localStorage.setItem('sp_identity', JSON.stringify({ class: cls, studentName: name })); } catch (e) {}
    sfx.success();
    celebrate(gainedXp, leveledUp);
    resetSelections();
    renderMoodPreview();
  } catch (e) {
    sfx.oops();
    toast('提交失败：' + ((e && e.message) || '请稍后再试'));
  } finally {
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = '提交今天的表现 🎈';
  }
}

function resetSelections() {
  state.stars = 0;
  state.checkChosen = {};
  state.checkOption = {};
  state.textValues = {};
  renderStars();
  els.starCaption.textContent = '可以不打星，直接选今天的小表现就行';
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
  setTimeout(() => { els.confettiBox.innerHTML = ''; }, 5200);
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
  if (!tasks.length) {
    els.taskBody.innerHTML = '<p class="text-muted">老师今天还没布置任务，先填下面的小表现吧～</p>';
    return;
  }
  let html = '';
  tasks.forEach(t => {
    const my = t.my_grade || 'none';
    const typeLabel = t.task_type === 'homework' ? '🏠 家庭作业' : '🏫 课堂作业';
    html += `<div class="stu-task">
      <div class="stu-task-head"><span class="stu-task-type ${t.task_type}">${typeLabel}</span></div>
      <div class="stu-task-title">${escapeHtml(t.title)}</div>
      ${t.detail ? `<div class="stu-task-detail">${escapeHtml(t.detail)}</div>` : ''}
      <div class="stu-task-grades">`;
    TASK_GRADES.forEach(g => {
      html += `<button type="button" class="stu-task-grade ${g.key === my ? 'on' : ''}" data-grade="${g.key}" data-task="${t.id}">${g.icon} ${g.label}</button>`;
    });
    html += `</div><div class="stu-task-result" data-result="${t.id}"></div></div>`;
  });
  els.taskBody.innerHTML = html;

  els.taskBody.querySelectorAll('.stu-task-grade').forEach(btn => {
    btn.addEventListener('click', () => onPickTaskGrade(btn.dataset.grade, btn.dataset.task, btn));
  });
}

async function onPickTaskGrade(grade, taskId, btn) {
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (state.readonly) { sfx.oops(); toast('预览模式不能提交哦～'); return; }
  const res = await supabase.rpc('submit_task', {
    p_class: cls, p_student: name, p_task_id: taskId, p_grade: grade
  });
  if (res.error) { sfx.oops(); toast('保存失败，请重试'); return; }
  const d = res.data || {};
  sfx.pick();
  const resultEl = els.taskBody.querySelector(`[data-result="${taskId}"]`);
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
