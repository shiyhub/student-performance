/**
 * 教师后台逻辑
 * 权限：Supabase Auth 登录（authenticated），三张表全部读写权限
 * Supabase SDK 通过 js/vendor/supabase.js 本地引入（全局 window.supabase）
 */
/* 配置守卫：js/config.js 未加载时不抛 TypeError，降级为 supabase=null */
const SUPABASE_CFG = window.SUPABASE_CONFIG || null;
const supabase = (window.supabase && SUPABASE_CFG && SUPABASE_CFG.url)
  ? window.supabase.createClient(
      SUPABASE_CFG.url,
      SUPABASE_CFG.anonKey,
      { auth: { persistSession: true, autoRefreshToken: true } }
    )
  : null;
const ready = !!supabase &&
  !String(SUPABASE_CFG.url || '').includes('YOUR_PROJECT_REF');

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
  if (els.shopRefundModal && els.shopRefundModal.classList.contains('show')) { closeShopRefund(); return true; }
  if (els.recordModal.classList.contains('show')) { closeRecordModal(); return true; }
  if (els.classQrModal.classList.contains('show')) { closeClassQr(); return true; }
  if (els.studentQrModal.classList.contains('show')) { closeStudentQr(); return true; }
  return false;   // 主界面/登录页：不拦截
}

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const MOOD_MAP = {
  happy:  { lv: 5, label: '很棒' },
  good:   { lv: 4, label: '不错' },
  normal: { lv: 3, label: '一般' },
  down:   { lv: 2, label: '有点低落' },
  sad:    { lv: 1, label: '需要加油' }
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
  // 自动化任务（五维星光值自动加分）
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
  btnSyncExamXpLog: $('#btnSyncExamXpLog'),
  syncExamXpLogHint: $('#syncExamXpLogHint'),
  btnAllXpLogs: $('#btnAllXpLogs'),
  btnXpAnomalyZone: $('#btnXpAnomalyZone'),
  xpAnomalyZoneBadge: $('#xpAnomalyZoneBadge'),
  xpAnomalyZoneList: $('#xpAnomalyZoneList'),
  previewStudent: $('#previewStudent'),
  btnPreviewStudent: $('#btnPreviewStudent'),
  // v195：虚拟测试学生
  tsClass: $('#tsClass'),
  tsName: $('#tsName'),
  tsEnabled: $('#tsEnabled'),
  tsShowWall: $('#tsShowWall'),
  tsStatus: $('#tsStatus'),
  tsDays: $('#tsDays'),
  tsPerDay: $('#tsPerDay'),
  tsMin: $('#tsMin'),
  tsMax: $('#tsMax'),
  tsData: $('#tsData'),
  btnTsSave: $('#btnTsSave'),
  btnTsGenerate: $('#btnTsGenerate'),
  btnTsView: $('#btnTsView'),
  btnTsOpen: $('#btnTsOpen'),
  btnTsClear: $('#btnTsClear'),
  btnTsDelete: $('#btnTsDelete'),
  // v167：星光管理
  starClass: $('#starClass'),
  btnStarRefresh: $('#btnStarRefresh'),
  starProgressBox: $('#starProgressBox'),
  starAddXp: $('#starAddXp'),
  btnStarAddXp: $('#btnStarAddXp'),
  starDrawBox: $('#starDrawBox'),
  shopItemSel: $('#shopItemSel'),
  shopItemPrice: $('#shopItemPrice'),
  btnShopPriceSave: $('#btnShopPriceSave'),
  shopAdminMsg: $('#shopAdminMsg'),
  couponTodayBox: $('#couponTodayBox'),
  btnCouponRefresh: $('#btnCouponRefresh'),
  archiveLabel: $('#archiveLabel'),
  btnArchive: $('#btnArchive'),
  archiveResult: $('#archiveResult'),
  archiveBatchList: $('#archiveBatchList'),
  // v201：星光商店购买记录与回退
  shopClass: $('#shopClass'),
  shopStudent: $('#shopStudent'),
  shopFrom: $('#shopFrom'),
  shopTo: $('#shopTo'),
  shopItemFilter: $('#shopItemFilter'),
  shopStatus: $('#shopStatus'),
  shopKeyword: $('#shopKeyword'),
  shopType: $('#shopType'),
  shopRefund: $('#shopRefund'),
  shopMinStar: $('#shopMinStar'),
  shopMaxStar: $('#shopMaxStar'),
  shopSort: $('#shopSort'),
  shopQuick: $('#shopQuick'),
  shopFilterChips: $('#shopFilterChips'),
  btnShopExport: $('#btnShopExport'),
  btnShopQuery: $('#btnShopQuery'),
  btnShopReset: $('#btnShopReset'),
  shopOrderSummary: $('#shopOrderSummary'),
  shopOrderBox: $('#shopOrderBox'),
  shopOrderPager: $('#shopOrderPager'),
  shopAuditBox: $('#shopAuditBox'),
  btnShopAuditRefresh: $('#btnShopAuditRefresh'),
  shopRefundModal: $('#shopRefundModal'),
  shopRefundImpact: $('#shopRefundImpact'),
  shopRefundReason: $('#shopRefundReason'),
  shopRefundError: $('#shopRefundError'),
  btnShopRefundCancel: $('#btnShopRefundCancel'),
  btnShopRefundConfirm: $('#btnShopRefundConfirm'),
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
/* 116 号脚本未执行时，RPC 不存在 → 退回旧的直插写法，保证功能不断档 */
const isMissingRpc = e => /could not find the function|PGRST202|schema cache|function .* does not exist/i
  .test(String((e && (e.message || e.details || e.hint)) || e || ''));
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
      if (upErr) return { ok: false, error: upErr };
      const { data: pub } = supabase.storage.from('exam-papers').getPublicUrl(fileName);
      if (!pub || !pub.publicUrl) return { ok: false };
      // v116：走 RPC，由服务端计算星光值并按「家长可见」落库
      const r = await supabase.rpc('exam_paper_save', {
        p_student_id: p.student_id || null,
        p_class: p.class,
        p_student_name: p.student_name,
        p_record_date: p.record_date,
        p_subject: p.subject || null,
        p_score: (p.score === null || p.score === undefined || p.score === '') ? null : Number(p.score),
        p_score_text: p.score_text || null,
        p_note: p.note || null,
        p_image_url: pub.publicUrl,
        p_multiplier: p.multiplier == null ? 1 : Number(p.multiplier),
        p_visible: p.visible !== false
      });
      if (r.error && isMissingRpc(r.error)) {
        // 旧库未执行 116 号脚本：退回原直插（无星光加成、家长默认可见）
        const ins = await supabase.from('exam_paper').insert({
          image_url: pub.publicUrl,
          student_id: p.student_id,
          class: p.class,
          student_name: p.student_name,
          record_date: p.record_date,
          subject: p.subject || null,
          score: p.score,
          score_text: p.score_text || null,
          note: p.note || null
        });
        return { ok: !ins.error, data: { ok: !ins.error, fallback: true }, error: ins.error };
      }
      return { ok: !!(r.data && r.data.ok), data: r.data, error: r.error };
    }
    if (op.name === 'exam_delete') {
      if (p.path) { await supabase.storage.from('exam-papers').remove([p.path]); }
      const r = await supabase.rpc('exam_paper_delete', { p_id: p.id });
      if (r.error && isMissingRpc(r.error)) {
        const del = await supabase.from('exam_paper').delete().eq('id', p.id);
        return { ok: !del.error, data: { ok: !del.error, fallback: true }, error: del.error };
      }
      return { ok: !!(r.data && r.data.ok), data: r.data, error: r.error };
    }
    if (op.name === 'exam_batch_save') {
      // v153：成绩单批次 —— 可选成绩单原图上传 + exam_batch + exam_score
      // v116：改走 RPC，服务端统一校验并发放星光值；旧库自动退回原直插
      let imageUrl = null;
      if (p.imageBlob && p.fileName) {
        const { error: upErr } = await supabase.storage
          .from('exam-papers')
          .upload(p.fileName, p.imageBlob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
        if (upErr) return { ok: false, error: upErr };
        const { data: pub } = supabase.storage.from('exam-papers').getPublicUrl(p.fileName);
        if (!pub || !pub.publicUrl) return { ok: false };
        imageUrl = pub.publicUrl;
      }

      const r = await supabase.rpc('exam_batch_save', {
        p_class: p.class,
        p_exam_name: p.exam_name,
        p_subject: p.subject || null,
        p_exam_date: p.exam_date,
        p_note: p.note || null,
        p_image_url: imageUrl,
        p_multiplier: p.multiplier == null ? 1 : Number(p.multiplier),
        p_visible: p.visible !== false,
        p_rows: p.rows || []
      });
      if (r.error && isMissingRpc(r.error)) {
        const ins = await supabase.from('exam_batch').insert({
          class: p.class,
          exam_name: p.exam_name,
          subject: p.subject || null,
          exam_date: p.exam_date,
          note: p.note || null,
          image_url: imageUrl
        }).select('id').single();
        if (ins.error) return { ok: false, error: ins.error };
        const batchId = ins.data && ins.data.id;
        const rows = (p.rows || []).map(rw => ({
          batch_id: batchId,
          student_id: rw.student_id || null,
          class: p.class,
          student_name: rw.student_name,
          score: rw.score
        }));
        if (rows.length) {
          const sr = await supabase.from('exam_score').insert(rows);
          if (sr.error) return { ok: false, error: sr.error };
        }
        return { ok: true, data: { ok: true, fallback: true, batch_id: batchId } };
      }
      return { ok: !!(r.data && r.data.ok), data: r.data, error: r.error };
    }
    if (op.name === 'exam_batch_delete') {
      if (p.path) { await supabase.storage.from('exam-papers').remove([p.path]); }
      const r = await supabase.rpc('exam_batch_delete', { p_id: p.id });
      if (r.error && isMissingRpc(r.error)) {
        const del = await supabase.from('exam_batch').delete().eq('id', p.id);
        return { ok: !del.error, data: { ok: !del.error, fallback: true }, error: del.error };
      }
      return { ok: !!(r.data && r.data.ok), data: r.data, error: r.error };
    }
    if (op.name === 'seat_save') {
      const del = await supabase.from('seat_grid').delete().eq('class', p.class);
      if (del.error) return { ok: false };
      if (p.rows.length) { const up = await supabase.from('seat_grid').upsert(p.rows); if (up.error) return { ok: false }; }
      return { ok: true };
    }
  } catch (e) { throw e; }
  // v178(F-02)：白名单未命中不再静默成功返回；显式报错，便于开发期发现漏登记
  console.error('[syncRunner] 未登记的操作：' + op.name);
  throw new Error('unregistered_op: ' + op.name);
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
    // 业务失败也把服务端返回体带出去，调用方才能显示具体原因（如「已有同名考试」）
    return { ok: false, queued: false, data: r.data };   // v116
  } catch (e) {
    if (isNetErr(e)) { await window.Offline.enqueue(op); return { ok: true, queued: true }; }
    return { ok: false, queued: false };
  }
}
async function flushOfflineQueue() {
  if (!window.Offline || !window.Offline.online) return;
  const n = await window.Offline.drain(syncRunner);
  if (n > 0) { toast('已同步 ' + n + ' 条离线操作'); loadTaskReport(); }
}
let teacherBanner = null;
function ensureOfflineBanner() {
  if (teacherBanner || !document.body) return;
  teacherBanner = document.createElement('div');
  teacherBanner.id = 'offlineBanner';
  teacherBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#4e6b5c;color:#fff;text-align:center;font-size:13px;padding:6px 10px;box-shadow:0 2px 6px rgba(0,0,0,.15);';
  teacherBanner.textContent = '离线模式 · 改动稍后同步';
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
    els.loginError.textContent = '尚未配置数据库，请修改 js/config.js';
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
  if (els.btnSyncExamXpLog) els.btnSyncExamXpLog.addEventListener('click', syncExamXpLog);
  if (els.btnAllXpLogs) els.btnAllXpLogs.addEventListener('click', loadAllStudentLogs);
  if (els.btnXpAnomalyZone) els.btnXpAnomalyZone.addEventListener('click', loadXpAnomalyZone);
  if (els.btnPreviewStudent) els.btnPreviewStudent.addEventListener('click', openStudentPreview);
  // v195：虚拟测试学生
  if (els.btnTsSave) els.btnTsSave.addEventListener('click', saveTestStudent);
  if (els.btnTsGenerate) els.btnTsGenerate.addEventListener('click', generateTestData);
  if (els.btnTsView) els.btnTsView.addEventListener('click', viewTestData);
  if (els.btnTsOpen) els.btnTsOpen.addEventListener('click', openTestEntry);
  if (els.btnTsClear) els.btnTsClear.addEventListener('click', () => clearTestData(true));
  if (els.btnTsDelete) els.btnTsDelete.addEventListener('click', () => clearTestData(false));
  if (els.tsClass) els.tsClass.addEventListener('change', loadTestStudent);
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
  toast(from === '自动' ? '正在预缓存全校数据…' : '开始预缓存全校数据…');
  const ok = await window.Precache.runTeacher(p => {
    if (!p.done || p.done === p.total) return;
    if (!precacheToastTimer && (p.done === 1 || p.done % Math.max(1, Math.round(p.total / 5)) === 0)) {
      precacheToastTimer = setTimeout(() => { precacheToastTimer = null; }, 2500);
      toast('预缓存中 ' + p.done + '/' + p.total + '（' + (p.label || '') + '）');
    }
  });
  if (ok) {
    const okN = (window.Precache.lastResult && window.Precache.lastResult.ok) || 0;
    if (okN === 0) toast('预缓存失败，联网后自动重试');
    else toast('预缓存完成：' + okN + ' 项已缓存');
  }
  else toast('预缓存未执行');
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
    exam: 'tabExam', task: 'tabTask', batch: 'tabBatch', stats: 'tabStats', xpLog: 'tabXpLog',
    star: 'tabStar', shop: 'tabShop', tools: 'tabTools', seat: 'tabSeat',
    checkin: 'tabCheckin'
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
  if (name === 'tools') { fillPreviewClasses(); initTestStudent(); }
  if (name === 'task') activateTaskTab();
  if (name === 'batch') activateBatchTab();
  if (name === 'stats') activateStatsTab();
  if (name === 'xpLog') fillXpLogClasses();
  if (name === 'star') activateStarTab();
  if (name === 'shop') activateShopTab();
  if (name === 'seat') activateSeatTab();
  if (name === 'checkin') activateCheckinTab();
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
  star: ['starProgressBox', 'starDrawBox', 'archiveResult', 'archiveBatchList', 'shopAdminMsg'],
  shop: ['shopOrderBox', 'shopOrderSummary', 'shopOrderPager', 'shopAuditBox', 'shopFilterChips'],
  tools: [],
  seat: ['seatBoard', 'seatPool'],
  checkin: ['checkinItemList', 'checkinDayBox', 'dimWeightBox']
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

  loadUndoPanel();   // v179：撤销栈与记录列表同步刷新（失败静默，不影响列表）

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
    html += '<div class="rec-section-title">' + I.notebook() + ' 在校表现记录</div>';
    html += data.map(r => renderRecordCard(r)).join('');
  }
  if (!notes.length && !data.length) {
    html = '<div class="empty">无符合条件的记录</div>';
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
      toast(wr.queued ? '已保存，联网后自动发送' : '已回复家长');
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
  let html = '<div class="rec-section-title home">' + I.home() + ' 家长留言 · 在家表现<span class="n">仅老师可见</span></div>';
  notes.forEach(n => {
    const info = n.student_info || {};
    // v50：回复线程（按时间正序展示，教师评论 / 家长回复多轮交流）
    const replies = (n.replies || []).slice().sort((a, b) =>
      (a.create_at || '').localeCompare(b.create_at || ''));
    html += `<div class="rec-card home-card-row">
              <div class="rec-meta">
                <span class="class-pill">${esc(info.class || '')}</span>
                <b>${esc(info.student_name || '')}</b>
                <span class="home-who">${I.users('ico-xs')} ${esc(n.parent_name)}</span>
                <span class="rec-when">${formatDate(n.record_date)} ${formatTime(n.create_at)}</span>
                <span class="rec-tools">
                  <button class="btn btn-ghost btn-sm danger-text" data-del-note="${n.id}">${I.trash('ico-sm')} 删除</button>
                </span>
              </div>
              <div class="home-content">${esc(n.content || '')}</div>
              <div class="home-replies">
                ${replies.map(r => `
                  <div class="home-reply ${r.sender === 'teacher' ? 't' : 'p'}">
                    <span class="hr-who">${r.sender === 'teacher' ? '' + I.user() + ' 老师' : '' + I.users() + ' 家长'}</span>
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

/* ---------------- v179：撤销 / 恢复 ----------------
   学生端不再校验身份（40 人共用白板，效率优先），误填/错人/重复提交由这里兜底：
   撤销 = 快照入库 + 删除（经验/五维/星光由触发器照原逻辑回退）
   恢复 = 按快照插回（触发器重新加分），窗口期内的误操作可原样还原          */
async function undoRecord(id, reason) {
  if (!window.Offline || !window.Offline.online) { toast('撤销需要联网'); return false; }
  const r = await supabase.rpc('teacher_undo_record', { p_record_id: id, p_reason: reason || null });
  if (r.error) { toast('撤销失败：' + r.error.message); return false; }
  const d = r.data || {};
  if (d.ok !== true) {
    toast(d.reason === 'not_found' ? '这条记录已不存在，刷新看看' : '撤销失败，请重试');
    return false;
  }
  toast(`已撤销${d.student_name ? ' ' + d.student_name : ''}${d.xp_refunded ? '，回退 ' + d.xp_refunded + ' 星光值' : ''}`);
  return true;
}

async function deleteRecord(id) {
  if (!confirm('撤销这条记录？\n星光值会一并回退，之后可在「最近撤销」里恢复。')) return;
  if (!(await undoRecord(id))) return;
  invalidateRecCache();
  await loadRecords();
  loadUndoPanel(true);
}

async function undoRecords(ids) {
  if (!ids.length) return;
  let ok = 0, fail = 0;
  for (const id of ids) { (await undoRecord(id)) ? ok++ : fail++; }
  invalidateRecCache();
  await loadRecords();
  loadUndoPanel(true);
  if (ok) toast(`已撤销 ${ok} 条${fail ? `，${fail} 条失败` : ''}，可在「最近撤销」恢复`);
}

async function restoreRecord(undoId) {
  if (!window.Offline || !window.Offline.online) { toast('恢复需要联网'); return; }
  const r = await supabase.rpc('teacher_restore_record', { p_undo_id: undoId });
  if (r.error) { toast('恢复失败：' + r.error.message); return; }
  const d = r.data || {};
  if (d.ok !== true) {
    toast(d.reason === 'already_restored' ? '这条已经恢复过了'
      : d.reason === 'no_student' ? '该学生已不在名单里，无法恢复'
      : d.reason === 'duplicate_day' ? '该生当天已有记录，先撤销新的再恢复这条'
      : '恢复失败，请重试');
    loadUndoPanel(true);
    return;
  }
  toast(`已恢复${d.student_name ? ' ' + d.student_name : ''}${d.xp_restored ? '，加回 ' + d.xp_restored + ' 星光值' : ''}`);
  invalidateRecCache();
  await loadRecords();
  loadUndoPanel(true);
}

let undoTs = 0;
async function loadUndoPanel(force) {
  const card = document.getElementById('undoCard');
  if (!card) return;
  // 与记录列表同步刷新，但 10s 内不重复请求（撤销/恢复后强制刷新）
  if (!force && Date.now() - undoTs < 10000) return;
  undoTs = Date.now();
  let list = [];
  try {
    const r = await supabase.rpc('teacher_list_record_undo', { p_class: els.filterClass.value || null, p_limit: 20 });
    if (!r.error && Array.isArray(r.data)) list = r.data;
  } catch (e) {}
  const pending = list.filter(x => !x.restored_at);
  if (!pending.length) { card.hidden = true; return; }
  card.hidden = false;
  document.getElementById('undoCount').textContent = `${pending.length}`;
  document.getElementById('undoBox').innerHTML = pending.map(x => {
    const items = (x.items || []).map(i => i.value ? `${esc(i.label || '')}：${esc(i.value)}` : esc(i.label || '')).join(' · ');
    return `<div class="undo-row">
      <div class="undo-info">
        <b>${esc(x.student_name)}</b>
        <span class="class-pill">${esc(x.class)}</span>
        <span class="undo-when">${formatDate(x.record_date)}</span>
        <span class="undo-xp">${x.xp_delta ? '−' + x.xp_delta + ' 星光值' : '无星光值'}</span>
        ${x.reason ? `<span class="undo-reason">${esc(x.reason)}</span>` : ''}
      </div>
      <div class="undo-items">${items || '（无表现项）'}</div>
      <button class="btn btn-ghost btn-sm" data-restore="${x.undo_id}">${I.undo('ico-sm')} 恢复</button>
    </div>`;
  }).join('');
  $$('[data-restore]', document.getElementById('undoBox')).forEach(btn => {
    btn.addEventListener('click', () => restoreRecord(btn.dataset.restore));
  });
}
document.getElementById('btnUndoToggle')?.addEventListener('click', e => {
  const box = document.getElementById('undoBox');
  const willHide = !box.hidden;
  box.hidden = willHide;
  e.currentTarget.textContent = willHide ? '展开' : '收起';
});

// 批量撤销所选记录（可恢复）
document.getElementById('btnRecCheckAll')?.addEventListener('click', () => {
  const boxes = document.querySelectorAll('.rec-check');
  const anyUnchecked = [...boxes].some(b => !b.checked);
  boxes.forEach(b => b.checked = anyUnchecked);
});
document.getElementById('btnBatchDelRec')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.rec-check:checked')].map(b => b.value);
  if (!ids.length) return toast('请先勾选要撤销的记录');
  if (!confirm(`撤销选中的 ${ids.length} 条记录？\n星光值会一并回退，之后可在「最近撤销」里恢复。`)) return;
  await undoRecords(ids);
});

async function deleteHomeNote(id) {
  if (!confirm('删除这条留言？不可恢复')) return;
  const { error } = await supabase.from('home_note').delete().eq('id', id);
  if (error) { toast('删除失败：' + error.message); return; }
  toast('已删除');
  loadRecords();
  invalidateRecCache();
}

/* ---------------- 新增 / 修改记录弹窗 ---------------- */

const MOOD_LEVELS_T = [
  { key: 'sad',    lv: 1, label: '需要加油' },
  { key: 'down',   lv: 2, label: '有点低落' },
  { key: 'normal', lv: 3, label: '一般' },
  { key: 'good',   lv: 4, label: '不错' },
  { key: 'happy',  lv: 5, label: '很棒' }
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
    record.behavior.items.filter(it => it && typeof it === 'object').forEach(it => {
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
    b.textContent = '';
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
  els.recMood.innerHTML = `${I.mood(m.lv)} ${m.label}`;
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
    extra = '<div class="rec-tag-group"><div class="rec-tag-title">历史标签（已停用或删除）</div><div class="rec-preserved">' +
      recState.preserved.map(it => {
        if (it.type === 'text') return `<span class="rec-chip active">${esc(it.label)}：${esc(it.value || '')}</span>`;
        return `<span class="rec-chip active ${it.category === 'negative' ? 'neg' : ''}">${esc(it.label)}${it.value ? ' · ' + esc(it.value) : ''}</span>`;
      }).join('') + '</div></div>';
  }

  els.recTags.innerHTML = group('' + I['star-fill']() + ' 积极表现', pos, 'pos') + group('' + I.drop() + ' 需要加油', neg, 'neg') + extra;

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
    return showRecError('请至少选一项表现');
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
    ? I.starRow(starCount)
    : '<span style="color:#98a69f;font-weight:600;">未打星</span>';
  const mood = MOOD_MAP[r.behavior && r.behavior.mood];

  let itemsHtml = '';
  const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items.filter(it => it && typeof it === 'object') : [];
  if (items.length) {
    itemsHtml = '<ul class="item-list">';
    items.forEach(it => {
      const label = esc(it.label || '');
      const neg = it.category === 'negative';
      const liCls = neg ? ' class="item-neg"' : '';
      const tick = neg ? '<span class="neg-tick">!</span>' : '<span class="tick"></span>';
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
         <button class="btn btn-ghost btn-sm" data-edit-comment="${r.id}">${I.edit('ico-sm')} 添加教师评语</button>
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
              <span>${mood ? I.mood(mood.lv) + ' ' + mood.label : ''}</span>
              <span class="rec-when">${formatDate(r.record_date)} ${formatTime(r.create_at)}</span>
              <span class="rec-tools">
                <button class="btn btn-ghost btn-sm" data-edit-rec="${r.id}">${I.edit('ico-sm')} 修改</button>
                <button class="btn btn-ghost btn-sm danger-text" data-del-rec="${r.id}">${I.undo('ico-sm')} 撤销</button>
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
    els.studentBox.innerHTML = '<div class="empty">名单为空，请先录入学生</div>';
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
                 <button type="button" class="btn btn-ghost btn-sm class-qr-btn" data-qr-class="${esc(cls)}">${I.phone('ico-sm')} 本班家长查询码</button>
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
      const xp = Number(s.xp) || 0;
      html += `<div class="roster-row">
                 <div class="roster-who">
                   <div class="sname">${esc(s.student_name)}${s.is_test ? '<span class="stu-test-tag">测试</span>' : ''}
                     <span class="xp-badge" title="累计星光值 ${xp}">${I.star('ico-xs')}${xp}</span>
                     <button type="button" class="btn btn-ghost btn-sm xp-edit" data-xp-id="${s.id}"
                             data-xp-class="${esc(s.class)}" data-xp-name="${esc(s.student_name)}"
                             data-xp-cur="${xp}" title="手动调整该学生星光值">${I.edit('ico-sm')} 调星光值</button>
                     <button type="button" class="btn btn-ghost btn-sm stu-qr-btn"
                             data-stu-cls="${esc(s.class)}" data-stu-name="${esc(s.student_name)}"
                             title="设置密码并生成学生个人二维码">${I.key('ico-sm')} 个人码</button>
                   </div>
                   <div class="pchips" data-chips-for="${s.id}">
                     ${chips}
                     <button type="button" class="pchip-add" data-add-parent="${s.id}">＋家长</button>
                   </div>
                 </div>
                 <button class="icon-btn danger" title="删除学生" data-del-id="${s.id}">${I.trash('ico-sm')}</button>
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
  // 手动调整学生星光值
  $$('[data-xp-id]', els.studentBox).forEach(btn => {
    btn.addEventListener('click', async () => {
      const cur = Number(btn.dataset.xpCur) || 0;
      const input = prompt(`给「${btn.dataset.xpName}」设置星光值：\n（当前 ${cur} 点）`, String(cur));
      if (input == null) return;
      const newXp = parseInt(input, 10);
      if (isNaN(newXp) || newXp < 0) { toast('请输入 0 以上的数字'); return; }
      // v204：必须带原因，服务端会把差额写进星光流水并留审计记录
      const why = prompt('调整原因（会记入星光流水与审计，可留空）：', '教师手动调整');
      if (why === null) return;
      const { data, error } = await supabase.rpc('set_student_xp', {
        p_class: btn.dataset.xpClass,
        p_student: btn.dataset.xpName,
        p_xp: newXp,
        p_reason: why || null
      });
      if (error) { toast('调整失败：' + error.message); return; }
      if (data && data.ok === false) {
        toast(data.reason === 'teacher_only' ? '请先登录教师账号' : '没找到这个学生');
        return;
      }
      const d = (data && data.delta) || 0;
      toast(`已设为 ${data.xp} 星光值${d ? `（${d > 0 ? '+' : ''}${d} 已记入流水）` : ''}`);
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
        toast('至少保留一位家长');
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
      toast('已有同名学生，可在名单里加家长');
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
    els.stuQrImage.innerHTML = '<p class="text-muted">尚未设置密码：点「' + I.dice() + ' 生成新密码」后自动出二维码。</p>';
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
        bad.push({ lineNo, raw, reason: '至少两列：学生姓名 + 家长姓名' });
        return;
      }
      rowClass = cls; name = parts[0]; parents = parts.slice(1);
    } else {
      // 混班：至少要有"班级 + 学生 + 1 位家长"三列
      if (parts.length < 3) {
        bad.push({ lineNo, raw, reason: '未填统一班级时，每行需三列' });
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
               ${I['check-circle']()} 检查通过，本次将导入 <b>${students.length}</b> 名学生、共 <b>${totalParents}</b> 位家长：
               <ul>${groupHtml}</ul>
               确认无误后点「② 确认导入」；已存在的学生和家长会自动跳过，新家长会追加到已有学生名下。
             </div>`;
  } else {
    html += '<div class="banner banner-error">没有可导入的有效行</div>';
  }
  if (bad.length) {
    html += `<div class="banner banner-error batch-bad">
               ${I.alert()} 有 <b>${bad.length}</b> 行无法识别，已排除（不影响其他行导入）：
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
    els.tagBox.innerHTML = '<div class="empty">暂无标签</div>';
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
    ['de','' + I.heart() + ' 德'],['zhi','' + I['book-open']() + ' 智'],['ti','' + I.dumbbell() + ' 体'],['mei','' + I.palette() + ' 美'],['lao','' + I.broom() + ' 劳']
  ].map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('');

  els.tagBox.innerHTML = data.map(t => `
    <div class="tag-edit-row${t.category === 'negative' ? ' row-neg' : ''}" data-tag-id="${t.id}">
      <input type="text" class="tag-label" value="${esc(t.label)}" maxlength="600" placeholder="标签文字（最长600字）">
      <input type="text" class="tag-options" value="${esc((t.options || []).join(','))}"
             maxlength="600" placeholder="二级标签，逗号分隔（选填）">
      <select class="tag-cat" title="心情分类（影响学生心情）">
        <option value="positive"${t.category === 'positive' ? ' selected' : ''}>积极</option>
        <option value="negative"${t.category === 'negative' ? ' selected' : ''}>消极</option>
      </select>
      <select class="tag-dim" title="加分维度（星光值加进该维度）">${DIM_OPT('', t.dim)}</select>
      <span class="tag-type-badge" title="仅支持勾选型">勾选型</span>
      <label class="tag-off-toggle" title="可重复：每天可多次；不可重复：同一项只记一次">
        <input type="checkbox" class="tag-repeat" ${t.history_unique === false ? 'checked' : ''}> 可重复提交
      </label>
      <label class="tag-off-toggle">
        <input type="checkbox" class="tag-active" ${t.is_active ? 'checked' : ''}> 启用
      </label>
      <input type="number" class="tag-sort" value="${Number(t.sort_order) || 0}" min="0" max="9999" title="排序，数字越小越靠前">
      <input type="number" class="tag-xp" value="${t.xp_value == null ? 2 : Number(t.xp_value)}" min="0" max="100" title="星光值，老师可自定义（消极建议0）">
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
      // 星光值老师可自定义：积极/消极都不强制（0~100）
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

/* ---------------- 自动化任务（五维星光值自动加分） ---------------- */

const DIM_LABEL = { de: '德', zhi: '智', ti: '体', mei: '美', lao: '劳' };
const DIM_ICON = { de: '' + I.heart() + '', zhi: '' + I['book-open']() + '', ti: '' + I.dumbbell() + '', mei: '' + I.palette() + '', lao: '' + I.broom() + '' };
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
  if (!tagId) { toast('请先选任务标签'); return; }
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
    if (wr.queued) { toast('已离线保存，联网后自动分配'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('分配失败：' + (d.reason || '')); return; }
    toast(`已分配 ${d.created} 名学生${d.skipped ? '（跳过重复 ' + d.skipped + '）' : ''}`);
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
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '需先执行 68 号 SQL')}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">暂无任务</div>';
    return;
  }
  const today = todayStr();
  box.innerHTML = rows.map(t => `
    <div class="auto-rule-row">
      <div class="rule-info">
        <div class="rule-title">${esc(t.task_date || '')}${String(t.task_date || '').slice(0, 10) === today ? '<span class="badge-off" style="margin-left:6px;">今天</span>' : ''}
          <span class="badge-dim">${esc(t.student_name)}</span>
          <span class="badge-tag">${esc(t.behavior_tags && t.behavior_tags.label || '(标签已删)')}</span>
          <span class="badge-${t.status === 'done' ? 'off' : 'dim'}" style="margin-left:6px;">${t.status === 'done' ? '' + I['check-circle']() + ' 已完成' : '' + I.hourglass() + ' 待完成'}</span>
        </div>
      </div>
      <div class="rule-actions">
        ${t.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-del-task="${t.id}">取消</button>` : ''}
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-del-task]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('取消这条任务？')) return;
    const wr = await runWrite({ name: 'delete_manual_task', params: { p_task_id: btn.dataset.delTask } });
    if (!wr.ok) { toast('取消失败，请重试'); return; }
    toast(wr.queued ? '已离线保存，联网后同步' : '已取消');
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
  if (!(xp >= 1 && xp <= 100)) { toast('星光值分值需在 1-100 之间'); return; }
  if (!personalState.students.length) { toast('请至少选择一名学生'); return; }
  const btn = document.getElementById('btnPersonalAssign');
  btn.disabled = true;
  try {
    const wr = await runWrite({ name: 'create_personal_tasks', params: {
      p_class: cls, p_content: content, p_dim: dim, p_xp_value: xp, p_date: date, p_deadline: deadline,
      p_students: personalState.students.map(n => ({ value: n }))
    }});
    if (!wr.ok) { toast('发布失败，请重试'); return; }
    if (wr.queued) { toast('已离线保存，联网后自动发布'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('发布失败：' + (d.reason || '')); return; }
    toast(`已发布给 ${d.created} 名学生${d.skipped ? '（跳过重复 ' + d.skipped + '）' : ''}`);
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
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '需先执行 69 号 SQL')}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">暂无个人任务</div>';
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
          <span class="badge-${t.status === 'done' ? 'off' : 'dim'}" style="margin-left:6px;">${t.status === 'done' ? (t.filled_by === 'teacher' ? '' + I['check-circle']() + ' 教师代填' : '' + I['check-circle']() + ' 已完成') : '' + I.hourglass() + ' 待完成'}</span>
        </div>
      </div>
      <div class="rule-actions">
        ${t.status === 'pending' ? `
          <button class="btn btn-warn btn-sm" data-fill-ptask="${t.id}" style="margin-right:6px;">代填</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-del-ptask="${t.id}" style="${t.status === 'done' ? 'color:#c0392b;border-color:#e0b4b0;' : ''}">${t.status === 'done' ? '删除（回退星光值）' : '取消'}</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-fill-ptask]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.fillPtask;
    if (!confirm('代填此任务并按分值加分？')) return;
    const wr = await runWrite({ name: 'teacher_fill_personal_task', params: { p_task_id: id } });
    if (!wr.ok) { toast('代填失败，请重试'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('代填失败：' + (d.reason || '')); return; }
    toast(`已代填，星光值+${d.xp_delta}`);
    loadPersonalTasks();
  }));
  box.querySelectorAll('[data-del-ptask]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('删除？已加星光值将回退')) return;
    const wr = await runWrite({ name: 'delete_personal_task', params: { p_task_id: btn.dataset.delPtask } });
    if (!wr.ok) { toast('删除失败，请重试'); return; }
    const d2 = wr.res || {};
    if (d2.ok === false) { toast('删除失败：' + (d2.reason || '')); return; }
    const refund2 = Number(d2.refund_xp) || 0;
    toast(wr.queued ? '已离线保存，联网后同步' : (refund2 ? '已删除，回退星光值 ' + refund2 + 'xp' : '已删除'));
    loadPersonalTasks();
  }));
  box.querySelectorAll('input[data-sel-ptask]').forEach(cb => cb.addEventListener('change', refreshPtaskSel));
}

/* ================= 挑战任务（档位制，教师可自定义档位与星光值） ================= */
const DEFAULT_CHALLENGE_LEVELS = (() => { const a = []; for (let lv = 10; lv <= 110; lv += 5) a.push([lv, lv / 5]); return a; })();
const challengeState = { students: [], allStudents: [], levels: DEFAULT_CHALLENGE_LEVELS.map(x => x.slice()) };

function renderChallengeLevels() {
  const box = els.challengeLevelBox;
  box.innerHTML = challengeState.levels.map((lv, i) => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:#f7f3ec;border:1px solid #e6d9c3;border-radius:8px;padding:4px 6px;">
      <input type="number" data-lv-n="${i}" value="${lv[0]}" style="width:64px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;font-size:13px;" title="档位数值">
      <span style="font-size:12px;color:#8a7a66;">档</span>
      <input type="number" data-lv-xp="${i}" value="${lv[1]}" style="width:56px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;font-size:13px;" title="星光值">
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
    if (!wr.ok) { toast('需先执行 82 号 SQL'); return; }
    if (wr.queued) { toast('已离线保存，联网后自动发布'); return; }
    const d = wr.res || {};
    if (d.ok === false) { toast('发布失败：' + (d.reason || '')); return; }
    toast(`已发布给 ${d.created} 名学生${d.skipped ? '（跳过重复 ' + d.skipped + '）' : ''}`);
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
    box.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '需先执行 82 号 SQL')}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">暂无挑战任务</div>';
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
    // v152：档位方案 levels=[[档位,星光值],...]；已达成 done_levels=[档位,...]（82 号 SQL 新增列）
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
          <span class="badge-tag">${I.trophy('ico-xs')} ${esc(t.title)}</span>
          <span class="badge-dim" style="margin-left:4px;">${DIM_LABEL[t.dim] || t.dim}</span>
          <span class="badge-${allDone ? 'off' : 'dim'}" style="margin-left:6px;">${allDone ? `${I.trophy()} 全部达成 ${doneArr.length}/${total} · 共+${gain}xp` : `进行中 ${doneArr.length}/${total} 档 · 已+${gain}xp`}</span>
        </div>
      </div>
      <div class="rule-actions">
        ${(subsMap.get(t.id) || []).length ? `<button class="btn btn-ghost btn-sm" data-sub-toggle="${t.id}">填报记录 ${(subsMap.get(t.id) || []).length} 次</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-del-challenge="${t.id}" style="${allDone ? 'color:#c0392b;border-color:#e0b4b0;' : ''}">${allDone ? '删除（回退星光值）' : '取消'}</button>
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
  }).join('') || '<div class="empty">暂无挑战任务</div>';
  box.querySelectorAll('[data-sub-toggle]').forEach(btn => btn.addEventListener('click', () => {
    const b = box.querySelector('[data-sub-box="' + btn.dataset.subToggle + '"]');
    if (b) b.style.display = (b.style.display === 'none') ? '' : 'none';
  }));
  box.querySelectorAll('[data-cancel-sub]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('取消填报？星光值将回退')) return;
    const wr = await runWrite({ name: 'cancel_challenge_submission', params: { p_submission_id: btn.dataset.cancelSub } });
    if (!wr.ok) { toast('取消失败，请重试'); return; }
    const d4 = wr.res || {};
    if (d4.ok === false) { toast('取消失败：' + (d4.reason || '')); return; }
    const refund4 = Number(d4.refund_xp) || 0;
    toast(refund4 ? '已取消本次填报，回退 ' + refund4 + 'xp' : '已取消本次填报');
    loadChallengeTasks();
  }));
  box.querySelectorAll('[data-del-challenge]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('删除？已加星光值将回退')) return;
    const wr = await runWrite({ name: 'delete_challenge_task', params: { p_task_id: btn.dataset.delChallenge } });
    if (!wr.ok) { toast('删除失败，请重试'); return; }
    const d3 = wr.res || {};
    if (d3.ok === false) { toast('删除失败：' + (d3.reason || '')); return; }
    const refund3 = Number(d3.refund_xp) || 0;
    toast(wr.queued ? '已离线保存，联网后同步' : (refund3 ? '已删除，回退星光值 ' + refund3 + 'xp' : '已删除'));
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
    els.autoBox.innerHTML = `<div class="banner banner-error">加载失败：${esc(e.message || '需先执行 61 号 SQL')}</div>`;
    return;
  }
  if (!rows.length) {
    els.autoBox.innerHTML = '<div class="empty">暂无自动化任务</div>';
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
      <span class="rule-meta">${I.clock('ico-xs')} ${fmtRange(r)} · ${fmtWeek(r.weekdays)}</span>
      <span class="rule-meta">${r.is_active ? '' + I['circle-dot']() + ' 生效中' : '' + I['circle-dot']() + ' 已停用'}</span>
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
      if (!confirm('删除该自动化任务？历史加分记录一并删除')) return;
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
    if (!tagId) return toast('请选择目标标签');
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
  if (!confirm('按历史记录重算全班星光值，不删记录。继续？')) return;
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
    els.recalcResult.textContent = `完成，重放了 ${data && data.records_replayed} 条记录`;
    toast('星光值已重算');
    loadStudents();
  } catch (e) {
    els.recalcResult.textContent = '失败：' + ((e && e.message) || '网络异常，请重试');
    toast('重算失败：' + ((e && e.message) || '网络异常，请重试'));
  } finally {
    btn.disabled = false;
    btn.textContent = '一键重算全班星光值';
  }
}

