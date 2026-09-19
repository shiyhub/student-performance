/**
 * 教师后台逻辑
 * 权限：Supabase Auth 登录（authenticated），三张表全部读写权限
 * Supabase SDK 通过 js/vendor/supabase.js 本地引入（全局 window.supabase）
 */
const supabase = window.supabase
  ? window.supabase.createClient(
      window.SUPABASE_CONFIG.url,
      window.SUPABASE_CONFIG.anonKey,
      { auth: { persistSession: true, autoRefreshToken: true } }
    )
  : null;
const ready = !!supabase &&
  !String(window.SUPABASE_CONFIG.url || '').includes('YOUR_PROJECT_REF');

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const MOOD_MAP = {
  happy:  { emoji: '😄', label: '很棒' },
  good:   { emoji: '🙂', label: '不错' },
  normal: { emoji: '😐', label: '一般' },
  sad:    { emoji: '😢', label: '加油' }
};
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const els = {
  loginView: $('#loginView'),
  appView: $('#appView'),
  loginForm: $('#loginForm'),
  inpEmail: $('#inpEmail'),
  inpPassword: $('#inpPassword'),
  loginError: $('#loginError'),
  btnLogin: $('#btnLogin'),
  userEmail: $('#userEmail'),
  btnLogout: $('#btnLogout'),
  // 记录
  filterClass: $('#filterClass'),
  filterDate: $('#filterDate'),
  filterKeyword: $('#filterKeyword'),
  btnSearch: $('#btnSearch'),
  btnClearFilter: $('#btnClearFilter'),
  recordBox: $('#recordBox'),
  // 名单
  addStudentForm: $('#addStudentForm'),
  addClass: $('#addClass'),
  addStudent: $('#addStudent'),
  addParent: $('#addParent'),
  classOptions: $('#classOptions'),
  studentBox: $('#studentBox'),
  // 标签
  addTagForm: $('#addTagForm'),
  addTagLabel: $('#addTagLabel'),
  addTagType: $('#addTagType'),
  tagBox: $('#tagBox')
};

const loaded = { students: false, tags: false };

init();

function init() {
  if (!ready) {
    els.loginError.textContent = '系统还没有连接数据库（Supabase 未配置），请先修改 js/config.js。';
    els.loginError.hidden = false;
    els.btnLogin.disabled = true;
    return;
  }

  els.loginForm.addEventListener('submit', onLogin);
  els.btnLogout.addEventListener('click', onLogout);

  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  els.btnSearch.addEventListener('click', loadRecords);
  els.btnClearFilter.addEventListener('click', () => {
    els.filterClass.value = '';
    els.filterDate.value = '';
    els.filterKeyword.value = '';
    loadRecords();
  });
  els.addStudentForm.addEventListener('submit', onAddStudent);
  els.addTagForm.addEventListener('submit', onAddTag);

  // 恢复登录会话
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) enterApp(data.session.user);
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) enterApp(session.user);
    if (event === 'SIGNED_OUT') leaveApp();
  });
}

/* ---------------- 登录 / 退出 ---------------- */

async function onLogin(e) {
  e.preventDefault();
  const email = els.inpEmail.value.trim();
  const password = els.inpPassword.value;
  if (!email || !password) return toast('请输入邮箱和密码');

  els.loginError.hidden = true;
  els.btnLogin.disabled = true;
  els.btnLogin.textContent = '登录中…';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    els.loginError.textContent = '登录失败：' + friendlyAuthError(error.message);
    els.loginError.hidden = false;
  }
  els.btnLogin.disabled = false;
  els.btnLogin.textContent = '登录';
}

async function onLogout() {
  await supabase.auth.signOut();
}

function enterApp(user) {
  els.loginView.hidden = true;
  els.appView.hidden = false;
  els.userEmail.textContent = user.email || '';
  loadClassesAndRecords();
}
function leaveApp() {
  els.appView.hidden = true;
  els.loginView.hidden = false;
  els.inpPassword.value = '';
  loaded.students = false;
  loaded.tags = false;
}

