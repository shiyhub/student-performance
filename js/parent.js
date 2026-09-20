/**
 * 家长查询页逻辑
 * 权限：匿名（anon）不能直接读表，只能调用 RPC get_student_records
 *      班级 + 学生姓名 + 家长姓名 三项在数据库端匹配，失败只返回空结果
 * 依赖：js/vendor/supabase.js、js/vendor/qrcode.min.js（本地引入）
 */
const supabase = window.supabase
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
  : null;
const ready = !!supabase &&
  !String(window.SUPABASE_CONFIG.url || '').includes('YOUR_PROJECT_REF');

const $ = (sel, root) => (root || document).querySelector(sel);

const MOOD_MAP = {
  happy:  { emoji: '😄', label: '很棒' },
  good:   { emoji: '🙂', label: '不错' },
  normal: { emoji: '😐', label: '一般' },
  down:   { emoji: '😟', label: '有点低落' },
  sad:    { emoji: '😢', label: '需要加油' }
};
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const els = {
  configBanner: $('#configBanner'),
  headerHint: $('#headerHint'),
  classLockBar: $('#classLockBar'),
  classLockName: $('#classLockName'),
  classField: $('#classField'),
  inpClass: $('#inpClass'),
  inpStudent: $('#inpStudent'),
  inpParent: $('#inpParent'),
  btnQuery: $('#btnQuery'),
  btnBack: $('#btnBack'),
  mismatchBanner: $('#mismatchBanner'),
  queryCard: $('#queryCard'),
  resultCard: $('#resultCard'),
  resultTitle: $('#resultTitle'),
  resultCount: $('#resultCount'),
  recordList: $('#recordList'),
  btnQrEntry: $('#btnQrEntry'),
  qrModal: $('#qrModal'),
  qrClass: $('#qrClass'),
  qrImage: $('#qrImage'),
  qrLoading: $('#qrLoading'),
  qrLink: $('#qrLink'),
  btnCopyLink: $('#btnCopyLink'),
  btnDownloadQr: $('#btnDownloadQr'),
  btnQrClose: $('#btnQrClose'),
  // 时间筛选 + 汇总
  quickSeg: $('#quickSeg'),
  dateChips: $('#dateChips'),
  viewDetail: $('#viewDetail'),
  viewSummary: $('#viewSummary'),
  summaryBox: $('#summaryBox'),
  emptyRange: $('#emptyRange'),
  // 在家表现
  homeDate: $('#homeDate'),
  homeContent: $('#homeContent'),
  btnHomeSubmit: $('#btnHomeSubmit')
};

// 扫码进入时班级由链接锁定，家长只需填写学生姓名 + 家长姓名
let lockedClass = '';

// 查询与会话状态
const state = {
  ctx: { cls: '', student: '', parent: '' },
  allRows: [],          // 该生全部在校记录（RPC 返回，已按日期倒序）
  quick: 'all',         // all | week | lastweek | 4w | custom
  picked: null,         // 自选日期 Set（null=未启用自选）
  viewMode: 'detail'    // detail | summary
};

init();

function init() {
  if (!ready) {
    els.configBanner.hidden = false;
    els.btnQuery.disabled = true;
    return;
  }

  // 链接里带 class 即视为"班级二维码"扫码进入：锁定班级
  const params = new URLSearchParams(location.search);
  const c = (params.get('class') || '').trim();
  if (c) {
    lockedClass = c;
    els.inpClass.value = c;
    els.classField.hidden = true;
    els.classLockName.textContent = c;
    els.classLockBar.hidden = false;
    els.headerHint.textContent = '扫码已自动识别班级，请填写学生姓名和家长姓名';
  }

  els.btnQuery.addEventListener('click', onQuery);
  els.btnBack.addEventListener('click', () => {
    els.resultCard.hidden = true;
    els.mismatchBanner.hidden = true;
    els.queryCard.hidden = false;
    window.scrollTo({ top: 0 });
  });

  // 二维码弹窗
  els.btnQrEntry.addEventListener('click', openQrModal);
  els.btnQrClose.addEventListener('click', closeQrModal);
  els.qrModal.addEventListener('click', e => { if (e.target === els.qrModal) closeQrModal(); });
  els.qrClass.addEventListener('input', refreshQrDebounced);
  els.btnCopyLink.addEventListener('click', copyQrLink);
  els.btnDownloadQr.addEventListener('click', downloadQr);

  // 时间筛选 / 视图切换
  els.quickSeg.addEventListener('click', e => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    setQuick(b.dataset.quick);
  });
  els.viewDetail.addEventListener('click', () => setView('detail'));
  els.viewSummary.addEventListener('click', () => setView('summary'));

  // 在家表现
  els.btnHomeSubmit.addEventListener('click', onSubmitHome);

  // 教师后台跳转过来时（#qr）自动弹出生成窗
  if (location.hash === '#qr') {
    setTimeout(openQrModal, 300);
  }
}