// v204：异常星光值排查（口径 v2）
// 应得 = 表现/任务流水 + 考试实发 + 教师手动调整；考试分不再被当成异常
const XP_KIND_META = {
  positive: { label: '偏多', color: '#b84c3a', bg: '#fdecea' },
  negative: { label: '偏少', color: '#a93b36', bg: '#fdecea' },
  acked:    { label: '已核准', color: '#5b6472', bg: '#eef0f3' }
};
function xpKindChip(kind) {
  const m = XP_KIND_META[kind] || { label: kind || '—', color: '#5b6472', bg: '#eef0f3' };
  return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;color:${m.color};background:${m.bg};">${m.label}</span>`;
}
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
      box.innerHTML = `<div class="banner banner-error">扫描失败：${esc(error.message)}（请确认已执行 137 号 SQL）</div>`;
      if (hint) hint.textContent = '';
      return;
    }
    const rows = (data && data.rows) || [];
    const anom = (data && data.anomaly_count) || 0;
    const acked = (data && data.acked_count) || 0;
    const gapCnt = (data && data.exam_gap_count) || 0;
    const sources = (data && data.log_sources) || [];
    if (hint) hint.textContent = '';

    const banners = [];
    if (!sources.length) {
      banners.push(`<div class="banner banner-error" style="margin-bottom:8px;">本班还没有任何星光流水，扫描结果会全部显示为「偏多」。
        请先到「测试工具 → 注入星光值流水」执行一次。</div>`);
    }
    if (gapCnt > 0) {
      banners.push(`<div class="banner" style="margin-bottom:8px;">有 <b>${gapCnt}</b> 名学生的考试星光尚未写入流水。
        这不影响上面的判定（考试分已单独计入应得），只是「流水合计」会偏低；
        可点「补写考试流水」一次性补齐。</div>`);
    }

    if (!rows.length) {
      box.innerHTML = banners.join('') +
        `<div class="banner">${I['check-circle']()} 无异常差额：当前星光值与应得完全一致。</div>`;
      return;
    }

    const rowsHtml = rows.map(r => {
      const d = r.diff || 0;
      const raw = r.diff_raw || 0;
      const meta = XP_KIND_META[r.kind] || XP_KIND_META.positive;
      const exam = (r.exam_total || 0) > 0
        ? `${r.exam_total}${r.exam_log < r.exam_total ? '<span class="text-muted" style="font-size:12px;">（流水缺 ' + (r.exam_total - r.exam_log) + '）</span>' : ''}`
        : '<span class="text-muted">—</span>';
      const act = r.kind === 'acked'
        ? `<button class="btn btn-ghost btn-sm" data-ack-revoke="${esc(r.student)}" type="button">撤销核准</button>`
        : `<button class="btn btn-ghost btn-sm" data-ack="${esc(r.student)}" data-diff="${raw}" type="button">核准豁免</button>`;
      return `<tr>
        <td><b>${esc(r.student)}</b></td>
        <td style="text-align:right;">${r.cur_xp}</td>
        <td style="text-align:right;">${r.expected}</td>
        <td style="text-align:right;">${exam}</td>
        <td style="text-align:right;color:${meta.color};font-weight:600;">${d > 0 ? '+' : ''}${d}</td>
        <td style="text-align:center;">${xpKindChip(r.kind)}</td>
        <td style="font-size:13px;">${esc(r.reason || '')}</td>
        <td style="text-align:center;white-space:nowrap;">${act}</td>
      </tr>`;
    }).join('');

    box.innerHTML = banners.join('') + `
      <div style="margin-bottom:8px;font-size:14px;">
        待处理异常 <b style="color:#b84c3a;">${anom}</b> 名
        ｜ 已核准 <b>${acked}</b> 名
        <span class="text-muted">（同一条差额核准后不再计入异常；学生再有新增差额会重新报出）</span>
      </div>
      <div style="max-height:420px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f4f4f5;">
            <th style="padding:8px 10px;text-align:left;">学生</th>
            <th style="padding:8px 10px;text-align:right;">当前星光值</th>
            <th style="padding:8px 10px;text-align:right;">应得</th>
            <th style="padding:8px 10px;text-align:right;">其中考试</th>
            <th style="padding:8px 10px;text-align:right;">差额</th>
            <th style="padding:8px 10px;text-align:center;">判定</th>
            <th style="padding:8px 10px;text-align:left;">说明</th>
            <th style="padding:8px 10px;text-align:center;">处置</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    box.querySelectorAll('button[data-ack]').forEach(b => {
      b.addEventListener('click', () => ackXpDiff(b.dataset.ack, Number(b.dataset.diff)));
    });
    box.querySelectorAll('button[data-ack-revoke]').forEach(b => {
      b.addEventListener('click', () => revokeXpDiffAck(b.dataset.ackRevoke));
    });
  } catch (e) {
    box.innerHTML = `<div class="banner banner-error">扫描失败：${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    if (hint && hint.textContent === '扫描中…') hint.textContent = '';
  }
}

