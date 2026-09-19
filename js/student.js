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

const MOODS = [
  { key: 'happy',  emoji: '😄', label: '很棒' },
  { key: 'good',   emoji: '🙂', label: '不错' },
  { key: 'normal', emoji: '😐', label: '一般' },
  { key: 'sad',    emoji: '😢', label: '加油' }
];
const MOOD_MAP = Object.fromEntries(MOODS.map(m => [m.key, m]));
const STAR_TEXT = ['', '还需加油', '继续努力', '还不错', '很棒', '超级棒'];
const PRAISE = {
  happy:  ['太棒啦！明天也要保持好心情！', '你今天闪闪发光，继续加油！'],
  good:   ['做得不错，为你点赞！', '稳稳进步中，明天会更好！'],
  normal: ['记录下来就是进步，明天加油！', '没关系，每天进步一点点！'],
  sad:    ['愿意说出来就很勇敢，老师和家长都爱你！', '明天会是新的一天，陪你一起加油！']
};
const AVATARS = ['🐯','🦁','🐼','🐰','🐨','🐮','🐸','🦊','🐷','🐵','🐔','🐧','🐹','🦄','🐶','🐱','🦉','🐙'];
const AVATAR_BG = ['#fdecc8','#d8f0e2','#dcecfb','#f6e0f1','#fdf3c9','#e6e2fb','#d9f2f5','#ffe3dd','#e8f6dc','#fae3ef'];

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
  btnDetailClose: $('#btnDetailClose'),
  // 表单
  todayLabel: $('#todayLabel'),
  configBanner: $('#configBanner'),
  inpClass: $('#inpClass'),
  inpName: $('#inpName'),
  starsRow: $('#starsRow'),
  starCaption: $('#starCaption'),
  moodRow: $('#moodRow'),
  tagsLoading: $('#tagsLoading'),
  tagsBox: $('#tagsBox'),
  tagsFailed: $('#tagsFailed'),
  chipsBox: $('#chipsBox'),
  textTagsBox: $('#textTagsBox'),
  btnSubmit: $('#btnSubmit'),
  successOverlay: $('#successOverlay'),
  successMsg: $('#successMsg'),
  btnAgain: $('#btnAgain'),
  btnWallFromSuccess: $('#btnWallFromSuccess'),
  confettiBox: $('#confettiBox')
};

const state = {
  // 墙
  classes: [],
  currentClass: '',
  roster: [],
  records: [],
  // 表单
  stars: 0,
  mood: null,
  tags: [],
  checkChosen: {},
  textValues: {}
};

init();