/* ---------------- 查询 ---------------- */

async function onQuery() {
  const cls = (lockedClass || els.inpClass.value || '').trim();
  const student = els.inpStudent.value.trim();
  const parent = els.inpParent.value.trim();
  if (!cls || !student || !parent) {
    toast(lockedClass ? '学生姓名和家长姓名都要填写哦' : '班级、学生姓名、家长姓名都要填写哦');
    return;
  }

  els.mismatchBanner.hidden = true;
  els.btnQuery.disabled = true;
  els.btnQuery.textContent = '查询中…';
  try {
    const { data, error } = await supabase.rpc('get_student_records', {
      p_class: cls,
      p_student: student,
      p_parent: parent
    });
    if (error) throw error;
    if (!data || data.length === 0) {
      els.mismatchBanner.textContent = lockedClass
        ? '信息不匹配，查不到记录。请核对学生姓名和家长姓名（需与老师登记的完全一致）后再试。'
        : '三项信息不匹配，查不到记录。请核对班级、学生姓名和家长姓名后再试。';
      els.mismatchBanner.hidden = false;
      return;
    }
    state.ctx = { cls, student, parent };
    renderResults(student, data);
  } catch (e) {
    toast('查询失败：' + ((e && e.message) || '请稍后再试'));
  } finally {
    els.btnQuery.disabled = false;
    els.btnQuery.textContent = '查询记录';
  }
}

/* ---------------- 在家表现提交（仅老师可见） ---------------- */

async function onSubmitHome() {
  const content = els.homeContent.value.trim();
  if (!content) { toast('先写一点孩子在家的表现吧'); return; }
  const date = els.homeDate.value || todayStr();
  els.btnHomeSubmit.disabled = true;
  els.btnHomeSubmit.textContent = '提交中…';
  try {
    const { data, error } = await supabase.rpc('add_home_note', {
      p_class: state.ctx.cls,
      p_student: state.ctx.student,
      p_parent: state.ctx.parent,
      p_content: content.slice(0, 500),
      p_date: date
    });
    if (error) throw error;
    if (data !== true) {
      toast('身份信息未通过校验，请返回重新查询后再提交');
      return;
    }
    els.homeContent.value = '';
    toast('已提交，只有老师能看到哦 🏠');
  } catch (e) {
    toast('提交失败：' + ((e && e.message) || '请稍后再试'));
  } finally {
    els.btnHomeSubmit.disabled = false;
    els.btnHomeSubmit.textContent = '提交在家表现';
  }
}

/* ---------------- 时间筛选 + 视图 ---------------- */