// v204：核准一条历史差额（人工确认后不再反复误报）
async function ackXpDiff(student, diff) {
  const reason = window.prompt(
    `将「${student}」当前差额 ${diff > 0 ? '+' : ''}${diff} 标记为已核准。\n` +
    '适用于：历史手动调分、导入数据、已核实的操作，且短期内不会再变化。\n\n请输入原因（可留空）：', '历史手动调整');
  if (reason === null) return;
  try {
    const { data, error } = await supabase.rpc('ack_xp_diff', {
      p_class: els.xpLogClass.value, p_student: student, p_diff: diff, p_reason: reason || null
    });
    if (error || !data || data.ok !== true) { toast('核准失败：' + ((error && error.message) || '仅登录教师可操作')); return; }
    toast('已核准，后续不再计入异常');
    scanXpAnomaly();
  } catch (e) { toast('核准失败：' + e.message); }
}

async function revokeXpDiffAck(student) {
  if (!window.confirm(`撤销「${student}」的差额核准？撤销后该差额会重新计入异常。`)) return;
  try {
    const { data, error } = await supabase.rpc('revoke_xp_diff_ack', {
      p_class: els.xpLogClass.value, p_student: student
    });
    if (error || !data || data.ok !== true) { toast('撤销失败：' + ((error && error.message) || '仅登录教师可操作')); return; }
    toast('已撤销核准');
    scanXpAnomaly();
  } catch (e) { toast('撤销失败：' + e.message); }
}

