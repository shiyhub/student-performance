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
  down:   { emoji: '😟', label: '有点低落' },
  sad:    { emoji: '😢', label: '需要加油' }
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
  parentInputs: $('#parentInputs'),
  btnAddParentField: $('#btnAddParentField'),
  classOptions: $('#classOptions'),
  studentBox: $('#studentBox'),
  // 批量录入
  batchClass: $('#batchClass'),
  batchText: $('#batchText'),
  batchResult: $('#batchResult'),
  btnBatchCheck: $('#btnBatchCheck'),
  btnBatchImport: $('#btnBatchImport'),
  btnBatchClear: $('#btnBatchClear'),
  // 标签
  addTagForm: $('#addTagForm'),
  addTagLabel: $('#addTagLabel'),
  addTagType: $('#addTagType'),
  addTagCategory: $('#addTagCategory'),
  addTagOptions: $('#addTagOptions'),
  tagBox: $('#tagBox')
};

const loaded = { students: false, tags: false };
let batchParsed = [];   // 批量录入：检查通过、待导入的行

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
  // 填写型标签固定为积极分类
  els.addTagType.addEventListener('change', () => {
    if (els.addTagType.value === 'text') els.addTagCategory.value = 'positive';
    els.addTagCategory.disabled = els.addTagType.value === 'text';
  });

  // 单个录入：动态家长输入（至少 1 位，最多 10 位）
  renderParentFields(['']);
  els.btnAddParentField.addEventListener('click', () => {
    const n = $$('.parent-input', els.parentInputs).length;
    if (n >= 10) { toast('一位学生最多添加 10 位家长'); return; }
    addParentField('');
    const inputs = $$('.parent-input', els.parentInputs);
    inputs[inputs.length - 1].focus();
  });
  els.btnBatchCheck.addEventListener('click', onBatchCheck);
  els.btnBatchImport.addEventListener('click', onBatchImport);
  els.btnBatchClear.addEventListener('click', onBatchClear);
  // 修改统一班级或文本后，旧预览作废，需重新检查
  [els.batchClass, els.batchText].forEach(el => {
    el.addEventListener('input', () => {
      batchParsed = [];
      els.btnBatchImport.disabled = true;
      els.btnBatchImport.textContent = '② 确认导入';
      els.batchResult.innerHTML = '';
    });
  });

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
    .select('*, student_parent(id, parent_name)')
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
      const parents = (s.student_parent || [])
        .slice()
        .sort((a, b) => a.parent_name.localeCompare(b.parent_name, 'zh-Hans-CN'));
      const chips = parents.map(p =>
        `<span class="pchip">${esc(p.parent_name)}
           <button type="button" class="pchip-x" data-del-parent="${p.id}"
                   data-student="${esc(s.student_name)}" title="移除该家长">×</button>
         </span>`
      ).join('');
      html += `<div class="roster-row">
                 <div class="roster-who">
                   <div class="sname">${esc(s.student_name)}</div>
                   <div class="pchips" data-chips-for="${s.id}">
                     ${chips}
                     <button type="button" class="pchip-add" data-add-parent="${s.id}">＋家长</button>
                   </div>
                 </div>
                 <button class="icon-btn" title="生成家长查询二维码" data-qr-id="${s.id}">🔗</button>
                 <button class="icon-btn danger" title="删除学生" data-del-id="${s.id}">🗑️</button>
               </div>`;
    });
    html += '</div>';
  });
  els.studentBox.innerHTML = html;

  // 二维码
  $$('[data-qr-id]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', () => {
      const s = data.find(x => x.id === btn.dataset.qrId);
      if (s) openStudentQr(s);
    });
  });
  // 删除学生（家长关联由数据库级联删除）
  $$('[data-del-id]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = data.find(x => x.id === btn.dataset.delId);
      if (!s) return;
      if (!confirm(`确定删除「${s.class} · ${s.student_name}」及其全部家长吗？\n（历史表现记录仍会保留，但该学生将无法再提交新记录、家长也无法再查询。）`)) return;
      const { error } = await supabase.from('student_info').delete().eq('id', s.id);
      if (error) { toast('删除失败：' + error.message); return; }
      toast('已删除');
      loadStudents();
      loadClassesAndRecords();
    });
  });
  // 移除某位家长
  $$('[data-del-parent]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', async () => {
      const box = btn.closest('.pchips');
      const count = box.querySelectorAll('.pchip').length;
      if (count <= 1) {
        toast('至少要保留一位家长；可先点「＋家长」添加新家长，再移除这一位');
        return;
      }
      const pid = btn.dataset.delParent;
      if (!confirm(`确定移除家长「${btn.parentElement.textContent.replace('×','').trim()}」吗？\n移除后这位家长将无法再查询该生。`)) return;
      const { error } = await supabase.from('student_parent').delete().eq('id', pid);
      if (error) { toast('移除失败：' + error.message); return; }
      toast('已移除该家长');
      loadStudents();
    });
  });
  // 给学生添加家长（行内输入）
  $$('[data-add-parent]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', () => showAddParentRow(btn));
  });
}

