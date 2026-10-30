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

/* ===== 返回导航（RSK-10）：浏览器返回键 / 手机返回手势 → 返回上一级菜单 =====
 * 教师端：弹窗（表现记录/班级码/学生码）打开时 push 一层 history，
 * 返回键/手势按 UI 状态关闭弹窗；主界面（无弹窗）不拦截，正常退出。
 */
const Nav = (() => {
  let depth = 0, ready = false;
  const marks = [];
  function enable() { ready = true; }
  function push(mark) {
    if (!ready) return;
    if (marks.length && marks[marks.length - 1] === mark) return;
    marks.push(mark); depth++;
    try { history.pushState({ d: depth }, ''); } catch (e) {}
  }
  function onPop(e) {
    if (e.state && typeof e.state.d === 'number') depth = Math.max(0, e.state.d);
    depth = Math.max(0, depth - 1);
    if (marks.length) marks.pop();
    NavBack();
  }
  return { enable, push, onPop };
})();
window.addEventListener('popstate', e => Nav.onPop(e));

function NavBack() {
  if (els.recordModal.classList.contains('show')) { closeRecordModal(); return true; }
  if (els.classQrModal.classList.contains('show')) { closeClassQr(); return true; }
  if (els.studentQrModal.classList.contains('show')) { closeStudentQr(); return true; }
  return false;   // 主界面/登录页：不拦截
}

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
  // 班级家长查询二维码
  classQrModal: $('#classQrModal'),
  classQrTitle: $('#classQrTitle'),
  classQrImage: $('#classQrImage'),
  classQrLink: $('#classQrLink'),
  btnClassQrClose: $('#btnClassQrClose'),
  btnClassQrCopy: $('#btnClassQrCopy'),
  btnClassQrDownload: $('#btnClassQrDownload'),
  // 学生个人密码 + 专属二维码
  studentQrModal: $('#studentQrModal'),
  stuQrTitle: $('#stuQrTitle'),
  stuCodeValue: $('#stuCodeValue'),
  btnStuGenCode: $('#btnStuGenCode'),
  stuQrImage: $('#stuQrImage'),
  stuQrLink: $('#stuQrLink'),
  btnStuQrClose: $('#btnStuQrClose'),
  btnStuQrCopy: $('#btnStuQrCopy'),
  btnStuQrDownload: $('#btnStuQrDownload'),
  // 批量录入
  batchClass: $('#batchClass'),
  batchText: $('#batchText'),
  awardResult: $('#awardResult'),
  btnBatchCheck: $('#btnBatchCheck'),
  btnBatchImport: $('#btnBatchImport'),
  btnBatchClear: $('#btnBatchClear'),
  // 标签
  addTagForm: $('#addTagForm'),
  addTagLabel: $('#addTagLabel'),
  addTagCategory: $('#addTagCategory'),
  addTagRepeat: $('#addTagRepeat'),
  addTagOptions: $('#addTagOptions'),
  addTagXp: $('#addTagXp'),
  tagBox: $('#tagBox'),
  // 自动化任务（五维经验自动加分）
  autoRuleForm: $('#autoRuleForm'),
  autoRuleName: $('#autoRuleName'),
  autoRuleType: $('#autoRuleType'),
  autoRuleTag: $('#autoRuleTag'),
  autoRuleDim: $('#autoRuleDim'),
  autoRuleXp: $('#autoRuleXp'),
  autoRuleStart: $('#autoRuleStart'),
  autoRuleEnd: $('#autoRuleEnd'),
  autoRuleWeek: $('#autoRuleWeek'),
  autoBox: $('#autoBox'),
  // 手动分配任务（值班/分工）
  manualTaskClass: $('#manualTaskClass'),
  manualTaskTag: $('#manualTaskTag'),
  manualTaskDate: $('#manualTaskDate'),
  manualStudentBox: $('#manualStudentBox'),
  manualTaskBox: $('#manualTaskBox'),
  // 个人任务（教师自定义内容）
  personalTaskContent: $('#personalTaskContent'),
  personalTaskClass: $('#personalTaskClass'),
  personalTaskDim: $('#personalTaskDim'),
  personalTaskXp: $('#personalTaskXp'),
  personalTaskDate: $('#personalTaskDate'),
  personalTaskDeadline: $('#personalTaskDeadline'),
  personalStudentBox: $('#personalStudentBox'),
  personalTaskBox: $('#personalTaskBox'),
  // 挑战任务（档位制）
  challengeTitle: $('#challengeTitle'),
  challengeClass: $('#challengeClass'),
  challengeDim: $('#challengeDim'),
  challengeDate: $('#challengeDate'),
  challengeStudentBox: $('#challengeStudentBox'),
  challengeTaskBox: $('#challengeTaskBox'),
  challengeLevelBox: $('#challengeLevelBox'),
  // 测试工具
  btnRecalcXp: $('#btnRecalcXp'),
  recalcResult: $('#recalcResult'),
  previewClass: $('#previewClass'),
  xpLogClass: $('#xpLogClass'),
  xpLogStudent: $('#xpLogStudent'),
  xpLogResult: $('#xpLogResult'),
  btnXpLogQuery: $('#btnXpLogQuery'),
  btnInjectXpLog: $('#btnInjectXpLog'),
  injectXpLogResult: $('#injectXpLogResult'),
  btnXpAnomaly: $('#btnXpAnomaly'),
  xpAnomalyHint: $('#xpAnomalyHint'),
  xpAnomalyList: $('#xpAnomalyList'),
  btnAllXpLogs: $('#btnAllXpLogs'),
  btnXpAnomalyZone: $('#btnXpAnomalyZone'),
  xpAnomalyZoneBadge: $('#xpAnomalyZoneBadge'),
  xpAnomalyZoneList: $('#xpAnomalyZoneList'),
  previewStudent: $('#previewStudent'),
  btnPreviewStudent: $('#btnPreviewStudent'),
  // 新增 / 修改记录
  btnAddRecord: $('#btnAddRecord'),
  recordModal: $('#recordModal'),
  recordModalTitle: $('#recordModalTitle'),
  recClassField: $('#recClassField'),
  recClass: $('#recClass'),
  recStudentField: $('#recStudentField'),
  recStudent: $('#recStudent'),
  recDate: $('#recDate'),
  recStars: $('#recStars'),
  recMood: $('#recMood'),
  recTags: $('#recTags'),
  recComment: $('#recComment'),
  recError: $('#recError'),
  btnRecCancel: $('#btnRecCancel'),
  btnRecSave: $('#btnRecSave')
};

/* ---------- v107：统一离线层辅助（老师端） ---------- */
const isNetErr = e => !navigator.onLine || /fetch|network|Failed to fetch|NetworkError|Load failed|timeout/i.test((e && e.message) || '');
async function cacheRead(key, fetcher) {
  if (!window.Offline || !window.Offline.online) {
    const v = await window.Offline.get(key);
    return { data: v && v.data, fromCache: true };
  }
  try {
    const res = await fetcher();
    if (res && !res.error) await window.Offline.set(key, { data: res.data });
    return res;
  } catch (e) {
    const v = await window.Offline.get(key);
    return { data: v && v.data, fromCache: true };
  }
}
async function syncRunner(op) {
  const p = op.params || {};
  try {
    if (op.name === 'submit_task') { const r = await supabase.rpc('submit_task', p); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'task_insert') { const r = await supabase.from('daily_task').insert(p); return { ok: !r.error, error: r.error }; }
    if (op.name === 'task_update') { const r = await supabase.from('daily_task').update(p.data).eq('id', p.id); return { ok: !r.error, error: r.error }; }
    if (op.name === 'task_delete') { const r = await supabase.rpc('delete_daily_task', { p_task_id: p.p_task_id }); return { ok: !r.error, error: r.error }; }
    if (op.name === 'delete_manual_task') { const r = await supabase.rpc('delete_manual_task', { p_task_id: p.p_task_id }); return { ok: !r.error, error: r.error }; }
    if (op.name === 'create_manual_tasks') { const r = await supabase.rpc('create_manual_tasks', p); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'create_personal_tasks') { const r = await supabase.rpc('create_personal_tasks', p); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'delete_personal_task') { const r = await supabase.rpc('delete_personal_task', { p_task_id: p.p_task_id }); return { ok: !r.error, error: r.error }; }
    if (op.name === 'delete_personal_tasks') { const r = await supabase.rpc('delete_personal_tasks', { p_task_ids: p.p_task_ids }); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'teacher_fill_personal_task') { const r = await supabase.rpc('teacher_fill_personal_task', { p_task_id: p.p_task_id }); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'create_challenge_tasks') { const r = await supabase.rpc('create_challenge_tasks', p); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'delete_challenge_task') { const r = await supabase.rpc('delete_challenge_task', { p_task_id: p.p_task_id }); return { ok: !r.error, error: r.error }; }
    if (op.name === 'delete_challenge_tasks') { const r = await supabase.rpc('delete_challenge_tasks', { p_task_ids: p.p_task_ids }); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'cancel_challenge_submission') { const r = await supabase.rpc('cancel_challenge_submission', { p_submission_id: p.p_submission_id }); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'teacher_home_reply') { const r = await supabase.from('home_note_reply').insert(p); return { ok: !r.error, error: r.error }; }
    if (op.name === 'exam_save') {
      const { fileName, imageBlob } = p;
      const { error: upErr } = await supabase.storage
        .from('exam-papers')
        .upload(fileName, imageBlob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      if (upErr) return { ok: false };
      const { data: pub } = supabase.storage.from('exam-papers').getPublicUrl(fileName);
      if (!pub || !pub.publicUrl) return { ok: false };
      const r = await supabase.from('exam_paper').insert(Object.assign({ image_url: pub.publicUrl }, p));
      return { ok: !r.error, error: r.error };
    }
    if (op.name === 'exam_delete') {
      if (p.path) { await supabase.storage.from('exam-papers').remove([p.path]); }
      const r = await supabase.from('exam_paper').delete().eq('id', p.id);
      return { ok: !r.error, error: r.error };
    }
    if (op.name === 'seat_save') {
      const del = await supabase.from('seat_grid').delete().eq('class', p.class);
      if (del.error) return { ok: false };
      if (p.rows.length) { const up = await supabase.from('seat_grid').upsert(p.rows); if (up.error) return { ok: false }; }
      return { ok: true };
    }
  } catch (e) { throw e; }
  return { ok: false };
}
async function runWrite(op) {
  if (!window.Offline || !window.Offline.online) {
    await window.Offline.enqueue(op);
    return { ok: true, queued: true };
  }
  try {
    const r = await syncRunner(op);
    if (r.ok) return { ok: true, queued: false, res: r.data };
    // SDK 网络失败不抛异常，而是返回 {data:null,error}（如 'Failed to fetch'）→ 同样自动入队，不丢数据
    if (isNetErr(r.error)) { await window.Offline.enqueue(op); return { ok: true, queued: true }; }
    return { ok: false, queued: false };
  } catch (e) {
    if (isNetErr(e)) { await window.Offline.enqueue(op); return { ok: true, queued: true }; }
    return { ok: false, queued: false };
  }
}
async function flushOfflineQueue() {
  if (!window.Offline || !window.Offline.online) return;
  const n = await window.Offline.drain(syncRunner);
  if (n > 0) { toast('📡 已同步 ' + n + ' 条离线操作'); loadTaskReport(); }
}
let teacherBanner = null;
function ensureOfflineBanner() {
  if (teacherBanner || !document.body) return;
  teacherBanner = document.createElement('div');
  teacherBanner.id = 'offlineBanner';
  teacherBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#4e6b5c;color:#fff;text-align:center;font-size:13px;padding:6px 10px;box-shadow:0 2px 6px rgba(0,0,0,.15);';
  teacherBanner.textContent = '📴 离线模式：显示本地缓存，批改/发布会先保存，联网后自动同步';
  teacherBanner.hidden = true;
  document.body.appendChild(teacherBanner);
}
if (window.Offline) {
  window.Offline.subscribe(v => {
    ensureOfflineBanner();
    if (teacherBanner) teacherBanner.hidden = v;
    if (v) flushOfflineQueue();
  });
}
window.TeacherSync = async () => { await flushOfflineQueue(); };
function saveLocalSession(user) {
  if (window.Offline && document.body) window.Offline.mountBadge();
  try { localStorage.setItem('sp_teacher_session', JSON.stringify({ email: user.email, ts: Date.now() })); } catch (e) {}
}

const loaded = { students: false, tags: false };
// 供"帮学生记录"弹窗复用的缓存
const cache = { students: [], tags: [] };
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
  const precacheBtn = document.getElementById('btnPrecache');
  if (precacheBtn) precacheBtn.addEventListener('click', () => runPrecache('手动'));

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
  els.btnAddRecord.addEventListener('click', () => openRecordModal('create'));
  els.btnRecCancel.addEventListener('click', closeRecordModal);
  els.recordModal.addEventListener('click', e => { if (e.target === els.recordModal) closeRecordModal(); });
  els.btnRecSave.addEventListener('click', saveRecordModal);
  els.recClass.addEventListener('change', fillRecStudents);
  els.addStudentForm.addEventListener('submit', onAddStudent);
  els.addTagForm.addEventListener('submit', onAddTag);

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
  // 测试工具
  if (els.btnRecalcXp) els.btnRecalcXp.addEventListener('click', onRecalcXp);
  if (els.previewClass) els.previewClass.addEventListener('change', fillPreviewStudents);
  if (els.xpLogClass) els.xpLogClass.addEventListener('change', () => { fillXpLogStudents(); if (els.btnXpAnomalyZone) loadXpAnomalyZone(); });
  if (els.btnXpLogQuery) els.btnXpLogQuery.addEventListener('click', queryXpLog);
  if (els.btnInjectXpLog) els.btnInjectXpLog.addEventListener('click', injectXpLog);
  if (els.btnXpAnomaly) els.btnXpAnomaly.addEventListener('click', scanXpAnomaly);
  if (els.btnAllXpLogs) els.btnAllXpLogs.addEventListener('click', loadAllStudentLogs);
  if (els.btnXpAnomalyZone) els.btnXpAnomalyZone.addEventListener('click', loadXpAnomalyZone);
  if (els.btnPreviewStudent) els.btnPreviewStudent.addEventListener('click', openStudentPreview);
  // 班级家长查询二维码弹窗
  els.btnClassQrClose.addEventListener('click', closeClassQr);
  els.classQrModal.addEventListener('click', e => { if (e.target === els.classQrModal) closeClassQr(); });
  els.btnClassQrCopy.addEventListener('click', copyClassQrLink);
  els.btnClassQrDownload.addEventListener('click', downloadClassQr);
  // 学生个人密码/二维码弹窗
  els.btnStuGenCode.addEventListener('click', async () => {
    if (!stuQrCtx) return;
    if (!window.Offline || !window.Offline.online) { toast('当前离线，请联网后生成密码'); return; }
    const code = genAccessCode();
    try {
      const { data, error } = await supabase.rpc('set_student_code', {
        p_class: stuQrCtx.cls, p_student: stuQrCtx.name, p_code: code
      });
      if (error || data !== true) {
        toast('设置失败：' + ((error && error.message) || '仅登录教师可操作'));
        return;
      }
    } catch (e) {
      toast('设置失败：' + ((e && e.message) || '网络异常'));
      return;
    }
    els.stuCodeValue.textContent = code;
    renderStuQr(code);
    toast(`已生成新密码 ${code}，二维码已更新`);
  });
  els.btnStuQrClose.addEventListener('click', closeStudentQr);
  els.studentQrModal.addEventListener('click', e => { if (e.target === els.studentQrModal) closeStudentQr(); });
  els.btnStuQrCopy.addEventListener('click', copyStuQrLink);
  els.btnStuQrDownload.addEventListener('click', downloadStuQr);
  // 修改统一班级或文本后，旧预览作废，需重新检查
  [els.batchClass, els.batchText].forEach(el => {
    el.addEventListener('input', () => {
      batchParsed = [];
      els.btnBatchImport.disabled = true;
      els.btnBatchImport.textContent = '② 确认导入';
      els.awardResult.innerHTML = '';
    });
  });

  // 恢复登录会话（离线时用本机已登录会话）
  let localSession = null;
  try { localSession = JSON.parse(localStorage.getItem('sp_teacher_session') || 'null'); } catch (e) {}
  // v152：乐观会话恢复——有本地登录记录就先进入主界面，
  // 避免 Supabase Auth 请求偶发超时（学校网络不稳定）时卡在登录页。
  // 后台静默验证会话有效性；验证失败再自然处理。
  let appEntered = false;
  if (localSession && localSession.email) {
    enterApp({ email: localSession.email });
    appEntered = true;
  }
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      saveLocalSession(data.session.user);
      if (!appEntered) enterApp(data.session.user);
    } else if (!localSession && appEntered) {
      leaveApp();
    }
    // 有本地会话但远程session过期：不强制踢出，用户可继续用缓存数据
  }).catch(() => {
    // getSession请求失败（网络波动）：保留在主界面，不踢出，数据走离线缓存
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

  // v152：登录请求加15秒超时，网络错误自动重试1次（学校网络偶发波动）
  const doLogin = () => {
    const loginPromise = supabase.auth.signInWithPassword({ email, password });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('请求超时，请检查网络')), 15000)
    );
    return Promise.race([loginPromise, timeoutPromise])
      .catch(err => ({ data: null, error: { message: err.message || '网络错误' } }));
  };

  let result = await doLogin();
  // 网络错误自动重试1次
  if (result.error && isNetErr(result.error)) {
    els.btnLogin.textContent = '网络慢，重试中…';
    await new Promise(r => setTimeout(r, 1500));
    result = await doLogin();
  }

  const { data, error } = result;
  if (error) {
    els.loginError.textContent = '登录失败：' + friendlyAuthError(error.message);
    els.loginError.hidden = false;
  } else if (data && data.user) {
    saveLocalSession(data.user);
    enterApp(data.user);
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
  Nav.enable();   // RSK-10：登录成功，弹窗返回栈启用
  els.userEmail.textContent = user.email || '';
  loadClassesAndRecords();
  // v111：联网时自动全量预缓存（学校经常断网，保证离线体验与在线一致）
  setTimeout(() => { if (window.Precache && window.Offline && window.Offline.online) runPrecache('自动'); }, 1200);
}

/* ---------- v111：全量预缓存（联网时下载全校数据到本机） ---------- */
let precacheToastTimer = null;
async function runPrecache(from) {
  if (!window.Precache) return;
  if (window.Precache.running) { toast('预缓存正在后台进行中…'); return; }
  toast(from === '自动' ? '正在后台预缓存全校数据，断网也能完整使用…' : '开始预缓存全校数据…');
  const ok = await window.Precache.runTeacher(p => {
    if (!p.done || p.done === p.total) return;
    if (!precacheToastTimer && (p.done === 1 || p.done % Math.max(1, Math.round(p.total / 5)) === 0)) {
      precacheToastTimer = setTimeout(() => { precacheToastTimer = null; }, 2500);
      toast('📥 预缓存中 ' + p.done + '/' + p.total + '（' + (p.label || '') + '）');
    }
  });
  if (ok) {
    const okN = (window.Precache.lastResult && window.Precache.lastResult.ok) || 0;
    if (okN === 0) toast('📥 预缓存失败：所有数据都没能下载（可能当前离线），联网后会自动重试');
    else toast('📥 预缓存完成：' + okN + ' 项数据已存到本机，断网可完整使用 ✅');
  }
  else toast('预缓存未执行（可能正在运行或当前离线）');
}
function leaveApp() {
  try { localStorage.removeItem('sp_teacher_session'); } catch (e) {}
  els.appView.hidden = true;
  els.loginView.hidden = false;
  els.inpPassword.value = '';
  loaded.students = false;
  loaded.tags = false;
}