function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 解析 YYYY-MM-DD 为本地日期
function parseDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toYmd(dt) {
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
// 该日期所在周的周一（中国习惯：周一为一周起点）
function mondayOf(ymd) {
  const dt = parseDate(ymd);
  const wd = (dt.getDay() + 6) % 7; // 周一=0 … 周日=6
  dt.setDate(dt.getDate() - wd);
  return dt;
}
function addDays(dt, n) {
  const d = new Date(dt);
  d.setDate(d.getDate() + n);
  return d;
}
// 快捷时间段对应的日期集合（Set<YYYY-MM-DD>）
function quickDateSet(quick, validDates) {
  const today = todayStr();
  const mon = mondayOf(today);
  let from = null, to = today;
  if (quick === 'week') {
    from = toYmd(mon);
  } else if (quick === 'lastweek') {
    const lm = addDays(mon, -7);
    from = toYmd(lm);
    to = toYmd(addDays(lm, 6));
  } else if (quick === '4w') {
    from = toYmd(addDays(mon, -21)); // 含本周共 4 周
  } else {
    return null;
  }
  const set = new Set();
  validDates.forEach(d => { if (d >= from && d <= to) set.add(d); });
  return set;
}

function renderResults(studentName, rows) {
  els.queryCard.hidden = true;
  els.resultCard.hidden = false;
  els.resultTitle.textContent = `${esc(studentName)} 的在校表现`;

  state.allRows = rows;
  state.quick = 'all';
  state.picked = null;
  state.viewMode = 'detail';

  // 在家表现日期默认今天
  els.homeDate.value = todayStr();
  els.homeContent.value = '';

  renderDateChips();
  updateSegActive();
  applyFilter();
  window.scrollTo({ top: 0 });
}

// 顶部"有记录的日期"多选条
function renderDateChips() {
  const dates = Array.from(new Set(state.allRows.map(r => r.record_date))).sort().reverse();
  els.dateChips.innerHTML = dates.map(d =>
    `<button type="button" class="date-chip" data-date="${d}">${chipDateLabel(d)}</button>`
  ).join('');
  els.dateChips.querySelectorAll('.date-chip').forEach(b => {
    b.addEventListener('click', () => toggleDate(b.dataset.date));
  });
}
function chipDateLabel(ymd) {
  const [, m, d] = String(ymd).split('-').map(Number);
  const dt = parseDate(ymd);
  return `${m}/${d} 周${'一二三四五六日'[(dt.getDay() + 6) % 7]}`;
}

function setQuick(quick) {
  state.quick = quick;
  state.picked = null;
  // 周/近4周默认看汇总；全部默认看明细
  state.viewMode = (quick === 'all') ? 'detail' : 'summary';
  updateSegActive();
  applyFilter();
}
function toggleDate(ymd) {
  if (!state.picked) state.picked = new Set();
  if (state.picked.has(ymd)) state.picked.delete(ymd);
  else state.picked.add(ymd);
  state.quick = state.picked.size ? 'custom' : 'all';
  state.viewMode = state.picked.size >= 2 ? 'summary' : 'detail';
  updateSegActive();
  applyFilter();
}
function setView(mode) {
  state.viewMode = mode;
  updateSegActive();
  applyFilter();
}
function updateSegActive() {
  els.quickSeg.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('active', state.quick === b.dataset.quick));
  els.viewDetail.classList.toggle('active', state.viewMode === 'detail');
  els.viewSummary.classList.toggle('active', state.viewMode === 'summary');
  els.dateChips.querySelectorAll('.date-chip').forEach(b =>
    b.classList.toggle('active', !!(state.picked && state.picked.has(b.dataset.date))));
}

// 计算当前筛选命中的记录（仍保持日期倒序）
function filteredRows() {
  let set = null;
  if (state.quick === 'custom' && state.picked && state.picked.size) {
    set = state.picked;
  } else if (state.quick !== 'all') {
    const valid = new Set(state.allRows.map(r => r.record_date));
    set = quickDateSet(state.quick, valid);
  }
  if (!set) return state.allRows;
  return state.allRows.filter(r => set.has(r.record_date));
}

function applyFilter() {
  const rows = filteredRows();
  els.resultCount.textContent = state.quick === 'all' && !state.picked
    ? `共 ${state.allRows.length} 条记录`
    : `已选 ${rows.length} 条 / 共 ${state.allRows.length} 条`;
  els.emptyRange.hidden = rows.length > 0;

  if (state.viewMode === 'summary') {
    els.summaryBox.hidden = false;
    els.recordList.hidden = true;
    els.summaryBox.innerHTML = renderSummary(rows);
  } else {
    els.summaryBox.hidden = true;
    els.recordList.hidden = false;
    els.recordList.innerHTML = renderDetailList(rows);
  }
}