function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('#tabRecords').hidden = name !== 'records';
  $('#tabStudents').hidden = name !== 'students';
  $('#tabTags').hidden = name !== 'tags';
  if (name === 'students' && !loaded.students) loadStudents();
  if (name === 'tags' && !loaded.tags) loadTagsAdmin();
}

/* ---------------- 表现记录 ---------------- */

async function loadClassesAndRecords() {
  // 班级下拉来自学生名单
  const { data: students } = await supabase
    .from('student_info')
    .select('class')
    .order('class');
  const classes = Array.from(new Set((students || []).map(s => s.class))).sort();
  els.filterClass.innerHTML = '<option value="">全部班级</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  els.classOptions.innerHTML = classes.map(c => `<option value="${esc(c)}"></option>`).join('');
  loadRecords();
}

async function loadRecords() {
  els.recordBox.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载记录…</div>';

  let q = supabase
    .from('daily_record')
    .select('*')
    .order('record_date', { ascending: false })
    .order('create_at', { ascending: false })
    .limit(500);
  const cls = els.filterClass.value;
  const date = els.filterDate.value;
  const kw = els.filterKeyword.value.trim();
  if (cls) q = q.eq('class', cls);
  if (date) q = q.eq('record_date', date);
  if (kw) q = q.ilike('student_name', '%' + kw + '%');

  const { data, error } = await q;
  if (error) {
    els.recordBox.innerHTML = `<div class="banner banner-error">加载失败：${esc(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    els.recordBox.innerHTML = '<div class="empty">还没有符合条件的记录。</div>';
    return;
  }

  els.recordBox.innerHTML = data.map(r => renderRecordCard(r)).join('');

  // 绑定评语编辑
  $$('[data-edit-comment]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => startEditComment(btn.dataset.editComment));
  });
  $$('[data-save-comment]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => saveComment(btn.dataset.saveComment));
  });
  $$('[data-cancel-comment]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => cancelEditComment(btn.dataset.cancelComment));
  });
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
      if (it.type === 'text') {
        itemsHtml += `<li><b>${label}：</b>${esc(it.value || '')}</li>`;
      } else {
        itemsHtml += `<li><span class="tick">✓</span>${label}</li>`;
      }
    });
    itemsHtml += '</ul>';
  }

  const comment = (r.teacher_comment || '').trim();
  const commentBlock = comment
    ? `<div class="comment-saved" id="commentView-${r.id}">
         <div class="row">
           <span class="comment-label">评语：</span><span>${esc(comment)}</span>
         </div>
         <div class="row" style="margin-top:6px;">
           <button class="btn btn-ghost btn-sm edit-btn" data-edit-comment="${r.id}">修改评语</button>
         </div>
       </div>
       <div class="comment-editor" id="commentEdit-${r.id}" hidden>
         <textarea class="input" id="commentText-${r.id}" placeholder="给孩子写几句鼓励的话…">${esc(comment)}</textarea>
         <div class="comment-actions">
           <button class="btn btn-primary btn-sm" data-save-comment="${r.id}">保存</button>
           <button class="btn btn-ghost btn-sm" data-cancel-comment="${r.id}">取消</button>
         </div>
       </div>`
    : `<div class="no-comment" id="commentView-${r.id}">
         <button class="btn btn-ghost btn-sm" data-edit-comment="${r.id}">✏️ 添加教师评语</button>
       </div>
       <div class="comment-editor" id="commentEdit-${r.id}" hidden>
         <textarea class="input" id="commentText-${r.id}" placeholder="给孩子写几句鼓励的话…"></textarea>
         <div class="comment-actions">
           <button class="btn btn-primary btn-sm" data-save-comment="${r.id}">保存</button>
           <button class="btn btn-ghost btn-sm" data-cancel-comment="${r.id}">取消</button>
         </div>
       </div>`;

  return `<div class="rec-card">
            <div class="rec-meta">
              <span class="class-pill">${esc(r.class)}</span>
              <b>${esc(r.student_name)}</b>
              <span>${mood ? mood.emoji + ' ' + mood.label : ''}</span>
              <span class="rec-when">${formatDate(r.record_date)} ${formatTime(r.create_at)}</span>
            </div>
            <div class="rec-body">
              <span class="stars-mini" style="color:#f5b945;letter-spacing:2px;">${stars}</span>
            </div>
            ${itemsHtml}
            ${commentBlock}
          </div>`;
}

function startEditComment(id) {
  $('#commentView-' + id).hidden = true;
  $('#commentEdit-' + id).hidden = false;
  const ta = $('#commentText-' + id);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
function cancelEditComment(id) {
  $('#commentEdit-' + id).hidden = true;
  $('#commentView-' + id).hidden = false;
}
async function saveComment(id) {
  const val = $('#commentText-' + id).value.trim();
  const btn = $(`[data-save-comment="${id}"]`);
  btn.disabled = true;
  btn.textContent = '保存中…';
  const { error } = await supabase
    .from('daily_record')
    .update({ teacher_comment: val || null })
    .eq('id', id);
  if (error) {
    toast('保存失败：' + error.message);
    btn.disabled = false;
    btn.textContent = '保存';
    return;
  }
  toast('评语已保存');
  loadRecords();
}

/* ---------------- 学生名单管理 ---------------- */

async function loadStudents() {
  loaded.students = true;
  els.studentBox.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载名单…</div>';
  const { data, error } = await supabase
    .from('student_info')
    .select('*')
    .order('class')
    .order('student_name');
  if (error) {
    els.studentBox.innerHTML = `<div class="banner banner-error">加载失败：${esc(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    els.studentBox.innerHTML = '<div class="empty">名单还是空的，先在上方录入第一个学生吧。</div>';
    return;
  }

  const groups = new Map();
  data.forEach(s => {
    if (!groups.has(s.class)) groups.set(s.class, []);
    groups.get(s.class).push(s);
  });

  let html = '';
  Array.from(groups.keys()).sort().forEach(cls => {
    html += `<div class="roster-group">
               <h4>${esc(cls)} <span class="n">${groups.get(cls).length} 人</span></h4>`;
    groups.get(cls).forEach(s => {
      html += `<div class="roster-row">
                 <div class="roster-who">
                   <div class="sname">${esc(s.student_name)}</div>
                   <div class="pname">家长：${esc(s.parent_name)}</div>
                 </div>
                 <button class="icon-btn" title="生成家长查询二维码" data-qr-id="${s.id}">🔗</button>
                 <button class="icon-btn danger" title="删除学生" data-del-id="${s.id}">🗑️</button>
               </div>`;
    });
    html += '</div>';
  });
  els.studentBox.innerHTML = html;

  $$('[data-qr-id]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', () => {
      const s = data.find(x => x.id === btn.dataset.qrId);
      if (s) openStudentQr(s);
    });
  });
  $$('[data-del-id]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = data.find(x => x.id === btn.dataset.delId);
      if (!s) return;
      if (!confirm(`确定删除「${s.class} · ${s.student_name}」吗？\n（历史表现记录仍会保留，但该学生将无法再提交新记录、家长也无法再查询。）`)) return;
      const { error } = await supabase.from('student_info').delete().eq('id', s.id);
      if (error) { toast('删除失败：' + error.message); return; }
      toast('已删除');
      loadStudents();
      loadClassesAndRecords();
    });
  });
}