function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  // 逐页切换，元素缺失时不报错（防止缓存旧 HTML 与新 JS 不同步）
  const panes = {
    records: 'tabRecords', students: 'tabStudents', tags: 'tabTags', auto: 'tabAuto',
    personal: 'tabPersonal', challenge: 'tabChallenge',
    exam: 'tabExam', task: 'tabTask', batch: 'tabBatch', stats: 'tabStats', xpLog: 'tabXpLog', tools: 'tabTools', seat: 'tabSeat'
  };
  // ① 先处理显示与清空：非当前页双重隐藏（hidden + 内联 display 兜底）+ 清空动态内容容器，
  //    彻底防止旧模块 DOM 残留叠加到新页面上方；当前页解除隐藏
  Object.entries(panes).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (key !== name) {
      el.hidden = true;
      el.style.display = 'none';   // 内联样式兜底：即使 [hidden] 规则未生效也不叠加显示
      clearPaneDynamics(key);       // 清空该页动态渲染的内容容器（静态骨架表单保留）
    } else {
      el.style.display = '';
      el.hidden = false;
    }
  });
  // ② 切走即重置"已加载"缓存，保证切回时重新渲染完整内容，无残留无空白
  if (name !== 'students') loaded.students = false;
  if (name !== 'tags') loaded.tags = false;
  // ③ 渲染当前页
  if (name === 'records') loadClassesAndRecords();
  if (name === 'students' && !loaded.students) loadStudents();
  if (name === 'tags' && !loaded.tags) loadTagsAdmin();
  if (name === 'auto') loadAutoTab();
  if (name === 'personal') {
    if (!loaded.personal) { loaded.personal = true; initPersonalTaskForm(); }
    else { loadPersonalStudents(); loadPersonalTasks(); }
  }
  if (name === 'challenge') {
    if (!loaded.challenge) { loaded.challenge = true; initChallengeForm(); }
    else { loadChallengeStudents(); loadChallengeTasks(); }
  }
  if (name === 'exam' && window.TeacherExam) window.TeacherExam.activate();
  if (name === 'tools') fillPreviewClasses();
  if (name === 'task') activateTaskTab();
  if (name === 'batch') activateBatchTab();
  if (name === 'stats') activateStatsTab();
  if (name === 'xpLog') fillXpLogClasses();
  if (name === 'seat') activateSeatTab();
}

/* 各页 JS 动态渲染的内容容器（切走时清空，防止旧 DOM 残留；静态骨架表单保留不动）。
   exam 页由 TeacherExam.activate() 的闭包守卫控制渲染，清空会导致切回空白，故不参与清空；
   tools 页无大容器，切回时 fillPreviewClasses() 会重建下拉。 */
const PANE_DYNAMIC = {
  records: ['recordBox'],
  students: ['studentBox', 'batchResult'],
  tags: ['tagBox'],
  auto: ['autoBox', 'manualTaskBox', 'manualStudentBox'],
  personal: ['personalTaskBox', 'personalStudentBox'],
  challenge: ['challengeTaskBox', 'challengeStudentBox'],
  exam: [],
  task: ['taskReportBox', 'tagReportBox'],
  batch: ['awardOptionBox', 'awardDateChips', 'awardStudentBox', 'awardResult', 'taskGradeResult'],
  stats: ['statsOut'],
  tools: [],
  seat: ['seatBoard', 'seatPool']
};
function clearPaneDynamics(key) {
  (PANE_DYNAMIC[key] || []).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

/* ---------------- 表现记录 ---------------- */

async function loadClassesAndRecords() {
  // 班级下拉来自学生名单（离线用缓存）
  let students = null;
  try {
    const r = await supabase.from('student_info').select('class').order('class');
    students = r.data;
    if (!r.error && students) {
      try { await window.Offline.set('classes_all', { data: students }); } catch (e2) {}
    }
  } catch (e) { students = null; }
  if (!students) {
    try { const v = await window.Offline.get('classes_all'); students = (v && v.data) || []; } catch (e2) { students = []; }
  }
  const classes = Array.from(new Set((students || []).map(s => s.class))).sort();
  els.filterClass.innerHTML = '<option value="">全部班级</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  els.classOptions.innerHTML = classes.map(c => `<option value="${esc(c)}"></option>`).join('');
  loadRecords();
}

async function loadRecords() {
  const cls = els.filterClass.value;
  const date = els.filterDate.value;
  const kw = els.filterKeyword.value.trim();

  // v145(RSK-15)：教师端 SWR——缓存秒开 + 60s 新鲜期复用 + 后台静默刷新
  // （数据库在海外，弱网 RTT 高；教师频繁切换筛选，不再每次直连白等）
  const cacheKey = 't_recs_' + (cls || '?') + '_' + (date || '?') + '_' + (kw || '?');
  let cached = null;
  try { cached = await window.Offline.get(cacheKey); } catch (e) {}
  const invTs = Number(localStorage.getItem('t_recs_inv') || 0);
  const cacheValid = cached && cached.data && (!invTs || invTs <= (cached.ts || 0));
  if (cacheValid) {
    renderRecordList(cached.data, cached.notes);
    if (Date.now() - (cached.ts || 0) < 60 * 1000) return;   // 60s 内直接复用，不发网络
  } else {
    els.recordBox.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载记录…</div>';
  }

  let q = supabase
    .from('daily_record')
    .select('id, class, student_name, record_date, self_evaluation, behavior, teacher_comment, create_at')
    .order('record_date', { ascending: false })
    .order('create_at', { ascending: false })
    .limit(500);
  if (cls) q = q.eq('class', cls);
  if (date) q = q.eq('record_date', date);
  if (kw) q = q.ilike('student_name', '%' + kw + '%');

  // 在家表现（家长提交，仅老师可见）；v50：带上回复线程（教师评论/家长多轮交流）
  let hq = supabase
    .from('home_note')
    .select('id, parent_name, content, record_date, create_at, student_info:student_id(class, student_name), replies:home_note_reply(id, sender, content, create_at)')
    .order('record_date', { ascending: false })
    .order('create_at', { ascending: false })
    .limit(500);
  if (date) hq = hq.eq('record_date', date);
  if (kw) {
    // 关键字同时匹配内容 / 家长姓名；班级与学生在拿到数据后过滤（embed 字段不便直接过滤）
    hq = hq.or(`content.ilike.%${kw}%,parent_name.ilike.%${kw}%`);
  }

  const [recRes, homeRes] = await Promise.all([q, hq]);
  let data, notes;
  if (recRes.error || homeRes.error) {
    // v111：离线/失败 → 用全量预缓存（records_all_<cls> / notes_all_<cls>），前端过滤班级/日期/关键词
    let recRows = [], noteRows = [];
    const clsList = cls ? [cls] : [];
    if (!cls) {
      try { const v = await window.Offline.get('classes_all'); clsList.push(...Array.from(new Set(((v && v.data) || []).map(s => s.class)))); } catch (e2) {}
    }
    for (const c of clsList) {
      try {
        const v1 = await window.Offline.get('records_all_' + c);
        if (v1 && Array.isArray(v1.data)) recRows = recRows.concat(v1.data);
        const v2 = await window.Offline.get('notes_all_' + c);
        if (v2 && Array.isArray(v2.data)) noteRows = noteRows.concat(v2.data);
      } catch (e2) {}
    }
    if (!recRows.length && !noteRows.length) {
      const msg = (recRes && recRes.error && recRes.error.message) || '离线且暂无缓存';
      els.recordBox.innerHTML = `<div class="banner banner-error">加载失败：${esc(msg)}（离线且本机无预缓存，请联网后重试）</div>`;
      return;
    }
    data = recRows.filter(r =>
      (!cls || r.class === cls) &&
      (!date || r.record_date === date) &&
      (!kw || (r.student_name || '').includes(kw))
    );
    notes = noteRows.filter(n => {
      const info = n.student_info || {};
      if (cls && info.class !== cls) return false;
      if (kw && !(info.student_name || '').includes(kw)) return false;
      return true;
    });
  } else {
    data = recRes.data || [];
    // 在家表现按班级 / 学生关键字二次过滤（embed 字段）
    notes = (homeRes.data || []).filter(n => {
      const info = n.student_info || {};
      if (cls && info.class !== cls) return false;
      if (kw && !(info.student_name || '').includes(kw)) return false;
      return true;
    });
  }
  // v145：网络成功 → 写缓存（ts 供 TTL 与"操作后失效"判断；仅缓存当次筛选组合）
  try { await window.Offline.set(cacheKey, { data, notes, ts: Date.now() }); } catch (e) {}
  // v148：五维自动化规则按日结算（幂等，当天首次进入即触发一次，后台静默，失败不影响页面）
  try {
    const settleKey = 'auto_bonus_settled_' + new Date().toISOString().slice(0, 10);
    if (!localStorage.getItem(settleKey)) {
      localStorage.setItem(settleKey, '1');
      supabase.rpc('run_auto_bonus', {}).then(() => {}).catch(() => {});
    }
  } catch (e2) {}
  renderRecordList(data, notes);
}

// v145：教师端记录列表渲染（缓存秒开与网络结果共用同一渲染路径）
function renderRecordList(data, notes) {
  let html = '';
  if (notes.length) html += renderHomeNotes(notes);
  if (data.length) {
    html += '<div class="rec-section-title">📒 在校表现记录</div>';
    html += data.map(r => renderRecordCard(r)).join('');
  }
  if (!notes.length && !data.length) {
    html = '<div class="empty">还没有符合条件的记录。</div>';
  }
  els.recordBox.innerHTML = html;

  // 评语内联编辑
  $$('[data-edit-comment]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => startEditComment(btn.dataset.editComment));
  });
  $$('[data-save-comment]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => saveComment(btn.dataset.saveComment));
  });
  $$('[data-cancel-comment]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => cancelEditComment(btn.dataset.cancelComment));
  });
  // 修改整单 / 删除
  $$('[data-edit-rec]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => {
      const r = data.find(x => x.id === btn.dataset.editRec);
      if (r) openRecordModal('edit', r);
    });
  });
  $$('[data-del-rec]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => deleteRecord(btn.dataset.delRec));
  });
  $$('[data-del-note]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', () => deleteHomeNote(btn.dataset.delNote));
  });
  // v50：回复家长留言（多轮交流）
  $$('[data-reply-send]', els.recordBox).forEach(btn => {
    btn.addEventListener('click', async () => {
      const noteId = btn.dataset.replySend;
      const input = els.recordBox.querySelector(`[data-reply-input="${noteId}"]`);
      const content = (input && input.value || '').trim();
      if (!content) { toast('先输入回复内容'); return; }
      btn.disabled = true;
      const wr = await runWrite({ name: 'teacher_home_reply', params: { note_id: noteId, sender: 'teacher', content: content.slice(0, 500) } });
      btn.disabled = false;
      if (!wr.ok) { toast('回复失败，请重试'); return; }
      toast(wr.queued ? '已保存，联网后自动发送 ✅' : '已回复家长 ✅');
      invalidateRecCache();
      loadRecords();
    });
  });
  $$('[data-reply-input]', els.recordBox).forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const btn = els.recordBox.querySelector(`[data-reply-send="${inp.dataset.replyInput}"]`);
        if (btn) btn.click();
      }
    });
  });
}

// v145：教师端数据变更后使记录缓存失效（下次进入自动刷新，避免 60s 内看到旧数据）
function invalidateRecCache() {
  try { localStorage.setItem('t_recs_inv', String(Date.now())); } catch (e) {}
}

function renderHomeNotes(notes) {
  let html = '<div class="rec-section-title home">🏠 家长留言 · 在家表现<span class="n">仅老师可见</span></div>';
  notes.forEach(n => {
    const info = n.student_info || {};
    // v50：回复线程（按时间正序展示，教师评论 / 家长回复多轮交流）
    const replies = (n.replies || []).slice().sort((a, b) =>
      (a.create_at || '').localeCompare(b.create_at || ''));
    html += `<div class="rec-card home-card-row">
              <div class="rec-meta">
                <span class="class-pill">${esc(info.class || '')}</span>
                <b>${esc(info.student_name || '')}</b>
                <span class="home-who">👪 ${esc(n.parent_name)}</span>
                <span class="rec-when">${formatDate(n.record_date)} ${formatTime(n.create_at)}</span>
                <span class="rec-tools">
                  <button class="btn btn-ghost btn-sm danger-text" data-del-note="${n.id}">🗑️ 删除</button>
                </span>
              </div>
              <div class="home-content">${esc(n.content || '')}</div>
              <div class="home-replies">
                ${replies.map(r => `
                  <div class="home-reply ${r.sender === 'teacher' ? 't' : 'p'}">
                    <span class="hr-who">${r.sender === 'teacher' ? '👩‍🏫 老师' : '👪 家长'}</span>
                    <span class="hr-text">${esc(r.content || '')}</span>
                    <span class="hr-time">${formatTime(r.create_at)}</span>
                  </div>`).join('')}
              </div>
              <div class="home-reply-box">
                <input class="input" data-reply-input="${n.id}" placeholder="回复家长（可多次回复，家长能看到）" maxlength="500">
                <button class="btn btn-primary btn-sm" data-reply-send="${n.id}">回复</button>
              </div>
            </div>`;
  });
  return html;
}

async function deleteRecord(id) {
  if (!confirm('确定删除这条在校表现记录吗？删除后不可恢复。')) return;
  const { error } = await supabase.from('daily_record').delete().eq('id', id);
  if (error) { toast('删除失败：' + error.message); return; }
  toast('已删除');
  loadRecords();
  invalidateRecCache();
}

// 批量删除所选记录
document.getElementById('btnRecCheckAll')?.addEventListener('click', () => {
  const boxes = document.querySelectorAll('.rec-check');
  const anyUnchecked = [...boxes].some(b => !b.checked);
  boxes.forEach(b => b.checked = anyUnchecked);
});
document.getElementById('btnBatchDelRec')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.rec-check:checked')].map(b => b.value);
  if (!ids.length) return toast('请先勾选要删除的记录');
  if (!confirm(`确定删除选中的 ${ids.length} 条记录吗？删除后不可恢复，经验也会相应扣回。`)) return;
  const { error } = await supabase.from('daily_record').delete().in('id', ids);
  if (error) { toast('批量删除失败：' + error.message); return; }
  toast('已删除 ' + ids.length + ' 条');
  loadRecords();
  invalidateRecCache();
});

async function deleteHomeNote(id) {
  if (!confirm('确定删除这条家长留言吗？删除后不可恢复。')) return;
  const { error } = await supabase.from('home_note').delete().eq('id', id);
  if (error) { toast('删除失败：' + error.message); return; }
  toast('已删除');
  loadRecords();
  invalidateRecCache();
}

/* ---------------- 新增 / 修改记录弹窗 ---------------- */

const MOOD_LEVELS_T = [
  { key: 'sad',    emoji: '😢', label: '需要加油' },
  { key: 'down',   emoji: '😟', label: '有点低落' },
  { key: 'normal', emoji: '😐', label: '一般' },
  { key: 'good',   emoji: '🙂', label: '不错' },
  { key: 'happy',  emoji: '😄', label: '很棒' }
];
let recState = null;

function todayStrLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 学期口径（与 35 号 SQL 一致）：9月1日~次年1月7日为秋（2026秋），1月8日~8月31日为春（2027春）
function semOf(dateStr) {
  const s = String(dateStr || '');
  const md = s.slice(5, 10);   // MM-DD
  if (md >= '09-01') return s.slice(0, 4) + '秋';
  if (md >= '01-08') return s.slice(0, 4) + '春';
  return String(Number(s.slice(0, 4)) - 1) + '秋';   // 1月1-7日 → 上学年秋
}

async function openRecordModal(mode, record) {
  els.recError.hidden = true;
  els.recError.textContent = '';
  recState = {
    mode,
    id: record ? record.id : null,
    cls: record ? record.class : (els.filterClass.value || ''),
    student: record ? record.student_name : '',
    date: record ? record.record_date : todayStrLocal(),
    stars: record ? (Number(record.self_evaluation) || 0) : 5,
    tags: [],
    chosen: {},   // {tagId: true}
    option: {},   // {tagId: 二级选项}
    text: {},     // {tagId: 文本}
    preserved: [] // 编辑时：当前标签表里已不存在的历史 items，原样保留
  };

  // 确保名单 / 标签已加载
  await Promise.all([
    cache.students.length ? null : ensureStudents(),
    cache.tags.length ? null : ensureTags()
  ]);

  els.recordModalTitle.textContent = mode === 'edit' ? '修改这条表现记录' : '帮学生记录一条';
  els.recClassField.hidden = mode === 'edit';
  els.recStudentField.hidden = mode === 'edit';

  // 班级 / 学生下拉
  const classes = Array.from(new Set(cache.students.map(s => s.class))).sort();
  els.recClass.innerHTML = classes.map(c =>
    `<option value="${esc(c)}"${c === recState.cls ? ' selected' : ''}>${esc(c)}</option>`).join('');
  if (!recState.cls && classes.length) recState.cls = classes[0];
  els.recClass.value = recState.cls;
  fillRecStudents();
  if (mode === 'edit') {
    // 编辑态用静态文本展示学生
    els.recStudent.innerHTML = `<option>${esc(record.class)} · ${esc(record.student_name)}</option>`;
  } else if (recState.student) {
    els.recStudent.value = recState.student;
  }

  els.recDate.value = recState.date;
  els.recComment.value = record ? (record.teacher_comment || '') : '';

  // 预填历史 items
  if (record && record.behavior && Array.isArray(record.behavior.items)) {
    const liveIds = new Set(cache.tags.map(t => t.id));
    record.behavior.items.forEach(it => {
      if (!liveIds.has(it.id)) { recState.preserved.push(it); return; }
      if (it.type === 'text') {
        recState.chosen[it.id] = true;
        recState.text[it.id] = it.value || '';
      } else {
        recState.chosen[it.id] = true;
        if (it.value) {
          // v124(Bug-8)：同标签多值（历史/合并数据）收集为数组，编辑保存不丢其余项
          if (recState.option[it.id] === undefined) {
            recState.option[it.id] = it.value;
          } else if (Array.isArray(recState.option[it.id])) {
            if (!recState.option[it.id].includes(it.value)) recState.option[it.id].push(it.value);
          } else if (recState.option[it.id] !== it.value) {
            recState.option[it.id] = [recState.option[it.id], it.value];
          }
        }
      }
    });
  }

  renderRecStars();
  renderRecTags();
  updateRecMood();
  els.recordModal.classList.add('show');
  Nav.push('record');   // RSK-10：打开表现记录弹窗
}

function closeRecordModal() {
  els.recordModal.classList.remove('show');
  recState = null;
}

async function ensureStudents() {
  let data = null, error = null;
  try {
    const r = await supabase
      .from('student_info').select('id, class, student_name').order('class').order('student_name');
    data = r.data; error = r.error;
  } catch (e) { error = { message: 'offline' }; }
  if (!error && data) {
    cache.students = data;
    try { await window.Offline.set('students_roster', { data }); } catch (e2) {}
  } else {
    // 离线/失败：用最近一次缓存的名单
    try {
      const v = await window.Offline.get('students_roster');
      cache.students = (v && v.data) || [];
    } catch (e2) { cache.students = cache.students || []; }
  }
}
async function ensureTags() {
  let data = null, error = null;
  try {
    const r = await supabase
      .from('behavior_tags').select('*').eq('is_active', true)
      .order('sort_order').order('created_at');
    data = r.data; error = r.error;
  } catch (e) { error = { message: 'offline' }; }
  const norm = (data || []).map(t => {
    if (!Array.isArray(t.options)) t.options = [];
    if (t.category !== 'negative') t.category = 'positive';
    return t;
  });
  if (!error && data) {
    cache.tags = norm;
    try { await window.Offline.set('tags', { data: norm }); } catch (e2) {}
  } else {
    try {
      const v = await window.Offline.get('tags');
      cache.tags = (v && v.data) || [];
    } catch (e2) { cache.tags = cache.tags || []; }
  }
}