function renderDetailList(rows) {
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
    html += `<div class="day-head">
               <span>${formatDate(g.date)}</span>
               <span class="day-count">${g.rows.length} 条</span>
             </div>`;
    g.rows.forEach(r => { html += renderRecordCard(r); });
  });
  return html;
}

/* ---------------- 分类汇总 ---------------- */

function renderSummary(rows) {
  if (!rows.length) return '';

  // 平均星级
  const avg = rows.reduce((s, r) => s + (r.self_evaluation || 0), 0) / rows.length;
  const dates = Array.from(new Set(rows.map(r => r.record_date))).sort();
  const rangeTxt = dates.length === 1
    ? formatDate(dates[0])
    : `${formatDate(dates[0]).replace(/ 星期.*/, '')} ~ ${formatDate(dates[dates.length - 1]).replace(/ 星期.*/, '')}（${dates.length} 天）`;

  // 心情分布
  const moodCount = { happy: 0, good: 0, normal: 0, down: 0, sad: 0 };
  // 积极/消极：key = label 或 label·二级项
  const posMap = new Map();
  const negMap = new Map();
  // 填写型内容
  const textItems = [];
  let commentCount = 0;

  rows.forEach(r => {
    const mood = r.behavior && r.behavior.mood;
    if (moodCount[mood] !== undefined) moodCount[mood]++;
    const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items : [];
    items.forEach(it => {
      const label = it.label || '';
      const neg = it.category === 'negative';
      const target = neg ? negMap : posMap;
      if (it.type === 'text') {
        textItems.push({ label, value: it.value || '', date: r.record_date, neg });
        const k = '✏️ ' + label;
        target.set(k, (target.get(k) || 0) + 1);
      } else {
        const k = it.value ? `${label} · ${it.value}` : label;
        target.set(k, (target.get(k) || 0) + 1);
      }
    });
    if ((r.teacher_comment || '').trim()) commentCount++;
  });

  const moodLine = ['happy', 'good', 'normal', 'down', 'sad']
    .filter(k => moodCount[k] > 0)
    .map(k => `<span class="sm-item">${MOOD_MAP[k].emoji} ×${moodCount[k]}</span>`)
    .join('');

  const groupHtml = (title, icon, map, cls) => {
    const arr = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    if (!arr.length) return '';
    return `<div class="sum-group ${cls}">
              <div class="sum-group-title">${icon} ${title}</div>
              ${arr.map(([k, n]) => `<div class="sum-line"><span class="sum-k">${esc(k)}</span><span class="sum-n">×${n}</span></div>`).join('')}
            </div>`;
  };

  // 填写型明细（最多展示全部，按日期倒序）
  const textHtml = textItems.length
    ? `<div class="sum-texts">
         <div class="sum-group-title">📝 填写内容</div>
         ${textItems.map(t =>
           `<div class="sum-text ${t.neg ? 'neg' : ''}"><b>${esc(t.label)}（${shortDate(t.date)}）：</b>${esc(t.value)}</div>`
         ).join('')}
       </div>`
    : '';

  return `<div class="sum-card">
            <div class="sum-overview">
              <div><span class="sum-big">${rows.length}</span><span class="sum-sub">条记录</span></div>
              <div><span class="sum-big">★${avg.toFixed(1)}</span><span class="sum-sub">平均星级</span></div>
              <div class="sum-range">${rangeTxt}</div>
            </div>
            <div class="sum-moods">${moodLine || '<span class="text-muted">暂无心情数据</span>'}</div>
            ${groupHtml('积极表现', '🌟', posMap, 'pos')}
            ${groupHtml('需要加油', '💧', negMap, 'neg')}
            ${textHtml}
            <div class="sum-comment-n">老师评语 <b>${commentCount}</b> 条（见逐日明细）</div>
          </div>`;
}

function shortDate(ymd) {
  const [, m, d] = String(ymd).split('-').map(Number);
  return `${m}/${d}`;
}