// v204：补写考试星光流水（历史数据一次性补齐）
async function syncExamXpLog() {
  const btn = els.btnSyncExamXpLog, hint = els.syncExamXpLogHint;
  const cls = els.xpLogClass ? els.xpLogClass.value : '';
  if (!window.confirm('把考试成绩的星光值补写进星光流水？' + (cls ? `（仅 ${cls}）` : '（全部班级）') + '\n可重复执行，不会重复加分。')) return;
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = '补写中…';
  try {
    const { data, error } = await supabase.rpc('sync_exam_xp_log', { p_class: cls || null });
    if (error) { if (hint) hint.textContent = '失败：' + error.message + '（请确认已执行 137 号 SQL）'; return; }
    const ins = (data && data.injected) || 0;
    const cln = (data && data.cleaned) || 0;
    if (hint) hint.textContent = `完成：补写 ${ins} 条，清理失效 ${cln} 条`;
    toast(`已补写 ${ins} 条考试流水`);
    scanXpAnomaly();
  } catch (e) {
    if (hint) hint.textContent = '失败：' + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// v153：学生星光值日志（全班日志总览，点击行查该生流水）
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
    if (!rows.length) { box.innerHTML = '<div class="banner">暂无学生或流水</div>'; return; }
    const rowsHtml = rows.map(r => {
      const d = r.diff || 0;
      const color = d === 0 ? 'inherit' : (d > 0 ? '#b84c3a' : '#a93b36');
      return `<tr class="xp-log-row" data-stu="${esc(r.student)}" style="cursor:pointer;">
        <td><b>${esc(r.student)}</b></td>
        <td style="text-align:right;">${r.cur_xp}</td>
        <td style="text-align:right;">${r.log_total}</td>
        <td style="text-align:right;color:${color};font-weight:600;">${d > 0 ? '+' : ''}${d}</td>
        <td style="text-align:center;">${r.log_cnt || 0} 条</td>
        <td style="text-align:center;">${esc(r.last_date || '—')}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <div style="margin-bottom:8px;font-size:14px;">全班 <b>${rows.length}</b> 名学生星光值日志（点击学生行查看该生流水明细）：</div>
      <div style="max-height:480px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f4f4f5;">
            <th style="padding:8px 10px;text-align:left;">学生</th>
            <th style="padding:8px 10px;text-align:right;">当前星光值</th>
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

// v153：星光值异常区（自动上报清单）
const XP_ANOMALY_TYPE = {
  missing_tag: '标签已删除',
  bad_xp_value: '星光值配置异常',
  bad_dim: '五维配置异常',
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
    if (!rows.length) { box.innerHTML = '<div class="banner">' + I['check-circle']() + ' 暂无自动上报的星光值异常。</div>'; return; }
    const rowsHtml = rows.map(r => {
      const d = r.detail || {};
      let extra = '';
      if (r.type === 'missing_tag' && d.tag_id) extra = '标签ID：<code>' + esc(String(d.tag_id).slice(0, 8)) + '</code>';
      if (r.type === 'bad_xp_value') extra = (esc(d.label || '') + ' = ' + (d.xp_value === undefined ? '' : d.xp_value) + ' xp');
      if (r.type === 'bad_dim') extra = (esc(d.label || '') + ' 维度「' + esc(d.dim || '') + '」');
      if (r.type === 'negative_clip') extra = '原星光值 ' + d.before + '，扣 ' + d.delta;
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


// v152.7：星光值流水注入（测试工具）｜v204：含考试成绩补写
async function injectXpLog() {
  if (!confirm('把全部加分（含考试成绩）写入星光流水，可重复执行、不会重复加分。继续？')) return;
  const btn = els.btnInjectXpLog, out = els.injectXpLogResult;
  if (btn) btn.disabled = true;
  if (out) out.textContent = '注入中…';
  try {
    let { data, error } = await supabase.rpc('rebuild_xp_log');
    // 137 号未执行时退回旧入口（此时考试分补不进来，会提示）
    if (error) ({ data, error } = await supabase.rpc('inject_xp_log'));
    if (error) { if (out) out.textContent = '失败：' + error.message; return; }
    const total = (data && data.injected) || 0;
    const exam = (data && data.exam_injected) || 0;
    if (out) out.textContent = `注入完成，共写入 ${total} 条星光记录${exam ? `（其中考试 ${exam} 条）` : ''}`;
  } catch (e) { if (out) out.textContent = '失败：' + e.message; }
  finally { if (btn) btn.disabled = false; }
}

// v152.7：星光记录查询
const XP_LOG_SRC = { daily: '日常表现', task: '每日任务', personal: '个人任务', challenge: '挑战任务', manual: '手动任务', exam: '考试成绩', adjust: '教师调整' };
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
  if (error) { box.innerHTML = `<div class="banner banner-error">查询失败：${esc(error.message)}（请确认已执行 137 号 SQL）</div>`; return; }
  const rows = (data && data.rows) || [];
  const total = (data && data.total) || 0;
  let cur = 0;
  const { data: info } = await supabase
    .from('student_info').select('xp').eq('class', cls).eq('student_name', name).single();
  if (info) cur = info.xp || 0;
  if (!rows.length) {
    box.innerHTML = '<div class="banner">该生暂无流水。若已有考试成绩或表现记录，请先到「测试工具 → 注入星光值流水」执行一次。</div>';
    return;
  }
  let acc = 0;
  const rowsHtml = rows.map(r => {
    const xp = r.xp || 0;
    acc += xp;
    const sign = xp < 0 ? '' : '+';
    return `<tr>
      <td style="white-space:nowrap;">${esc(r.date || '')}</td>
      <td>${XP_LOG_SRC[r.source] || r.source}</td>
      <td>${esc(r.label || '')}</td>
      <td style="text-align:center;">${XP_LOG_DIM[r.dim] || (r.dim ? r.dim : '—')}</td>
      <td style="text-align:right;${xp < 0 ? 'color:#a93b36;' : ''}">${sign}${xp}</td>
      <td style="text-align:right;font-weight:600;">${acc}</td>
    </tr>`;
  }).join('');
  box.innerHTML = `
    <div style="margin-bottom:8px;font-size:14px;">
      流水合计 <b>${total} xp</b> ｜ 当前星光值 <b>${cur} xp</b> ｜ 差额 <b>${cur - total} xp</b>
      <span class="text-muted">（差额为手动调分、删除回退等未留痕操作；考试成绩与教师调整已计入流水）</span>
    </div>
    <div style="max-height:480px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#f4f4f5;">
          <th style="padding:8px 10px;text-align:left;">日期</th>
          <th style="padding:8px 10px;text-align:left;">渠道</th>
          <th style="padding:8px 10px;text-align:left;">说明</th>
          <th style="padding:8px 10px;text-align:center;">维度</th>
          <th style="padding:8px 10px;text-align:right;">星光值</th>
          <th style="padding:8px 10px;text-align:right;">累计</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

/* ---------------- v195：虚拟测试学生 ---------------- */
let tsCurrent = null;

async function initTestStudent() {
  if (!els.tsClass) return;
  if (!els.tsClass.options.length) {
    let classes = [];
    try {
      const { data } = await supabase.from('student_info').select('class').order('class');
      classes = Array.from(new Set((data || []).map(x => x.class))).sort();
    } catch (e) { classes = []; }
    els.tsClass.innerHTML = classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  if (els.tsClass.value) loadTestStudent();
  else if (els.tsStatus) els.tsStatus.textContent = '暂无班级';
}

async function loadTestStudent() {
  if (!els.tsClass || !els.tsStatus) return;
  const cls = els.tsClass.value;
  if (!cls) { els.tsStatus.textContent = '先选班级'; return; }
  const { data, error } = await supabase.rpc('test_student_get', { p_class: cls });
  if (error) { els.tsStatus.textContent = '读取失败：' + error.message; return; }

  if (!data || !data.exists) {
    tsCurrent = null;
    els.tsStatus.textContent = '未创建';
    els.tsName.value = '测试学生';
    els.tsEnabled.checked = true;
    els.tsShowWall.checked = false;
    if (els.tsData) els.tsData.textContent = '';
    return;
  }

  tsCurrent = data;
  const st = data.student || {}, stats = data.stats || {}, wallet = data.wallet || {}, cfg = st.config || {};
  els.tsName.value = st.name || '测试学生';
  els.tsEnabled.checked = !!st.enabled;
  els.tsShowWall.checked = !!st.show_on_wall;
  if (cfg.days) els.tsDays.value = cfg.days;
  if (cfg.per_day) els.tsPerDay.value = cfg.per_day;
  if (cfg.star_min) els.tsMin.value = cfg.star_min;
  if (cfg.star_max) els.tsMax.value = cfg.star_max;
  els.tsStatus.textContent =
    `${st.enabled ? '已启用' : '已停用'} · 记录 ${stats.records || 0} 条 · 星光值 ${st.xp || 0} · 余额 ${wallet.balance || 0}` +
    (stats.last_record ? ` · 最近 ${stats.last_record}` : '');
}

async function saveTestStudent() {
  if (!els.tsClass) return;
  const cls = els.tsClass.value;
  const name = (els.tsName.value || '').trim();
  if (!cls || !name) return toast('请填写班级和姓名');
  els.btnTsSave.disabled = true;
  const { data, error } = await supabase.rpc('test_student_save', {
    p_class: cls, p_name: name,
    p_enabled: !!els.tsEnabled.checked,
    p_show_on_wall: !!els.tsShowWall.checked,
    p_note: null
  });
  els.btnTsSave.disabled = false;
  if (error) return toast('保存失败：' + error.message);
  if (!data || data.ok === false) {
    const reason = data && data.reason;
    if (reason === 'name_conflict') toast('该班已有同名学生，换个名字');
    else if (reason === 'rename_blocked') toast('已有测试数据，不能改名');
    else toast('保存失败');
    return;
  }
  toast('已保存');
  loadTestStudent();
}

async function generateTestData() {
  const cls = els.tsClass && els.tsClass.value;
  if (!cls) return toast('先选班级');
  els.btnTsGenerate.disabled = true;
  const { data, error } = await supabase.rpc('test_student_generate', {
    p_class: cls,
    p_days: Number(els.tsDays.value) || 7,
    p_per_day: Number(els.tsPerDay.value) || 1,
    p_star_min: Number(els.tsMin.value) || 3,
    p_star_max: Number(els.tsMax.value) || 5,
    p_mood: null
  });
  els.btnTsGenerate.disabled = false;
  if (error) return toast('生成失败：' + error.message);
  if (!data || data.ok === false) {
    return toast(data && data.reason === 'disabled' ? '测试学生已停用' : '先生成账号');
  }
  toast(`已生成 ${data.generated || 0} 条`);
  loadTestStudent();
}

async function viewTestData() {
  const cls = els.tsClass && els.tsClass.value;
  if (!cls) return toast('先选班级');
  const { data, error } = await supabase.rpc('test_student_data', { p_class: cls, p_limit: 20 });
  if (error) { els.tsData.textContent = '读取失败：' + error.message; return; }
  if (!data || data.ok === false) { els.tsData.textContent = '暂无数据'; return; }
  const rows = data.records || [];
  if (!rows.length) { els.tsData.textContent = '暂无数据'; return; }
  els.tsData.textContent = rows.map(r =>
    `${r.date}  ${r.star == null ? '-' : r.star}星  ${r.mood || '-'}  标签 ${r.items || 0} 个  ${r.comment || ''}`
  ).join('\n');
}

async function clearTestData(keepAccount) {
  const cls = els.tsClass && els.tsClass.value;
  if (!cls) return toast('先选班级');
  const tip = keepAccount ? '清空该测试学生的全部数据（保留账号）？' : '删除测试账号及其全部数据？';
  if (!confirm(tip)) return;
  const { data, error } = await supabase.rpc('test_student_clear', { p_class: cls, p_keep_account: keepAccount });
  if (error) return toast('操作失败：' + error.message);
  if (!data || data.ok === false) return toast('操作失败');
  toast(keepAccount ? '已清空' : '已删除');
  if (els.tsData) els.tsData.textContent = '';
  loadTestStudent();
}

function openTestEntry() {
  const cls = els.tsClass && els.tsClass.value;
  const name = ((els.tsName && els.tsName.value) || '').trim() || '测试学生';
  if (!cls) return toast('先选班级');
  const url = `./index.html?test=1&class=${encodeURIComponent(cls)}&student=${encodeURIComponent(name)}`;
  window.open(url, '_blank');
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
  if (/failed to fetch|networkerror|network error|load failed|request failed/i.test(msg)) return '网络连接失败，请重试';
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
  msg = String(msg == null ? '' : msg).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\s{2,}/g, ' ').trim();
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
    toast(wr.queued ? '已离线保存，联网后同步' : '任务已更新');
    cancelTaskEdit();
  } else {
    const wr = await runWrite({ name: 'task_insert', params: { class: cls, task_date: date, semester: semOf(date), task_type: type, title, detail, due_time: due } });
    if (!wr.ok) { toast('发布失败，请重试'); return; }
    toast(wr.queued ? '已离线保存，联网后发布' : '任务已发布，学生端今天就能看到啦');
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
  if (btn) btn.textContent = '保存修改';
  const cancelBtn = document.getElementById('btnCancelTaskEdit');
  if (cancelBtn) cancelBtn.hidden = false;
  const note = document.querySelector('#taskForm .text-muted');
  if (note) note.textContent = '正在编辑，保存后生效';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('btnLoadReport')?.addEventListener('click', loadTaskReport);

const TASK_TYPE_LABEL = { classwork: '' + I.school() + ' 课堂作业', homework: '' + I.home() + ' 家庭作业' };

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
          ? '<p class="text-muted">离线无缓存，请先联网打开该日期</p>'
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
    box.innerHTML = '<p class="text-muted">当天未发布任务</p>';
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
      <button type="button" class="rf-btn${reportTaskFilter === 'all' ? ' on' : ''}" data-rf="all">${I.checklist('ico-sm')} 全部任务（${tasks.length}）</button>
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
          <button type="button" class="task-edit-btn" data-edit-id="${t.id}" data-title="${esc(t.title)}" data-detail="${esc(t.detail||'')}" data-type="${t.task_type}" data-date="${(t.task_date||'').slice(0,10)}" title="编辑">${I.edit('ico-sm')}</button>
          <button type="button" class="task-del-btn" data-del="${t.id}" title="删除这条任务">${I.trash('ico-sm')}</button>
          ${t.detail ? '<br><span class="text-muted">' + esc(t.detail) + '</span>' : ''}
        </div>
        <div class="task-stats">${I.hourglass('ico-xs')}未完成 ${counts.none} · ${I['check-circle']('ico-xs')}完成 ${counts.done} · ${I.thumb('ico-xs')}优秀 ${counts.good} · ${I.trophy('ico-xs')}完美 ${counts.perfect}</div>
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
      toast(wr.queued ? student + ' 已离线保存，联网后同步' : student + ' 已评为：' + btn.textContent.trim());
      loadTaskReport();
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('删除这条任务？已加星光值保留')) return;
      const wr = await runWrite({ name: 'task_delete', params: { p_task_id: btn.dataset.del } });
      if (!wr.ok) { toast('删除失败，请重试'); return; }
      toast(wr.queued ? '已离线删除，联网后同步' : '已删除'); loadTaskReport();
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
        ? '<p class="text-muted">离线无缓存，请先联网打开该日期</p>'
        : '<p class="text-muted">当天无打卡记录</p>';
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
    const items = ((byStu[name] && byStu[name].behavior && byStu[name].behavior.items) || [])
      .filter(it => it && typeof it === 'object');
    if (items.length) {
      filled++;
      items.forEach(it => {
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
      const items = ((r && r.behavior && r.behavior.items) || []).filter(it => it && typeof it === 'object');
      const st = seatMap[name];
      const seatTag = st ? `<span class="task-stu-seat">${st.r + 1}排${st.c + 1}座</span>` : '';
      const mood = r && r.behavior && r.behavior.mood ? MOOD_MAP[r.behavior.mood] : null;
      const moodTag = mood ? `<span class="tag-mood">${I.mood(mood.lv)}</span>` : '';
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
    <div style="margin-top:12px;color:#c0392b;">${I['x-circle']()} 未填写（${notFilled.length}）：${notFilled.map(n => `<span class="batch-pill" style="background:#fde3e3;">${esc(n)}</span>`).join(' ') || '全部填写' + I.sparkle() + ''}</div>`;
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
      ? tasks.map(t => `<option value="${t.id}">${t.task_type==='homework'?'家庭作业':'课堂作业'} ${esc(t.title)}</option>`).join('')
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
    result.textContent = '' + (row && row.message ? row.message : '完成');
    toast('任务批量评分完成！');
  } catch (e) {
    result.textContent = '' + (e.message || '失败');
  } finally {
    btn.disabled = false; btn.textContent = '批量评分';
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
      return `<option value="${t.id}">[${t.category==='negative'?'消极':'积极'}·星光值${t.xp_value}] ${esc(t.label)}${n?`（含${n}小项）`:''}</option>`;
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
    result.textContent = '共写入 ' + total + ' 条（' + lastMsg + '）';
    toast('批量评价完成！');
  } catch (e) {
    result.textContent = '' + (e.message || '失败');
  } finally {
    btn.disabled = false; btn.textContent = '一键批量评价';
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
  document.getElementById('statsTask').innerHTML = '<option value="">不按任务</option>' + (tasks||[]).map(t=>`<option value="${t.id}">${(t.task_date||'').slice(0,10)} ${t.task_type==='homework'?'家庭作业':'课堂作业'} ${esc(t.title)}</option>`).join('');
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
    ((r.behavior&&r.behavior.items)||[]).filter(it => it && typeof it === 'object').forEach(it => {
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
    timelineHtml = '<h3 style="margin:14px 0 6px;">' + I.clock() + ' '+esc(student)+' 历史表现</h3>';
    const list = (recs||[]).slice(0,60);
    if (!list.length) timelineHtml += '<div class="text-muted">无记录</div>';
    list.forEach(r => {
      const items = ((r.behavior&&r.behavior.items)||[]).filter(it => it && typeof it === 'object').map(it =>
        `<span class="batch-chip" style="${it.category==='negative'?'background:#fde3e3;color:#c0392b;':''}">${esc(it.label)}</span>`).join(' ');
      const comment = r.teacher_comment ? `<div style="color:#888;margin-top:4px;">${I.message()} ${esc(r.teacher_comment)}</div>` : '';
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
    taskHtml = `<h3 style="margin-top:16px;">${I.checklist()} 任务完成情况</h3>
      <div style="color:#27ae60;">${I['check-circle']()} 已完成（${did.length}）：${did.map(n=>`<span class="batch-pill">${esc(n)}${doneMap[n]&&doneMap[n]!=='done'?'·'+gname[doneMap[n]]:''}</span>`).join(' ')||'无人'}</div>
      <div style="color:#c0392b;margin-top:8px;">${I['x-circle']()} 未完成（${not.length}）：${not.map(n=>`<span class="batch-pill" style="background:#fde3e3;">${esc(n)}</span>`).join(' ')||'全部完成' + I.sparkle() + ''}</div>`;
  }

  // 小项谁做到/没做到（如背了某课）
  let tagHtml = '';
  const tagSel = document.getElementById('statsTag').value;
  if (tagSel) {
    const [mode, val] = tagSel.split('::');
    const didSet = new Set();
    (recs||[]).forEach(r => {
      ((r.behavior&&r.behavior.items)||[]).filter(it => it && typeof it === 'object').forEach(it => {
        if (mode==='OPT' && it.value===val) didSet.add(r.student_name);
        if (mode==='TAG' && it.label===val) didSet.add(r.student_name);
      });
    });
    const did = allStudents.filter(n=>didSet.has(n));
    const not = allStudents.filter(n=>!didSet.has(n));
    tagHtml = `<h3 style="margin-top:16px;">${I.tag()} 「${esc(val)}」达成情况</h3>
      <div style="color:#27ae60;">${I['check-circle']()} 已做到（${did.length}）：${did.map(n=>`<span class="batch-pill">${esc(n)}</span>`).join(' ')||'无人'}</div>
      <div style="color:#c0392b;margin-top:8px;">${I['x-circle']()} 还没做到（${not.length}）：${not.map(n=>`<span class="batch-pill" style="background:#fde3e3;">${esc(n)}</span>`).join(' ')||'全部做到' + I.sparkle() + ''}</div>`;
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
    <h3 style="margin-top:16px;">${I.tag()} 各标签次数</h3>
    <table class="tbl" style="width:100%;border-collapse:collapse;">
      <tr style="text-align:left;"><th style="padding:6px;border-bottom:2px solid #eee;">标签</th><th>积极</th><th>消极</th><th>合计</th></tr>
      ${tagRows.map(([k,v])=>`<tr>
        <td style="padding:6px;border-bottom:1px solid #f3f3f3;">${esc(k)}</td>
        <td style="color:#27ae60;">${v.pos}</td>
        <td style="color:#c0392b;">${v.neg}</td>
        <td><b>${v.pos+v.neg}</b></td></tr>`).join('') || '<tr><td colspan=4 class="text-muted">无数据</td></tr>'}
    </table>
    <h3 style="margin-top:16px;">${I['check-circle']()} 任务评级分布</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;">
      <span>${I.hourglass('ico-xs')} 未完成：<b>${gradeCount.none}</b></span>
      <span>${I['check-circle']('ico-xs')} 完成：<b>${gradeCount.done}</b></span>
      <span>${I.thumb('ico-xs')} 优秀A：<b style="color:#e67e22;">${gradeCount.good}</b></span>
      <span>${I.trophy('ico-xs')} 完美A+：<b style="color:#f1c40f;">${gradeCount.perfect}</b></span>
    </div>
    ${timelineHtml}`;
}

/* ---------------- v213：打卡管理 ----------------
   打卡项与记录都在 checkin_item / checkin_log 两张表里，
   增删改与撤销走 RPC（RPC 内部用 shop_admin_guard 校验教师身份）。 */
const CK_DIM = { de: '德', zhi: '智', ti: '体', mei: '美', lao: '劳' };
const CK_DIM_COLOR = { de: '#e74c3c', zhi: '#2e86de', ti: '#27ae60', mei: '#9b59b6', lao: '#e67e22' };
const ckState = { items: [], day: null, bound: false };

function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function activateCheckinTab() {
  const sel = document.getElementById('checkinClass');
  if (sel && !sel.options.length) {
    const { data } = await supabase.from('student_info').select('class').order('class');
    const cls = [...new Set((data || []).map(s => s.class).filter(Boolean))];
    sel.innerHTML = cls.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  const dt = document.getElementById('checkinDate');
  if (dt && !dt.value) dt.value = todayISO();
  bindCheckinAdmin();
  await loadCheckinAdmin();
}

function bindCheckinAdmin() {
  if (ckState.bound) return;
  ckState.bound = true;
  document.getElementById('btnCheckinRefresh').addEventListener('click', loadCheckinAdmin);
  document.getElementById('checkinClass').addEventListener('change', loadCheckinAdmin);
  document.getElementById('checkinDate').addEventListener('change', loadCheckinAdmin);
  document.getElementById('addCheckinForm').addEventListener('submit', onAddCheckinItem);
  document.getElementById('btnDimWeightSave').addEventListener('click', saveDimWeights);
  document.getElementById('checkinItemList').addEventListener('click', e => {
    const row = e.target.closest('.ck-row');
    if (!row) return;
    if (e.target.closest('.ck-save')) saveCheckinRow(row);
    else if (e.target.closest('.ck-del')) delCheckinRow(row);
  });
  document.getElementById('checkinDayBox').addEventListener('click', e => {
    const chip = e.target.closest('.ck-chip');
    if (!chip) return;
    cancelCheckinLog(chip.dataset.id, chip.dataset.name, chip.dataset.item);
  });
}

async function loadCheckinAdmin() {
  const clsEl = document.getElementById('checkinClass');
  const dateEl = document.getElementById('checkinDate');
  const cls = clsEl ? clsEl.value : '';
  const date = (dateEl && dateEl.value) ? dateEl.value : todayISO();

  const r1 = await supabase.rpc('get_checkin_items', { p_all: true });
  if (r1.error) {
    document.getElementById('checkinItemList').innerHTML =
      '<p class="text-muted">打卡功能还没启用：请先在 Supabase 执行 database/140-checkin-and-dim-norm.sql。</p>';
    document.getElementById('checkinDayBox').innerHTML = '';
    document.getElementById('dimWeightBox').innerHTML = '';
    return;
  }
  ckState.items = (r1.data && r1.data.items) || [];
  renderCheckinItemRows();

  if (cls) {
    const r2 = await supabase.rpc('get_checkin_day', { p_class: cls, p_date: date });
    ckState.day = (r2 && !r2.error && r2.data && r2.data.ok) ? r2.data : null;
  } else {
    ckState.day = null;
  }
  renderCheckinDayBox();
  await loadDimWeights();
}

function renderCheckinItemRows() {
  const box = document.getElementById('checkinItemList');
  if (!box) return;
  if (!ckState.items.length) {
    box.innerHTML = '<p class="text-muted">还没有打卡项，用下面的表单添加。</p>';
    return;
  }
  box.innerHTML = ckState.items.map(it => `
    <div class="ck-row" data-id="${esc(it.id)}">
      <input class="input ck-name" value="${esc(it.name)}" maxlength="20" title="名称">
      <select class="input ck-dim" title="计入哪一维">
        ${Object.keys(CK_DIM).map(k => `<option value="${k}"${k === it.dim ? ' selected' : ''}>${CK_DIM[k]}</option>`).join('')}
      </select>
      <input class="input ck-xp" type="number" min="0" max="50" value="${Number(it.xp) || 0}" title="每次加的星光值">
      <input class="input ck-icon" value="${esc(it.icon || '')}" maxlength="4" placeholder="图标" title="可填 emoji，如 🧹">
      <input class="input ck-sort" type="number" value="${Number(it.sort_order) || 0}" title="排序，小的在前">
      <label class="ck-en"><input type="checkbox" class="ck-enabled"${it.enabled ? ' checked' : ''}> 启用</label>
      <button class="btn btn-primary ck-save" type="button">保存</button>
      <button class="btn ck-del" type="button">删除</button>
    </div>`).join('');
}

function renderCheckinDayBox() {
  const box = document.getElementById('checkinDayBox');
  const total = document.getElementById('checkinDayTotal');
  if (!box) return;
  const d = ckState.day;
  if (!d || !d.items || !d.items.length) {
    if (total) total.textContent = '';
    box.innerHTML = '<p class="text-muted">这一天还没有打卡记录。</p>';
    return;
  }
  if (total) total.textContent = `· ${d.date} 共 ${d.total} 条（点名字可撤销）`;
  box.innerHTML = d.items.map(g => `
    <div class="ck-day">
      <div class="ck-day-head">
        <b>${esc(g.name)}</b>
        <span class="ck-dim-tag" style="color:${CK_DIM_COLOR[g.dim] || '#e67e22'}">${CK_DIM[g.dim] || '劳'}</span>
        <span class="text-muted">+${Number(g.xp) || 0} 星光 · ${Number(g.cnt) || 0} 人</span>
      </div>
      <div class="ck-day-names">
        ${(g.students || []).map(s => `<button class="ck-chip" type="button" data-id="${esc(s.id)}" data-name="${esc(s.name)}" data-item="${esc(g.name)}" title="点击撤销这条">${esc(s.name)}</button>`).join('')}
      </div>
    </div>`).join('');
}

async function saveCheckinRow(row) {
  const p_item = {
    id: row.dataset.id,
    name: (row.querySelector('.ck-name').value || '').trim(),
    dim: row.querySelector('.ck-dim').value,
    xp: Number(row.querySelector('.ck-xp').value) || 0,
    icon: (row.querySelector('.ck-icon').value || '').trim(),
    sort_order: Number(row.querySelector('.ck-sort').value) || 0,
    enabled: row.querySelector('.ck-enabled').checked
  };
  if (!p_item.name) { toast('名称不能为空'); return; }
  const { data, error } = await supabase.rpc('save_checkin_item', { p_item });
  if (error) { toast('保存失败：' + error.message); return; }
  if (!data || !data.ok) {
    const why = { dup_name: '已经有同名打卡项', bad_xp: '星光值要在 0–50 之间', bad_dim: '维度不合法', no_name: '名称不能为空' }[data && data.reason] || '保存失败';
    toast(why);
    return;
  }
  toast('已保存');
  loadCheckinAdmin();
}

async function delCheckinRow(row) {
  const name = (row.querySelector('.ck-name').value || '').trim();
  if (!confirm(`删除打卡项「${name}」？\n有历史记录时只会停用，记录仍可追溯。`)) return;
  const { data, error } = await supabase.rpc('delete_checkin_item', { p_id: row.dataset.id });
  if (error) { toast('删除失败：' + error.message); return; }
  if (!data || !data.ok) { toast('删除失败'); return; }
  toast(data.disabled ? `「${name}」已有 ${data.used} 条记录，已改为停用` : `「${name}」已删除`);
  loadCheckinAdmin();
}

async function onAddCheckinItem(e) {
  e.preventDefault();
  const name = (document.getElementById('addCkName').value || '').trim();
  if (!name) { toast('先填个名称'); return; }
  const p_item = {
    name,
    dim: document.getElementById('addCkDim').value,
    xp: Number(document.getElementById('addCkXp').value) || 0,
    icon: (document.getElementById('addCkIcon').value || '').trim(),
    sort_order: Number(document.getElementById('addCkSort').value) || 0,
    enabled: true
  };
  const { data, error } = await supabase.rpc('save_checkin_item', { p_item });
  if (error) { toast('添加失败：' + error.message); return; }
  if (!data || !data.ok) {
    const why = { dup_name: '已经有同名打卡项', bad_xp: '星光值要在 0–50 之间' }[data && data.reason] || '添加失败';
    toast(why);
    return;
  }
  toast(`已添加「${name}」`);
  document.getElementById('addCheckinForm').reset();
  document.getElementById('addCkXp').value = 2;
  document.getElementById('addCkSort').value = 50;
  loadCheckinAdmin();
}

async function cancelCheckinLog(id, name, item) {
  if (!id) return;
  if (!confirm(`撤销「${item}」里 ${name} 的这条记录？\n这一条加上的星光值会一并扣回。`)) return;
  const { data, error } = await supabase.rpc('cancel_checkin', { p_id: id });
  if (error) { toast('撤销失败：' + error.message); return; }
  if (!data || !data.ok) { toast('撤销失败'); return; }
  toast(`已撤销 ${name}，扣回 ${data.xp} 星光`);
  loadCheckinAdmin();
}

async function loadDimWeights() {
  const box = document.getElementById('dimWeightBox');
  if (!box) return;
  const { data, error } = await supabase.from('dim_weight').select('dim,weight');
  if (error) {
    box.innerHTML = '<p class="text-muted">权重表还没建，请先执行 140 号脚本。</p>';
    return;
  }
  const map = {};
  (data || []).forEach(r => { map[r.dim] = r.weight; });
  box.innerHTML = Object.keys(CK_DIM).map(k => `
    <label class="ck-w">
      <span class="ck-w-lab" style="color:${CK_DIM_COLOR[k]}">${CK_DIM[k]}</span>
      <input class="input ck-w-in" data-dim="${k}" type="number" step="0.1" min="0.2" max="3" value="${(map[k] == null ? 1 : Number(map[k]))}">
    </label>`).join('');
}

async function saveDimWeights() {
  const ins = Array.from(document.querySelectorAll('.ck-w-in'));
  let ok = 0, bad = 0;
  for (const el of ins) {
    const w = Number(el.value) || 1;
    const { data, error } = await supabase.rpc('set_dim_weight', { p_dim: el.dataset.dim, p_weight: w });
    if (!error && data && data.ok) ok++; else bad++;
  }
  toast(bad ? `${ok} 项已保存，${bad} 项失败` : `五维权重已保存（${ok} 项）`);
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
      toast('离线模式 · 改动先存本地');
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
    toast(wr.queued ? '已离线保存，联网后同步' : '座位已保存');
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
  if (!confirm(`删除所选 ${ids.length} 条个人任务？已完成任务的已加星光值将自动回退。`)) return;
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
    toast(`已删除 ${del} 条${refund ? '，回退星光值 ' + refund + 'xp' : ''}${fail ? '（失败 ' + fail + ' 条）' : ''}`);
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
  if (!confirm(`删除所选 ${ids.length} 条挑战任务？已达成档位加过的星光值将自动回退。`)) return;
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
    toast(`已删除 ${del} 条${refund ? '，回退星光值 ' + refund + 'xp' : ''}${fail ? '（失败 ' + fail + ' 条）' : ''}`);
    loadChallengeTasks();
  } catch (e) { toast('删除失败，请重试'); }
  finally { btn.disabled = false; }
});

/* ============================================================
   v167：星光管理（班级星光值 / 抽奖 / 商店 / 封存重置）
   ============================================================ */
async function activateStarTab() {
  await fillStarClasses();
  await Promise.all([loadStarProgress(), loadShopAdmin(), loadArchiveBatches(), loadTodayCoupons()]);
}

async function fillStarClasses() {
  if (!els.starClass) return;
  const cur = els.starClass.value;
  let classes = [];
  try {
    const r = await supabase.from('student_info').select('class');
    if (!r.error) classes = Array.from(new Set((r.data || []).map(x => x.class))).filter(Boolean).sort();
  } catch (e) { /* 离线 */ }
  if (!classes.length) {
    try {
      const v = await window.Offline.get('classes_all');
      classes = Array.from(new Set(((v && v.data) || []).map(x => x.class))).filter(Boolean).sort();
    } catch (e2) {}
  }
  els.starClass.innerHTML = '<option value="">请选择班级</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (cur) els.starClass.value = cur;
}

async function loadStarProgress() {
  const cls = els.starClass && els.starClass.value;
  if (!els.starProgressBox) return;
  if (!cls) { els.starProgressBox.innerHTML = '<div class="text-muted">请先选择班级。</div>'; return; }
  let d = null;
  try {
    const r = await supabase.rpc('get_class_progress', { p_class: cls });
    if (!r.error) d = r.data;
  } catch (e) {}
  if (!d || d.ok === false) { els.starProgressBox.innerHTML = '<div class="text-muted">读取失败，需先执行 109 号 SQL</div>'; return; }
  const pct = Math.max(0, Math.min(100, Number(d.pct) || 0));
  els.starProgressBox.innerHTML = `
    <div class="star-progress">
      <div class="sp-head"><span class="sp-lv">Lv.${d.level || 1}</span>
        <span class="sp-xp">班级星光值 <b>${d.xp || 0}</b>${d.next_need ? ` / ${d.next_need}` : ' · 满级'}</span></div>
      <div class="sp-bar"><i style="width:${pct}%"></i></div>
      <div class="sp-foot">
        <span>${d.next_need ? `再 ${d.next_level_need} 点升 Lv.${(d.level || 1) + 1}` : '已达最高等级'}</span>
        <span class="${d.chances ? 'sp-chance has' : 'sp-chance'}">${I.wheel('ico-xs')} 可抽奖 ${d.chances || 0} 次</span>
      </div>
    </div>`;
  loadStarDraws();
}

async function loadStarDraws() {
  const cls = els.starClass && els.starClass.value;
  if (!els.starDrawBox) return;
  if (!cls) { els.starDrawBox.innerHTML = ''; return; }
  let rows = [];
  try {
    const r = await supabase.rpc('get_class_draw_history', { p_class: cls, p_limit: 20 });
    if (!r.error && Array.isArray(r.data)) rows = r.data;
  } catch (e) {}
  if (!rows.length) { els.starDrawBox.innerHTML = '<div class="text-muted">暂无抽奖记录</div>'; return; }
  els.starDrawBox.innerHTML = `<table class="star-table"><thead><tr>
      <th>时间</th><th>升级</th><th>奖品</th><th>抽奖学生</th></tr></thead><tbody>` +
    rows.map(x => `<tr><td>${fmtTime(x.drawn_at)}</td><td>Lv.${x.level}</td>
      <td>${x.icon || '' + I.gift() + ''} ${esc(x.name || '')}</td><td>${esc(x.student_name || '—')}</td></tr>`).join('') +
    `</tbody></table>`;
}

async function loadShopAdmin() {
  if (!els.shopItemSel) return;
  let items = [];
  try {
    const r = await supabase.from('shop_item').select('item_key,item_type,name,price,group_name')
      .order('item_type').order('sort_order');
    if (!r.error) items = r.data || [];
  } catch (e) {}
  if (!items.length) {
    els.shopItemSel.innerHTML = '<option value="">暂无商品（请执行 110 号 SQL）</option>';
    return;
  }
  const typeLabel = { avatar: '头像', frame: '头像框', daily: '日常' };
  els.shopItemSel.innerHTML = items.map(x =>
    `<option value="${esc(x.item_key)}" data-price="${x.price}">${typeLabel[x.item_type] || '商品'} · ${esc(x.name)} · ${x.price}</option>`).join('');
  syncShopPriceInput();
}

/* v172：今日已使用的日常卡（免作业卡等），供老师核对 */
async function loadTodayCoupons() {
  if (!els.couponTodayBox) return;
  const cls = els.starClass && els.starClass.value;
  let rows = [];
  try {
    const r = await supabase.rpc('get_today_coupons', { p_class: cls || '' });
    if (!r.error && r.data && Array.isArray(r.data.items)) rows = r.data.items;
  } catch (e) {}
  if (!rows.length) { els.couponTodayBox.innerHTML = '<div class="text-muted">今日暂无</div>'; return; }
  els.couponTodayBox.innerHTML = `<table class="star-table"><thead><tr>
      <th>时间</th><th>学生</th><th>卡片</th></tr></thead><tbody>` +
    rows.map(x => `<tr><td>${fmtTime(x.used_at)}</td><td>${esc(x.student_name || '—')}</td>
      <td>${esc(x.name || '')}</td></tr>`).join('') +
    `</tbody></table>`;
}

function syncShopPriceInput() {
  if (!els.shopItemSel || !els.shopItemPrice) return;
  const opt = els.shopItemSel.selectedOptions[0];
  if (opt && opt.dataset.price != null) els.shopItemPrice.value = opt.dataset.price;
}

async function saveShopPrice() {
  const key = els.shopItemSel && els.shopItemSel.value;
  const price = Number(els.shopItemPrice && els.shopItemPrice.value);
  if (!key) return toast('请先选择商品');
  if (!Number.isFinite(price) || price < 0) return toast('价格需为不小于 0 的整数');
  const r = await supabase.from('shop_item').update({ price: Math.round(price), updated_at: new Date().toISOString() }).eq('item_key', key);
  if (r.error) return toast('保存失败：' + r.error.message);
  if (els.shopAdminMsg) els.shopAdminMsg.textContent = `已更新价格：${key}  ${Math.round(price)} 星光值`;
  toast('价格已更新');
  loadShopAdmin();
}

async function loadArchiveBatches() {
  if (!els.archiveBatchList) return;
  let rows = [];
  try {
    const r = await supabase.rpc('get_archive_batches');
    if (!r.error && Array.isArray(r.data)) rows = r.data;
  } catch (e) {}
  if (!rows.length) { els.archiveBatchList.innerHTML = '<div class="text-muted">暂无封存记录</div>'; return; }
  els.archiveBatchList.innerHTML = rows.map(b => {
    const st = b.stats || {};
    const parts = Object.entries(st).filter(([k]) => k !== 'ok').map(([k, v]) => `${k}:${v}`).join(' · ');
    return `<div class="archive-row">
      <div class="ar-head"><b>${esc(b.label || '')}</b><span>${fmtTime(b.created_at)}</span></div>
      <div class="ar-stats">${esc(parts)}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-arch-view="${b.id}">查看记录</button>
      <div class="ar-body" id="archBody-${b.id}"></div>
    </div>`;
  }).join('');
  $$('[data-arch-view]', els.archiveBatchList).forEach(btn => {
    btn.addEventListener('click', () => showArchiveRecords(btn.dataset.archView, btn));
  });
}

async function showArchiveRecords(batchId, btn) {
  const box = document.getElementById('archBody-' + batchId);
  if (!box) return;
  if (box.dataset.loaded === '1') { box.hidden = !box.hidden; return; }
  box.innerHTML = '<div class="text-muted">正在读取归档…</div>';
  let rows = [];
  try {
    const r = await supabase.rpc('get_archive_records', { p_batch: batchId });
    if (!r.error && r.data && r.data.ok) rows = r.data.records || [];
  } catch (e) {}
  if (!rows.length) { box.innerHTML = '<div class="text-muted">该批次无记录</div>'; box.dataset.loaded = '1'; return; }
  const byStu = {};
  rows.forEach(x => { const k = x.class + '|' + x.student_name; byStu[k] = (byStu[k] || 0) + 1; });
  box.innerHTML = `<div class="text-muted" style="margin:6px 0;">共 ${rows.length} 条记录，涉及 ${Object.keys(byStu).length} 名学生（仅展示前 200 条）</div>` +
    `<table class="star-table"><thead><tr><th>日期</th><th>班级</th><th>学生</th><th>星级</th></tr></thead><tbody>` +
    rows.slice(0, 200).map(x => `<tr><td>${x.record_date || ''}</td><td>${esc(x.class || '')}</td>
      <td>${esc(x.student_name || '')}</td><td>${x.self_evaluation || '—'}</td></tr>`).join('') +
    '</tbody></table>';
  box.dataset.loaded = '1';
}

async function doArchiveAll() {
  const label = (els.archiveLabel && els.archiveLabel.value || '').trim();
  const tip = `即将封存并重置全部学生数据：\n\n· 表现记录、任务、挑战、试卷、留言、成就、星光流水、抽奖记录  归档\n· 学生星光值、班级星光值  归零\n· 名单 / 头像 / 头像框 / 家长凭据  保留\n\n此操作不可撤销，确定继续吗？`;
  if (!confirm(tip)) return;
  if (!confirm('再次确认：现在执行封存与重置？')) return;
  if (els.btnArchive) els.btnArchive.disabled = true;
  try {
    const r = await supabase.rpc('archive_all_and_reset', { p_label: label || null, p_note: null });
    if (r.error) { toast('封存失败：' + r.error.message); return; }
    const d = r.data || {};
    if (d.ok === false) { toast('封存失败：' + (d.reason || '')); return; }
    const st = d.stats || {};
    els.archiveResult.innerHTML = `<div class="banner banner-info">${I['check-circle']()} 已封存「${esc(d.label || '')}」：` +
      Object.entries(st).filter(([k]) => k !== 'ok').map(([k, v]) => `${k} ${v} 条`).join('、') + `</div>`;
    toast('封存完成，已开始新一轮统计');
    await Promise.all([loadStarProgress(), loadArchiveBatches()]);
  } catch (e) {
    toast('封存失败，请检查网络');
  } finally {
    if (els.btnArchive) els.btnArchive.disabled = false;
  }
}

function fmtTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 16);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 绑定 */
if (els.starClass) els.starClass.addEventListener('change', () => { loadStarProgress(); });
if (els.btnStarRefresh) els.btnStarRefresh.addEventListener('click', () => { fillStarClasses().then(loadStarProgress); });
if (els.btnStarAddXp) els.btnStarAddXp.addEventListener('click', async () => {
  const cls = els.starClass && els.starClass.value;
  const n = Number(els.starAddXp && els.starAddXp.value);
  if (!cls) return toast('请先选择班级');
  if (!Number.isFinite(n) || n <= 0) return toast('请输入大于 0 的星光值');
  const r = await supabase.rpc('class_add_xp', { p_class: cls, p_amount: Math.round(n) });
  if (r.error) return toast('发放失败：' + r.error.message);
  toast(`已为 ${cls} 发放 ${Math.round(n)} 班级星光值${r.data && r.data.gained_level ? `，升了 ${r.data.gained_level} 级` : ''}`);
  if (els.starAddXp) els.starAddXp.value = '';
  loadStarProgress();
});
if (els.shopItemSel) els.shopItemSel.addEventListener('change', syncShopPriceInput);
if (els.btnShopPriceSave) els.btnShopPriceSave.addEventListener('click', saveShopPrice);
if (els.btnCouponRefresh) els.btnCouponRefresh.addEventListener('click', () => loadTodayCoupons());
if (els.btnArchive) els.btnArchive.addEventListener('click', doArchiveAll);

/* ============================================================
   v201：星光商店购买记录与回退（教师端）
   ------------------------------------------------------------
   数据来源：shop_order（135 号 SQL）+ shop_refund_audit
   权限：仅登录教师（authenticated）可查可退，anon 一律拒绝
   v107：筛选增强 —— 关键字 / 商品类型 / 回退状态 / 星光区间 / 排序
         依赖 138-shop-order-filters.sql 的 14 参 get_shop_orders
   ============================================================ */
const SHOP = { rows: [], total: 0, page: 0, size: 20, current: null, items: [], loaded: false, quick: 'all' };

const SHOP_TYPE_TEXT = { avatar: '头像', frame: '头像框', daily: '日常卡', theme: '卡片主题' };
const SHOP_STATUS_STYLE = {
  active:   { text: '已生效', cls: 'ok' },
  refunded: { text: '已回退', cls: 'refunded' },
  void:     { text: '已作废', cls: 'void' }
};
const SHOP_REASON_TEXT = {
  no_order: '订单不存在',
  already_refunded: '该订单已经回退过',
  order_not_active: '该订单当前不可回退',
  coupon_used: '日常卡已被使用，不能回退',
  no_reason: '必须填写回退原因',
  unauthorized: '登录状态失效，请重新登录',
  bad_item: '商品不存在或已下架'
};

function shopTypeText(t) { return SHOP_TYPE_TEXT[t] || '商品'; }

function shopCanRefund(r) {
  if (!r) return false;
  if (r.status !== 'active') return false;
  if (r.item_type === 'daily' && r.coupon_status === 'used') return false;
  return true;
}

function shopBlockText(r) {
  if (!r) return '';
  if (r.status === 'refunded') return '已回退';
  if (r.status === 'void') return '已作废';
  if (r.status !== 'active') return '不可回退';
  if (r.item_type === 'daily' && r.coupon_status === 'used') return '日常卡已使用';
  return '—';
}

function shopNeedSql(msg) {
  return /PGRST202|schema cache|does not exist|could not find the function|404/i.test(String(msg || ''));
}

/* ---------------- 筛选下拉 ---------------- */
async function activateShopTab() {
  await fillShopClasses();
  await fillShopItems();
  syncShopQuick();
  await loadShopOrders(0);
  await loadShopAudit();
}

async function fillShopClasses() {
  if (!els.shopClass) return;
  const cur = els.shopClass.value;
  let classes = [];
  try {
    const r = await supabase.from('student_info').select('class');
    if (!r.error) classes = Array.from(new Set((r.data || []).map(x => x.class))).filter(Boolean).sort();
  } catch (e) { /* 离线 */ }
  if (!classes.length) {
    try {
      const v = await window.Offline.get('classes_all');
      classes = Array.from(new Set(((v && v.data) || []).map(x => x.class))).filter(Boolean).sort();
    } catch (e2) {}
  }
  els.shopClass.innerHTML = '<option value="">全部班级</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (cur) els.shopClass.value = cur;
  await fillShopStudents();
}

async function fillShopStudents() {
  if (!els.shopStudent) return;
  const cls = (els.shopClass && els.shopClass.value) || '';
  const cur = els.shopStudent.value;
  let names = [];
  if (cls) {
    try {
      const r = await supabase.from('student_info').select('student_name')
        .eq('class', cls).order('student_name');
      if (!r.error) names = (r.data || []).map(x => x.student_name).filter(Boolean);
    } catch (e) {}
  }
  if (!cls) {
    els.shopStudent.innerHTML = '<option value="">选择班级后可筛选学生</option>';
    els.shopStudent.disabled = true;
    return;
  }
  els.shopStudent.innerHTML = '<option value="">全部学生</option>' +
    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  els.shopStudent.disabled = false;
  if (cur && names.includes(cur)) els.shopStudent.value = cur;
}

async function fillShopItems() {
  if (!els.shopItemFilter) return;
  const cur = els.shopItemFilter.value;
  let items = SHOP.items;
  if (!items.length) {
    try {
      const r = await supabase.from('shop_item')
        .select('item_key,item_type,name,sort_order').order('sort_order');
      if (!r.error) items = r.data || [];
    } catch (e) {}
    SHOP.items = items;
  }
  const order = ['avatar', 'frame', 'theme', 'daily'];
  const typeFilter = (els.shopType && els.shopType.value) || '';
  const list = typeFilter ? items.filter(x => (x.item_type || 'avatar') === typeFilter) : items;
  const groups = {};
  list.forEach(x => {
    const t = x.item_type || 'avatar';
    (groups[t] = groups[t] || []).push(x);
  });
  const opts = `<option value="">全部商品</option>` +
    order.filter(t => groups[t]).map(t =>
      `<optgroup label="${shopTypeText(t)}">` +
      groups[t].map(x => `<option value="${esc(x.item_key)}">${esc(x.name)}</option>`).join('') +
      `</optgroup>`).join('');
  els.shopItemFilter.innerHTML = opts;
  if (cur) els.shopItemFilter.value = cur;
}

/* ---------------- 订单列表 ---------------- */
/* 把所有筛选控件收成一个 rpc 参数包；offset/size 供翻页与导出复用 */
function shopParams(offset, size) {
  const num = el => {
    if (!el || el.value === '' || el.value == null) return null;
    const n = parseInt(el.value, 10);
    return isNaN(n) ? null : Math.max(0, n);
  };
  const kw = els.shopKeyword ? String(els.shopKeyword.value || '').trim() : '';
  return {
    p_class: (els.shopClass && els.shopClass.value) || null,
    p_student: (els.shopStudent && els.shopStudent.value) || null,
    p_from: (els.shopFrom && els.shopFrom.value) || null,
    p_to: (els.shopTo && els.shopTo.value) || null,
    p_item_key: (els.shopItemFilter && els.shopItemFilter.value) || null,
    p_status: (els.shopStatus && els.shopStatus.value) || null,
    p_keyword: kw || null,
    p_item_type: (els.shopType && els.shopType.value) || null,
    p_min_star: num(els.shopMinStar),
    p_max_star: num(els.shopMaxStar),
    p_refund: (els.shopRefund && els.shopRefund.value) || null,
    p_sort: (els.shopSort && els.shopSort.value) || 'time_desc',
    p_limit: size || SHOP.size,
    p_offset: offset || 0
  };
}

async function loadShopOrders(offset) {
  if (!els.shopOrderBox) return;
  const page = Math.max(0, Math.floor(offset || 0));
  const from = (els.shopFrom && els.shopFrom.value) || null;
  const to = (els.shopTo && els.shopTo.value) || null;
  if (from && to && from > to) { toast('开始日期不能晚于结束日期'); return; }
  const p0 = shopParams(0, 1);
  if (p0.p_min_star != null && p0.p_max_star != null && p0.p_min_star > p0.p_max_star) {
    toast('星光下限不能大于上限'); return;
  }

  const params = shopParams(page * SHOP.size, SHOP.size);

  els.shopOrderBox.innerHTML = '<div class="shop-empty">正在查询…</div>';
  if (els.shopOrderPager) els.shopOrderPager.innerHTML = '';
  let d = null;
  try {
    const r = await supabase.rpc('get_shop_orders', params);
    if (r.error) { renderShopError(r.error.message); return; }
    d = r.data;
  } catch (e) { renderShopError(e && e.message); return; }

  if (!d || d.ok === false) {
    renderShopError((d && d.reason) || '查询失败');
    return;
  }
  SHOP.page = page;
  SHOP.rows = d.rows || [];
  SHOP.total = Number(d.total) || 0;
  renderShopChips();
  renderShopSummary(d);
  renderShopRows();
  renderShopPager();
}

function renderShopError(msg) {
  const text = String(msg || '');
  const hint = shopNeedSql(text)
    ? '商店订单功能未安装或未升级：请按顺序在 Supabase SQL Editor 执行 '
      + '<b>database/135-shop-order-refund.sql</b>（订单表与回退）和 '
      + '<b>database/138-shop-order-filters.sql</b>（新增筛选），再刷新本页。'
    : (text === 'unauthorized'
        ? '登录状态失效，请退出后重新登录教师端。'
        : '查询失败：' + esc(text));
  if (els.shopOrderBox) els.shopOrderBox.innerHTML = `<div class="banner banner-warn">${hint}</div>`;
  if (els.shopOrderSummary) els.shopOrderSummary.innerHTML = '';
  if (els.shopOrderPager) els.shopOrderPager.innerHTML = '';
}

/* ---------------- 生效条件胶囊 ---------------- */
const SHOP_QUICK_TEXT = { today: '今天', '7d': '近 7 天', '30d': '近 30 天' };

function shopFilterList() {
  const out = [];
  const push = (key, val) => { if (val !== '' && val != null) out.push({ key, label: val }); };
  const kw = els.shopKeyword ? String(els.shopKeyword.value || '').trim() : '';
  push('kw', kw ? `关键字 ${kw}` : '');
  push('class', els.shopClass && els.shopClass.value ? `班级 ${els.shopClass.value}` : '');
  push('student', els.shopStudent && els.shopStudent.value ? `学生 ${els.shopStudent.value}` : '');
  push('type', els.shopType && els.shopType.value ? `类型 ${SHOP_TYPE_TEXT[els.shopType.value] || ''}` : '');
  push('item', els.shopItemFilter && els.shopItemFilter.value
    ? `商品 ${(els.shopItemFilter.options[els.shopItemFilter.selectedIndex] || {}).text}` : '');
  const f = (els.shopFrom && els.shopFrom.value) || '';
  const t = (els.shopTo && els.shopTo.value) || '';
  if (f || t) out.push({ key: 'range', label: `时间 ${f || '不限'} ~ ${t || '不限'}` });
  push('status', els.shopStatus && els.shopStatus.value
    ? `订单 ${(els.shopStatus.options[els.shopStatus.selectedIndex] || {}).text}` : '');
  push('refund', els.shopRefund && els.shopRefund.value
    ? `回退 ${(els.shopRefund.options[els.shopRefund.selectedIndex] || {}).text}` : '');
  const mn = els.shopMinStar && els.shopMinStar.value;
  const mx = els.shopMaxStar && els.shopMaxStar.value;
  if (mn || mx) out.push({ key: 'star', label: `星光 ${mn || '0'} ~ ${mx || '不限'}` });
  if (els.shopSort && els.shopSort.value && els.shopSort.value !== 'time_desc') {
    out.push({ key: 'sort', label: `排序 ${(els.shopSort.options[els.shopSort.selectedIndex] || {}).text}` });
  }
  return out;
}

function renderShopChips() {
  if (!els.shopFilterChips) return;
  const list = shopFilterList();
  if (!list.length) { els.shopFilterChips.innerHTML = ''; return; }
  els.shopFilterChips.innerHTML = list.map(x =>
    `<span class="shop-fchip"><b>${esc(x.label)}</b><button type="button" data-unfilter="${x.key}" title="移除此条件">×</button></span>`
  ).join('') + `<button class="shop-clear" type="button" data-unfilter="all">清除全部</button>`;
}

function clearShopFilter(key) {
  const clear = el => { if (el) el.value = ''; };
  if (key === 'all') {
    clear(els.shopKeyword); clear(els.shopStudent); clear(els.shopItemFilter);
    clear(els.shopFrom); clear(els.shopTo); clear(els.shopStatus);
    clear(els.shopType); clear(els.shopRefund); clear(els.shopMinStar); clear(els.shopMaxStar);
    if (els.shopSort) els.shopSort.value = 'time_desc';
    els.shopClass && (els.shopClass.value = '');
    SHOP.quick = '';
    fillShopStudents();
    syncShopQuick();
    fillShopItems();
    return;
  }
  if (key === 'kw') clear(els.shopKeyword);
  else if (key === 'class') { clear(els.shopClass); clear(els.shopStudent); fillShopStudents(); }
  else if (key === 'student') clear(els.shopStudent);
  else if (key === 'type') { clear(els.shopType); clear(els.shopItemFilter); fillShopItems(); }
  else if (key === 'item') clear(els.shopItemFilter);
  else if (key === 'range') { clear(els.shopFrom); clear(els.shopTo); SHOP.quick = ''; syncShopQuick(); }
  else if (key === 'status') clear(els.shopStatus);
  else if (key === 'refund') clear(els.shopRefund);
  else if (key === 'star') { clear(els.shopMinStar); clear(els.shopMaxStar); }
  else if (key === 'sort') { if (els.shopSort) els.shopSort.value = 'time_desc'; }
}

function syncShopQuick() {
  if (!els.shopQuick) return;
  els.shopQuick.querySelectorAll('[data-quick]').forEach(b => {
    b.classList.toggle('on', b.dataset.quick === SHOP.quick);
  });
}

function setShopQuick(q) {
  SHOP.quick = q;
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  let from = '', to = '';
  if (q === 'today') { from = to = fmt(now); }
  else if (q === '7d' || q === '30d') {
    const d = new Date(now);
    d.setDate(d.getDate() - (q === '7d' ? 6 : 29));
    from = fmt(d); to = fmt(now);
  }
  if (els.shopFrom) els.shopFrom.value = from;
  if (els.shopTo) els.shopTo.value = to;
  syncShopQuick();
  loadShopOrders(0);
}

/* ---------------- 导出当前筛选结果 ---------------- */
function shopCsvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportShopOrders() {
  if (!SHOP.total) { toast('当前筛选没有记录可导出'); return; }
  if (els.btnShopExport) { els.btnShopExport.disabled = true; els.btnShopExport.textContent = '导出中…'; }
  const out = [];
  try {
    const pageSize = 200;
    for (let off = 0; off < SHOP.total && off < 4000; off += pageSize) {
      const r = await supabase.rpc('get_shop_orders', shopParams(off, pageSize));
      if (r.error) { toast('导出失败：' + r.error.message); return; }
      const d = r.data || {};
      if (d.ok === false) { toast('导出失败：' + (d.reason || '未知原因')); return; }
      const rows = d.rows || [];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
  } catch (e) {
    toast('导出失败：' + ((e && e.message) || '网络异常'));
    return;
  } finally {
    if (els.btnShopExport) { els.btnShopExport.disabled = false; els.btnShopExport.textContent = '导出当前结果 CSV'; }
  }
  if (!out.length) { toast('没有可导出的记录'); return; }
  const head = ['购买时间', '班级', '学生', '商品类型', '商品', '数量', '单价', '消耗星光',
    '订单状态', '回退状态', '回退时间', '操作人', '回退原因'];
  const lines = [head.join(',')];
  out.forEach(r => {
    lines.push([
      fmtTime(r.created_at),
      r.class || '', r.student_name || '',
      SHOP_TYPE_TEXT[r.item_type] || r.item_type || '',
      r.item_name || r.item_key || '',
      Number(r.qty) || 1, Number(r.unit_price) || 0, Number(r.star_spent) || 0,
      (SHOP_STATUS_STYLE[r.status] || {}).text || r.status || '',
      r.refund_status === 'refunded' ? '已回退' : '未回退',
      r.refunded_at ? fmtTime(r.refunded_at) : '',
      r.refunded_by || '', r.refund_reason || ''
    ].map(shopCsvCell).join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `商店订单-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${out.length}条.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(out.length < SHOP.total
    ? `已导出前 ${out.length} 条（共 ${SHOP.total} 条，单次上限 4000）`
    : `已导出 ${out.length} 条记录`);
}

function renderShopSummary(d) {
  if (!els.shopOrderSummary) return;
  const total = Number(d.total) || 0;
  const star = Number(d.star_total) || 0;
  const rc = Number(d.refunded_count) || 0;
  const rs = Number(d.refunded_star) || 0;
  const sc = Number(d.student_count) || 0;
  els.shopOrderSummary.innerHTML = `
    <div class="shop-stat"><div class="ss-label">购买记录</div><div class="ss-value">${total}<small>条</small></div></div>
    <div class="shop-stat"><div class="ss-label">消耗星光合计</div><div class="ss-value">${star}<small>点</small></div></div>
    <div class="shop-stat"><div class="ss-label">已回退</div><div class="ss-value">${rc}<small>条</small> <small>· ${rs} 点</small></div></div>
    <div class="shop-stat"><div class="ss-label">涉及学生</div><div class="ss-value">${sc}<small>人</small></div></div>`;
}

function shopRowHTML(r) {
  const st = SHOP_STATUS_STYLE[r.status] || { text: r.status || '—', cls: 'none' };
  const refunded = r.refund_status === 'refunded';
  const can = shopCanRefund(r);
  const spent = Number(r.star_spent) || 0;
  const op = can
    ? `<button class="btn btn-ghost btn-sm" type="button" data-refund="${esc(r.id)}">
         <svg class="ico" aria-hidden="true" focusable="false"><use href="#i-undo"/></svg> 回退</button>`
    : `<span class="text-muted">${esc(shopBlockText(r))}</span>`;
  return `<tr>
    <td>${fmtTime(r.created_at)}</td>
    <td><div class="shop-stu"><b>${esc(r.student_name)}</b><span>${esc(r.class || '')}</span></div></td>
    <td><div class="shop-item-cell">
      <span class="shop-type" data-t="${esc(r.item_type || '')}">${esc(shopTypeText(r.item_type))}</span>
      <span>${esc(r.item_name || r.item_key)}</span></div></td>
    <td>${Number(r.qty) || 1}</td>
    <td><span class="shop-star${spent > 0 ? '' : ' zero'}">${spent} 点</span></td>
    <td><span class="shop-chip ${st.cls}">${esc(st.text)}</span></td>
    <td>${refunded
      ? `<span class="shop-chip refunded">已回退</span>
         <div class="shop-note">${fmtTime(r.refunded_at)}${r.refunded_by ? ' · ' + esc(r.refunded_by) : ''}</div>`
      : '<span class="shop-chip none">未回退</span>'}</td>
    <td>${op}</td>
  </tr>`;
}

function renderShopRows() {
  if (!els.shopOrderBox) return;
  if (!SHOP.rows.length) {
    els.shopOrderBox.innerHTML = '<div class="shop-empty">没有符合条件的购买记录</div>';
    return;
  }
  els.shopOrderBox.innerHTML = `<div class="shop-table-wrap">
    <table class="star-table shop-table">
      <thead><tr>
        <th>购买时间</th><th>学生</th><th>商品</th><th>数量</th>
        <th>消耗星光</th><th>订单状态</th><th>回退状态</th><th>操作</th>
      </tr></thead>
      <tbody>${SHOP.rows.map(shopRowHTML).join('')}</tbody>
    </table></div>`;
}

function renderShopPager() {
  if (!els.shopOrderPager) return;
  const from = SHOP.total ? SHOP.page * SHOP.size + 1 : 0;
  const to = Math.min(SHOP.total, (SHOP.page + 1) * SHOP.size);
  const hasPrev = SHOP.page > 0;
  const hasNext = to < SHOP.total;
  els.shopOrderPager.innerHTML =
    `<span class="sp-info">第 ${from}–${to} 条 / 共 ${SHOP.total} 条</span>
     <span class="sp-btns">
       <button class="btn btn-ghost btn-sm" type="button" data-page="prev"${hasPrev ? '' : ' disabled'}>上一页</button>
       <button class="btn btn-ghost btn-sm" type="button" data-page="next"${hasNext ? '' : ' disabled'}>下一页</button>
     </span>`;
}

/* ---------------- 回退：影响预览 → 二次确认 → 执行 ---------------- */
function showShopRefundError(msg) {
  if (!els.shopRefundError) return;
  els.shopRefundError.textContent = msg;
  els.shopRefundError.hidden = !msg;
}

async function openShopRefund(orderId) {
  if (!els.shopRefundModal || !orderId) return;
  SHOP.current = null;
  showShopRefundError('');
  if (els.shopRefundReason) { els.shopRefundReason.value = ''; els.shopRefundReason.disabled = false; }
  if (els.shopRefundImpact) els.shopRefundImpact.innerHTML = '<div class="text-muted">正在核对影响范围…</div>';
  if (els.btnShopRefundConfirm) els.btnShopRefundConfirm.disabled = true;
  els.shopRefundModal.classList.add('show');
  Nav.push('shopRefund');

  let d = null;
  try {
    const r = await supabase.rpc('shop_refund_impact', { p_order_id: orderId });
    if (r.error) {
      if (els.shopRefundImpact) {
        els.shopRefundImpact.innerHTML = shopNeedSql(r.error.message)
          ? '<div class="banner banner-warn">尚未安装 135 号 SQL，无法回退。请先执行 <b>database/135-shop-order-refund.sql</b>。</div>'
          : `<div class="banner banner-error">读取失败：${esc(r.error.message)}</div>`;
      }
      return;
    }
    d = r.data;
  } catch (e) {
    if (els.shopRefundImpact) els.shopRefundImpact.innerHTML = '<div class="banner banner-error">网络异常，请重试。</div>';
    return;
  }

  if (!d || d.ok === false) {
    const why = SHOP_REASON_TEXT[(d && d.reason) || ''] || (d && d.reason) || '无法回退';
    if (els.shopRefundImpact) els.shopRefundImpact.innerHTML = `<div class="banner banner-warn">${esc(why)}</div>`;
    return;
  }

  SHOP.current = d;
  renderShopRefundImpact(d);
  if (els.btnShopRefundConfirm) els.btnShopRefundConfirm.disabled = !d.refundable;
  if (d.refundable && els.shopRefundReason) els.shopRefundReason.focus();
}

function renderShopRefundImpact(d) {
  if (!els.shopRefundImpact) return;
  const o = d.order || {};
  const line = (k, v) => `<div class="shop-impact-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const rows = [];

  rows.push(`<div class="shop-impact-row shop-impact-order"><span class="k">订单</span>
    <span class="v"><b>${esc(o.student_name || '')}</b> · ${esc(o.item_name || o.item_key || '')}
    ${Number(o.qty) > 1 ? ' ×' + Number(o.qty) : ''}
    <div class="shop-note">${esc(o.class || '')} · ${fmtTime(o.created_at)} · 单价 ${Number(o.unit_price) || 0} 点</div></span></div>`);

  const head = `<div class="shop-impact-head">${esc(o.student_name || '')} · ${esc(o.item_name || '')}</div>
    <div class="shop-impact">${rows.join('')}</div>`;

  // 不可回退：只说清楚原因，不展示"会返还多少"这类不会发生的结果
  if (!d.refundable) {
    els.shopRefundImpact.innerHTML = head +
      `<div class="banner banner-error shop-refund-warn">该订单不可回退：${esc(SHOP_REASON_TEXT[d.block_reason] || d.block_reason || '未知原因')}</div>`;
    if (els.shopRefundReason) {
      els.shopRefundReason.value = '';
      els.shopRefundReason.disabled = true;
    }
    return;
  }
  if (els.shopRefundReason) els.shopRefundReason.disabled = false;

  rows.push(line('返还星光值', (Number(d.stars) || 0) > 0
    ? `<b class="shop-star">+${d.stars} 点</b>（余额 ${d.balance_before} → ${d.balance_after}）`
    : '该单未消耗星光值（0 点）'));
  rows.push(line('累计消费', `${d.total_spent_before} → ${d.total_spent_after} 点`));
  rows.push(line('衣柜物品', d.inventory_action === 'removed' ? '从衣柜移除这件商品' : '衣柜中已无这件商品'));
  rows.push(line('当前佩戴', d.equip_action
    ? `正在佩戴，将自动卸下${d.equip_reset_to ? '（' + esc(d.equip_reset_to) + '）' : ''}`
    : '当前未佩戴，无需处理'));
  if (o.item_type === 'daily') {
    rows.push(line('日常卡', d.coupon_action === 'removed'
      ? '收回 1 张未使用的卡'
      : (d.coupon_status === 'used'
          ? '<b style="color:#c0392b">已被使用，不能回退</b>'
          : '没有可收回的卡')));
  }
  rows.push(line('星光流水', (Number(d.stars) || 0) > 0 ? '新增 1 条回退流水（可追溯）' : '无需新增流水'));

  els.shopRefundImpact.innerHTML =
    `<div class="shop-impact-head">${esc(o.student_name || '')} · ${esc(o.item_name || '')}</div>
     <div class="shop-impact">${rows.join('')}</div>
     <div class="banner banner-warn shop-refund-warn">回退后不可撤销：星光值会立即退回学生余额，商品移出衣柜，学生需要重新兑换才能再次拥有。</div>`;
}

function closeShopRefund() {
  if (els.shopRefundModal) els.shopRefundModal.classList.remove('show');
  SHOP.current = null;
  showShopRefundError('');
  if (els.shopRefundReason) els.shopRefundReason.value = '';
}

async function doShopRefund() {
  const d = SHOP.current;
  if (!d || !d.order || !d.refundable) return toast('该订单当前不可回退');

  const reason = ((els.shopRefundReason && els.shopRefundReason.value) || '').trim();
  if (reason.length < 2) {
    showShopRefundError('请填写回退原因（至少 2 个字），该原因会写入审计日志。');
    if (els.shopRefundReason) els.shopRefundReason.focus();
    return;
  }
  showShopRefundError('');

  const o = d.order;
  const stars = Number(d.stars) || 0;
  const tip = `确认回退这笔购买？\n\n学生：${o.student_name}（${o.class}）\n商品：${o.item_name}\n` +
    `返还星光：${stars} 点（余额 ${d.balance_before} → ${d.balance_after}）\n` +
    (d.equip_action ? '该商品正在佩戴，将自动卸下\n' : '') +
    (o.item_type === 'daily' && d.coupon_action === 'removed' ? '将收回 1 张未使用的日常卡\n' : '') +
    `\n回退后不可撤销，确定继续吗？`;
  if (!confirm(tip)) return;

  const btn = els.btnShopRefundConfirm;
  if (btn) btn.disabled = true;
  try {
    const r = await supabase.rpc('refund_shop_order', {
      p_order_id: o.id,
      p_operator: ((els.userEmail && els.userEmail.textContent) || '').trim() || null,
      p_reason: reason
    });
    if (r.error) {
      showShopRefundError(shopNeedSql(r.error.message)
        ? '尚未安装 135 号 SQL，无法回退。'
        : '回退失败：' + r.error.message);
      return;
    }
    const res = r.data || {};
    if (res.ok === false) {
      showShopRefundError('回退失败：' + (SHOP_REASON_TEXT[res.reason] || res.reason || '未知原因'));
      return;
    }
    closeShopRefund();
    toast(`已回退：${res.student_name || o.student_name} · ${res.item_name || o.item_name}，返还 ${res.stars_refunded || stars} 点星光值`);
    const target = (SHOP.rows.length === 1 && SHOP.page > 0) ? SHOP.page - 1 : SHOP.page;
    await loadShopOrders(target);
    await loadShopAudit();
  } catch (e) {
    showShopRefundError('回退失败，请检查网络后重试。');
  } finally {
    if (btn && els.shopRefundModal && els.shopRefundModal.classList.contains('show')) btn.disabled = false;
  }
}

/* ---------------- 审计日志 ---------------- */
async function loadShopAudit() {
  if (!els.shopAuditBox) return;
  const cls = (els.shopClass && els.shopClass.value) || null;
  let d = null;
  try {
    const r = await supabase.rpc('get_shop_refund_audit', { p_class: cls, p_limit: 20, p_offset: 0 });
    if (r.error) { renderShopAuditError(r.error.message); return; }
    d = r.data;
  } catch (e) { renderShopAuditError(e && e.message); return; }

  if (!d || d.ok === false) { renderShopAuditError((d && d.reason) || '读取失败'); return; }
  const rows = d.rows || [];
  if (!rows.length) {
    els.shopAuditBox.innerHTML = '<div class="text-muted">还没有回退记录</div>';
    return;
  }
  els.shopAuditBox.innerHTML =
    `<div class="text-muted" style="margin-bottom:8px;">共 ${Number(d.total) || rows.length} 条回退记录（显示最近 ${rows.length} 条）</div>
     <div class="shop-table-wrap"><table class="star-table shop-table">
       <thead><tr><th>操作时间</th><th>操作人</th><th>学生</th><th>商品</th><th>返还星光</th><th>回退原因</th></tr></thead>
       <tbody>${rows.map(a => `<tr>
         <td>${fmtTime(a.created_at)}</td>
         <td>${esc(a.operator || '—')}</td>
         <td><div class="shop-stu"><b>${esc(a.student_name || '')}</b><span>${esc(a.class || '')}</span></div></td>
         <td><div class="shop-item-cell"><span class="shop-type" data-t="${esc(a.item_type || '')}">${esc(shopTypeText(a.item_type))}</span><span>${esc(a.item_name || a.item_key || '')}</span></div></td>
         <td><span class="shop-star">+${Number(a.stars_refunded) || 0} 点</span></td>
         <td>${esc(a.reason || '')}</td>
       </tr>`).join('')}</tbody>
     </table></div>`;
}

function renderShopAuditError(msg) {
  if (!els.shopAuditBox) return;
  const text = String(msg || '');
  els.shopAuditBox.innerHTML = shopNeedSql(text)
    ? '<div class="text-muted">尚未安装 135 号 SQL</div>'
    : `<div class="text-muted">审计日志读取失败：${esc(text)}</div>`;
}

/* ---------------- 绑定 ---------------- */
if (els.shopClass) els.shopClass.addEventListener('change', async () => {
  await fillShopStudents();
  loadShopOrders(0);
  loadShopAudit();
});
if (els.shopStudent) els.shopStudent.addEventListener('change', () => loadShopOrders(0));
if (els.shopStatus) els.shopStatus.addEventListener('change', () => loadShopOrders(0));
if (els.shopItemFilter) els.shopItemFilter.addEventListener('change', () => loadShopOrders(0));
if (els.shopFrom) els.shopFrom.addEventListener('change', () => { SHOP.quick = ''; syncShopQuick(); loadShopOrders(0); });
if (els.shopTo) els.shopTo.addEventListener('change', () => { SHOP.quick = ''; syncShopQuick(); loadShopOrders(0); });
if (els.shopType) els.shopType.addEventListener('change', async () => {
  await fillShopItems();
  loadShopOrders(0);
});
if (els.shopRefund) els.shopRefund.addEventListener('change', () => loadShopOrders(0));
if (els.shopSort) els.shopSort.addEventListener('change', () => loadShopOrders(0));
if (els.shopKeyword) {
  els.shopKeyword.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); loadShopOrders(0); }
  });
  els.shopKeyword.addEventListener('search', () => loadShopOrders(0)); // 点输入框右侧的 × 时
}
if (els.shopMinStar) els.shopMinStar.addEventListener('change', () => loadShopOrders(0));
if (els.shopMaxStar) els.shopMaxStar.addEventListener('change', () => loadShopOrders(0));
if (els.shopQuick) els.shopQuick.addEventListener('click', e => {
  const btn = e.target.closest('[data-quick]');
  if (btn) setShopQuick(btn.dataset.quick);
});
if (els.shopFilterChips) els.shopFilterChips.addEventListener('click', e => {
  const btn = e.target.closest('[data-unfilter]');
  if (!btn) return;
  clearShopFilter(btn.dataset.unfilter);
  loadShopOrders(0);
});
if (els.btnShopExport) els.btnShopExport.addEventListener('click', exportShopOrders);
if (els.btnShopQuery) els.btnShopQuery.addEventListener('click', () => loadShopOrders(0));
if (els.btnShopReset) els.btnShopReset.addEventListener('click', async () => {
  if (els.shopClass) els.shopClass.value = '';
  if (els.shopFrom) els.shopFrom.value = '';
  if (els.shopTo) els.shopTo.value = '';
  if (els.shopItemFilter) els.shopItemFilter.value = '';
  if (els.shopStatus) els.shopStatus.value = '';
  if (els.shopKeyword) els.shopKeyword.value = '';
  if (els.shopType) els.shopType.value = '';
  if (els.shopRefund) els.shopRefund.value = '';
  if (els.shopMinStar) els.shopMinStar.value = '';
  if (els.shopMaxStar) els.shopMaxStar.value = '';
  if (els.shopSort) els.shopSort.value = 'time_desc';
  SHOP.quick = '';
  syncShopQuick();
  await fillShopStudents();
  await fillShopItems();
  await loadShopOrders(0);
  await loadShopAudit();
});
if (els.shopOrderBox) els.shopOrderBox.addEventListener('click', e => {
  const btn = e.target.closest('[data-refund]');
  if (btn) openShopRefund(btn.dataset.refund);
});
if (els.shopOrderPager) els.shopOrderPager.addEventListener('click', e => {
  const btn = e.target.closest('[data-page]');
  if (!btn || btn.disabled) return;
  if (btn.dataset.page === 'prev') loadShopOrders(Math.max(0, SHOP.page - 1));
  else loadShopOrders(SHOP.page + 1);
});
if (els.btnShopAuditRefresh) els.btnShopAuditRefresh.addEventListener('click', loadShopAudit);
if (els.btnShopRefundCancel) els.btnShopRefundCancel.addEventListener('click', closeShopRefund);
if (els.btnShopRefundConfirm) els.btnShopRefundConfirm.addEventListener('click', doShopRefund);
if (els.shopRefundModal) els.shopRefundModal.addEventListener('click', e => {
  if (e.target === els.shopRefundModal) closeShopRefund();
});