function fillRecStudents() {
  if (!recState) return;
  recState.cls = els.recClass.value;
  const list = cache.students.filter(s => s.class === recState.cls);
  els.recStudent.innerHTML = list.map(s =>
    `<option value="${esc(s.student_name)}">${esc(s.student_name)}</option>`).join('');
  if (recState.student && list.some(s => s.student_name === recState.student)) {
    els.recStudent.value = recState.student;
  } else {
    recState.student = list.length ? list[0].student_name : '';
  }
}

function renderRecStars() {
  els.recStars.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rec-star' + (i <= recState.stars ? '' : ' off');
    b.textContent = '★';
    b.addEventListener('click', () => {
      // 再点一次当前星级 = 清空（不打星）
      recState.stars = (recState.stars === i) ? 0 : i;
      renderRecStars();
    });
    els.recStars.appendChild(b);
  }
}

function recMoodLevel() {
  let lv = 3;
  recState.tags.forEach(t => {
    if (!recState.chosen[t.id]) return;
    if (t.tag_type === 'text' && !(recState.text[t.id] || '').trim()) return;
    lv += Number(t.score) || (t.category === 'negative' ? -1 : 1);
  });
  return Math.min(5, Math.max(1, lv));
}
function updateRecMood() {
  const m = MOOD_LEVELS_T[recMoodLevel() - 1];
  els.recMood.textContent = `${m.emoji} ${m.label}`;
  els.recMood.className = 'rec-mood lv' + recMoodLevel();
}

function renderRecTags() {
  const tags = cache.tags.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  recState.tags = tags;
  const pos = tags.filter(t => t.category !== 'negative');
  const neg = tags.filter(t => t.category === 'negative');

  const group = (title, list, cls) => {
    if (!list.length) return '';
    let h = `<div class="rec-tag-group ${cls}"><div class="rec-tag-title">${title}</div><div class="rec-tag-grid">`;
    list.forEach(t => {
      const active = !!recState.chosen[t.id];
      h += `<button type="button" class="rec-chip${active ? ' active' : ''} ${cls}" data-rec-tag="${t.id}">${esc(t.label)}</button>`;
    });
    h += '</div>';
    // 二级选项 + 文本框
    list.forEach(t => {
      if (!recState.chosen[t.id]) return;
      if (t.tag_type === 'text') {
        h += `<div class="rec-subblock" data-subfor="${t.id}">
                <input class="input rec-text-in" data-rec-text="${t.id}" maxlength="100"
                       value="${esc(recState.text[t.id] || '')}" placeholder="${esc(t.label)}：填写内容">
              </div>`;
      } else if (t.options && t.options.length) {
        h += `<div class="rec-subblock" data-subfor="${t.id}">
                <div class="rec-subrow">${t.options.map(o => {
                  const optV = recState.option[t.id];
                  const optSel = Array.isArray(optV) ? optV.includes(o) : optV === o;
                  return `<button type="button" class="rec-subchip${optSel ? ' active' : ''}"
                    data-rec-opt="${t.id}" data-opt-val="${esc(o)}">${esc(o)}</button>`;
                }).join('')}</div>
              </div>`;
      }
    });
    h += '</div>';
    return h;
  };

  let extra = '';
  if (recState.preserved.length) {
    extra = '<div class="rec-tag-group"><div class="rec-tag-title">历史标签（标签表中已停用/删除，将原样保留）</div><div class="rec-preserved">' +
      recState.preserved.map(it => {
        if (it.type === 'text') return `<span class="rec-chip active">${esc(it.label)}：${esc(it.value || '')}</span>`;
        return `<span class="rec-chip active ${it.category === 'negative' ? 'neg' : ''}">${esc(it.label)}${it.value ? ' · ' + esc(it.value) : ''}</span>`;
      }).join('') + '</div></div>';
  }

  els.recTags.innerHTML = group('🌟 积极表现', pos, 'pos') + group('💧 需要加油', neg, 'neg') + extra;

  $$('[data-rec-tag]', els.recTags).forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.recTag;
      if (recState.chosen[id]) {
        delete recState.chosen[id];
        delete recState.option[id];
        delete recState.text[id];
      } else {
        recState.chosen[id] = true;
      }
      renderRecTags();
      updateRecMood();
    });
  });
  $$('[data-rec-opt]', els.recTags).forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.recOpt;
      const cur = recState.option[id];
      if (Array.isArray(cur)) {
        // 历史多值：点击切换进/出集合
        const v = b.dataset.optVal;
        if (cur.includes(v)) { cur.splice(cur.indexOf(v), 1); if (!cur.length) delete recState.option[id]; }
        else cur.push(v);
      } else {
        recState.option[id] = b.dataset.optVal;   // 单选覆盖（保持原有交互）
      }
      renderRecTags();
    });
  });
  $$('[data-rec-text]', els.recTags).forEach(inp => {
    inp.addEventListener('input', () => {
      recState.text[inp.dataset.recText] = inp.value;
      updateRecMood();
    });
  });
}

function buildBehavior() {
  const items = [];
  recState.tags.forEach(t => {
    if (!recState.chosen[t.id]) return;
    if (t.tag_type === 'text') {
      const v = (recState.text[t.id] || '').trim();
      if (v) items.push({ id: t.id, label: t.label, type: 'text', value: v.slice(0, 100), category: t.category || 'positive' });
    } else {
      const opt = recState.option[t.id];
      if (Array.isArray(opt)) {
        if (t.options && t.options.length && !opt.length) return; // 二级选项必填
        opt.forEach(v => { if (v) items.push({ id: t.id, label: t.label, type: 'check', value: v, category: t.category || 'positive' }); });
        if (!opt.length) return;
      } else {
        const v = (opt || '').trim();
        if (t.options && t.options.length && !v) return; // 二级选项必填（保存前另有拦截）
        items.push({ id: t.id, label: t.label, type: 'check', value: v || null, category: t.category || 'positive' });
      }
    }
  });
  recState.preserved.forEach(it => items.push(it));
  const lv = recMoodLevel();
  return { mood: MOOD_LEVELS_T[lv - 1].key, items };
}

async function saveRecordModal() {
  // 校验
  if (recState.mode === 'create') {
    recState.cls = els.recClass.value;
    recState.student = els.recStudent.value;
    if (!recState.cls || !recState.student) {
      return showRecError('请选择班级和学生');
    }
  }
  if (!els.recDate.value) return showRecError('请选择日期');

  // 二级选项缺漏检查
  const missing = recState.tags.find(t =>
    recState.chosen[t.id] && t.tag_type === 'check' &&
    Array.isArray(t.options) && t.options.length &&
    (Array.isArray(recState.option[t.id]) ? !recState.option[t.id].length : !(recState.option[t.id] || '').trim()));
  if (missing) return showRecError(`请为「${missing.label}」选择一个具体项目`);

  const behavior = buildBehavior();
  // 空表现拦截：不允许保存空白日常记录（与后端 100 号兜底对应）
  if (!behavior.items || !behavior.items.length) {
    return showRecError('请至少选择一项表现，不能保存空白记录');
  }

  const payload = {
    record_date: els.recDate.value,
    semester: semOf(els.recDate.value),
    self_evaluation: recState.stars || null,
    behavior,
    teacher_comment: els.recComment.value.trim() || null
  };

  els.btnRecSave.disabled = true;
  els.btnRecSave.textContent = '保存中…';
  try {
    if (recState.mode === 'create') {
      payload.class = recState.cls;
      payload.student_name = recState.student;
      const { error } = await supabase.from('daily_record').insert(payload);
      if (error) throw error;
      toast('已新增记录');
    } else {
      const { error } = await supabase.from('daily_record').update(payload).eq('id', recState.id);
      if (error) throw error;
      toast('修改已保存');
      invalidateRecCache();
    }
    closeRecordModal();
    loadRecords();   // 方案A：班级列表未变，不再全量重查
  } catch (e) {
    showRecError('保存失败：' + ((e && e.message) || '请稍后再试'));
  } finally {
    els.btnRecSave.disabled = false;
    els.btnRecSave.textContent = '保存';
  }
}

function showRecError(msg) {
  els.recError.textContent = msg;
  els.recError.hidden = false;
}

function renderRecordCard(r) {
  const starCount = Number(r.self_evaluation) || 0;
  const stars = starCount
    ? '★'.repeat(starCount) + '☆'.repeat(5 - starCount)
    : '<span style="color:#98a69f;font-weight:600;">未打星</span>';
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
              <input type="checkbox" class="rec-check" value="${r.id}" title="选择">
              <span class="class-pill">${esc(r.class)}</span>
              <b>${esc(r.student_name)}</b>
              <span>${mood ? mood.emoji + ' ' + mood.label : ''}</span>
              <span class="rec-when">${formatDate(r.record_date)} ${formatTime(r.create_at)}</span>
              <span class="rec-tools">
                <button class="btn btn-ghost btn-sm" data-edit-rec="${r.id}">✏️ 修改</button>
                <button class="btn btn-ghost btn-sm danger-text" data-del-rec="${r.id}">🗑️ 删除</button>
              </span>
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
  invalidateRecCache();
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
  cache.students = data || [];
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
               <h4>
                 <span class="rg-title">${esc(cls)} <span class="n">${groups.get(cls).length} 人</span></span>
                 <button type="button" class="btn btn-ghost btn-sm class-qr-btn" data-qr-class="${esc(cls)}">📱 本班家长查询码</button>
               </h4>`;
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
      const lv = Number(s.level) || 1;
      const xp = Number(s.xp) || 0;
      html += `<div class="roster-row">
                 <div class="roster-who">
                   <div class="sname">${esc(s.student_name)}
                     <span class="xp-badge" title="经验 ${xp}">Lv${lv} · ${xp}XP</span>
                     <button type="button" class="btn btn-ghost btn-sm xp-edit" data-xp-id="${s.id}"
                             data-xp-class="${esc(s.class)}" data-xp-name="${esc(s.student_name)}"
                             data-xp-cur="${xp}" title="手动调整该学生经验">✏️ 调经验</button>
                     <button type="button" class="btn btn-ghost btn-sm stu-qr-btn"
                             data-stu-cls="${esc(s.class)}" data-stu-name="${esc(s.student_name)}"
                             title="设置密码并生成学生个人二维码">🔑 个人码</button>
                   </div>
                   <div class="pchips" data-chips-for="${s.id}">
                     ${chips}
                     <button type="button" class="pchip-add" data-add-parent="${s.id}">＋家长</button>
                   </div>
                 </div>
                 <button class="icon-btn danger" title="删除学生" data-del-id="${s.id}">🗑️</button>
               </div>`;
    });
    html += '</div>';
  });
  els.studentBox.innerHTML = html;

  // 班级家长查询二维码（一个班一个，全班通用）
  $$('[data-qr-class]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', () => openClassQr(btn.dataset.qrClass));
  });
  // 学生个人密码/二维码（离线时用缓存读取已设置密码）
  $$('[data-stu-cls]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', () => openStudentQr(btn.dataset.stuCls, btn.dataset.stuName));
  });
  try { window.Offline.set('students_roster_full', { data: data || [] }); } catch (e2) {}
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
  // 手动调整学生经验
  $$('[data-xp-id]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', async () => {
      const cur = Number(btn.dataset.xpCur) || 0;
      const input = prompt(`给「${btn.dataset.xpName}」设置经验值：\n（当前 ${cur} 点；等级会自动重算，Lv3=60 经验）`, String(cur));
      if (input == null) return;
      const newXp = parseInt(input, 10);
      if (isNaN(newXp) || newXp < 0) { toast('请输入 0 以上的数字'); return; }
      const { data, error } = await supabase.rpc('set_student_xp', {
        p_class: btn.dataset.xpClass,
        p_student: btn.dataset.xpName,
        p_xp: newXp
      });
      if (error) { toast('调整失败：' + error.message); return; }
      if (data && data.ok === false) { toast('没找到这个学生'); return; }
      toast(`已设为 ${data.xp} 经验（Lv${data.level}）`);
      invalidateRecCache();
      loadStudents();
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

/* ---------- 本班家长查询二维码（一个班一个，全班家长通用） ---------- */

function classParentLink(cls) {
  const url = new URL('parent.html', location.href);
  url.searchParams.set('class', cls);
  return url.toString();
}

function openClassQr(cls) {
  if (!cls) { toast('班级名称为空，无法生成'); return; }
  els.classQrTitle.textContent = `「${cls}」家长查询二维码`;
  els.classQrImage.innerHTML = '';
  const link = classParentLink(cls);
  els.classQrLink.textContent = link;
  try {
    new window.QRCode(els.classQrImage, {
      text: link,
      width: 480,
      height: 480,
      colorDark: '#26332e',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } catch (e) {
    toast('二维码生成失败，可直接复制链接');
  }
  els.classQrModal.classList.add('show');
  Nav.push('qr');   // RSK-10：打开班级二维码弹窗
}

function closeClassQr() {
  els.classQrModal.classList.remove('show');
}

/* ---------- 学生个人密码 + 专属二维码（老人扫码零输入） ---------- */

let stuQrCtx = null;   // { cls, name }

function genAccessCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function studentQrLink(cls, name, code) {
  const url = new URL('parent.html', location.href);
  url.searchParams.set('class', cls);
  url.searchParams.set('student', name);
  url.searchParams.set('code', code);
  return url.toString();
}

function renderStuQr(code) {
  els.stuQrLink.textContent = '';
  els.stuQrImage.innerHTML = '';
  if (!code || !stuQrCtx) {
    els.stuQrImage.innerHTML = '<p class="text-muted">尚未设置密码：点「🎲 生成新密码」后自动出二维码。</p>';
    return;
  }
  const link = studentQrLink(stuQrCtx.cls, stuQrCtx.name, code);
  els.stuQrLink.textContent = link;
  try {
    new window.QRCode(els.stuQrImage, {
      text: link,
      width: 480, height: 480,
      colorDark: '#26332e', colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } catch (e) {
    toast('二维码生成失败，可直接复制链接');
  }
}

async function openStudentQr(cls, name) {
  if (!cls || !name) { toast('学生信息为空'); return; }
  stuQrCtx = { cls, name };
  els.stuQrTitle.textContent = `${name} · 专属二维码`;
  els.stuCodeValue.textContent = '读取中…';
  els.stuQrImage.innerHTML = '<p class="text-muted">读取密码中…</p>';
  els.stuQrLink.textContent = '';
  els.studentQrModal.classList.add('show');
  Nav.push('qr2');   // RSK-10：打开学生二维码弹窗
  let code = '';
  if (window.Offline && window.Offline.online) {
    try {
      const { data, error } = await supabase
        .from('student_info')
        .select('access_code')
        .eq('class', cls)
        .eq('student_name', name)
        .maybeSingle();
      if (!error && data) code = data.access_code || '';
    } catch (e) {}
  }
  if (!code) {
    // 离线或在线没读到：用名单缓存（含 access_code）
    try {
      const v = await window.Offline.get('students_roster_full');
      const row = ((v && v.data) || []).find(s => s.class === cls && s.student_name === name);
      if (row) code = row.access_code || '';
    } catch (e) {}
  }
  els.stuCodeValue.textContent = code || '未设置';
  renderStuQr(code);
}

function closeStudentQr() {
  els.studentQrModal.classList.remove('show');
  stuQrCtx = null;
}

async function copyStuQrLink() {
  const text = els.stuQrLink.textContent;
  if (!text) { toast('还没有可复制的链接，请先生成密码'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('链接已复制');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('链接已复制'); }
    catch (err) { window.prompt('请手动复制链接：', text); }
    document.body.removeChild(ta);
  }
}

function downloadStuQr() {
  const name = stuQrCtx ? stuQrCtx.name : '学生';
  const canvas = els.stuQrImage.querySelector('canvas');
  if (!canvas) { toast('二维码还没生成好，请稍候再试'); return; }
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${name}-专属二维码.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    window.open(canvas.toDataURL('image/png'), 'qrPreview');
  }
}

async function copyClassQrLink() {
  const text = els.classQrLink.textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('链接已复制，可发到家长群');
  } catch (e) {
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

function downloadClassQr() {
  const cls = (els.classQrTitle.textContent || '').replace(/[「」]/g, '').replace('家长查询二维码', '').trim() || '班级';
  const canvas = els.classQrImage.querySelector('canvas');
  if (!canvas) { toast('二维码还没生成好，请稍候再试'); return; }
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `家长查询二维码-${cls}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    window.open(canvas.toDataURL('image/png'), 'qrPreview');
  }
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
  els.awardResult.innerHTML = html;
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
  els.awardResult.innerHTML = '';
  batchParsed = [];
  els.btnBatchImport.disabled = true;
  if (loaded.students) loadStudents();
  loadClassesAndRecords();
}