function renderRecordCard(r) {
  const stars = '★'.repeat(r.self_evaluation) + '☆'.repeat(5 - r.self_evaluation);
  const mood = MOOD_MAP[r.behavior && r.behavior.mood];

  let itemsHtml = '';
  const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items : [];
  if (items.length) {
    itemsHtml = '<ul class="item-list">';
    items.forEach(it => {
      const label = esc(it.label || '');
      const neg = it.category === 'negative';
      const liCls = neg ? ' class="item-neg"' : '';
      const tick = neg ? '<span class="neg-tick">!</span>' : '<span class="tick">✓</span>';
      if (it.type === 'text') {
        itemsHtml += `<li${liCls}><b>${label}：</b>${esc(it.value || '')}</li>`;
      } else if (it.value) {
        itemsHtml += `<li${liCls}>${tick}${label} <span class="item-sub">· ${esc(it.value)}</span></li>`;
      } else {
        itemsHtml += `<li${liCls}>${tick}${label}</li>`;
      }
    });
    itemsHtml += '</ul>';
  }

  const comment = (r.teacher_comment || '').trim();
  const commentHtml = comment
    ? `<div class="comment-box"><span class="comment-label">老师评语：</span>${esc(comment)}</div>`
    : '';

  return `<div class="rec-card">
            <div class="rec-topline">
              <span>${mood ? mood.emoji + ' ' + mood.label : ''}</span>
              <span class="rec-time">${formatTime(r.create_at)}</span>
            </div>
            <div class="rec-main">
              <span class="stars-mini">${stars}</span>
            </div>
            ${itemsHtml}
            ${commentHtml}
          </div>`;
}

/* ---------------- 二维码 ---------------- */

let qrRefreshTimer;
function openQrModal() {
  els.qrClass.value = (lockedClass || els.inpClass.value || '').trim();
  els.qrModal.classList.add('show');
  refreshQr();
}
function closeQrModal() {
  els.qrModal.classList.remove('show');
  history.replaceState(null, '', location.pathname + location.search);
}

// 班级级链接：只带 class，全班家长通用
function buildQrLink() {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('class', els.qrClass.value.trim());
  return url.toString();
}

function refreshQr() {
  const cls = els.qrClass.value.trim();
  els.qrImage.innerHTML = '';
  if (!cls) {
    els.qrImage.hidden = true;
    els.qrLink.textContent = '请先填写班级';
    return;
  }
  const link = buildQrLink();
  els.qrLink.textContent = link;
  els.qrImage.hidden = false;
  try {
    // 本地二维码库（MIT 许可）：向容器内插入 canvas；480px 便于打印/放大
    new window.QRCode(els.qrImage, {
      text: link,
      width: 480,
      height: 480,
      colorDark: '#26332e',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } catch (e) {
    els.qrImage.hidden = true;
    toast('二维码生成失败，可直接复制链接转发');
  }
}
function refreshQrDebounced() {
  clearTimeout(qrRefreshTimer);
  qrRefreshTimer = setTimeout(refreshQr, 350);
}

async function copyQrLink() {
  const text = els.qrLink.textContent;
  if (!text.startsWith('http')) { toast('请先填写班级'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('链接已复制，可发到家长群');
  } catch (e) {
    // 旧浏览器兜底
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('链接已复制，可发到家长群'); }
    catch (err) { window.prompt('请手动复制链接：', text); }
    document.body.removeChild(ta);
  }
}

// 下载二维码为 PNG（可打印张贴）
function downloadQr() {
  const cls = els.qrClass.value.trim();
  if (!cls) { toast('请先填写班级'); return; }
  const canvas = els.qrImage.querySelector('canvas');
  if (!canvas) { toast('二维码还没生成好，请稍候再试'); return; }
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `家长查询二维码-${cls}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    window.open(canvas.toDataURL('image/png'), '_blank');
  }
}

/* ---------------- 工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const isToday = y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate();
  return `${m}月${d}日 星期${WEEK[date.getDay()]}${isToday ? '（今天）' : ''}`;
}
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