async function onAddStudent(e) {
  e.preventDefault();
  const cls = els.addClass.value.trim();
  const name = els.addStudent.value.trim();
  const parent = els.addParent.value.trim();
  if (!cls || !name || !parent) { toast('班级、学生姓名、家长姓名都要填写'); return; }

  const btn = els.addStudentForm.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '添加中…';
  const { error } = await supabase
    .from('student_info')
    .insert({ class: cls, student_name: name, parent_name: parent });
  btn.disabled = false;
  btn.textContent = '添加学生';
  if (error) {
    if (/unique|uq_student/i.test(error.message)) {
      toast('名单里已经有这个学生了（班级+学生+家长组合重复）');
    } else {
      toast('添加失败：' + error.message);
    }
    return;
  }
  toast('已添加：' + name);
  els.addStudent.value = '';
  els.addParent.value = '';
  els.addStudent.focus();
  if (loaded.students) loadStudents();
  loadClassesAndRecords();
}

function openStudentQr(s) {
  const url = new URL('parent.html', location.href);
  url.searchParams.set('class', s.class);
  url.searchParams.set('student', s.student_name);
  url.hash = 'qr';
  window.open(url.toString(), '_blank');
}

/* ---------------- 表现标签管理 ---------------- */

async function loadTagsAdmin() {
  loaded.tags = true;
  await renderTags();
}