function onBatchClear() {
  els.batchText.value = '';
  els.awardResult.innerHTML = '';
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
    if (!['de','zhi','ti','mei','lao'].includes(t.dim)) t.dim = 'zhi';
  });
  cache.tags = data;

  const DIM_OPT = (sel, val) => [
    ['de','❤️ 德'],['zhi','🧠 智'],['ti','💪 体'],['mei','🎨 美'],['lao','🧹 劳']
  ].map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('');

  els.tagBox.innerHTML = data.map(t => `
    <div class="tag-edit-row${t.category === 'negative' ? ' row-neg' : ''}" data-tag-id="${t.id}">
      <input type="text" class="tag-label" value="${esc(t.label)}" maxlength="600" placeholder="标签文字（最长600字）">
      <input type="text" class="tag-options" value="${esc((t.options || []).join(','))}"
             maxlength="600" placeholder="二级标签，逗号分隔（选填），如：语文作业,数学作业">
      <select class="tag-cat" title="心情分类（影响学生心情）">
        <option value="positive"${t.category === 'positive' ? ' selected' : ''}>🌟 积极</option>
        <option value="negative"${t.category === 'negative' ? ' selected' : ''}>💧 消极</option>
      </select>
      <select class="tag-dim" title="加分维度（经验值加进该维度）">${DIM_OPT('', t.dim)}</select>
      <span class="tag-type-badge" title="仅支持勾选型">勾选型</span>
      <label class="tag-off-toggle" title="可重复提交：每天/多次都能选；不勾选=不可重复，同一具体项一生只能记一次">
        <input type="checkbox" class="tag-repeat" ${t.history_unique === false ? 'checked' : ''}> 可重复提交
      </label>
      <label class="tag-off-toggle">
        <input type="checkbox" class="tag-active" ${t.is_active ? 'checked' : ''}> 启用
      </label>
      <input type="number" class="tag-sort" value="${Number(t.sort_order) || 0}" min="0" max="9999" title="排序，数字越小越靠前">
      <input type="number" class="tag-xp" value="${t.xp_value == null ? 2 : Number(t.xp_value)}" min="0" max="100" title="经验值，老师可自定义（消极建议0）">
      <div class="tag-row-actions">
        <button class="btn btn-primary btn-sm tag-save">保存</button>
        <button class="btn btn-danger-ghost btn-sm tag-delete">删除</button>
      </div>
    </div>`).join('');

  $$('.tag-edit-row', els.tagBox).forEach(row => {
    const id = row.dataset.tagId;
    const syncControls = () => {
      row.classList.toggle('row-neg', $('.tag-cat', row).value === 'negative');
    };
    $('.tag-save', row).addEventListener('click', async () => {
      const label = $('.tag-label', row).value.trim();
      if (!label) return toast('标签文字不能为空');
      const options = parseTagOptions($('.tag-options', row).value);
      const category = $('.tag-cat', row).value === 'negative' ? 'negative' : 'positive';
      const score = category === 'negative' ? -1 : 1;
      // 经验值老师可自定义：积极/消极都不强制（0~100）
      const xpVal = Math.max(0, Math.min(100, parseInt($('.tag-xp', row).value, 10) || 0));
      const dim = $('.tag-dim', row).value || 'zhi';
      const btn = $('.tag-save', row);
      btn.disabled = true;
      btn.textContent = '…';
      const { error } = await supabase.from('behavior_tags').update({
        label,
        tag_type: 'check',
        options,
        category,
        score,
        xp_value: xpVal,
        dim,
        is_active: $('.tag-active', row).checked,
        history_unique: !$('.tag-repeat', row).checked,
        sort_order: parseInt($('.tag-sort', row).value, 10) || 0
      }).eq('id', id);
      btn.disabled = false;
      btn.textContent = '保存';
      if (error) { toast('保存失败：' + error.message); return; }
      toast('标签已更新');
    });
    // 分类切换联动
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

// 解析二级标签文本：支持中英文逗号、顿号、换行/空格分隔；去重、限量（20项）、单项限长600
function parseTagOptions(text) {
  const arr = String(text || '')
    .split(/[,，、\n\r;；\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const out = [];
  arr.forEach(s => {
    if (out.length >= 20) return;
    const v = s.slice(0, 600);
    if (!out.includes(v)) out.push(v);
  });
  return out;
}

async function onAddTag(e) {
  e.preventDefault();
  const label = els.addTagLabel.value.trim();
  if (!label) return toast('请输入标签文字');
  const btn = els.addTagForm.querySelector('button[type=submit]') || els.addTagForm.querySelector('button');
  if (btn) { btn.disabled = true; btn.textContent = '添加中…'; }
  const options = parseTagOptions(els.addTagOptions.value);
  const category = els.addTagCategory.value === 'negative' ? 'negative' : 'positive';
  const score = category === 'negative' ? -1 : 1;
  const dim = (els.addTagDim && els.addTagDim.value) || 'zhi';
  const xpVal = Math.max(0, Math.min(100, parseInt(els.addTagXp.value, 10) || 0));
  const repeatable = !els.addTagRepeat || els.addTagRepeat.value !== 'unique';
  const { data, error } = await supabase
    .from('behavior_tags')
    .insert({
      label,
      tag_type: 'check',
      options,
      category,
      score,
      xp_value: xpVal,
      dim,
      history_unique: !repeatable,
      sort_order: Math.floor(Date.now() / 1000) % 1000
    })
    .select('id');
  if (btn) { btn.disabled = false; btn.textContent = '添加标签'; }
  if (error) { toast('添加失败：' + error.message); return; }
  toast('已添加标签：' + label);
  els.addTagLabel.value = '';
  els.addTagOptions.value = '';
  els.addTagCategory.value = 'positive';
  if (els.addTagDim) els.addTagDim.value = 'zhi';
  els.addTagRepeat.value = 'repeat';
  els.addTagXp.value = '2';
  els.addTagLabel.focus();
  if (loaded.tags) renderTags();
}

/* ---------------- 自动化任务（五维经验自动加分） ---------------- */

const DIM_LABEL = { de: '德', zhi: '智', ti: '体', mei: '美', lao: '劳' };
const DIM_ICON = { de: '❤️', zhi: '🧠', ti: '💪', mei: '🎨', lao: '🧹' };
const WEEK_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

async function loadAutoTab() {
  // 目标标签下拉：用激活标签（含停用标签会导致规则不生效困惑，故只列启用项）
  try {
    const { data, error } = await supabase
      .from('behavior_tags')
      .select('id,label,category,dim')
      .eq('is_active', true)
      .order('sort_order').order('created_at');
    if (!error && data) {
      const opts = data.length
        ? data.map(t => `<option value="${t.id}">${esc(t.label)}（${DIM_LABEL[t.dim] || '智'}）</option>`).join('')
        : '<option value="">（请先在标签页创建标签）</option>';
      els.autoRuleTag.innerHTML = opts;
      els.manualTaskTag.innerHTML = opts;
    }
  } catch (e) { /* 下拉加载失败不阻塞规则列表 */ }
  await initManualTaskForm();
  await loadAutoRules();
}

/* ================= 手动分配任务（值班/分工） ================= */
const manualState = { students: [], allStudents: [], loaded: false };

async function initManualTaskForm() {
  // 班级下拉
  let classes = [];
  try {
    const r = await supabase.from('student_info').select('class').order('class');
    if (!r.error && r.data) classes = Array.from(new Set(r.data.map(s => s.class))).sort();
  } catch (e) {}
  els.manualTaskClass.innerHTML = classes.length
    ? classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
    : '<option value="">（暂无班级）</option>';
  if (!els.manualTaskDate.value) els.manualTaskDate.value = todayStr();
  els.manualTaskClass.addEventListener('change', loadManualStudents);
  if (classes.length) {
    await loadManualStudents();
  }
  await loadManualTasks();
}

async function loadManualStudents() {
  const cls = els.manualTaskClass.value;
  if (!cls) { els.manualStudentBox.innerHTML = ''; manualState.allStudents = []; manualState.students = []; return; }
  let names = [];
  try {
    const r = await supabase.from('student_info').select('student_name').eq('class', cls).order('student_name');
    if (!r.error && r.data) names = r.data.map(s => s.student_name);
  } catch (e) {}
  manualState.allStudents = names;
  manualState.students = names.slice();   // 默认全班
  renderManualStudents();
}

function renderManualStudents() {
  const box = els.manualStudentBox;
  const all = manualState.allStudents || [];
  box.innerHTML = all.length
    ? all.map(n => {
        const on = manualState.students.includes(n);
        return `<label class="batch-pill ${on ? 'on' : ''}"><input type="checkbox" value="${esc(n)}" ${on ? 'checked' : ''} style="display:none">${esc(n)}</label>`;
      }).join('')
    : '<span class="text-muted">请先选择班级</span>';
  box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
    const v = cb.value;
    if (cb.checked && !manualState.students.includes(v)) manualState.students.push(v);
    if (!cb.checked) manualState.students = manualState.students.filter(x => x !== v);
    cb.closest('.batch-pill').classList.toggle('on', cb.checked);
  }));
}

document.getElementById('btnManualAll')?.addEventListener('click', () => {
  manualState.students = manualState.allStudents.slice();
  renderManualStudents();
});
document.getElementById('btnManualNone')?.addEventListener('click', () => {
  manualState.students = [];
  renderManualStudents();
});
document.getElementById('btnManualAssign')?.addEventListener('click', async () => {
  const cls = els.manualTaskClass.value;
  const tagId = els.manualTaskTag.value;
  const date = els.manualTaskDate.value;
  if (!cls) { toast('请先选班级'); return; }
  if (!tagId) { toast('请先选任务标签（如卫生委员，可在标签页创建）'); return; }
  if (!date) { toast('请选择任务日期'); return; }
  if (!manualState.students.length) { toast('请至少选择一名学生'); return; }
  const btn = document.getElementById('btnManualAssign');
  btn.disabled = true;
  try {
    const wr = await runWrite({ name: 'create_manual_tasks', params: {
      p_class: cls, p_tag_id: tagId, p_date: date,
      p_students: manualState.students.map(n => ({ value: n }))
    }});
    if (!wr.ok) { toast('分配失败，请重试'); return; }
    if (wr.queued) { toast('已离线保存，联网后自动分配 ✅'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('分配失败：' + (d.reason || '')); return; }
    toast(`已分配 ${d.created} 名学生${d.skipped ? '（跳过重复 ' + d.skipped + '）' : ''} ✅`);
    await loadManualTasks();
  } catch (e) { toast('分配失败，请重试'); }
  finally { btn.disabled = false; }
});

async function loadManualTasks() {
  const box = els.manualTaskBox;
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载…</div>';
  let rows;
  try {
    const r = await supabase
      .from('manual_task')
      .select('*, behavior_tags(label)')
      .order('task_date', { ascending: false })
      .order('create_at', { ascending: false });
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '请确认已执行 68 号 SQL（manual_task 表）')}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">还没有手动分配的任务。</div>';
    return;
  }
  const today = todayStr();
  box.innerHTML = rows.map(t => `
    <div class="auto-rule-row">
      <div class="rule-info">
        <div class="rule-title">${esc(t.task_date || '')}${String(t.task_date || '').slice(0, 10) === today ? '<span class="badge-off" style="margin-left:6px;">今天</span>' : ''}
          <span class="badge-dim">${esc(t.student_name)}</span>
          <span class="badge-tag">${esc(t.behavior_tags && t.behavior_tags.label || '(标签已删)')}</span>
          <span class="badge-${t.status === 'done' ? 'off' : 'dim'}" style="margin-left:6px;">${t.status === 'done' ? '✅ 已完成' : '⏳ 待完成'}</span>
        </div>
      </div>
      <div class="rule-actions">
        ${t.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-del-task="${t.id}">取消</button>` : ''}
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-del-task]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('取消这条任务分配？（未加分，学生端将不再显示）')) return;
    const wr = await runWrite({ name: 'delete_manual_task', params: { p_task_id: btn.dataset.delTask } });
    if (!wr.ok) { toast('取消失败，请重试'); return; }
    toast(wr.queued ? '已离线保存，联网后同步 ✅' : '已取消');
    loadManualTasks();
  }));
}

/* ================= 个人任务（教师自定义内容） ================= */
const personalState = { students: [], allStudents: [], loaded: false };

async function initPersonalTaskForm() {
  let classes = [];
  try {
    const r = await supabase.from('student_info').select('class').order('class');
    if (!r.error && r.data) classes = Array.from(new Set(r.data.map(s => s.class))).sort();
  } catch (e) {}
  els.personalTaskClass.innerHTML = classes.length
    ? classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
    : '<option value="">（暂无班级）</option>';
  if (!els.personalTaskDate.value) els.personalTaskDate.value = todayStr();
  if (!els.personalTaskDeadline.value) els.personalTaskDeadline.value = todayStr();
  els.personalTaskDate.addEventListener('change', () => {
    if (els.personalTaskDeadline.value && els.personalTaskDeadline.value < els.personalTaskDate.value) {
      els.personalTaskDeadline.value = els.personalTaskDate.value;
    }
  });
  els.personalTaskClass.addEventListener('change', loadPersonalStudents);
  if (classes.length) await loadPersonalStudents();
  await loadPersonalTasks();
}

async function loadPersonalStudents() {
  const cls = els.personalTaskClass.value;
  if (!cls) { els.personalStudentBox.innerHTML = ''; personalState.allStudents = []; personalState.students = []; return; }
  let names = [];
  try {
    const r = await supabase.from('student_info').select('student_name').eq('class', cls).order('student_name');
    if (!r.error && r.data) names = r.data.map(s => s.student_name);
  } catch (e) {}
  personalState.allStudents = names;
  personalState.students = names.slice();   // 默认全班
  renderPersonalStudents();
}

function renderPersonalStudents() {
  const box = els.personalStudentBox;
  const all = personalState.allStudents || [];
  box.innerHTML = all.length
    ? all.map(n => {
        const on = personalState.students.includes(n);
        return `<label class="batch-pill ${on ? 'on' : ''}"><input type="checkbox" value="${esc(n)}" ${on ? 'checked' : ''} style="display:none">${esc(n)}</label>`;
      }).join('')
    : '<span class="text-muted">请先选择班级</span>';
  box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
    const v = cb.value;
    if (cb.checked && !personalState.students.includes(v)) personalState.students.push(v);
    if (!cb.checked) personalState.students = personalState.students.filter(x => x !== v);
    cb.closest('.batch-pill').classList.toggle('on', cb.checked);
  }));
}

document.getElementById('btnPersonalAll')?.addEventListener('click', () => {
  personalState.students = personalState.allStudents.slice();
  renderPersonalStudents();
});
document.getElementById('btnPersonalNone')?.addEventListener('click', () => {
  personalState.students = [];
  renderPersonalStudents();
});
document.getElementById('btnPersonalAssign')?.addEventListener('click', async () => {
  const cls = els.personalTaskClass.value;
  const content = els.personalTaskContent.value.trim();
  const dim = els.personalTaskDim.value;
  const xp = parseInt(els.personalTaskXp.value, 10);
  const date = els.personalTaskDate.value;
  const deadline = els.personalTaskDeadline.value || date;
  if (!cls) { toast('请先选班级'); return; }
  if (!content) { toast('请填写任务内容'); return; }
  if (!date) { toast('请选择任务日期'); return; }
  if (deadline < date) { toast('截止日期不能早于任务日期'); return; }
  if (!(xp >= 1 && xp <= 100)) { toast('经验分值需在 1-100 之间'); return; }
  if (!personalState.students.length) { toast('请至少选择一名学生'); return; }
  const btn = document.getElementById('btnPersonalAssign');
  btn.disabled = true;
  try {
    const wr = await runWrite({ name: 'create_personal_tasks', params: {
      p_class: cls, p_content: content, p_dim: dim, p_xp_value: xp, p_date: date, p_deadline: deadline,
      p_students: personalState.students.map(n => ({ value: n }))
    }});
    if (!wr.ok) { toast('发布失败，请重试'); return; }
    if (wr.queued) { toast('已离线保存，联网后自动发布 ✅'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('发布失败：' + (d.reason || '')); return; }
    toast(`已发布给 ${d.created} 名学生${d.skipped ? '（跳过重复 ' + d.skipped + '）' : ''} ✅`);
    els.personalTaskContent.value = '';
    await loadPersonalTasks();
  } catch (e) { toast('发布失败，请重试'); }
  finally { btn.disabled = false; }
});

async function loadPersonalTasks() {
  const box = els.personalTaskBox;
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载…</div>';
  let rows;
  try {
    const r = await supabase
      .from('personal_task')
      .select('*')
      .order('task_date', { ascending: false })
      .order('create_at', { ascending: false });
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '请确认已执行 69 号 SQL（personal_task 表）')}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">还没有发布个人任务。</div>';
    return;
  }
  const today = todayStr();
  box.innerHTML = rows.map(t => `
    <div class="auto-rule-row">
      <label class="sel-check" style="display:flex;align-items:center;padding-right:8px;cursor:pointer;user-select:none;" title="选择该条">
        <input type="checkbox" data-sel-ptask="${t.id}">
      </label>
      <div class="rule-info">
        <div class="rule-title">${esc(t.task_date || '')}${String(t.task_date || '').slice(0, 10) === today ? '<span class="badge-off" style="margin-left:6px;">今天</span>' : ''}
          ${t.deadline ? `<span class="badge-dim" style="margin-left:6px;">截止 ${String(t.deadline).slice(5)}</span>` : ''}
          <span class="badge-dim">${esc(t.student_name)}</span>
          <span class="badge-tag">${esc(t.content)}</span>
          <span class="badge-dim" style="margin-left:4px;">${DIM_META[t.dim] ? DIM_META[t.dim].label : (DIM_LABEL[t.dim] || t.dim)}+${t.xp_value}</span>
          <span class="badge-${t.status === 'done' ? 'off' : 'dim'}" style="margin-left:6px;">${t.status === 'done' ? (t.filled_by === 'teacher' ? '✅ 教师代填' : '✅ 已完成') : '⏳ 待完成'}</span>
        </div>
      </div>
      <div class="rule-actions">
        ${t.status === 'pending' ? `
          <button class="btn btn-warn btn-sm" data-fill-ptask="${t.id}" style="margin-right:6px;">代填</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-del-ptask="${t.id}" style="${t.status === 'done' ? 'color:#c0392b;border-color:#e0b4b0;' : ''}">${t.status === 'done' ? '删除（回退经验）' : '取消'}</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-fill-ptask]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.fillPtask;
    if (!confirm('确认为该生代填此任务？将立即按分值加经验。')) return;
    const wr = await runWrite({ name: 'teacher_fill_personal_task', params: { p_task_id: id } });
    if (!wr.ok) { toast('代填失败，请重试'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('代填失败：' + (d.reason || '')); return; }
    toast(`已代填，经验+${d.xp_delta}${d.level ? '，升至 Lv.' + d.level : ''} ✅`);
    loadPersonalTasks();
  }));
  box.querySelectorAll('[data-del-ptask]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('删除这条个人任务？已完成任务的已加经验将自动回退。')) return;
    const wr = await runWrite({ name: 'delete_personal_task', params: { p_task_id: btn.dataset.delPtask } });
    if (!wr.ok) { toast('删除失败，请重试'); return; }
    const d2 = wr.res || {};
    if (d2.ok === false) { toast('删除失败：' + (d2.reason || '')); return; }
    const refund2 = Number(d2.refund_xp) || 0;
    toast(wr.queued ? '已离线保存，联网后同步 ✅' : (refund2 ? '已删除，回退经验 ' + refund2 + 'xp' : '已删除'));
    loadPersonalTasks();
  }));
  box.querySelectorAll('input[data-sel-ptask]').forEach(cb => cb.addEventListener('change', refreshPtaskSel));
}

/* ================= 挑战任务（档位制，教师可自定义档位与经验） ================= */
const DEFAULT_CHALLENGE_LEVELS = (() => { const a = []; for (let lv = 10; lv <= 110; lv += 5) a.push([lv, lv / 5]); return a; })();
const challengeState = { students: [], allStudents: [], levels: DEFAULT_CHALLENGE_LEVELS.map(x => x.slice()) };