// 在「＋家长」按钮位置展开一个输入框
function showAddParentRow(addBtn) {
  const studentId = addBtn.dataset.addParent;
  addBtn.outerHTML =
    `<span class="pchip-edit" data-edit-for="${studentId}">
       <input type="text" class="parent-inline-input" maxlength="20" placeholder="家长姓名">
       <button type="button" class="btn btn-primary btn-sm parent-ok">确定</button>
       <button type="button" class="btn btn-ghost btn-sm parent-cancel">取消</button>
     </span>`;
  const row = els.studentBox.querySelector(`[data-edit-for="${studentId}"]`);
  const input = $('.parent-inline-input', row);
  input.focus();
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); $('.parent-ok', row).click(); }
    if (ev.key === 'Escape') $('.parent-cancel', row).click();
  });
  $('.parent-cancel', row).addEventListener('click', () => loadStudents());
  $('.parent-ok', row).addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) { toast('请输入家长姓名'); return; }
    const { error } = await supabase
      .from('student_parent')
      .insert({ student_id: studentId, parent_name: name });
    if (error) {
      if (/uq_student_parent|unique/i.test(error.message)) {
        toast('这位家长已经在名单里了');
      } else {
        toast('添加失败：' + error.message);
      }
      return;
    }
    toast('已添加家长：' + name);
    loadStudents();
  });
}

/* ---------------- 单个录入：学生 + 多位家长 ---------------- */

function renderParentFields(values) {
  els.parentInputs.innerHTML = '';
  values.forEach(v => addParentField(v));
}

function addParentField(value) {
  const row = document.createElement('div');
  row.className = 'parent-field-row';
  row.innerHTML =
    `<input type="text" class="input parent-input" maxlength="20"
            placeholder="家长姓名（如：爸爸 李大明）" value="">
     <button type="button" class="parent-field-del" title="删除这一位">×</button>`;
  const input = $('.parent-input', row);
  input.value = value || '';
  $('.parent-field-del', row).addEventListener('click', () => {
    if ($$('.parent-input', els.parentInputs).length <= 1) {
      toast('至少填写一位家长');
      return;
    }
    row.remove();
  });
  els.parentInputs.appendChild(row);
}