async function renderTags() {
  els.tagBox.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载标签…</div>';
  const { data, error } = await supabase
    .from('behavior_tags')
    .select('*')
    .order('sort_order')
    .order('created_at');
  if (error) {
    els.tagBox.innerHTML = `<div class="banner banner-error">加载失败：${esc(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    els.tagBox.innerHTML = '<div class="empty">还没有标签，在上方添加第一个吧。</div>';
    return;
  }

  els.tagBox.innerHTML = data.map(t => `
    <div class="tag-edit-row" data-tag-id="${t.id}">
      <input type="text" class="tag-label" value="${esc(t.label)}" maxlength="30" placeholder="标签文字">
      <select class="tag-type">
        <option value="check"${t.tag_type === 'check' ? ' selected' : ''}>勾选型</option>
        <option value="text"${t.tag_type === 'text' ? ' selected' : ''}>填写型</option>
      </select>
      <label class="tag-off-toggle">
        <input type="checkbox" class="tag-active" ${t.is_active ? 'checked' : ''}> 启用
      </label>
      <input type="number" class="tag-sort" value="${Number(t.sort_order) || 0}" min="0" max="9999" title="排序，数字越小越靠前">
      <div class="tag-row-actions">
        <button class="btn btn-primary btn-sm tag-save">保存</button>
        <button class="btn btn-danger-ghost btn-sm tag-delete">删除</button>
      </div>
    </div>`).join('');

  $$('.tag-edit-row', els.tagBox).forEach(row => {
    const id = row.dataset.tagId;
    $('.tag-save', row).addEventListener('click', async () => {
      const label = $('.tag-label', row).value.trim();
      if (!label) return toast('标签文字不能为空');
      const btn = $('.tag-save', row);
      btn.disabled = true;
      btn.textContent = '…';
      const { error } = await supabase.from('behavior_tags').update({
        label,
        tag_type: $('.tag-type', row).value,
        is_active: $('.tag-active', row).checked,
        sort_order: parseInt($('.tag-sort', row).value, 10) || 0
      }).eq('id', id);
      btn.disabled = false;
      btn.textContent = '保存';
      if (error) { toast('保存失败：' + error.message); return; }
      toast('标签已更新');
    });
    $('.tag-delete', row).addEventListener('click', async () => {
      const label = $('.tag-label', row).value.trim();
      if (!confirm(`确定删除标签「${label}」吗？\n历史记录中已经使用的内容不受影响。`)) return;
      const { error } = await supabase.from('behavior_tags').delete().eq('id', id);
      if (error) { toast('删除失败：' + error.message); return; }
      toast('标签已删除');
      renderTags();
    });
  });
}

async function onAddTag(e) {
  e.preventDefault();
  const label = els.addTagLabel.value.trim();
  if (!label) return toast('请输入标签文字');
  const btn = els.addTagForm.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '添加中…';
  const { data, error } = await supabase
    .from('behavior_tags')
    .insert({ label, tag_type: els.addTagType.value, sort_order: Math.floor(Date.now() / 1000) % 1000 })
    .select('id');
  btn.disabled = false;
  btn.textContent = '添加标签';
  if (error) { toast('添加失败：' + error.message); return; }
  toast('已添加标签：' + label);
  els.addTagLabel.value = '';
  els.addTagLabel.focus();
  if (loaded.tags) renderTags();
}

/* ---------------- 工具 ---------------- */

function friendlyAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return '邮箱或密码不正确';
  if (/email not confirmed/i.test(msg)) return '邮箱尚未确认，请查收邀请邮件';
  return msg;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${m}月${d}日 周${WEEK[date.getDay()]}`;
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