function renderChallengeLevels() {
  const box = els.challengeLevelBox;
  box.innerHTML = challengeState.levels.map((lv, i) => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:#f7f3ec;border:1px solid #e6d9c3;border-radius:8px;padding:4px 6px;">
      <input type="number" data-lv-n="${i}" value="${lv[0]}" style="width:64px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;font-size:13px;" title="档位数值">
      <span style="font-size:12px;color:#8a7a66;">档</span>
      <input type="number" data-lv-xp="${i}" value="${lv[1]}" style="width:56px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;font-size:13px;" title="经验值">
      <span style="font-size:12px;color:#8a7a66;">xp</span>
      <button type="button" data-lv-del="${i}" style="border:none;background:none;color:#c0392b;cursor:pointer;font-size:14px;padding:0 2px;">×</button>
    </span>`).join('');
  box.querySelectorAll('[data-lv-n]').forEach(inp => inp.addEventListener('change', () => { challengeState.levels[+inp.dataset.lvN][0] = parseInt(inp.value, 10) || 0; }));
  box.querySelectorAll('[data-lv-xp]').forEach(inp => inp.addEventListener('change', () => { challengeState.levels[+inp.dataset.lvXp][1] = parseInt(inp.value, 10) || 0; }));
  box.querySelectorAll('[data-lv-del]').forEach(btn => btn.addEventListener('click', () => { challengeState.levels.splice(+btn.dataset.lvDel, 1); renderChallengeLevels(); }));
}
document.getElementById('btnChallengeLevelAdd')?.addEventListener('click', () => {
  challengeState.levels.push([challengeState.levels.length ? challengeState.levels[challengeState.levels.length-1][0] + 5 : 10, 1]);
  renderChallengeLevels();
});
document.getElementById('btnChallengeLevelReset')?.addEventListener('click', () => {
  challengeState.levels = DEFAULT_CHALLENGE_LEVELS.map(x => x.slice());
  renderChallengeLevels();
});

async function initChallengeForm() {
  let classes = [];
  try {
    const r = await supabase.from('student_info').select('class').order('class');
    if (!r.error && r.data) classes = Array.from(new Set(r.data.map(s => s.class))).sort();
  } catch (e) {}
  els.challengeClass.innerHTML = classes.length
    ? classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
    : '<option value="">（暂无班级）</option>';
  if (!els.challengeDate.value) els.challengeDate.value = todayStr();
  renderChallengeLevels();
  els.challengeClass.addEventListener('change', loadChallengeStudents);
  if (classes.length) await loadChallengeStudents();
  await loadChallengeTasks();
}

async function loadChallengeStudents() {
  const cls = els.challengeClass.value;
  if (!cls) { els.challengeStudentBox.innerHTML = ''; challengeState.allStudents = []; challengeState.students = []; return; }
  let names = [];
  try {
    const r = await supabase.from('student_info').select('student_name').eq('class', cls).order('student_name');
    if (!r.error && r.data) names = r.data.map(s => s.student_name);
  } catch (e) {}
  challengeState.allStudents = names;
  challengeState.students = names.slice();
  renderChallengeStudents();
}

function renderChallengeStudents() {
  const box = els.challengeStudentBox;
  const all = challengeState.allStudents || [];
  box.innerHTML = all.length
    ? all.map(n => {
        const on = challengeState.students.includes(n);
        return `<label class="batch-pill ${on ? 'on' : ''}"><input type="checkbox" value="${esc(n)}" ${on ? 'checked' : ''} style="display:none">${esc(n)}</label>`;
      }).join('')
    : '<span class="text-muted">请先选择班级</span>';
  box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
    const v = cb.value;
    if (cb.checked && !challengeState.students.includes(v)) challengeState.students.push(v);
    if (!cb.checked) challengeState.students = challengeState.students.filter(x => x !== v);
    cb.closest('.batch-pill').classList.toggle('on', cb.checked);
  }));
}

document.getElementById('btnChallengeAll')?.addEventListener('click', () => {
  challengeState.students = challengeState.allStudents.slice();
  renderChallengeStudents();
});
document.getElementById('btnChallengeNone')?.addEventListener('click', () => {
  challengeState.students = [];
  renderChallengeStudents();
});
document.getElementById('btnChallengeAssign')?.addEventListener('click', async () => {
  const cls = els.challengeClass.value;
  const title = els.challengeTitle.value.trim();
  const dim = els.challengeDim.value;
  const date = els.challengeDate.value;
  if (!cls) { toast('请先选班级'); return; }
  if (!title) { toast('请填写挑战名称'); return; }
  if (!date) { toast('请选择任务日期'); return; }
  if (!challengeState.levels.length) { toast('档位方案不能为空'); return; }
  if (!challengeState.students.length) { toast('请至少选择一名学生'); return; }
  const btn = document.getElementById('btnChallengeAssign');
  btn.disabled = true;
  try {
    const wr = await runWrite({ name: 'create_challenge_tasks', params: {
      p_class: cls, p_title: title, p_dim: dim, p_date: date,
      p_levels: challengeState.levels,
      p_students: challengeState.students.map(n => ({ value: n }))
    }});
    if (!wr.ok) { toast('发布失败：请确认已执行 82 号 SQL（挑战任务 v2）'); return; }
    if (wr.queued) { toast('已离线保存，联网后自动发布 ✅'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('发布失败：' + (d.reason || '')); return; }
    toast(`已发布给 ${d.created} 名学生${d.skipped ? '（跳过重复 ' + d.skipped + '）' : ''} ✅`);
    els.challengeTitle.value = '';
    await loadChallengeTasks();
  } catch (e) { toast('发布失败，请重试'); }
  finally { btn.disabled = false; }
});

async function loadChallengeTasks() {
  const box = els.challengeTaskBox;
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载…</div>';
  let rows;
  try {
    const r = await supabase
      .from('challenge_task')
      .select('*')
      .order('task_date', { ascending: false })
      .order('create_at', { ascending: false });
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '请确认已执行 82 号 SQL（挑战任务 v2，含 done_levels 列）')}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">还没有发布挑战任务。</div>';
    return;
  }
  // v152.2：查询填报记录（单次可取消），按挑战分组
  let subsMap = new Map();
  try {
    const s = await supabase
      .from('challenge_submission')
      .select('id,challenge_id,student_name,levels,xp,submitted_at,status')
      .eq('status', 'active');
    if (!s.error && s.data) {
      (s.data || []).forEach(sub => {
        const arr = subsMap.get(sub.challenge_id) || [];
        arr.push(sub);
        subsMap.set(sub.challenge_id, arr);
      });
    }
  } catch (e) {}
  const today = todayStr();
  box.innerHTML = rows.map(t => {
    if (t.status === 'cancelled') return '';
    // v152：档位方案 levels=[[档位,经验],...]；已达成 done_levels=[档位,...]（82 号 SQL 新增列）
    const scheme = Array.isArray(t.levels) && t.levels.length
      ? t.levels
      : DEFAULT_CHALLENGE_LEVELS.map(x => x.slice());
    const doneArr = Array.isArray(t.done_levels) ? t.done_levels : [];
    const doneSet = new Set(doneArr.map(Number));
    const total = scheme.length || doneArr.length;
    const allDone = t.status === 'done' || (total > 0 && doneArr.length >= total);
    const gain = scheme.reduce((s, lv) => {
      const lvNum = Number(lv && lv[0]);
      return s + (doneSet.has(lvNum) ? (Number(lv && lv[1]) || 0) : 0);
    }, 0);
    return `
    <div class="auto-rule-row">
      <label class="sel-check" style="display:flex;align-items:center;padding-right:8px;cursor:pointer;user-select:none;" title="选择该条">
        <input type="checkbox" data-sel-challenge="${t.id}">
      </label>
      <div class="rule-info">
        <div class="rule-title">${esc(t.task_date || '')}${String(t.task_date || '').slice(0,10) === today ? '<span class="badge-off" style="margin-left:6px;">今天</span>' : ''}
          <span class="badge-dim">${esc(t.student_name)}</span>
          <span class="badge-tag">🏆 ${esc(t.title)}</span>
          <span class="badge-dim" style="margin-left:4px;">${DIM_LABEL[t.dim] || t.dim}</span>
          <span class="badge-${allDone ? 'off' : 'dim'}" style="margin-left:6px;">${allDone ? `🏆 全部达成 ${doneArr.length}/${total} · 共+${gain}xp` : `进行中 ${doneArr.length}/${total} 档 · 已+${gain}xp`}</span>
        </div>
      </div>
      <div class="rule-actions">
        ${(subsMap.get(t.id) || []).length ? `<button class="btn btn-ghost btn-sm" data-sub-toggle="${t.id}">填报记录 ${(subsMap.get(t.id) || []).length} 次</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-del-challenge="${t.id}" style="${allDone ? 'color:#c0392b;border-color:#e0b4b0;' : ''}">${allDone ? '删除（回退经验）' : '取消'}</button>
      </div>
      ${(subsMap.get(t.id) || []).length ? `<div class="sub-list" data-sub-box="${t.id}" style="display:none;margin:6px 0 0 44px;padding:6px 10px;background:#faf6ef;border:1px solid #e8dcc6;border-radius:8px;font-size:12px;">
        ${(subsMap.get(t.id) || []).map(sub => `
          <div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px dashed #e8dcc6;">
            <span style="color:#8a7a66;">${esc(String(sub.submitted_at || '').replace('T', ' ').slice(0, 16))}</span>
            <span>档位 ${(Array.isArray(sub.levels) ? sub.levels : []).map(Number).join(',') || '—'}</span>
            <span style="color:#a07d3e;">+${Number(sub.xp) || 0}xp</span>
            <button class="btn btn-warn btn-sm" data-cancel-sub="${sub.id}" style="margin-left:auto;padding:2px 8px;">取消本次（回退）</button>
          </div>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('') || '<div class="empty">还没有发布挑战任务。</div>';
  box.querySelectorAll('[data-sub-toggle]').forEach(btn => btn.addEventListener('click', () => {
    const b = box.querySelector('[data-sub-box="' + btn.dataset.subToggle + '"]');
    if (b) b.style.display = (b.style.display === 'none') ? '' : 'none';
  }));
  box.querySelectorAll('[data-cancel-sub]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('取消本次填报？该次所得经验将回退，对应档位从已达成中移除。')) return;
    const wr = await runWrite({ name: 'cancel_challenge_submission', params: { p_submission_id: btn.dataset.cancelSub } });
    if (!wr.ok) { toast('取消失败，请重试'); return; }
    const d4 = wr.res || {};
    if (d4.ok === false) { toast('取消失败：' + (d4.reason || '')); return; }
    const refund4 = Number(d4.refund_xp) || 0;
    toast(refund4 ? '已取消本次填报，回退 ' + refund4 + 'xp' : '已取消本次填报');
    loadChallengeTasks();
  }));
  box.querySelectorAll('[data-del-challenge]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('删除这条挑战？已达成档位加过的经验将自动回退。')) return;
    const wr = await runWrite({ name: 'delete_challenge_task', params: { p_task_id: btn.dataset.delChallenge } });
    if (!wr.ok) { toast('删除失败，请重试'); return; }
    const d3 = wr.res || {};
    if (d3.ok === false) { toast('删除失败：' + (d3.reason || '')); return; }
    const refund3 = Number(d3.refund_xp) || 0;
    toast(wr.queued ? '已离线保存，联网后同步 ✅' : (refund3 ? '已删除，回退经验 ' + refund3 + 'xp' : '已删除'));
    loadChallengeTasks();
  }));
  box.querySelectorAll('input[data-sel-challenge]').forEach(cb => cb.addEventListener('change', refreshChallengeSel));
}

async function loadAutoRules() {
  els.autoBox.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载规则…</div>';
  let rows;
  try {
    const { data, error } = await supabase
      .from('auto_rules')
      .select('*, behavior_tags(label)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    els.autoBox.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '请确认已执行 61 号 SQL（auto_rules 表）')}</div>`;
    return;
  }
  if (!rows.length) {
    els.autoBox.innerHTML = '<div class="empty">还没有自动化任务，在上方创建第一条吧。</div>';
    return;
  }
  const fmtRange = r => (r.start_date || r.end_date)
    ? `${r.start_date || '…'} ~ ${r.end_date || '…'}`
    : '长期';
  const fmtWeek = w => {
    const arr = Array.isArray(w) && w.length ? w : [1, 2, 3, 4, 5];
    return arr.map(x => WEEK_LABEL[x] || '').filter(Boolean).join('、');
  };
  els.autoBox.innerHTML = rows.map(r => `
    <div class="auto-rule-row${r.is_active ? '' : ' rule-inactive'}" data-rule-id="${r.id}">
      <span class="rule-name">${esc(r.name)}</span>
      <span class="rule-badge badge-dim">${DIM_ICON[r.dim] || ''} ${DIM_LABEL[r.dim] || '智'} +${r.xp_value}</span>
      <span class="rule-badge badge-tag">${r.trigger_type === 'no_tag' ? '当天没有' : '当天有'}「${esc((r.behavior_tags && r.behavior_tags.label) || '(标签已删除)')}」</span>
      <span class="rule-meta">⏰ ${fmtRange(r)} · ${fmtWeek(r.weekdays)}</span>
      <span class="rule-meta">${r.is_active ? '🟢 生效中' : '⚪ 已停用'}</span>
      <div class="rule-actions">
        <button class="btn btn-ghost btn-sm rule-toggle">${r.is_active ? '停用' : '启用'}</button>
        <button class="btn btn-danger-ghost btn-sm rule-delete">删除</button>
      </div>
    </div>`).join('');

  $$('.auto-rule-row', els.autoBox).forEach(row => {
    const id = row.dataset.ruleId;
    $('.rule-toggle', row).addEventListener('click', async () => {
      const cur = row.classList.contains('rule-inactive');
      const { error } = await supabase.from('auto_rules').update({ is_active: cur }).eq('id', id);
      if (error) { toast('操作失败：' + error.message); return; }
      loadAutoRules();
    });
    $('.rule-delete', row).addEventListener('click', async () => {
      if (!confirm('确定删除该自动化任务吗？\n已产生的历史自动加分记录会一并删除。')) return;
      const { error } = await supabase.from('auto_rules').delete().eq('id', id);
      if (error) { toast('删除失败：' + error.message); return; }
      toast('已删除');
      loadAutoRules();
    });
  });
}

if (els.autoRuleForm) {
  els.autoRuleForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = els.autoRuleName.value.trim();
    if (!name) return toast('请输入规则名称');
    const tagId = els.autoRuleTag.value;
    if (!tagId) return toast('请选择目标标签（需先在标签页创建并启用）');
    const xpVal = Math.max(1, Math.min(100, parseInt(els.autoRuleXp.value, 10) || 1));
    const week = Array.from(els.autoRuleWeek.querySelectorAll('input:checked')).map(i => parseInt(i.value, 10));
    if (!week.length) return toast('请至少勾选一个执行星期');
    const btn = els.autoRuleForm.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = '创建中…'; }
    const { error } = await supabase.from('auto_rules').insert({
      name,
      trigger_type: els.autoRuleType.value,
      tag_id: tagId,
      dim: els.autoRuleDim.value,
      xp_value: xpVal,
      start_date: els.autoRuleStart.value || null,
      end_date: els.autoRuleEnd.value || null,
      weekdays: week,
      is_active: true
    });
    if (btn) { btn.disabled = false; btn.textContent = '创建规则'; }
    if (error) { toast('创建失败：' + error.message); return; }
    toast('规则已创建，明天起自动结算');
    els.autoRuleName.value = '';
    els.autoRuleXp.value = '1';
    els.autoRuleStart.value = '';
    els.autoRuleEnd.value = '';
    els.autoRuleType.value = 'no_tag';
    els.autoRuleDim.value = 'de';
    loadAutoRules();
  });
}

/* ---------------- 测试工具 ---------------- */

async function onRecalcXp() {
  if (!confirm('将按历史记录重新累加全班的经验和等级。\n不会删除任何记录，只是重算经验。确定继续吗？')) return;
  const btn = els.btnRecalcXp;
  if (btn.disabled) return;   // v128(RSK-06)：重入保护（含 RPC 异常路径）
  btn.disabled = true;
  btn.textContent = '重算中…';
  try {
    const { data, error } = await supabase.rpc('recalc_all_xp');
    if (error) {
      els.recalcResult.textContent = '失败：' + error.message;
      toast('重算失败：' + error.message);
      return;
    }
    els.recalcResult.textContent = `✅ 完成，重放了 ${data && data.records_replayed} 条记录`;
    toast('经验已重算');
    loadStudents();
  } catch (e) {
    els.recalcResult.textContent = '失败：' + ((e && e.message) || '网络异常，请重试');
    toast('重算失败：' + ((e && e.message) || '网络异常，请重试'));
  } finally {
    btn.disabled = false;
    btn.textContent = '一键重算全班经验';
  }
}