function init() {
  els.wallDate.textContent = todayLabel();
  els.todayLabel.textContent = todayLabel();
  renderStars();
  renderMoods();
  bindEvents();
  prefillIdentity();

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

  els.wallClass.innerHTML = state.classes
    .map(c => `<option value="${esc(c)}"${c === state.currentClass ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');
  loadWall();
}

async function loadWall() {
  els.wallEmpty.hidden = true;
  els.matesGrid.hidden = true;
  els.wallLoading.hidden = false;
  els.wallLoading.innerHTML = '<span class="spinner"></span>正在加载同学们…';

  const cls = state.currentClass;
  const [rosterRes, recordRes] = await Promise.all([
    supabase.from('student_directory')
      .select('id, class, student_name')
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

  // 全班汇总
  const classAvg = recs.length
    ? (recs.reduce((s, r) => s + (r.self_evaluation || 0), 0) / recs.length).toFixed(1)
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
    const avg = mine.length
      ? (mine.reduce((sum, r) => sum + (r.self_evaluation || 0), 0) / mine.length).toFixed(1)
      : null;
    const todayRec = mine.find(r => r.record_date === today);
    const todayMood = todayRec && todayRec.behavior ? MOOD_MAP[todayRec.behavior.mood] : null;

    const bg = AVATAR_BG[hashCode(s.id) % AVATAR_BG.length];
    const emoji = AVATARS[hashCode(s.id) % AVATARS.length];

    html += `<button class="mate" data-detail="${esc(s.student_name)}">
        <span class="mate-avatar" style="background:${bg}">${emoji}</span>
        ${todayMood ? `<span class="mate-today" title="今天已记录">${todayMood.emoji}</span>` : ''}
        ${avg ? `<span class="mate-badge">⭐${avg}</span>` : `<span class="mate-badge count-badge">未记录</span>`}
        <span class="mate-name">${esc(s.student_name)}</span>
      </button>`;
  });

  els.matesGrid.innerHTML = html;
  els.matesGrid.hidden = false;

  $$('.mate', els.matesGrid).forEach(btn => {
    btn.addEventListener('click', () => {
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
  const emoji = rosterRow ? AVATARS[hashCode(rosterRow.id) % AVATARS.length] : '🐯';
  const bg = rosterRow ? AVATAR_BG[hashCode(rosterRow.id) % AVATAR_BG.length] : '#fdf0dd';
  els.detailAvatar.textContent = emoji;
  els.detailAvatar.style.background = bg;
  els.detailName.textContent = name;
  const avg = rows.length
    ? (rows.reduce((s, r) => s + (r.self_evaluation || 0), 0) / rows.length).toFixed(1)
    : null;
  els.detailSub.textContent = rows.length
    ? `共 ${rows.length} 条记录${avg ? ' · 平均 ⭐' + avg : ''}`
    : '还没有提交过表现记录';
  els.detailBody.innerHTML = renderRecordTimeline(rows);
  els.detailModal.classList.add('show');
}

function openClassDetail(avg, todayCount) {
  els.detailAvatar.textContent = '🌈';
  els.detailAvatar.style.background = 'linear-gradient(135deg,#ffe6c9,#d8f0e2)';
  els.detailName.textContent = state.currentClass + ' · 全班';
  els.detailSub.textContent = `共 ${state.records.length} 条记录 · 今日 ${todayCount} 条${avg ? ' · 平均 ⭐' + avg : ''}`;
  els.detailBody.innerHTML = renderClassRanking() + renderRecordTimeline(state.records);
  els.detailModal.classList.add('show');
}

function renderClassRanking() {
  const byName = new Map();
  state.records.forEach(r => {
    if (!byName.has(r.student_name)) byName.set(r.student_name, { name: r.student_name, sum: 0, n: 0 });
    const x = byName.get(r.student_name);
    x.sum += r.self_evaluation || 0;
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
      const stars = '★'.repeat(r.self_evaluation) + '☆'.repeat(5 - r.self_evaluation);
      const mood = MOOD_MAP[r.behavior && r.behavior.mood];

      let itemsHtml = '';
      const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items : [];
      if (items.length) {
        itemsHtml = '<ul class="detail-items">';
        items.forEach(it => {
          if (it.type === 'text') {
            itemsHtml += `<li><b>${esc(it.label || '')}：</b>${esc(it.value || '')}</li>`;
          } else {
            itemsHtml += `<li><span class="tick">✓</span>${esc(it.label || '')}</li>`;
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
      state.stars = i;
      renderStars();
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
      els.starCaption.textContent = STAR_TEXT[i];
    });
    els.starsRow.appendChild(b);
  }
}

function renderMoods() {
  els.moodRow.innerHTML = '';
  MOODS.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mood-btn' + (state.mood === m.key ? ' active' : '');
    b.innerHTML = `<span class="mood-emoji">${m.emoji}</span><span class="mood-label">${m.label}</span>`;
    b.addEventListener('click', () => {
      state.mood = m.key;
      renderMoods();
    });
    els.moodRow.appendChild(b);
  });
}

async function loadTags() {
  const { data, error } = await supabase
    .from('behavior_tags')
    .select('id, label, tag_type, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  els.tagsLoading.hidden = true;
  if (error || !data) {
    els.tagsFailed.hidden = false;
    return;
  }
  state.tags = data;
  els.chipsBox.innerHTML = '';
  els.textTagsBox.innerHTML = '';

  data.forEach(t => {
    if (t.tag_type === 'check') {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = t.label;
      chip.addEventListener('click', () => {
        if (state.checkChosen[t.id]) {
          delete state.checkChosen[t.id];
          chip.classList.remove('active');
        } else {
          state.checkChosen[t.id] = true;
          chip.classList.add('active');
        }
      });
      els.chipsBox.appendChild(chip);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'text-tag';
      const label = document.createElement('label');
      label.textContent = t.label;
      const input = document.createElement('input');
      input.className = 'input';
      input.type = 'text';
      input.maxLength = 100;
      input.placeholder = '填写今天的内容（选填）';
      input.addEventListener('input', () => { state.textValues[t.id] = input.value; });
      wrap.appendChild(label);
      wrap.appendChild(input);
      els.textTagsBox.appendChild(wrap);
    }
  });

  if (!data.length) {
    els.chipsBox.innerHTML = '<span class="text-muted">老师还没有设置表现标签。</span>';
  }
  els.tagsBox.hidden = false;
}

function bindEvents() {
  // 墙 ↔ 表单
  els.btnGoWrite.addEventListener('click', showForm);
  els.btnBackWall.addEventListener('click', showWall);
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
  els.btnDetailClose.addEventListener('click', closeDetail);
  els.detailModal.addEventListener('click', e => { if (e.target === els.detailModal) closeDetail(); });
  // 提交
  els.btnSubmit.addEventListener('click', onSubmit);
  els.btnAgain.addEventListener('click', () => els.successOverlay.classList.remove('show'));
  els.btnWallFromSuccess.addEventListener('click', () => {
    els.successOverlay.classList.remove('show');
    showWall();
  });
}

function showForm() {
  if (!state.currentClass) { toast('请先选择班级'); return; }
  els.inpClass.value = state.currentClass;
  els.wallView.hidden = true;
  els.formView.hidden = false;
  window.scrollTo({ top: 0 });
  if (!els.inpName.value) els.inpName.focus();
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
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls) return toast('请先填写班级');
  if (!name) return toast('请先填写姓名');
  if (state.stars < 1) return toast('给自己打个星吧～');
  if (!state.mood) return toast('选一个今天的心情吧～');

  const items = [];
  for (const t of state.tags) {
    if (t.tag_type === 'check') {
      if (state.checkChosen[t.id]) {
        items.push({ id: t.id, label: t.label, type: 'check', value: null });
      }
    } else {
      const v = (state.textValues[t.id] || '').trim();
      if (v) items.push({ id: t.id, label: t.label, type: 'text', value: v.slice(0, 100) });
    }
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
      toast('没有找到你的名字哦，请检查班级和姓名，或请老师确认名单');
      return;
    }

    const { error: insertError } = await supabase.from('daily_record').insert({
      class: cls,
      student_name: name,
      record_date: todayStr(),
      self_evaluation: state.stars,
      behavior: { mood: state.mood, items }
    });
    if (insertError) {
      if (/row-level security|policy|is_valid_student/i.test(insertError.message)) {
        toast('名单中没有找到对应班级和姓名，请请老师确认');
      } else {
        throw insertError;
      }
      return;
    }

    try { localStorage.setItem('sp_identity', JSON.stringify({ class: cls, studentName: name })); } catch (e) {}
    celebrate();
    resetSelections();
  } catch (e) {
    toast('提交失败：' + ((e && e.message) || '请稍后再试'));
  } finally {
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = '提交今天的表现 🎈';
  }
}

function resetSelections() {
  state.stars = 0;
  state.mood = null;
  state.checkChosen = {};
  state.textValues = {};
  renderStars();
  renderMoods();
  els.starCaption.textContent = '点一点上面的小星星';
  els.chipsBox.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
  els.textTagsBox.querySelectorAll('input').forEach(i => { i.value = ''; });
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

function celebrate() {
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
  const pool = PRAISE[state.mood] || PRAISE.good;
  els.successMsg.textContent = pool[Math.floor(Math.random() * pool.length)];
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