async function onAddStudent(e) {
  e.preventDefault();
  const cls = els.addClass.value.trim();
  const name = els.addStudent.value.trim();
  const parents = $$('.parent-input', els.parentInputs)
    .map(i => i.value.trim())
    .filter(Boolean);
  if (!cls || !name) { toast('请填写班级和学生姓名'); return; }
  if (!parents.length) { toast('请至少填写一位家长姓名'); return; }
  // 去掉本次重复填写的同名家长
  const uniqParents = Array.from(new Set(parents));

  const btn = els.addStudentForm.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '添加中…';

  // 先建学生并拿回 id，再写家长关联
  const { data: stuData, error: stuErr } = await supabase
    .from('student_info')
    .insert({ class: cls, student_name: name })
    .select('id')
    .single();

  if (stuErr) {
    btn.disabled = false;
    btn.textContent = '添加学生';
    if (/uq_student|duplicate|unique/i.test(stuErr.message)) {
      toast('这个班已经有同名学生了，可在名单里直接给他「＋家长」');
    } else {
      toast('添加失败：' + stuErr.message);
    }
    return;
  }

  const parentRows = uniqParents.map(p => ({ student_id: stuData.id, parent_name: p }));
  const { error: pErr } = await supabase.from('student_parent').insert(parentRows);

  btn.disabled = false;
  btn.textContent = '添加学生';
  if (pErr) {
    toast('学生已添加，但部分家长保存失败：' + pErr.message);
  } else {
    toast(`已添加：${name}（${uniqParents.length} 位家长）`);
  }
  els.addStudent.value = '';
  renderParentFields(['']);
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

/* ---------------- 批量录入学生（每位学生家长数量不限） ---------------- */

// 解析粘贴文本：
//   统一班级非空：每行 = 学生姓名 + 1..N 位家长
//   统一班级为空：每行 = 班级 + 学生姓名 + 1..N 位家长
// 同一个学生分多行写不同家长会自动合并。
function parseBatchText(text, defaultClass) {
  const students = new Map();  // key: 班级|学生 → {class, student_name, parents:Set}
  const bad = [];
  const cls = (defaultClass || '').trim();

  function addStudent(key, rowClass, name, parents) {
    if (!students.has(key)) {
      students.set(key, { class: rowClass, student_name: name, parents: [] });
    }
    const rec = students.get(key);
    parents.forEach(p => { if (!rec.parents.includes(p)) rec.parents.push(p); });
  }

  text.split(/\r?\n/).forEach((line, idx) => {
    const lineNo = idx + 1;
    const raw = line.trim();
    if (!raw) return;  // 空行跳过

    // 依次按 制表符 / 中英文逗号 / 连续空白 切分
    const parts = raw.split(/\t|[，,]|\s+/).map(s => s.trim()).filter(Boolean);
    let rowClass, name, parents;

    if (cls) {
      // 统一班级：至少要有"学生 + 1 位家长"两列
      if (parts.length < 2) {
        bad.push({ lineNo, raw, reason: '需要至少两列：学生姓名 + 一位家长姓名' });
        return;
      }
      rowClass = cls; name = parts[0]; parents = parts.slice(1);
    } else {
      // 混班：至少要有"班级 + 学生 + 1 位家长"三列
      if (parts.length < 3) {
        bad.push({ lineNo, raw, reason: '未填统一班级时，每行至少三列：班级,学生姓名,一位家长姓名' });
        return;
      }
      rowClass = parts[0]; name = parts[1]; parents = parts.slice(2);
    }

    addStudent(`${rowClass}|${name}`, rowClass, name, parents);
  });

  return { students: Array.from(students.values()), bad };
}

function onBatchCheck() {
  const { students, bad } = parseBatchText(els.batchText.value || '', els.batchClass.value);
  batchParsed = students;
  els.btnBatchImport.disabled = students.length === 0;

  // 按班级分组统计
  const groups = new Map();
  students.forEach(r => {
    if (!groups.has(r.class)) groups.set(r.class, []);
    groups.get(r.class).push(r);
  });

  let html = '';
  if (students.length) {
    const totalParents = students.reduce((n, s) => n + s.parents.length, 0);
    const groupHtml = Array.from(groups.keys()).sort().map(c => {
      const list = groups.get(c);
      const pCount = list.reduce((n, s) => n + s.parents.length, 0);
      const preview = list.slice(0, 5)
        .map(s => `${esc(s.student_name)}（${s.parents.length}位家长）`).join('、');
      const more = list.length > 5 ? ` 等 ${list.length} 人` : '';
      return `<li><b>${esc(c)}</b>：${list.length} 名学生、${pCount} 位家长 —— ${preview}${more}</li>`;
    }).join('');
    html += `<div class="banner banner-success batch-preview">
               ✅ 检查通过，本次将导入 <b>${students.length}</b> 名学生、共 <b>${totalParents}</b> 位家长：
               <ul>${groupHtml}</ul>
               确认无误后点「② 确认导入」；已存在的学生和家长会自动跳过，新家长会追加到已有学生名下。
             </div>`;
  } else {
    html += '<div class="banner banner-error">没有可导入的有效行，请按格式粘贴名单。</div>';
  }
  if (bad.length) {
    html += `<div class="banner banner-error batch-bad">
               ⚠️ 有 <b>${bad.length}</b> 行无法识别，已排除（不影响其他行导入）：
               <ul>${bad.map(b => `<li>第 ${b.lineNo} 行「${esc(b.raw)}」——${esc(b.reason)}</li>`).join('')}</ul>
             </div>`;
  }
  els.batchResult.innerHTML = html;
}

async function onBatchImport() {
  if (!batchParsed.length) return;
  const btn = els.btnBatchImport;
  btn.disabled = true;
  btn.textContent = '导入中…';

  // 1) 确保所有学生都存在（已存在的靠唯一约束忽略）
  const studentRows = batchParsed.map(s => ({ class: s.class, student_name: s.student_name }));
  for (let i = 0; i < studentRows.length; i += 200) {
    const { error } = await supabase
      .from('student_info')
      .upsert(studentRows.slice(i, i + 200), {
        onConflict: 'class,student_name',
        ignoreDuplicates: true
      });
    if (error) {
      toast('导入失败（学生）：' + error.message);
      btn.disabled = false;
      btn.textContent = '② 确认导入';
      return;
    }
  }

  // 2) 重新读取学生与现有家长，建立映射
  const { data: existing, error: qerr } = await supabase
    .from('student_info')
    .select('id, class, student_name, student_parent(parent_name)');
  if (qerr) {
    toast('导入失败（读取名单）：' + qerr.message);
    btn.disabled = false;
    btn.textContent = '② 确认导入';
    return;
  }
  const idMap = new Map();           // 班级|学生 → id
  const existParents = new Set();    // id|家长姓名
  (existing || []).forEach(s => {
    idMap.set(`${s.class}|${s.student_name}`, s.id);
    (s.student_parent || []).forEach(p => existParents.add(`${s.id}|${p.parent_name}`));
  });

  // 3) 组装需要新增的家长关联
  const freshParents = [];
  let totalParentCount = 0;
  batchParsed.forEach(s => {
    const sid = idMap.get(`${s.class}|${s.student_name}`);
    if (!sid) return;
    s.parents.forEach(p => {
      totalParentCount++;
      if (!existParents.has(`${sid}|${p}`)) {
        freshParents.push({ student_id: sid, parent_name: p });
      }
    });
  });

  let lastError = null;
  for (let i = 0; i < freshParents.length; i += 200) {
    const { error } = await supabase
      .from('student_parent')
      .upsert(freshParents.slice(i, i + 200), {
        onConflict: 'student_id,parent_name',
        ignoreDuplicates: true
      });
    if (error) { lastError = error; break; }
  }

  btn.disabled = false;
  btn.textContent = '② 确认导入';
  if (lastError) {
    toast('部分家长导入失败：' + lastError.message);
    return;
  }

  toast(`导入完成：${batchParsed.length} 名学生；新增家长 ${freshParents.length} 位，跳过已有 ${totalParentCount - freshParents.length} 位`);
  els.batchText.value = '';
  els.batchResult.innerHTML = '';
  batchParsed = [];
  els.btnBatchImport.disabled = true;
  if (loaded.students) loadStudents();
  loadClassesAndRecords();
}

function onBatchClear() {
  els.batchText.value = '';
  els.batchResult.innerHTML = '';
  batchParsed = [];
  els.btnBatchImport.disabled = true;
  els.btnBatchImport.textContent = '② 确认导入';
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

  // 兼容旧数据
  data.forEach(t => {
    if (!Array.isArray(t.options)) t.options = [];
    if (t.category !== 'negative') t.category = 'positive';
  });

  els.tagBox.innerHTML = data.map(t => `
    <div class="tag-edit-row${t.category === 'negative' ? ' row-neg' : ''}" data-tag-id="${t.id}">
      <input type="text" class="tag-label" value="${esc(t.label)}" maxlength="30" placeholder="标签文字">
      <input type="text" class="tag-options" value="${esc((t.options || []).join(','))}"
             maxlength="200" placeholder="二级选项，逗号分隔（选填），如：数学课堂作业,语文课堂作业">
      <select class="tag-cat" title="分类（影响学生心情）">
        <option value="positive"${t.category === 'positive' ? ' selected' : ''}>积极</option>
        <option value="negative"${t.category === 'negative' ? ' selected' : ''}>消极</option>
      </select>
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
    const syncControls = () => {
      const isText = $('.tag-type', row).value === 'text';
      $('.tag-options', row).disabled = ($('.tag-type', row).value !== 'check');
      // 填写型固定为积极
      $('.tag-cat', row).disabled = isText;
      if (isText) $('.tag-cat', row).value = 'positive';
      row.classList.toggle('row-neg', $('.tag-cat', row).value === 'negative');
    };
    $('.tag-save', row).addEventListener('click', async () => {
      const label = $('.tag-label', row).value.trim();
      if (!label) return toast('标签文字不能为空');
      const tagType = $('.tag-type', row).value;
      const options = tagType === 'check'
        ? parseTagOptions($('.tag-options', row).value)
        : [];
      let category = $('.tag-cat', row).value === 'negative' ? 'negative' : 'positive';
      if (tagType === 'text') category = 'positive';
      const score = category === 'negative' ? -1 : 1;
      const btn = $('.tag-save', row);
      btn.disabled = true;
      btn.textContent = '…';
      const { error } = await supabase.from('behavior_tags').update({
        label,
        tag_type: tagType,
        options,
        category,
        score,
        is_active: $('.tag-active', row).checked,
        sort_order: parseInt($('.tag-sort', row).value, 10) || 0
      }).eq('id', id);
      btn.disabled = false;
      btn.textContent = '保存';
      if (error) { toast('保存失败：' + error.message); return; }
      toast('标签已更新');
    });
    // 类型 / 分类切换联动
    $('.tag-type', row).addEventListener('change', syncControls);
    $('.tag-cat', row).addEventListener('change', syncControls);
    syncControls();
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

// 解析二级选项文本：支持中英文逗号、顿号、换行/空格分隔；去重、限量、限长
function parseTagOptions(text) {
  const arr = String(text || '')
    .split(/[,，、\n\r;；\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const out = [];
  arr.forEach(s => {
    if (out.length >= 20) return;
    const v = s.slice(0, 20);
    if (!out.includes(v)) out.push(v);
  });
  return out;
}

async function onAddTag(e) {
  e.preventDefault();
  const label = els.addTagLabel.value.trim();
  if (!label) return toast('请输入标签文字');
  const btn = els.addTagForm.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '添加中…';
  const tagType = els.addTagType.value;
  const options = tagType === 'check' ? parseTagOptions(els.addTagOptions.value) : [];
  let category = els.addTagCategory.value === 'negative' ? 'negative' : 'positive';
  if (tagType === 'text') category = 'positive';
  const score = category === 'negative' ? -1 : 1;
  const { data, error } = await supabase
    .from('behavior_tags')
    .insert({
      label,
      tag_type: tagType,
      options,
      category,
      score,
      sort_order: Math.floor(Date.now() / 1000) % 1000
    })
    .select('id');
  btn.disabled = false;
  btn.textContent = '添加标签';
  if (error) { toast('添加失败：' + error.message); return; }
  toast('已添加标签：' + label);
  els.addTagLabel.value = '';
  els.addTagOptions.value = '';
  els.addTagCategory.value = 'positive';
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