// v152.8：异常经验排查（经验记录页）
async function scanXpAnomaly() {
  const btn = els.btnXpAnomaly, hint = els.xpAnomalyHint, box = els.xpAnomalyList;
  if (!btn || !box) return;
  const cls = els.xpLogClass.value;
  if (!cls) { toast('请先选择班级'); return; }
  btn.disabled = true;
  if (hint) hint.textContent = '扫描中…';
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在比对…</div>';
  try {
    const { data, error } = await supabase.rpc('get_xp_anomalies', { p_class: cls });
    if (error) {
      box.innerHTML = `<div class="banner banner-error">扫描失败：${esc(error.message)}（请确认已执行 88 号 SQL）</div>`;
      if (hint) hint.textContent = '';
      return;
    }
    const rows = (data && data.rows) || [];
    if (hint) hint.textContent = '';
    if (!rows.length) {
      box.innerHTML = '<div class="banner">✅ 全班当前经验与流水应得一致，无异常差额。</div>';
      return;
    }
    const rowsHtml = rows.map(r => {
      const d = r.diff || 0;
      let reason;
      if (r.log_total === 0) reason = '无流水记录（未注入或纯手动调整）';
      else if (d > 0) reason = `经验偏多 +${d}：可能手动调经验 / 删除未回退`;
      else reason = `经验偏少 ${d}：可能删除回退过头 / 手动扣减`;
      const color = d > 0 ? '#b84c3a' : '#a93b36';
      return `<tr>
        <td><b>${esc(r.student)}</b></td>
        <td style="text-align:center;">Lv${r.level}</td>
        <td style="text-align:right;">${r.cur_xp}</td>
        <td style="text-align:right;">${r.log_total}</td>
        <td style="text-align:right;color:${color};font-weight:600;">${d > 0 ? '+' : ''}${d}</td>
        <td style="font-size:13px;">${reason}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <div style="margin-bottom:8px;font-size:14px;">发现 <b>${rows.length}</b> 名经验异常学生：</div>
      <div style="max-height:400px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f4f4f5;">
            <th style="padding:8px 10px;text-align:left;">学生</th>
            <th style="padding:8px 10px;text-align:center;">等级</th>
            <th style="padding:8px 10px;text-align:right;">当前经验</th>
            <th style="padding:8px 10px;text-align:right;">流水应得</th>
            <th style="padding:8px 10px;text-align:right;">差额</th>
            <th style="padding:8px 10px;text-align:left;">可能原因</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="banner banner-error">扫描失败：${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    if (hint && hint.textContent === '扫描中…') hint.textContent = '';
  }
}

// v153：学生经验日志（全班日志总览，点击行查该生流水）
async function loadAllStudentLogs() {
  const cls = els.xpLogClass.value;
  if (!cls) { toast('请先选择班级'); return; }
  const box = els.xpLogResult;
  if (!box) return;
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载全班日志…</div>';
  try {
    const { data, error } = await supabase.rpc('get_student_xp_logs', { p_class: cls });
    if (error) {
      box.innerHTML = `<div class="banner banner-error">加载失败：${esc(error.message)}（请确认已执行 90 号 SQL）</div>`;
      return;
    }
    const rows = (data && data.rows) || [];
    if (!rows.length) { box.innerHTML = '<div class="banner">该班暂无学生或流水。</div>'; return; }
    const rowsHtml = rows.map(r => {
      const d = r.diff || 0;
      const color = d === 0 ? 'inherit' : (d > 0 ? '#b84c3a' : '#a93b36');
      return `<tr class="xp-log-row" data-stu="${esc(r.student)}" style="cursor:pointer;">
        <td><b>${esc(r.student)}</b></td>
        <td style="text-align:center;">Lv${r.level}</td>
        <td style="text-align:right;">${r.cur_xp}</td>
        <td style="text-align:right;">${r.log_total}</td>
        <td style="text-align:right;color:${color};font-weight:600;">${d > 0 ? '+' : ''}${d}</td>
        <td style="text-align:center;">${r.log_cnt || 0} 条</td>
        <td style="text-align:center;">${esc(r.last_date || '—')}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <div style="margin-bottom:8px;font-size:14px;">全班 <b>${rows.length}</b> 名学生经验日志（点击学生行查看该生流水明细）：</div>
      <div style="max-height:480px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f4f4f5;">
            <th style="padding:8px 10px;text-align:left;">学生</th>
            <th style="padding:8px 10px;text-align:center;">等级</th>
            <th style="padding:8px 10px;text-align:right;">当前经验</th>
            <th style="padding:8px 10px;text-align:right;">流水应得</th>
            <th style="padding:8px 10px;text-align:right;">差额</th>
            <th style="padding:8px 10px;text-align:center;">流水条数</th>
            <th style="padding:8px 10px;text-align:center;">最近记录</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
    box.querySelectorAll('.xp-log-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const name = tr.dataset.stu;
        if (els.xpLogStudent) {
          els.xpLogStudent.value = name;
          if (els.xpLogStudent.value !== name) {
            fillXpLogStudents().then(() => { els.xpLogStudent.value = name; queryXpLog(); });
            return;
          }
        }
        queryXpLog();
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message)}</div>`;
  }
}

// v153：经验异常区（自动上报清单）
const XP_ANOMALY_TYPE = {
  missing_tag: '标签已删除',
  bad_xp_value: '经验值配置异常',
  negative_clip: '扣减致负截断',
  xp_mismatch: '加分链路异常'
};
async function loadXpAnomalyZone() {
  const cls = els.xpLogClass.value;
  if (!cls) { toast('请先选择班级'); return; }
  const box = els.xpAnomalyZoneList, badge = els.xpAnomalyZoneBadge;
  if (!box) return;
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载异常清单…</div>';
  try {
    const { data, error } = await supabase.rpc('get_xp_anomaly_zone', { p_class: cls });
    if (error) {
      box.innerHTML = `<div class="banner banner-error">加载失败：${esc(error.message)}（请确认已执行 90 号 SQL）</div>`;
      return;
    }
    const rows = (data && data.rows) || [];
    const cnt = (data && data.open_count) || 0;
    if (badge) badge.textContent = cnt ? cnt + ' 条待处理' : '无待处理';
    if (!rows.length) { box.innerHTML = '<div class="banner">✅ 暂无自动上报的经验异常。</div>'; return; }
    const rowsHtml = rows.map(r => {
      const d = r.detail || {};
      let extra = '';
      if (r.type === 'missing_tag' && d.tag_id) extra = '标签ID：<code>' + esc(String(d.tag_id).slice(0, 8)) + '</code>';
      if (r.type === 'bad_xp_value') extra = (esc(d.label || '') + ' = ' + (d.xp_value === undefined ? '' : d.xp_value) + ' xp');
      if (r.type === 'negative_clip') extra = '原经验 ' + d.before + '，扣 ' + d.delta;
      if (r.type === 'xp_mismatch') extra = '应得 ' + d.expected + '，实际 ' + d.actual;
      return `<tr>
        <td><b>${esc(r.student)}</b></td>
        <td style="text-align:center;">${esc(r.date || '—')}</td>
        <td style="text-align:center;">${esc(r.source || '—')}</td>
        <td>${XP_ANOMALY_TYPE[r.type] || esc(r.type)}</td>
        <td style="font-size:13px;">${esc(r.reason)}${extra ? '<br><span class="text-muted">' + extra + '</span>' : ''}</td>
        <td style="text-align:center;white-space:nowrap;font-size:13px;">${esc(String(r.create_at || '').replace('T', ' ').slice(5, 16))}</td>
        <td style="text-align:center;"><button class="btn btn-ghost btn-sm" data-id="${r.id}" type="button">标记已处理</button></td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <div style="margin-bottom:8px;font-size:14px;">发现 <b>${rows.length}</b> 条待处理异常（提交时自动检测上报，同生同日同类仅一条）：</div>
      <div style="max-height:400px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f4f4f5;">
            <th style="padding:8px 10px;text-align:left;">学生</th>
            <th style="padding:8px 10px;text-align:center;">日期</th>
            <th style="padding:8px 10px;text-align:center;">来源</th>
            <th style="padding:8px 10px;text-align:left;">异常类型</th>
            <th style="padding:8px 10px;text-align:left;">原因</th>
            <th style="padding:8px 10px;text-align:center;">上报时间</th>
            <th style="padding:8px 10px;text-align:center;">处理</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
    box.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => resolveXpAnomaly(btn.dataset.id));
    });
  } catch (e) {
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message)}</div>`;
  }
}

// v153：标记异常已处理
async function resolveXpAnomaly(id) {
  if (!confirm('确认将该异常标记为已处理？')) return;
  try {
    const { data, error } = await supabase.rpc('resolve_xp_anomaly', { p_id: id });
    if (error || !data || data.ok !== true) { toast('标记失败：' + ((error && error.message) || '仅登录教师可操作')); return; }
    toast('已标记为已处理');
    loadXpAnomalyZone();
  } catch (e) { toast('标记失败：' + e.message); }
}


// v152.7：经验流水注入（测试工具）
async function injectXpLog() {
  if (!confirm('将按真实经验值把现有全部加分写入经验流水（可重复执行，不会重复）。确定继续吗？')) return;
  const btn = els.btnInjectXpLog, out = els.injectXpLogResult;
  if (btn) btn.disabled = true;
  if (out) out.textContent = '注入中…';
  try {
    const { data, error } = await supabase.rpc('inject_xp_log');
    if (error) { if (out) out.textContent = '失败：' + error.message; return; }
    if (out) out.textContent = '注入完成，共写入 ' + ((data && data.injected) || 0) + ' 条经验记录';
  } catch (e) { if (out) out.textContent = '失败：' + e.message; }
  finally { if (btn) btn.disabled = false; }
}

// v152.7：经验记录查询
const XP_LOG_SRC = { daily: '日常表现', task: '每日任务', personal: '个人任务', challenge: '挑战任务', manual: '手动任务' };
const XP_LOG_DIM = { de: '德', zhi: '智', ti: '体', mei: '美', lao: '劳' };
async function fillXpLogClasses() {
  if (!els.xpLogClass) return;
  const { data } = await supabase.from('student_info').select('class').order('class');
  const classes = Array.from(new Set((data || []).map(s => s.class))).sort();
  els.xpLogClass.innerHTML = '<option value="">请选择班级</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  fillXpLogStudents();
}
async function fillXpLogStudents() {
  if (!els.xpLogClass || !els.xpLogStudent) return;
  const cls = els.xpLogClass.value;
  if (!cls) { els.xpLogStudent.innerHTML = '<option value="">先选班级</option>'; return; }
  const { data } = await supabase
    .from('student_info').select('student_name').eq('class', cls).order('student_name');
  els.xpLogStudent.innerHTML = '<option value="">请选择学生</option>' +
    (data || []).map(s => `<option value="${esc(s.student_name)}">${esc(s.student_name)}</option>`).join('');
}
async function queryXpLog() {
  const cls = els.xpLogClass.value, name = els.xpLogStudent.value;
  if (!cls || !name) { toast('请先选班级和学生'); return; }
  const box = els.xpLogResult;
  if (!box) return;
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载…</div>';
  const { data, error } = await supabase.rpc('get_xp_log', { p_class: cls, p_student: name });
  if (error) { box.innerHTML = `<div class="banner banner-error">查询失败：${esc(error.message)}（请确认已执行 87 号 SQL）</div>`; return; }
  const rows = (data && data.rows) || [];
  const total = (data && data.total) || 0;
  let cur = 0;
  const { data: info } = await supabase
    .from('student_info').select('xp').eq('class', cls).eq('student_name', name).single();
  if (info) cur = info.xp || 0;
  if (!rows.length) {
    box.innerHTML = '<div class="banner">该生暂无经验流水。首次使用请在教师后台「测试工具」执行注入（select public.inject_xp_log();）</div>';
    return;
  }
  let acc = 0;
  const rowsHtml = rows.map(r => {
    acc += (r.xp || 0);
    return `<tr>
      <td style="white-space:nowrap;">${esc(r.date || '')}</td>
      <td>${XP_LOG_SRC[r.source] || r.source}</td>
      <td>${esc(r.label || '')}</td>
      <td style="text-align:center;">${XP_LOG_DIM[r.dim] || (r.dim ? r.dim : '—')}</td>
      <td style="text-align:right;">+${r.xp}</td>
      <td style="text-align:right;font-weight:600;">${acc}</td>
    </tr>`;
  }).join('');
  box.innerHTML = `
    <div style="margin-bottom:8px;font-size:14px;">
      流水合计 <b>${total} xp</b> ｜ 当前经验 <b>${cur} xp</b> ｜ 差额 <b>${cur - total} xp</b>
      <span class="text-muted">（差额为教师手动调整或删除回退等无流水操作；流水合计即「真实经验值」参照）</span>
    </div>
    <div style="max-height:480px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#f4f4f5;">
          <th style="padding:8px 10px;text-align:left;">日期</th>
          <th style="padding:8px 10px;text-align:left;">渠道</th>
          <th style="padding:8px 10px;text-align:left;">说明</th>
          <th style="padding:8px 10px;text-align:center;">维度</th>
          <th style="padding:8px 10px;text-align:right;">经验</th>
          <th style="padding:8px 10px;text-align:right;">累计</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

async function fillPreviewClasses() {
  if (!els.previewClass) return;
  const { data } = await supabase.from('student_info').select('class').order('class');
  const classes = Array.from(new Set((data || []).map(s => s.class))).sort();
  els.previewClass.innerHTML = '<option value="">请选择班级</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  fillPreviewStudents();
}

async function fillPreviewStudents() {
  if (!els.previewClass || !els.previewStudent) return;
  const cls = els.previewClass.value;
  if (!cls) { els.previewStudent.innerHTML = '<option value="">先选班级</option>'; return; }
  const { data } = await supabase
    .from('student_info').select('student_name').eq('class', cls).order('student_name');
  els.previewStudent.innerHTML = '<option value="">请选择学生</option>' +
    (data || []).map(s => `<option value="${esc(s.student_name)}">${esc(s.student_name)}</option>`).join('');
}

// v153：学生预览窗口防重——多次点击只会出现一个预览网页（复用并聚焦已有窗口）
let previewWin = null;
function openStudentPreview() {
  const cls = els.previewClass.value;
  const name = els.previewStudent.value;
  if (!cls || !name) { toast('请先选班级和学生'); return; }
  const url = `./index.html?class=${encodeURIComponent(cls)}&student=${encodeURIComponent(name)}&readonly=1`;
  if (previewWin && !previewWin.closed) {
    previewWin.location.href = url;  // 已打开过 → 复用原窗口跳转（切换学生同样生效）
    previewWin.focus();
    return;
  }
  previewWin = window.open(url, 'spPreview');  // 固定窗口名：浏览器层面兜底复用
  if (previewWin) previewWin.focus();
}

/* ---------------- 工具 ---------------- */

function friendlyAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return '邮箱或密码不正确';
  if (/email not confirmed/i.test(msg)) return '邮箱尚未确认，请查收邀请邮件';
  if (/failed to fetch|networkerror|network error|load failed|request failed/i.test(msg)) return '网络连接失败：请检查网络（WiFi/流量）后重试';
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

/* ================= 每日任务 ================= */
const loadedTask = { list: false };
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function activateTaskTab() {
  const taskClass = document.getElementById('taskClass');
  const reportClass = document.getElementById('reportClass');
  const tagReportClass = document.getElementById('tagReportClass');
  if (!loadedTask.list) {
    // 班级下拉：离线/失败时回退最近缓存（与记录页同口径 classes_all）
    let students = null;
    try {
      const r = await supabase.from('student_info').select('class').order('class');
      students = r.data;
      if (!r.error && students) { try { await window.Offline.set('classes_all', { data: students }); } catch (e2) {} }
    } catch (e) { students = null; }
    if (!students) {
      try { const v = await window.Offline.get('classes_all'); students = (v && v.data) || []; } catch (e2) { students = []; }
    }
    const classes = Array.from(new Set((students || []).map(s => s.class))).sort();
    [taskClass, reportClass, tagReportClass].forEach(sel => {
      sel.innerHTML = classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    });
    loadedTask.list = true;
  }
  const taskDate = document.getElementById('taskDate');
  const reportDate = document.getElementById('reportDate');
  const tagReportDate = document.getElementById('tagReportDate');
  if (!taskDate.value) taskDate.value = todayStr();
  if (!reportDate.value) reportDate.value = todayStr();
  if (!tagReportDate.value) tagReportDate.value = todayStr();
  loadTaskReport();
  loadTagReport();
}

document.getElementById('taskForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cls = document.getElementById('taskClass').value;
  const date = document.getElementById('taskDate').value || todayStr();
  const type = document.getElementById('taskType').value || 'classwork';
  const title = document.getElementById('taskTitle').value.trim();
  const detail = document.getElementById('taskDetail').value.trim();
  let due = document.getElementById('taskDue').value || null;
  // 未填截止日期：课堂作业当天，家庭作业次日（按本地时区，避免 UTC 偏移把日期变成前一天）
  if (!due) {
    const m = String(date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(date);
    if (type === 'homework') d.setDate(d.getDate() + 1);
    due = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  if (!cls || !title) { toast('请填班级和任务标题'); return; }

  if (editingTaskId) {
    const wr = await runWrite({ name: 'task_update', params: { id: editingTaskId, data: { class: cls, task_date: date, semester: semOf(date), task_type: type, title, detail, due_time: due } } });
    if (!wr.ok) { toast('保存失败，请重试'); return; }
    toast(wr.queued ? '已离线保存，联网后同步 ✅' : '任务已更新');
    cancelTaskEdit();
  } else {
    const wr = await runWrite({ name: 'task_insert', params: { class: cls, task_date: date, semester: semOf(date), task_type: type, title, detail, due_time: due } });
    if (!wr.ok) { toast('发布失败，请重试'); return; }
    toast(wr.queued ? '已离线保存，联网后发布 ✅' : '任务已发布，学生端今天就能看到啦');
  }
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDetail').value = '';
  document.getElementById('taskDue').value = '';
  loadTaskReport();
});

document.getElementById('btnCancelTaskEdit')?.addEventListener('click', () => {
  cancelTaskEdit();
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDetail').value = '';
});

let editingTaskId = null;
function cancelTaskEdit() {
  editingTaskId = null;
  const btn = document.querySelector('#taskForm button[type="submit"]');
  if (btn) { btn.textContent = '发布任务'; }
  const cancelBtn = document.getElementById('btnCancelTaskEdit');
  if (cancelBtn) cancelBtn.hidden = true;
  const note = document.querySelector('#taskForm .text-muted');
  if (note) note.textContent = '同一天可发布多条，按类型排列';
}
function beginTaskEdit(t) {
  editingTaskId = t.id;
  document.getElementById('taskClass').value = document.getElementById('reportClass').value;
  document.getElementById('taskDate').value = (t.task_date || '').slice(0, 10);
  document.getElementById('taskType').value = t.task_type || 'classwork';
  document.getElementById('taskTitle').value = t.title;
  document.getElementById('taskDetail').value = t.detail || '';
  document.getElementById('taskDue').value = (t.due_time || '').slice(0, 10);
  const btn = document.querySelector('#taskForm button[type="submit"]');
  if (btn) btn.textContent = '💾 保存修改';
  const cancelBtn = document.getElementById('btnCancelTaskEdit');
  if (cancelBtn) cancelBtn.hidden = false;
  const note = document.querySelector('#taskForm .text-muted');
  if (note) note.textContent = '正在编辑这条任务，保存后生效；点"取消编辑"回到新建模式';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('btnLoadReport')?.addEventListener('click', loadTaskReport);

const TASK_TYPE_LABEL = { classwork: '🏫 课堂作业', homework: '🏠 家庭作业' };

async function loadTaskReport() {
  const cls = document.getElementById('reportClass').value;
  const date = document.getElementById('reportDate').value || todayStr();
  const box = document.getElementById('taskReportBox');
  if (!cls) { box.innerHTML = '<p class="text-muted">请先选班级</p>'; return; }
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载…</div>';

  // 全班名单（用于补齐未提交学生）
  let stuRes = null, rpcRes = {}, seatRes = null, offlineFailed = false;
  try {
    [stuRes, rpcRes, seatRes] = await Promise.all([
      supabase.from('student_info').select('student_name').eq('class', cls).order('student_name'),
      supabase.rpc('get_class_task_report', { p_class: cls, p_date: date }),
      supabase.from('seat_grid').select('student_name, seat_row, seat_col').eq('class', cls)
    ]);
  } catch (e) { offlineFailed = true; }
  let data = rpcRes && rpcRes.data, error = rpcRes && rpcRes.error;
  if (offlineFailed || error) {
    const v = await window.Offline.get('taskreport_' + cls + '_' + date);
    if (v) {
      // 兼容两种缓存结构：在线缓存 = 裸 {allStudents,tasks,seatMap}；v111 预缓存 = {data:{...}}
      const rep = (v && v.data && (v.data.tasks || v.data.allStudents)) ? v.data : v;
      stuRes = { data: (rep.allStudents || []).map(n => ({ student_name: n })) };
      seatRes = { data: Object.entries(rep.seatMap || {}).map(([n, st]) => ({ student_name: n, seat_row: st.r, seat_col: st.c })) };
      data = rep.tasks || [];
    } else {
      // v111：当日报告无缓存 → 用全量预缓存组装（tasks_all_<cls> + subs_all_<cls> + seat_<cls> + 名单）
      try {
        const tAll = await window.Offline.get('tasks_all_' + cls);
        const sAll = await window.Offline.get('subs_all_' + cls);
        const seatV = await window.Offline.get('seat_' + cls);
        const dayTasks = ((tAll && tAll.data) || []).filter(t => String(t.task_date || '').slice(0, 10) === date);
        if (dayTasks.length) {
          const subsAll = (sAll && sAll.data) || [];
          data = dayTasks.map(t => {
            const submissions = {};
            subsAll.forEach(sb => {
              if (sb.task_id === t.id) submissions[sb.student_name] = { grade: sb.grade };
            });
            const o = Object.assign({}, t, { submissions });
            return o;
          });
          const seatMap = {};
          ((seatV && seatV.data) || []).forEach(x => { seatMap[x.student_name] = { r: x.seat_row, c: x.seat_col }; });
          const rosterV = await window.Offline.get('students_roster');
          const allNames = ((rosterV && rosterV.data) || []).filter(s => s.class === cls).map(s => s.student_name);
          if (allNames.length) {
            stuRes = { data: allNames.map(n => ({ student_name: n })) };
            seatRes = { data: Object.entries(seatMap).map(([n, st]) => ({ student_name: n, seat_row: st.r, seat_col: st.c })) };
          }
        }
      } catch (e3) {}
      if (!data) {
        box.innerHTML = offlineFailed
          ? '<p class="text-muted">离线且暂无缓存：请先联网打开过这个日期再看。</p>'
          : '<p class="text-muted">加载失败：' + esc(error.message) + '</p>';
        return;
      }
    }
  }
  // v106：按座位表排序——已排座位的按 排→列 在前，未排座位的按姓名跟在后面
  const seatMap = {};
  (seatRes && seatRes.data || []).forEach(s => { seatMap[s.student_name] = { r: s.seat_row, c: s.seat_col }; });
  const allStudents = ((stuRes && stuRes.data) || []).map(s => s.student_name).slice().sort((a, b) => {
    const sa = seatMap[a], sb = seatMap[b];
    if (sa && sb) return (sa.r - sb.r) || (sa.c - sb.c);
    if (sa) return -1; if (sb) return 1;
    return a.localeCompare(b, 'zh');
  });
  const tasks = Array.isArray(data) ? data : ((data && data.tasks) || []);
  if (!tasks.length) {
    box.innerHTML = '<p class="text-muted">这一天还没有发布任务。在上方发布后学生就能看到。</p>';
    return;
  }

  renderTaskReportData(tasks, allStudents, seatMap, cls, date);
  await window.Offline.set('taskreport_' + cls + '_' + date, { allStudents, tasks, seatMap });
}

/* v53：任务报告渲染 + 任务筛选（当天多任务时按任务切换，方便逐任务填写） */
let reportTaskFilter = 'all';
function renderTaskReportData(tasks, allStudents, seatMap, cls, date) {
  const box = document.getElementById('taskReportBox');
  let visibleTasks = reportTaskFilter === 'all' ? tasks : tasks.filter(t => t.id === reportTaskFilter);
  if (!visibleTasks.length) { reportTaskFilter = 'all'; visibleTasks = tasks; }

  let html = '';
  // 任务筛选条：当天多任务时显示（点任务只看它，点"全部"看所有）
  if (tasks.length > 1) {
    html += `<div class="report-filter">
      <button type="button" class="rf-btn${reportTaskFilter === 'all' ? ' on' : ''}" data-rf="all">📋 全部任务（${tasks.length}）</button>
      ${tasks.map(t => `<button type="button" class="rf-btn${reportTaskFilter === t.id ? ' on' : ''}" data-rf="${t.id}">${TASK_TYPE_LABEL[t.task_type] || t.task_type}·${esc(t.title)}</button>`).join('')}
    </div>`;
  }
  visibleTasks.forEach(t => {
    const sub = t.submissions || {};
    const counts = { none: 0, done: 0, good: 0, perfect: 0 };
    allStudents.forEach(name => {
      const g = (sub[name] && sub[name].grade) || 'none';
      counts[g] = (counts[g] || 0) + 1;
    });
    html += `<div class="task-card-block">
      <div class="task-banner">
        <div>
          <span class="task-type-tag ${t.task_type}">${TASK_TYPE_LABEL[t.task_type] || t.task_type}</span>
          <b>${esc(t.title)}</b>
          <button type="button" class="task-edit-btn" data-edit-id="${t.id}" data-title="${esc(t.title)}" data-detail="${esc(t.detail||'')}" data-type="${t.task_type}" data-date="${(t.task_date||'').slice(0,10)}" title="编辑">✏️</button>
          <button type="button" class="task-del-btn" data-del="${t.id}" title="删除这条任务">🗑</button>
          ${t.detail ? '<br><span class="text-muted">' + esc(t.detail) + '</span>' : ''}
        </div>
        <div class="task-stats">⏳未完成 ${counts.none} · ✅完成 ${counts.done} · 👍优秀 ${counts.good} · 🏆完美 ${counts.perfect}</div>
      </div>
      <div class="task-stu-grid">`;
    allStudents.forEach(name => {
      const g = (sub[name] && sub[name].grade) || 'none';
      const st = seatMap[name];
      const seatTag = st ? `<span class="task-stu-seat">${st.r + 1}排${st.c + 1}座</span>` : '';
      html += `<div class="task-stu" data-student="${esc(name)}" data-task="${t.id}">
        <div class="task-stu-name">${esc(name)}${seatTag}</div>
        <div class="task-grade-row">
          ${gradeBtn('none', g, '未完成')}
          ${gradeBtn('done', g, '完成')}
          ${gradeBtn('good', g, '优秀A')}
          ${gradeBtn('perfect', g, '完美A+')}
        </div></div>`;
    });
    html += '</div></div>';
  });
  box.innerHTML = html;

  // 任务筛选切换（数据已加载，仅重新渲染，秒切）
  box.querySelectorAll('.rf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      reportTaskFilter = btn.dataset.rf;
      renderTaskReportData(tasks, allStudents, seatMap, cls, date);
    });
  });
  box.querySelectorAll('.task-grade-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.task-stu');
      const student = card.dataset.student;
      const taskId = card.dataset.task;
      const grade = btn.dataset.grade;
      const wr = await runWrite({ name: 'submit_task', params: { p_class: cls, p_student: student, p_task_id: taskId, p_grade: grade } });
      if (!wr.ok) { toast('保存失败，请重试'); return; }
      toast(wr.queued ? student + ' 已离线保存，联网后同步 ✅' : student + ' 已评为：' + btn.textContent.trim());
      loadTaskReport();
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除这条任务吗？学生已获得的经验会保留。')) return;
      const wr = await runWrite({ name: 'task_delete', params: { p_task_id: btn.dataset.del } });
      if (!wr.ok) { toast('删除失败，请重试'); return; }
      toast(wr.queued ? '已离线删除，联网后同步 ✅' : '已删除'); loadTaskReport();
    });
  });
  box.querySelectorAll('[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      beginTaskEdit({
        id: btn.dataset.editId,
        title: btn.dataset.title,
        detail: btn.dataset.detail,
        task_type: btn.dataset.type,
        task_date: btn.dataset.date
      });
    });
  });
}
function gradeBtn(grade, cur, label) {
  return `<button type="button" class="task-grade-btn ${grade === cur ? 'on' : ''}" data-grade="${grade}">${label}</button>`;
}

