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
  qrStudent: $('#qrStudent'),
  qrImage: $('#qrImage'),
  qrLoading: $('#qrLoading'),
  qrLink: $('#qrLink'),
  btnCopyLink: $('#btnCopyLink'),
  btnQrClose: $('#btnQrClose')
};

init();

function init() {
  if (!ready) {
    els.configBanner.hidden = false;
    els.btnQuery.disabled = true;
    return;
  }

  // 老师转发的链接可预填班级、学生姓名（家长姓名必须当场手输）
  const params = new URLSearchParams(location.search);
  if (params.get('class')) els.inpClass.value = params.get('class').trim();
  if (params.get('student')) els.inpStudent.value = params.get('student').trim();

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
  els.qrStudent.addEventListener('input', refreshQrDebounced);
  els.btnCopyLink.addEventListener('click', copyQrLink);

  // 教师后台跳转过来时（#qr）自动弹出生成窗
  if (location.hash === '#qr') {
    setTimeout(openQrModal, 300);
  }
}

/* ---------------- 查询 ---------------- */

async function onQuery() {
  const cls = els.inpClass.value.trim();
  const student = els.inpStudent.value.trim();
  const parent = els.inpParent.value.trim();
  if (!cls || !student || !parent) {
    toast('班级、学生姓名、家长姓名都要填写哦');
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
      els.mismatchBanner.hidden = false;
      return;
    }
    renderResults(student, data);
  } catch (e) {
    toast('查询失败：' + ((e && e.message) || '请稍后再试'));
  } finally {
    els.btnQuery.disabled = false;
    els.btnQuery.textContent = '查询记录';
  }
}

/* ---------------- 渲染历史记录 ---------------- */

function renderResults(studentName, rows) {
  els.queryCard.hidden = true;
  els.resultCard.hidden = false;
  els.resultTitle.textContent = `${esc(studentName)} 的在校表现`;
  els.resultCount.textContent = `共 ${rows.length} 条记录`;

  // 按日期分组（RPC 已按日期、时间倒序返回）
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
  els.recordList.innerHTML = html;
  window.scrollTo({ top: 0 });
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
  els.qrClass.value = els.inpClass.value.trim();
  els.qrStudent.value = els.inpStudent.value.trim();
  els.qrModal.classList.add('show');
  refreshQr();
}
function closeQrModal() {
  els.qrModal.classList.remove('show');
  history.replaceState(null, '', location.pathname + location.search);
}

function buildQrLink() {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('class', els.qrClass.value.trim());
  url.searchParams.set('student', els.qrStudent.value.trim());
  return url.toString();
}

function refreshQr() {
  const cls = els.qrClass.value.trim();
  const student = els.qrStudent.value.trim();
  els.qrImage.innerHTML = '';
  if (!cls || !student) {
    els.qrImage.hidden = true;
    els.qrLink.textContent = '请先填写班级和学生姓名';
    return;
  }
  const link = buildQrLink();
  els.qrLink.textContent = link;
  els.qrImage.hidden = false;
  try {
    // 本地二维码库（MIT 许可）：向容器内插入 canvas
    new window.QRCode(els.qrImage, {
      text: link,
      width: 260,
      height: 260,
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
  if (!text.startsWith('http')) { toast('请先填写班级和学生姓名'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('链接已复制，可发给家长');
  } catch (e) {
    // 旧浏览器兜底
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('链接已复制，可发给家长'); }
    catch (err) { window.prompt('请手动复制链接：', text); }
    document.body.removeChild(ta);
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