/* ================= 标签填写情况（每日打卡查询） ================= */
/* 五维色：德红 / 智蓝 / 体绿 / 美紫 / 劳橙（与标签管理页同口径） */
const DIM_META = {
  de:  { label: '德', color: '#e74c3c' },
  zhi: { label: '智', color: '#2e86de' },
  ti:  { label: '体', color: '#27ae60' },
  mei: { label: '美', color: '#9b59b6' },
  lao: { label: '劳', color: '#e67e22' }
};

async function loadTagReport() {
  const cls = document.getElementById('tagReportClass').value;
  const date = document.getElementById('tagReportDate').value || todayStr();
  const box = document.getElementById('tagReportBox');
  if (!cls) { box.innerHTML = '<p class="text-muted">请先选班级</p>'; return; }
  box.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载…</div>';

  let recs = [], tags = [], seatMap = {}, roster = [], offlineFailed = false;
  try {
    const [rRec, rTag, rSeat, rRoster] = await Promise.all([
      supabase.from('daily_record').select('student_name,behavior').eq('class', cls).eq('record_date', date),
      supabase.from('behavior_tags').select('id,label,xp_value,dim'),
      supabase.from('seat_grid').select('student_name, seat_row, seat_col').eq('class', cls),
      supabase.from('student_info').select('student_name').eq('class', cls)
    ]);
    recs = rRec.data || []; tags = rTag.data || [];
    (rSeat.data || []).forEach(s => { seatMap[s.student_name] = { r: s.seat_row, c: s.seat_col }; });
    roster = (rRoster.data || []).map(s => s.student_name);
  } catch (e) { offlineFailed = true; }

  if (offlineFailed || (!recs.length && !roster.length)) {
    // 离线回退：打卡缓存 tagreport_<cls>_<date>
    try {
      const v = await window.Offline.get('tagreport_' + cls + '_' + date);
      if (v && (v.recs || v.roster)) {
        recs = v.recs || []; roster = v.roster || [];
        tags = v.tags || []; seatMap = v.seatMap || {};
      }
    } catch (e2) {}
    if (!roster.length) {
      box.innerHTML = offlineFailed
        ? '<p class="text-muted">离线且暂无缓存：请先联网打开过这个日期再看。</p>'
        : '<p class="text-muted">该日期全班还没有打卡记录。</p>';
      return;
    }
  }

  // 按座位表排序（有座位排前，其余按姓名）
  const allStudents = roster.slice().sort((a, b) => {
    const sa = seatMap[a], sb = seatMap[b];
    if (sa && sb) return (sa.r - sb.r) || (sa.c - sb.c);
    if (sa) return -1; if (sb) return 1;
    return a.localeCompare(b, 'zh');
  });

  const tagMap = {}; (tags || []).forEach(t => { tagMap[t.id] = t; });
  renderTagReportData(recs, tagMap, allStudents, seatMap, cls, date);
  try { await window.Offline.set('tagreport_' + cls + '_' + date, { recs, tags, roster, seatMap }); } catch (e3) {}
}

function renderTagReportData(recs, tagMap, allStudents, seatMap, cls, date) {
  const box = document.getElementById('tagReportBox');
  const byStu = {};
  (recs || []).forEach(r => { byStu[r.student_name] = r; });

  // 统计
  let filled = 0, posN = 0, negN = 0, totalN = 0, dimN = {};
  allStudents.forEach(name => {
    const items = (byStu[name] && byStu[name].behavior && byStu[name].behavior.items);
    if (items && items.length) {
      filled++;
      (items || []).forEach(it => {
        const tag = tagMap[it.id] || {};
        const dim = tag.dim || 'zhi';
        dimN[dim] = (dimN[dim] || 0) + 1;
        if (it.category === 'negative') negN++; else posN++;
        totalN++;
      });
    }
  });
  const notFilled = allStudents.filter(n => !byStu[n] || !((byStu[n].behavior && byStu[n].behavior.items) || []).length);

  const dimChips = Object.keys(dimN).map(d =>
    `<span class="tag-dim-chip" style="border-color:${(DIM_META[d]||{}).color||'#888'};color:${(DIM_META[d]||{}).color||'#888'};">${(DIM_META[d]||{label:d}).label}×${dimN[d]}</span>`).join('');

  box.innerHTML = `
    <div class="grid" style="gap:10px;margin-bottom:14px;">
      <div class="stat-box"><div class="stat-num">${filled}</div><div class="text-muted">已填写人数 / ${allStudents.length}</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#27ae60;">${posN}</div><div class="text-muted">积极表现</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#c0392b;">${negN}</div><div class="text-muted">需要加油</div></div>
      <div class="stat-box"><div class="stat-num">${totalN}</div><div class="text-muted">标签总次数</div></div>
    </div>
    <div style="margin-bottom:10px;">${dimChips || '<span class="text-muted">暂无标签</span>'}</div>
    <div class="task-stu-grid">` +
    allStudents.map(name => {
      const r = byStu[name];
      const items = (r && r.behavior && r.behavior.items) || [];
      const st = seatMap[name];
      const seatTag = st ? `<span class="task-stu-seat">${st.r + 1}排${st.c + 1}座</span>` : '';
      const mood = r && r.behavior && r.behavior.mood ? MOOD_MAP[r.behavior.mood] : null;
      const moodTag = mood ? `<span class="tag-mood">${mood.emoji}</span>` : '';
      if (!items.length) {
        return `<div class="task-stu" style="border-left:3px solid #ddd;">
          <div class="task-stu-name">${esc(name)}${seatTag}</div>
          <div class="text-muted" style="font-size:12px;padding:6px 0;">未填写</div></div>`;
      }
      const chips = items.map(it => {
        const tag = tagMap[it.id] || {};
        const dim = tag.dim || 'zhi';
        const dm = DIM_META[dim] || { label: '智', color: '#2e86de' };
        const val = it.xp != null ? it.xp : (tag.xp_value != null ? tag.xp_value : 2);
        const neg = it.category === 'negative';
        return `<span class="batch-chip" style="${neg ? 'background:#fde3e3;color:#c0392b;' : ''}">${esc(it.label || tag.label || '(未命名)')}<span class="tag-dim" style="color:${dm.color};">${dm.label}</span><span class="tag-val">+${val}</span></span>`;
      }).join(' ');
      return `<div class="task-stu">
        <div class="task-stu-name">${esc(name)}${seatTag}${moodTag}</div>
        <div style="padding:6px 0;">${chips || '<span class="text-muted">未填写</span>'}</div></div>`;
    }).join('') + `</div>
    <div style="margin-top:12px;color:#c0392b;">❌ 未填写（${notFilled.length}）：${notFilled.map(n => `<span class="batch-pill" style="background:#fde3e3;">${esc(n)}</span>`).join(' ') || '全部填写🎉'}</div>`;
}

document.getElementById('btnLoadTagReport')?.addEventListener('click', loadTagReport);

/* ================= 批量评价 ================= */
const batchState = { dates: [], students: [], loaded: false, tagList: [] };

function renderAwardOptionPick() {
  const tagId = document.getElementById('awardTag').value;
  const tag = (batchState.tagList || []).find(t => t.id === tagId);
  const field = document.getElementById('awardOptionField');
  const box = document.getElementById('awardOptionBox');
  const opts = (tag && tag.options) || [];
  if (!opts.length) { field.hidden = true; box.innerHTML = ''; return; }
  field.hidden = false;
  box.innerHTML = opts.map(o =>
    `<label class="batch-pill"><input type="checkbox" value="${esc(o)}" style="display:none">${esc(o)}</label>`).join('');
  box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
    cb.closest('.batch-pill').classList.toggle('on', cb.checked);
  }));
}
function selectedAwardOptions() {
  return [...document.querySelectorAll('#awardOptionBox input:checked')].map(i => i.value);
}

async function activateBatchTab() {
  if (!batchState.loaded) {
    batchState.loaded = true;
    await loadBatchClasses();
    document.getElementById('awardClass').addEventListener('change', loadBatchTagsAndStudents);
    document.getElementById('awardTag').addEventListener('change', renderAwardOptionPick);
    document.getElementById('btnAddAwardDate').addEventListener('click', addBatchDate);
    document.getElementById('btnAwardToday').addEventListener('click', () => {
      document.getElementById('awardDates').value = todayStr(); addBatchDate();
    });
    document.getElementById('btnAwardClearDates').addEventListener('click', () => {
      batchState.dates = []; renderBatchDates();
    });
    document.getElementById('btnAwardAll').addEventListener('click', () => {
      batchState.students = batchState.allStudents || []; renderBatchStudents();
    });
    document.getElementById('btnAwardNone').addEventListener('click', () => {
      batchState.students = []; renderBatchStudents();
    });
    document.getElementById('btnAwardGo').addEventListener('click', runBatchAward);
    document.getElementById('btnTaskGradeGo').addEventListener('click', runBatchTaskGrade);
    document.getElementById('awardTaskDate').value = todayStr();
    document.getElementById('awardTaskDate').addEventListener('change', () => {
      const cls = document.getElementById('awardClass').value;
      if (cls) loadAwardTasks(cls);
    });
  }
}

async function loadAwardTasks(cls) {
  const sel = document.getElementById('awardTask');
  if (!cls) { sel.innerHTML = '<option value="">选班级后加载</option>'; return; }
  const d = document.getElementById('awardTaskDate').value || todayStr();
  const { data: tasks } = await supabase.from('daily_task')
    .select('id,title,task_date,task_type')
    .eq('class', cls).eq('task_date', d)
    .order('task_type');
  sel.innerHTML = '<option value="">请选择任务</option>' +
    ((tasks && tasks.length)
      ? tasks.map(t => `<option value="${t.id}">${t.task_type==='homework'?'🏠':'🏫'} ${esc(t.title)}</option>`).join('')
      : '<option value="" disabled>当天没有任务</option>');
}

async function runBatchTaskGrade() {
  const taskId = document.getElementById('awardTask').value;
  const grade = document.getElementById('awardGrade').value;
  const result = document.getElementById('taskGradeResult');
  if (!taskId) return toast('请先选择任务');
  if (!batchState.students.length) return toast('请先在上方选择学生');
  const btn = document.getElementById('btnTaskGradeGo');
  btn.disabled = true; btn.textContent = '正在评分…';
  result.textContent = '';
  try {
    const { data, error } = await supabase.rpc('batch_grade_task', {
      p_task_id: taskId, p_students: batchState.students, p_grade: grade
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    result.textContent = '✅ ' + (row && row.message ? row.message : '完成');
    toast('任务批量评分完成！');
  } catch (e) {
    result.textContent = '❌ ' + (e.message || '失败');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 批量给所选学生评等级';
  }
}

async function loadBatchClasses() {
  const sel = document.getElementById('awardClass');
  const { data: students } = await supabase.from('student_info').select('class').order('class');
  const classes = Array.from(new Set((students || []).map(s => s.class))).sort();
  sel.innerHTML = '<option value="">请选择班级</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

async function loadBatchTagsAndStudents() {
  const cls = document.getElementById('awardClass').value;
  const tagSel = document.getElementById('awardTag');
  const box = document.getElementById('awardStudentBox');
  if (!cls) { tagSel.innerHTML = '<option value="">请先选班级</option>'; box.innerHTML=''; return; }
  // 学生
  const { data: students } = await supabase.from('student_info')
    .select('student_name').eq('class', cls).order('student_name');
  batchState.allStudents = (students || []).map(s => s.student_name);
  batchState.students = batchState.allStudents.slice();
  renderBatchStudents();
  // 标签：正常加载全部；有二级选项(如优秀作业)时再弹出小项
  const { data: tags } = await supabase.from('behavior_tags')
    .select('id,label,category,xp_value,options').eq('is_active', true).order('sort_order');
  batchState.tagList = tags || [];
  tagSel.innerHTML = '<option value="">请选择标签</option>' +
    batchState.tagList.map(t => {
      const n = (t.options || []).length;
      return `<option value="${t.id}">[${t.category==='negative'?'消极':'积极'}·经验${t.xp_value}] ${esc(t.label)}${n?`（含${n}小项）`:''}</option>`;
    }).join('');
  renderAwardOptionPick();
  loadAwardTasks(cls);
}

function renderBatchStudents() {
  const box = document.getElementById('awardStudentBox');
  const all = batchState.allStudents || [];
  box.innerHTML = all.map(n => {
    const on = batchState.students.includes(n);
    return `<label class="batch-pill ${on?'on':''}"><input type="checkbox" value="${esc(n)}" ${on?'checked':''} style="display:none">${esc(n)}</label>`;
  }).join('');
  box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
    const v = cb.value;
    if (cb.checked && !batchState.students.includes(v)) batchState.students.push(v);
    if (!cb.checked) batchState.students = batchState.students.filter(x => x !== v);
    cb.closest('.batch-pill').classList.toggle('on', cb.checked);
  }));
}

function addBatchDate() {
  const v = document.getElementById('awardDates').value;
  if (!v) return toast('请选一个日期');
  if (!batchState.dates.includes(v)) batchState.dates.push(v);
  batchState.dates.sort();
  renderBatchDates();
}

function renderBatchDates() {
  const box = document.getElementById('awardDateChips');
  box.innerHTML = batchState.dates.map(d =>
    `<span class="batch-chip">${d} <button type="button" data-x="${d}">×</button></span>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    batchState.dates = batchState.dates.filter(x => x !== b.dataset.x);
    renderBatchDates();
  }));
}

async function runBatchAward() {
  const cls = document.getElementById('awardClass').value;
  const tagId = document.getElementById('awardTag').value;
  const result = document.getElementById('awardResult');
  if (!cls || !tagId) return toast('请先选班级和标签');
  if (!batchState.dates.length) return toast('请至少加一个日期');
  if (!batchState.students.length) return toast('请至少选一个学生');
  const btn = document.getElementById('btnAwardGo');
  btn.disabled = true; btn.textContent = '正在写入…';
  result.textContent = '';
  try {
    const opts = selectedAwardOptions();
    const labels = opts.length ? opts : [null];
    let total = 0, lastMsg = '';
    for (const lb of labels) {
      const { data, error } = await supabase.rpc('batch_award_tag', {
        p_class: cls, p_dates: batchState.dates, p_students: batchState.students,
        p_tag_id: tagId, p_label: lb
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      total += (row && row.ok_count) || 0;
      lastMsg = (row && row.message) || '';
    }
    result.textContent = '✅ 共写入 ' + total + ' 条（' + lastMsg + '）';
    toast('批量评价完成！');
  } catch (e) {
    result.textContent = '❌ ' + (e.message || '失败');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 一键批量评价';
  }
}

/* ===== 今日概览 ===== */
async function loadOverview() {
  const sem = document.getElementById('ovSemester').value;
  try {
    const { data: roster } = await supabase.from('student_directory').select('class,student_name');
    const total = (roster || []).length;
    const today = todayStrLocal();   // 本地日期，避免凌晨 0-8 点取到 UTC 昨天
    let q = supabase.from('daily_record').select('student_name,class,record_date').eq('record_date', today);
    if (sem !== '全部') q = q.eq('semester', sem);
    const { data: recs } = await q;
    const doneSet = new Set((recs || []).map(r => r.class + '|' + r.student_name));
    const done = doneSet.size;
    document.getElementById('ovTotal').textContent = total;
    document.getElementById('ovDone').textContent = done;
    document.getElementById('ovUndo').textContent = Math.max(0, total - done);
    let taskDone = 0;
    try {
      const { data: tdefs } = await supabase.from('daily_task').select('id').eq('task_date', today);
      if (tdefs && tdefs.length) {
        const { count } = await supabase.from('task_submission')
          .select('*', { count: 'exact', head: true })
          .in('task_id', tdefs.map(t=>t.id))
          .neq('grade', 'none');
        taskDone = count || 0;
      }
    } catch (e) {}
    document.getElementById('ovTaskDone').textContent = taskDone;
  } catch (e) {}
}
document.getElementById('ovSemester')?.addEventListener('change', loadOverview);
loadOverview();

/* ================= 数据统计 ================= */
const statsState = { loaded: false };
function monthAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function activateStatsTab() {
  if (statsState.loaded) return;
  statsState.loaded = true;
  document.getElementById('statsFrom').value = monthAgo();
  document.getElementById('statsTo').value = todayStrLocal();
  const clsSel = document.getElementById('statsClass');
  const { data: stu } = await supabase.from('student_info').select('class,student_name').order('student_name');
  const classes = Array.from(new Set((stu||[]).map(s=>s.class))).sort();
  clsSel.innerHTML = '<option value="">全部班级</option>' + classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const stuSel = document.getElementById('statsStudent');
  stuSel.innerHTML = '<option value="">全班汇总</option>' + (stu||[]).map(s=>`<option value="${esc(s.student_name)}">${esc(s.class)} · ${esc(s.student_name)}</option>`).join('');
  const { data: tasks } = await supabase.from('daily_task').select('id,title,task_date,task_type').order('task_date',{ascending:false}).limit(200);
  document.getElementById('statsTask').innerHTML = '<option value="">不按任务</option>' + (tasks||[]).map(t=>`<option value="${t.id}">${(t.task_date||'').slice(0,10)} ${t.task_type==='homework'?'🏠':'🏫'} ${esc(t.title)}</option>`).join('');
  const { data: allTags } = await supabase.from('behavior_tags').select('id,label,options,category').eq('is_active',true);
  let opt = '<option value="">不按小项</option>';
  (allTags||[]).forEach(t => {
    opt += `<option value="TAG::${t.label}">${esc(t.label)}（全部）</option>`;
    (t.options||[]).forEach(o => { opt += `<option value="OPT::${esc(o)}">　└ ${esc(o)}</option>`; });
  });
  document.getElementById('statsTag').innerHTML = opt;
  document.getElementById('btnStatsGo').addEventListener('click', runStats);
}

async function runStats() {
  const cls = document.getElementById('statsClass').value;
  const from = document.getElementById('statsFrom').value;
  const to = document.getElementById('statsTo').value;
  const student = document.getElementById('statsStudent').value;
  const category = document.getElementById('statsCategory').value;
  const out = document.getElementById('statsOut');
  out.innerHTML = '<div class="text-muted">统计中…</div>';

  let q = supabase.from('daily_record').select('class,student_name,record_date,behavior,teacher_comment').order('record_date',{ascending:false});
  if (cls) q = q.eq('class', cls);
  if (from) q = q.gte('record_date', from);
  if (to) q = q.lte('record_date', to);
  if (student) q = q.eq('student_name', student);
  const { data: recs, error } = await q;
  if (error) { out.innerHTML = '<div class="text-muted">加载失败：'+esc(error.message)+'</div>'; return; }

  // 标签计数
  const tagCount = {};
  let posTotal=0, negTotal=0, totalItems=0;
  (recs||[]).forEach(r => {
    ((r.behavior&&r.behavior.items)||[]).forEach(it => {
      if (category && it.category !== category) return;
      const label = it.label || '(未命名)';
      tagCount[label] = tagCount[label] || {pos:0,neg:0};
      if (it.category==='negative') { tagCount[label].neg++; negTotal++; }
      else { tagCount[label].pos++; posTotal++; }
      totalItems++;
    });
  });
  const tagRows = Object.entries(tagCount).sort((a,b)=>(b[1].pos+b[1].neg)-(a[1].pos+a[1].neg));

  // 任务评分统计（task_submission 只有 student_name/grade/task_id）
  let tq = supabase.from('task_submission').select('student_name,grade,task_id');
  if (student) tq = tq.eq('student_name', student);
  const { data: subs } = await tq;
  const gradeCount = {none:0,done:0,good:0,perfect:0};
  (subs||[]).forEach(s=>{ if(gradeCount[s.grade]!=null) gradeCount[s.grade]++; });

  // 单个学生历史时间线
  let timelineHtml = '';
  if (student) {
    timelineHtml = '<h3 style="margin:14px 0 6px;">🕘 '+esc(student)+' 历史表现</h3>';
    const list = (recs||[]).slice(0,60);
    if (!list.length) timelineHtml += '<div class="text-muted">该时间段没有记录。</div>';
    list.forEach(r => {
      const items = ((r.behavior&&r.behavior.items)||[]).map(it =>
        `<span class="batch-chip" style="${it.category==='negative'?'background:#fde3e3;color:#c0392b;':''}">${esc(it.label)}</span>`).join(' ');
      const comment = r.teacher_comment ? `<div style="color:#888;margin-top:4px;">💬 ${esc(r.teacher_comment)}</div>` : '';
      timelineHtml += `<div style="border-bottom:1px dashed #eee;padding:8px 0;">
        <b>${esc(r.record_date&&r.record_date.slice(0,10))}</b>
        <span style="margin-left:8px;">${items||'<span class="text-muted">无标签</span>'}</span>${comment}</div>`;
    });
  }

  const { data: roster } = await supabase.from('student_info').select('class,student_name');
  let allStudents = (roster||[]).map(r=>r.student_name);
  if (cls) allStudents = (roster||[]).filter(r=>r.class===cls).map(r=>r.student_name);

  // 任务谁做到/没做到
  let taskHtml = '';
  const taskId = document.getElementById('statsTask').value;
  if (taskId) {
    const { data: subs } = await supabase.from('task_submission').select('student_name,grade').eq('task_id', taskId);
    const doneMap = {}; (subs||[]).forEach(s=> doneMap[s.student_name]=s.grade);
    const did = allStudents.filter(n=>doneMap[n]);
    const not = allStudents.filter(n=>!doneMap[n]);
    const gname = {none:'未完成',done:'完成',good:'优秀A',perfect:'完美A+'};
    taskHtml = `<h3 style="margin-top:16px;">📋 任务完成情况</h3>
      <div style="color:#27ae60;">✅ 已完成（${did.length}）：${did.map(n=>`<span class="batch-pill">${esc(n)}${doneMap[n]&&doneMap[n]!=='done'?'·'+gname[doneMap[n]]:''}</span>`).join(' ')||'无人'}</div>
      <div style="color:#c0392b;margin-top:8px;">❌ 未完成（${not.length}）：${not.map(n=>`<span class="batch-pill" style="background:#fde3e3;">${esc(n)}</span>`).join(' ')||'全部完成🎉'}</div>`;
  }

  // 小项谁做到/没做到（如背了某课）
  let tagHtml = '';
  const tagSel = document.getElementById('statsTag').value;
  if (tagSel) {
    const [mode, val] = tagSel.split('::');
    const didSet = new Set();
    (recs||[]).forEach(r => {
      ((r.behavior&&r.behavior.items)||[]).forEach(it => {
        if (mode==='OPT' && it.value===val) didSet.add(r.student_name);
        if (mode==='TAG' && it.label===val) didSet.add(r.student_name);
      });
    });
    const did = allStudents.filter(n=>didSet.has(n));
    const not = allStudents.filter(n=>!didSet.has(n));
    tagHtml = `<h3 style="margin-top:16px;">🏷️ 「${esc(val)}」达成情况</h3>
      <div style="color:#27ae60;">✅ 已做到（${did.length}）：${did.map(n=>`<span class="batch-pill">${esc(n)}</span>`).join(' ')||'无人'}</div>
      <div style="color:#c0392b;margin-top:8px;">❌ 还没做到（${not.length}）：${not.map(n=>`<span class="batch-pill" style="background:#fde3e3;">${esc(n)}</span>`).join(' ')||'全部做到🎉'}</div>`;
  }

  out.innerHTML = `
    <div class="grid" style="gap:10px;margin-bottom:14px;">
      <div class="stat-box"><div class="stat-num">${new Set((recs||[]).map(r=>r.record_date)).size}</div><div class="text-muted">总记录天数</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#27ae60;">${posTotal}</div><div class="text-muted">积极表现</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#c0392b;">${negTotal}</div><div class="text-muted">需要加油</div></div>
      <div class="stat-box"><div class="stat-num">${totalItems}</div><div class="text-muted">标签总次数</div></div>
    </div>
    ${taskHtml}
    ${tagHtml}
    <h3 style="margin-top:16px;">🏷️ 各标签次数</h3>
    <table class="tbl" style="width:100%;border-collapse:collapse;">
      <tr style="text-align:left;"><th style="padding:6px;border-bottom:2px solid #eee;">标签</th><th>积极</th><th>消极</th><th>合计</th></tr>
      ${tagRows.map(([k,v])=>`<tr>
        <td style="padding:6px;border-bottom:1px solid #f3f3f3;">${esc(k)}</td>
        <td style="color:#27ae60;">${v.pos}</td>
        <td style="color:#c0392b;">${v.neg}</td>
        <td><b>${v.pos+v.neg}</b></td></tr>`).join('') || '<tr><td colspan=4 class="text-muted">无数据</td></tr>'}
    </table>
    <h3 style="margin-top:16px;">✅ 任务评级分布</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;">
      <span>⏳ 未完成：<b>${gradeCount.none}</b></span>
      <span>✅ 完成：<b>${gradeCount.done}</b></span>
      <span>👍 优秀A：<b style="color:#e67e22;">${gradeCount.good}</b></span>
      <span>🏆 完美A+：<b style="color:#f1c40f;">${gradeCount.perfect}</b></span>
    </div>
    ${timelineHtml}`;
}

/* ---------------- 座位编排 ---------------- */
let seatState = { rows: 7, cols: 6, placed: {} }; // key "r_c" -> name
async function activateSeatTab() {
  const sel = document.getElementById('seatClass');
  if (sel && !sel.options.length) {
    const { data } = await supabase.from('student_info').select('class').order('class');
    const cls = [...new Set((data||[]).map(s=>s.class).filter(Boolean))];
    sel.innerHTML = cls.map(c=>`<option value="${c}">${c}</option>`).join('');
    sel.onchange = loadSeat;
  }
  buildSeatGrid();
  await loadSeat();
}
function buildSeatGrid() {
  const board = document.getElementById('seatBoard');
  board.innerHTML = '';
  for (let r=0;r<seatState.rows;r++) for (let c=0;c<seatState.cols;c++) {
    const cell = document.createElement('div');
    cell.className = 'seat-cell';
    cell.dataset.key = r+'_'+c;
    cell.style.cssText='min-height:56px;border:1.5px dashed #c9b8ad;border-radius:8px;padding:4px;display:flex;align-items:center;justify-content:center;background:#f4f1ec;';
    board.appendChild(cell);
  }
  board.onclick = e => {
    const cell = e.target.closest('.seat-cell'); if(!cell) return;
    const cur = seatState.placed[cell.dataset.key];
    if (cur) { delete seatState.placed[cell.dataset.key]; renderSeat(); return; }
    if (seatSelected) { placeAt(cell.dataset.key, seatSelected); seatSelected = null; }
  };
}
async function loadSeat() {
  const cls = document.getElementById('seatClass').value;
  seatState.placed = {};
  let seatData = null, nameData = null, failed = false;
  try {
    [seatData, nameData] = await Promise.all([
      supabase.from('seat_grid').select('seat_row,seat_col,student_name').eq('class', cls),
      supabase.from('student_info').select('student_name').eq('class', cls)
    ]);
  } catch (e) { failed = true; }
  if (failed || !seatData || !nameData) {
    const v = await window.Offline.get('seat_' + cls);
    if (v && v.placed) {
      (v.placed || []).forEach(x => seatState.placed[x.r + '_' + x.c] = x.name);
      seatAllNames = v.names || [];
      renderSeat(seatAllNames);
      toast('离线模式：显示上次保存的座位表，改动会先存本地');
      return;
    }
    toast('座位表加载失败，请联网后重试');
    return;
  }
  (seatData.data || []).forEach(s => seatState.placed[s.seat_row + '_' + s.seat_col] = s.student_name);
  seatAllNames = (nameData.data || []).map(s => s.student_name);
  await window.Offline.set('seat_' + cls, {
    placed: Object.entries(seatState.placed).map(([k, name]) => { const [r, c] = k.split('_').map(Number); return { r, c, name }; }),
    names: seatAllNames
  });
  renderSeat(seatAllNames);
}
let seatSelected = null;
let seatAllNames = [];
function renderSeat(allNames) {
  allNames = allNames || seatAllNames;
  document.querySelectorAll('.seat-cell').forEach(cell => {
    const name = seatState.placed[cell.dataset.key];
    cell.innerHTML = name ? `<span class="seat-chip" draggable="true" data-name="${name}" style="cursor:move;background:#c8d5c0;padding:4px 10px;border-radius:8px;">${name}</span>` : '';
  });
  const placedSet = new Set(Object.values(seatState.placed));
  const pool = document.getElementById('seatPool');
  pool.innerHTML = allNames.filter(n=>!placedSet.has(n)).map(n=>`<span class="seat-chip" draggable="true" data-name="${n}" style="cursor:pointer;background:${seatSelected===n?'#c9a08e':'#eee'};padding:4px 10px;border-radius:8px;">${n}</span>`).join('');
  document.querySelectorAll('.seat-chip').forEach(chip => {
    chip.draggable = true;
    chip.ondragstart = e => e.dataTransfer.setData('text/plain', chip.dataset.name);
    chip.onclick = () => {
      const inCell = chip.closest('.seat-cell');
      if (inCell) { delete seatState.placed[inCell.dataset.key]; renderSeat(allNames); return; }
      seatSelected = chip.dataset.name;
      renderSeat(allNames);
    };
  });
}
function placeAt(key, name) {
  // 若该学生已在别处，先移走
  for (const k in seatState.placed) if (seatState.placed[k]===name) delete seatState.placed[k];
  seatState.placed[key] = name;
  renderSeat();
}
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnSeatSave');
  if (btn) btn.onclick = async () => {
    const cls = document.getElementById('seatClass').value;
    const rows = Object.entries(seatState.placed).map(([k,name]) => {
      const [r,c] = k.split('_').map(Number);
      return { class: cls, seat_row: r, seat_col: c, student_name: name };
    });
    const wr = await runWrite({ name: 'seat_save', params: { class: cls, rows } });
    if (!wr.ok) { toast('保存失败，请重试'); return; }
    toast(wr.queued ? '已离线保存，联网后同步 ✅' : '座位已保存');
    if (!wr.queued) await window.Offline.set('seat_' + cls, {
      placed: Object.entries(seatState.placed).map(([k, name]) => { const [r, c] = k.split('_').map(Number); return { r, c, name }; }),
      names: seatAllNames
    });
  };
});

/* ================= v152.1：个人任务 & 挑战任务 多选删除（83 号 SQL） ================= */
function refreshPtaskSel() {
  const box = els.personalTaskBox;
  const n = box.querySelectorAll('input[data-sel-ptask]:checked').length;
  const cnt = document.getElementById('ptaskSelCount');
  if (cnt) cnt.textContent = n ? `已选 ${n} 条` : '';
}
document.getElementById('btnPtaskSelAll')?.addEventListener('click', () => {
  els.personalTaskBox.querySelectorAll('input[data-sel-ptask]').forEach(cb => { cb.checked = true; });
  refreshPtaskSel();
});
document.getElementById('btnPtaskSelNone')?.addEventListener('click', () => {
  els.personalTaskBox.querySelectorAll('input[data-sel-ptask]').forEach(cb => { cb.checked = false; });
  refreshPtaskSel();
});
document.getElementById('btnPtaskDelBatch')?.addEventListener('click', async () => {
  const ids = Array.from(els.personalTaskBox.querySelectorAll('input[data-sel-ptask]:checked')).map(cb => cb.value);
  if (!ids.length) { toast('请先勾选要删除的个人任务'); return; }
  if (!confirm(`删除所选 ${ids.length} 条个人任务？已完成任务的已加经验将自动回退。`)) return;
  const btn = document.getElementById('btnPtaskDelBatch');
  btn.disabled = true;
  try {
    const wr = await runWrite({ name: 'delete_personal_tasks', params: { p_task_ids: ids } });
    if (!wr.ok) { toast('删除失败，请重试'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('删除失败：' + (d.reason || '')); return; }
    const refund = Number(d.refund_xp) || 0;
    const del = Number(d.deleted) || 0;
    const fail = Number(d.failed) || 0;
    toast(`已删除 ${del} 条${refund ? '，回退经验 ' + refund + 'xp' : ''}${fail ? '（失败 ' + fail + ' 条）' : ''} ✅`);
    loadPersonalTasks();
  } catch (e) { toast('删除失败，请重试'); }
  finally { btn.disabled = false; }
});

function refreshChallengeSel() {
  const box = els.challengeTaskBox;
  const n = box.querySelectorAll('input[data-sel-challenge]:checked').length;
  const cnt = document.getElementById('challengeSelCount');
  if (cnt) cnt.textContent = n ? `已选 ${n} 条` : '';
}
document.getElementById('btnChallengeSelAll')?.addEventListener('click', () => {
  els.challengeTaskBox.querySelectorAll('input[data-sel-challenge]').forEach(cb => { cb.checked = true; });
  refreshChallengeSel();
});
document.getElementById('btnChallengeSelNone')?.addEventListener('click', () => {
  els.challengeTaskBox.querySelectorAll('input[data-sel-challenge]').forEach(cb => { cb.checked = false; });
  refreshChallengeSel();
});
document.getElementById('btnChallengeDelBatch')?.addEventListener('click', async () => {
  const ids = Array.from(els.challengeTaskBox.querySelectorAll('input[data-sel-challenge]:checked')).map(cb => cb.value);
  if (!ids.length) { toast('请先勾选要删除的挑战任务'); return; }
  if (!confirm(`删除所选 ${ids.length} 条挑战任务？已达成档位加过的经验将自动回退。`)) return;
  const btn = document.getElementById('btnChallengeDelBatch');
  btn.disabled = true;
  try {
    const wr = await runWrite({ name: 'delete_challenge_tasks', params: { p_task_ids: ids } });
    if (!wr.ok) { toast('删除失败，请重试'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('删除失败：' + (d.reason || '')); return; }
    const refund = Number(d.refund_xp) || 0;
    const del = Number(d.deleted) || 0;
    const fail = Number(d.failed) || 0;
    toast(`已删除 ${del} 条${refund ? '，回退经验 ' + refund + 'xp' : ''}${fail ? '（失败 ' + fail + ' 条）' : ''} ✅`);
    loadChallengeTasks();
  } catch (e) { toast('删除失败，请重试'); }
  finally { btn.disabled = false; }
});
