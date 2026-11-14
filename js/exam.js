/**
 * 教师端 · 试卷拍照 / 成绩单批量导入模块
 * 原功能：选班级/学生 → 拍照/选图 → 本地 tesseract 识别分数（可手改）
 *       → 上传 Supabase Storage(exam-papers) → 写入 exam_paper → 家长端可见
 * v153 新增：导入成绩单（整班批量）
 *       考试名称 + 可附说明 → ① 成绩单图片 OCR 识别「姓名+分数」
 *                             ② Excel 模板导入（.xlsx/.csv）
 *       → 表格预览可手改 → exam_batch + exam_score → 家长端「成绩单」可见
 * 学生端不引入本文件，也无法查询 exam_paper / exam_batch / exam_score。
 * OCR 资源全部本地：js/vendor/tesseract/（eng + chi_sim），不依赖外网 CDN。
 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const els = {
    examClass: $('#examClass'),
    examStudent: $('#examStudent'),
    examDate: $('#examDate'),
    examSubject: $('#examSubject'),
    examFile: $('#examFile'),
    examPreviewWrap: $('#examPreviewWrap'),
    examPreview: $('#examPreview'),
    examScore: $('#examScore'),
    examScoreText: $('#examScoreText'),
    examNote: $('#examNote'),
    examMultiplier: $('#examMultiplier'),
    examHideParent: $('#examHideParent'),
    examStarPreview: $('#examStarPreview'),
    examOcrStatus: $('#examOcrStatus'),
    btnExamSave: $('#btnExamSave'),
    btnExamReset: $('#btnExamReset'),
    examBox: $('#examBox'),
    /* v153 成绩单批量导入 */
    batchClass: $('#ebClass'),
    batchName: $('#ebName'),
    batchSubject: $('#ebSubject'),
    batchDate: $('#ebDate'),
    batchNote: $('#ebNote'),
    batchImg: $('#ebImg'),
    batchImgStatus: $('#ebImgStatus'),
    batchXlsx: $('#ebXlsx'),
    batchXlsxStatus: $('#ebXlsxStatus'),
    batchXlsxIssues: $('#ebXlsxIssues'),
    batchMultiplier: $('#ebMultiplier'),
    batchHideParent: $('#ebHideParent'),
    btnBatchTpl: $('#btnEbTpl'),
    batchTableWrap: $('#ebTableWrap'),
    batchTableBody: $('#ebTableBody'),
    batchSummary: $('#ebSummary'),
    btnBatchSave: $('#btnEbSave'),
    btnBatchClear: $('#btnEbClear'),
    batchUnmatched: $('#ebUnmatched'),
    batchBox: $('#ebBox')
  };

  const TESS_DIR = 'js/vendor/tesseract/';
  // tesseract.js 按 oem 自动拼出 tesseract-core-simd-lstm.wasm.js，本地没有该文件；
  // 直接指定完整 core 文件路径，避免 404 导致 OCR 静默失败。
  const TESS_CORE = TESS_DIR + 'tesseract-core-simd.wasm.js';
  const state = {
    ready: false,
    students: [],        // [{id, class, student_name}]
    imageBlob: null,     // 压缩后的 jpeg Blob
    previewUrl: '',
    ocrBusy: false,
    saving: false,
    /* v153 批次导入 */
    batchRows: [],       // [{student_id, student_name, score, source}]
    batchImageBlob: null,
    batchSaving: false,
    batches: [],
    batchDetailOpen: {},
    lastOcrText: ''
  };
  let ocrWorkerPromise = null;
  let batchOcrWorkerPromise = null;

  function todayStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function uuidName() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function fmtNum(n) { return String(Math.round(Number(n) * 10) / 10); }
  function setStatus(el, txt) { if (el) el.textContent = txt || ''; }
  function normalizeName(s) {
    return String(s == null ? '' : s)
      .replace(/\s+/g, '')
      .replace(/[·•.。、,，:：\-—_]/g, '')
      .trim();
  }
  function sanitizeScore(v) {
    if (v == null) return null;
    const raw = String(v).trim();
    if (!raw) return null;
    const m = raw.match(/-?\d+(?:\.\d+)?/);   // 先取第一个数字，避免 "-1" 被当成 "1"
    if (!m) return null;
    const n = Number(m[0]);
    if (!isFinite(n) || n < 0 || n > 150) return null;
    return String(Math.round(n * 10) / 10);
  }

  /* ------------ v116：星光值加成 ------------ */
  const STAR_MULTIPLIERS = [0.25, 0.5, 0.75, 1, 1.5, 2];
  const MULT_LABEL = { 0.25: '0.25 倍', 0.5: '0.5 倍', 0.75: '0.75 倍', 1: '1 倍', 1.5: '1.5 倍', 2: '2 倍' };

  function normMultiplier(v) {
    const n = Number(v);
    return STAR_MULTIPLIERS.indexOf(n) >= 0 ? n : 1;
  }
  /** 星光值口径：分数 ÷ 10 × 倍数，四舍五入取整（与 116 号脚本 star_from_score 一致） */
  function starsFromScore(score, mult) {
    if (score == null || String(score).trim() === '') return 0;
    const n = Number(score);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.round((n / 10) * normMultiplier(mult)));
  }
  function batchMultiplier() { return normMultiplier(els.batchMultiplier ? els.batchMultiplier.value : 1); }
  function isParentVisible(hideEl) { return !(hideEl && hideEl.checked); }
  function setSaveLabel(btn, visible, idleText) {
    if (!btn) return;
    btn.textContent = visible ? idleText : '保存（不发送家长）';
  }
  function syncExamPreview() {
    if (!els.examStarPreview) return;
    const mult = normMultiplier(els.examMultiplier && els.examMultiplier.value);
    const sc = sanitizeScore(els.examScore.value);
    const stars = starsFromScore(sc, mult);
    els.examStarPreview.innerHTML = sc === null
      ? `星光值 +0 · ${MULT_LABEL[mult]}（填写分数后显示）`
      : `星光值 <b>+${stars}</b> · ${sc} 分 ÷ 10 × ${MULT_LABEL[mult]}`;
  }

  /* ------------ 标签页激活（首次加载名单） ------------ */
  async function activate() {
    if (state.ready) return;
    state.ready = true;
    if (els.examDate) els.examDate.value = todayStr();
    if (els.batchDate) els.batchDate.value = todayStr();
    bindEvents();
    bindBatchEvents();
    await loadRoster();
    await Promise.all([loadPapers(), loadBatchList()]);
    syncSaveLabels();
    syncExamPreview();
  }

  function bindEvents() {
    els.examClass.addEventListener('change', fillStudents);
    els.examFile.addEventListener('change', onFilePicked);
    els.btnExamSave.addEventListener('click', onSave);
    els.btnExamReset.addEventListener('click', resetForm);
    if (els.examMultiplier) els.examMultiplier.addEventListener('change', () => { syncExamPreview(); syncSaveLabels(); });
    if (els.examScore) els.examScore.addEventListener('input', syncExamPreview);
    if (els.examHideParent) els.examHideParent.addEventListener('change', syncSaveLabels);
  }

  /* 保存按钮文案随「不发送给家长」联动，避免老师点下去才发现发错 */
  function syncSaveLabels() {
    setSaveLabel(els.btnExamSave, isParentVisible(els.examHideParent), '保存并发送给家长');
    setSaveLabel(els.btnBatchSave, isParentVisible(els.batchHideParent), '保存本次成绩并发送给家长');
  }

  async function loadRoster() {
    let data = null, error = null, offline = false;
    try {
      const r = await supabase
        .from('student_info')
        .select('id, class, student_name')
        .order('class')
        .order('student_name');
      data = r.data; error = r.error;
    } catch (e) { offline = true; }
    if (offline || error) {
      const v = await window.Offline.get('exam_roster');
      data = (v && v.rows) || null;
      if (!data) { toast('离线无缓存，请先联网'); state.ready = false; return; }
    } else {
      await window.Offline.set('exam_roster', { rows: data || [] });
    }
    state.students = data || [];
    const classes = Array.from(new Set(state.students.map(s => s.class))).sort();
    els.examClass.innerHTML = classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    fillStudents();
    fillBatchClass(classes);
  }

  function fillStudents() {
    const cls = els.examClass.value;
    const list = state.students.filter(s => s.class === cls);
    els.examStudent.innerHTML = list
      .map(s => `<option value="${esc(s.id)}">${esc(s.student_name)}</option>`).join('');
  }

  /* ------------ 选图 → 压缩预览 → OCR ------------ */
  async function onFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('请选择图片文件'); return; }

    setOcrStatus('正在处理图片…');
    try {
      state.imageBlob = await downscaleImage(file, 1600, 0.82);
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(state.imageBlob);
      els.examPreview.src = state.previewUrl;
      els.examPreviewWrap.hidden = false;

      runOcr(state.imageBlob);
    } catch (err) {
      setOcrStatus('图片处理失败，可手动填分数');
    }
  }

  function downscaleImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
          'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  function setOcrStatus(txt) { els.examOcrStatus.textContent = txt || ''; }

  async function getOcrWorker() {
    if (ocrWorkerPromise) return ocrWorkerPromise;
    ocrWorkerPromise = (async () => {
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: TESS_DIR + 'worker.min.js',
        corePath: TESS_CORE,                 // 自动选 tesseract-core[-simd].wasm.js
        langPath: TESS_DIR,                 // eng.traineddata.gz
        gzip: true
      });
      await worker.setParameters({ tessedit_char_whitelist: '0123456789.' });
      return worker;
    })();
    return ocrWorkerPromise;
  }

  async function runOcr(blob) {
    state.ocrBusy = true;
    setOcrStatus('正在识别分数（首次需加载引擎）…');
    // v128(RSK-04)：OCR 加 60 秒超时，超时提示手动填写，避免低配/弱网长时间无反馈
    const OCR_TIMEOUT_MS = 60000;
    const withTimeout = p => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('OCR_TIMEOUT')), OCR_TIMEOUT_MS))
    ]);
    try {
      const worker = await withTimeout(getOcrWorker());
      const { data } = await withTimeout(worker.recognize(blob));
      const found = pickScore((data && data.text) || '');
      if (found) {
        els.examScore.value = String(found.score);
        els.examScoreText.value = found.text;
        setOcrStatus(`识别到分数「${found.text}」，请核对后保存（不对可直接手动修改）。`);
      } else {
        setOcrStatus('未识别到分数，请手动填写');
      }
    } catch (err) {
      setOcrStatus((err && err.message === 'OCR_TIMEOUT')
        ? '识别超时，请手动填写'
        : '识别失败，请手动填写');
    } finally {
      state.ocrBusy = false;
    }
  }

  // 从 OCR 文本中挑最可能的分数：0~150 的数字，取最大值（试卷分数通常是醒目的大数字）
  function pickScore(text) {
    const nums = String(text).match(/\d{1,3}(?:\.\d+)?/g) || [];
    const candidates = nums
      .map(Number)
      .filter(n => !isNaN(n) && n > 0 && n <= 150 && Math.abs(n - Math.round(n * 100) / 100) < 1e-6);
    if (!candidates.length) return null;
    const score = Math.max(...candidates);
    return { score, text: String(score) + '分' };
  }

  /* ------------ 保存上传 ------------ */
  async function onSave() {
    if (state.saving) return;
    const cls = els.examClass.value;
    const studentId = els.examStudent.value;
    const studentName = (els.examStudent.options[els.examStudent.selectedIndex] || {}).text || '';
    const date = els.examDate.value || todayStr();
    const subject = els.examSubject.value.trim();
    const note = els.examNote.value.trim();
    const scoreRaw = els.examScore.value.trim();
    const scoreText = els.examScoreText.value.trim();
    const mult = normMultiplier(els.examMultiplier && els.examMultiplier.value);
    const visible = isParentVisible(els.examHideParent);

    if (!cls || !studentId) { toast('请先选择班级和学生'); return; }
    if (!state.imageBlob) { toast('请先拍照或选择试卷图片'); return; }

    let score = null;
    if (scoreRaw) {
      const n = Number(scoreRaw);
      if (isNaN(n) || n <= 0 || n > 150) { toast('分数需在 0~150 之间'); return; }
      score = Math.round(n * 10) / 10;
    }

    state.saving = true;
    els.btnExamSave.disabled = true;
    els.btnExamSave.textContent = '正在上传…';
    try {
      const fileName = uuidName() + '.jpg';
      const wr = await runWrite({ name: 'exam_save', params: {
        fileName,
        imageBlob: state.imageBlob,
        student_id: studentId,
        class: cls,
        student_name: studentName,
        record_date: date,
        subject: subject || null,
        score,
        score_text: scoreText || null,
        note: note || null,
        multiplier: mult,
        visible
      } });
      if (!wr.ok) {
        const code = wr.data && wr.data.message;
        throw new Error(code || '保存失败');
      }
      const awarded = (wr.res && wr.res.awarded) || starsFromScore(score, mult);
      const tip = visible ? '已保存，家长可见' : '已保存，不发送给家长';
      toast(wr.queued
        ? '已离线保存，联网后自动上传'
        : (awarded > 0 ? `${tip} · 星光 +${awarded}` : tip));
      resetForm();
      await loadPapers();
    } catch (err) {
      toast('上传失败：' + ((err && err.message) || '请稍后再试'));
    } finally {
      state.saving = false;
      els.btnExamSave.disabled = false;
      syncSaveLabels();
    }
  }

  function resetForm() {
    state.imageBlob = null;
    if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ''; }
    els.examFile.value = '';
    els.examPreview.removeAttribute('src');
    els.examPreviewWrap.hidden = true;
    els.examScore.value = '';
    els.examScoreText.value = '';
    els.examNote.value = '';
    els.examSubject.value = '';
    els.examDate.value = todayStr();
    if (els.examMultiplier) els.examMultiplier.value = '1';
    if (els.examHideParent) els.examHideParent.checked = false;
    syncExamPreview();
    syncSaveLabels();
    setOcrStatus('');
  }

  /* ------------ 已上传试卷列表 ------------ */
  async function loadPapers() {
    els.examBox.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载试卷…</div>';
    let rows = null, offline = false;
    try {
      const r = await supabase
        .from('exam_paper')
        .select('*')
        .order('record_date', { ascending: false })
        .order('create_at', { ascending: false })
        .limit(200);
      if (r.error) { offline = true; }
      else { rows = r.data || []; await window.Offline.set('exam_papers', { rows }); }
    } catch (e) { offline = true; }
    if (offline) {
      const v = await window.Offline.get('exam_papers');
      rows = (v && v.rows) || null;
      if (!rows) { els.examBox.innerHTML = '<div class="t-empty">离线无缓存，请先联网</div>'; return; }
      toast('离线模式 · 显示缓存');
    }
    if (!rows.length) {
      els.examBox.innerHTML = '<div class="t-empty">暂无试卷</div>';
      return;
    }
    els.examBox.innerHTML = rows.map(r => {
      const score = (r.score !== null && r.score !== undefined && r.score !== '')
        ? parseFloat(Number(r.score).toFixed(1)) + ' 分'
        : (r.score_text || '成绩待补');
      const hidden = r.visible_parent === false;
      const stars = Number(r.star_awarded) || 0;
      return `<div class="exam-item" data-id="${esc(r.id)}">
        <a class="exam-thumb" href="${esc(r.image_url)}" target="_blank" rel="noopener">
          <img src="${esc(r.image_url)}" alt="试卷" loading="lazy">
        </a>
        <div class="exam-info">
          <div class="exam-line1"><b>${esc(r.student_name)}</b><span>${esc(r.class)}</span>${hidden ? '<span class="badge-hidden">家长不可见</span>' : ''}</div>
          <div class="exam-line2">${esc(r.record_date)} · ${esc(r.subject || '未填科目')} · <b class="exam-score">${esc(String(score))}</b>${stars ? ` · 星光 +${stars}` : ''}</div>
          ${r.note ? `<div class="exam-line3">${esc(r.note)}</div>` : ''}
        </div>
        <button type="button" class="btn btn-ghost btn-sm exam-del" data-del="${esc(r.id)}" data-url="${esc(r.image_url)}">${I.trash('ico-sm')} 删除</button>
      </div>`;
    }).join('');

    $$('.exam-del', els.examBox).forEach(btn => {
      btn.addEventListener('click', () => onDelete(btn.dataset.del, btn.dataset.url));
    });
  }

  async function onDelete(id, url) {
    if (!window.confirm('删除这份试卷？已发的星光值会一并扣回')) return;
    let path = null;
    if (url) {
      const m = String(url).match(/exam-papers\/([^?#]+)/);
      if (m) { try { path = decodeURIComponent(m[1]); } catch (e) {} }
    }
    try {
      const wr = await runWrite({ name: 'exam_delete', params: { id, path } });
      if (!wr.ok) throw new Error('删除失败');
      const refund = (wr.res && wr.res.refund) || 0;
      toast(wr.queued
        ? '已离线删除，联网后同步'
        : (refund ? `试卷已删除，扣回星光 ${refund}` : '试卷已删除'));
      await loadPapers();
    } catch (err) {
      toast('删除失败：' + ((err && err.message) || '请稍后再试'));
    }
  }

  /* ============================================================
   * v153：成绩单批量导入
   * ============================================================ */

  function bindBatchEvents() {
    if (!els.batchClass) return;
    els.batchClass.addEventListener('change', () => { resetBatchTable(); });
    els.btnBatchTpl.addEventListener('click', downloadTemplate);
    els.batchXlsx.addEventListener('change', onXlsxPicked);
    els.batchImg.addEventListener('change', onBatchImagePicked);
    els.btnBatchSave.addEventListener('click', onBatchSave);
    if (els.batchMultiplier) els.batchMultiplier.addEventListener('change', () => { renderBatchTable(); syncSaveLabels(); });
    if (els.batchHideParent) els.batchHideParent.addEventListener('change', syncSaveLabels);
    els.btnBatchClear.addEventListener('click', () => {
      const cls = els.batchClass.value;
      state.batchRows = rosterOf(cls).map(s => ({ student_id: s.id, student_name: s.student_name, score: '' }));
      state.batchImageBlob = null;
      els.batchImg.value = '';
      setStatus(els.batchImgStatus, '');
      els.batchXlsx.value = '';
      setStatus(els.batchXlsxStatus, '');
      els.batchUnmatched.hidden = true;
      clearXlsxIssues();
      renderBatchTable();
    });
  }

  function rosterOf(cls) { return state.students.filter(s => s.class === cls); }

  function fillBatchClass(classes) {
    if (!els.batchClass) return;
    els.batchClass.innerHTML = classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    resetBatchTable();
  }

  function resetBatchTable() {
    const cls = els.batchClass ? els.batchClass.value : '';
    state.batchRows = rosterOf(cls).map(s => ({ student_id: s.id, student_name: s.student_name, score: '', source: '' }));
    renderBatchTable();
  }

  function renderBatchTable() {
    if (!els.batchTableBody) return;
    const rows = state.batchRows;
    if (!rows.length) { els.batchTableWrap.hidden = true; return; }
    els.batchTableWrap.hidden = false;
    els.batchTableBody.innerHTML = rows.map((r, i) => {
      const filled = String(r.score || '').trim() !== '';
      const srcTxt = filled ? (r.source === 'ocr' ? '识别填充' : r.source === 'excel' ? 'Excel 导入' : '手动填写') : '待填';
      const stars = filled ? starsFromScore(sanitizeScore(r.score), batchMultiplier()) : 0;
      return `<tr data-name="${esc(r.student_name)}" class="${filled ? 'matched' : ''}">
        <td class="idx-col">${i + 1}</td>
        <td>${esc(r.student_name)}</td>
        <td class="score-cell"><input class="score-input" type="text" inputmode="decimal" maxlength="6" data-i="${i}" value="${esc(String(r.score || ''))}" placeholder="—"></td>
        <td class="star-cell${stars ? '' : ' zero'}">${stars ? '+' + stars : '—'}</td>
        <td class="st-cell">${srcTxt}</td>
      </tr>`;
    }).join('');
    $$('.score-input', els.batchTableBody).forEach(inp => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.i;
        state.batchRows[i].score = inp.value.trim();
        state.batchRows[i].source = 'manual';
        const tr = inp.closest('tr');
        if (tr) {
          const filled = inp.value.trim() !== '';
          tr.classList.toggle('matched', filled);
          const st = tr.querySelector('.st-cell');
          if (st) st.textContent = filled ? '手动填写' : '待填';
          const sc = tr.querySelector('.star-cell');
          if (sc) {
            const stars = filled ? starsFromScore(sanitizeScore(inp.value.trim()), batchMultiplier()) : 0;
            sc.textContent = stars ? '+' + stars : '—';
            sc.classList.toggle('zero', !stars);
          }
        }
        updateBatchSummary();
      });
    });
    updateBatchSummary();
  }

  function updateBatchSummary() {
    if (!els.batchSummary) return;
    const total = state.batchRows.length;
    const filled = state.batchRows.filter(r => String(r.score || '').trim() !== '');
    const mult = batchMultiplier();
    if (!filled.length) {
      els.batchSummary.textContent = `共 ${total} 人，尚未填写分数 · 星光 ${MULT_LABEL[mult]}`;
      return;
    }
    const nums = filled.map(r => Number(sanitizeScore(r.score))).filter(n => !isNaN(n));
    if (!nums.length) {
      els.batchSummary.textContent = `共 ${total} 人，已填 ${filled.length} 人，但分数都不合法 · 星光 ${MULT_LABEL[mult]}`;
      return;
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    const avg = sum / nums.length;
    const stars = filled.reduce((a, r) => a + starsFromScore(sanitizeScore(r.score), mult), 0);
    els.batchSummary.textContent =
      `共 ${total} 人，已填 ${filled.length} 人 · 平均 ${fmtNum(avg)} · 最高 ${fmtNum(Math.max(...nums))} · 最低 ${fmtNum(Math.min(...nums))}` +
      ` · 星光合计 +${stars}（${MULT_LABEL[mult]}）`;
  }

  function applyImported(pairs, source) {
    let filled = 0;
    const unmatched = [];
    const byNorm = new Map(state.batchRows.map((r, i) => [normalizeName(r.student_name), i]));
    pairs.forEach(p => {
      const idx = byNorm.get(normalizeName(p.name));
      const sc = sanitizeScore(p.score);
      if (idx === undefined || sc === null) { unmatched.push(p); return; }
      state.batchRows[idx].score = sc;
      state.batchRows[idx].source = source;
      filled++;
    });
    renderBatchTable();
    showUnmatched(unmatched);
    return { filled, unmatched };
  }

  function showUnmatched(list) {
    if (!els.batchUnmatched) return;
    if (!list.length) { els.batchUnmatched.hidden = true; els.batchUnmatched.innerHTML = ''; return; }
    els.batchUnmatched.hidden = false;
    els.batchUnmatched.innerHTML = `以下 ${list.length} 行没有对应到本班学生，请核对后手动填写：` +
      list.map(p => `<b>${esc(String(p.name || '?'))}</b>${p.score ? ' ' + esc(String(p.score)) : ''}`).join('、');
  }

  /* ---------- 成绩单图片 OCR ---------- */
  async function onBatchImagePicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('请选择图片文件'); return; }

    setStatus(els.batchImgStatus, '正在处理图片…');
    try {
      state.batchImageBlob = await downscaleImage(file, 2200, 0.9);
      setStatus(els.batchImgStatus, '正在识别成绩单（首次需加载引擎）…');
      const worker = await withT(90, getBatchOcrWorker());
      const { data } = await withT(180, worker.recognize(state.batchImageBlob));
      const text = (data && data.text) || '';
      state.lastOcrText = text;
      const pairs = parseScoreLines(text, state.batchRows.map(r => r.student_name));
      if (pairs.length) {
        const res = applyImported(pairs, 'ocr');
        setStatus(els.batchImgStatus,
          `识别到 ${pairs.length} 行，已自动填入 ${res.filled} 人` +
          (res.unmatched.length ? `，${res.unmatched.length} 行未匹配（见下方提示）。请逐行核对后保存。` : '。请逐行核对后保存。'));
        return;
      }
      const nums = extractNumbers(text);
      if (nums.length && Math.abs(nums.length - state.batchRows.length) <= 8 &&
          window.confirm(`没有识别到姓名，但识别到 ${nums.length} 个分数。是否按本班名单顺序依次填入？`)) {
        nums.forEach((n, i) => {
          if (i < state.batchRows.length) { state.batchRows[i].score = String(n); state.batchRows[i].source = 'ocr'; }
        });
        renderBatchTable();
        setStatus(els.batchImgStatus, `已按名单顺序填入 ${Math.min(nums.length, state.batchRows.length)} 人的分数，请逐行核对后保存。`);
      } else {
        setStatus(els.batchImgStatus, '未匹配到姓名，请改用 Excel 或手动填写');
      }
    } catch (err) {
      setStatus(els.batchImgStatus, (err && err.message === 'TIMEOUT')
        ? '识别超时，请改用 Excel 或手动填写'
        : '识别失败，请确认已上传中文识别包 js/vendor/tesseract/chi_sim.traineddata.gz');
    }
  }

  function withT(seconds, promise) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), seconds * 1000))
    ]);
  }

  function getBatchOcrWorker() {
    if (batchOcrWorkerPromise) return batchOcrWorkerPromise;
    batchOcrWorkerPromise = (async () => {
      if (!window.Tesseract) throw new Error('OCR 组件未加载');
      const worker = await window.Tesseract.createWorker('chi_sim+eng', 1, {
        workerPath: TESS_DIR + 'worker.min.js',
        corePath: TESS_CORE,
        langPath: TESS_DIR,
        gzip: true
      });
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      return worker;
    })().catch(err => { batchOcrWorkerPromise = null; throw err; });
    return batchOcrWorkerPromise;
  }

  /**
   * 从 OCR 文本解析「姓名 + 分数」行。
   * 逻辑：逐行找本班名单中的姓名（最长优先、允许姓名中间夹空格），
   * 每识别到一个姓名，就取其与下一个姓名之间的第一个 0~150 数字作为分数；
   * 这样一行并排多个学生（表格被 OCR 合并）也能正确拆分。
   */
  function parseScoreLines(text, names) {
    const out = [];
    // 先长后短：避免"杨桃"抢占"杨桃花"
    const sorted = names.slice().sort((a, b) => b.length - a.length);
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      // 同一行可能并排多个学生（表格被 OCR 合并成一行），逐个定位姓名
      const hits = [];
      const claimed = [];
      const overlaps = (a, b) => claimed.some(c => a < c.end && b > c.start);
      for (const n of sorted) {
        const chars = Array.from(normalizeName(n));
        if (chars.length < 2) continue;
        const re = new RegExp(chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s·•.]*'), 'g');
        let m;
        while ((m = re.exec(line)) !== null) {
          const start = m.index, end = m.index + m[0].length;
          if (!overlaps(start, end)) { claimed.push({ start, end, name: n }); break; }
        }
      }
      hits.push(...claimed);
      hits.sort((a, b) => a.start - b.start);
      hits.forEach((hit, idx) => {
        const next = hits[idx + 1];
        const seg = line.slice(hit.end, next ? next.start : line.length);
        const nm = seg.match(/\d{1,3}(?:\.\d+)?/);
        if (!nm) return;
        const sc = sanitizeScore(nm[0]);
        if (sc === null) return;
        out.push({ name: hit.name, score: sc });
      });
    }
    return out;
  }

  function extractNumbers(text) {
    const nums = (String(text || '').match(/\d{1,3}(?:\.\d+)?/g) || [])
      .map(Number).filter(n => isFinite(n) && n > 0 && n <= 150);
    return nums;
  }

  /* ---------- Excel 模板下载 / 导入 ---------- */
  // 兜底：xlsx 组件若未随页面加载（文件缺失/首次缓存未命中），按需再拉一次
  let xlsxLoading = null;
  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(true);
    if (xlsxLoading) return xlsxLoading;
    xlsxLoading = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'js/vendor/xlsx.mini.min.js';
      s.onload = () => resolve(!!window.XLSX);
      s.onerror = () => { xlsxLoading = null; resolve(false); };
      document.head.appendChild(s);
      setTimeout(() => { if (!window.XLSX) resolve(false); }, 8000);
    });
    return xlsxLoading;
  }

  function xlsxMissingHint(where) {
    const msg = 'Excel 组件加载失败，请确认已上传 js/vendor/xlsx.mini.min.js';
    if (where === 'status') setStatus(els.batchXlsxStatus, msg);
    else toast(msg);
  }
  async function downloadTemplate() {
    const cls = els.batchClass.value;
    if (!cls) { toast('请先选择班级'); return; }
    if (!window.XLSX) {
      const ok = await ensureXlsx();
      if (!ok || !window.XLSX) { xlsxMissingHint(); return; }
    }
    const aoa = [['姓名', '分数']].concat(state.batchRows.map(r => [r.student_name, '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '成绩单');
    XLSX.writeFile(wb, `成绩单模板_${cls}.xlsx`);
    toast('模板已下载，填分后导入');
  }

  async function onXlsxPicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    clearXlsxIssues();

    // ① 文件格式：扩展名
    const ext = ((String(file.name || '').match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
    if (!ext || ['xlsx', 'xls', 'csv'].indexOf(ext) < 0) {
      setStatus(els.batchXlsxStatus, `不支持「${ext ? '.' + ext : '无扩展名'}」格式，只支持 .xlsx / .xls / .csv`);
      e.target.value = '';
      return;
    }
    // ② 文件大小：5 MB 上限（整班成绩单远小于此，超了基本是选错文件）
    if (file.size > 5 * 1024 * 1024) {
      setStatus(els.batchXlsxStatus, '文件超过 5 MB，请拆分后再导入');
      e.target.value = '';
      return;
    }
    if (!window.XLSX) {
      const ok = await ensureXlsx();
      if (!ok || !window.XLSX) { xlsxMissingHint('status'); return; }
    }
    setStatus(els.batchXlsxStatus, '正在读取表格…');
    const reader = new FileReader();
    reader.onload = () => {
      let aoa;
      try {
        const wb = XLSX.read(reader.result, { type: 'array' });
        if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('工作簿里没有任何工作表');
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) throw new Error('第一个工作表是空的');
        aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      } catch (err) {
        setStatus(els.batchXlsxStatus, '文件打不开：' + ((err && err.message) || '可能不是有效的 Excel 文件'));
        return;
      }

      if (!aoa || !aoa.length || !aoa.some(r => (r || []).some(v => String(v == null ? '' : v).trim() !== ''))) {
        setStatus(els.batchXlsxStatus, '表格是空的，没有任何内容');
        return;
      }

      const parsed = parseSheet(aoa);
      if (parsed.fatal) {
        setStatus(els.batchXlsxStatus, parsed.fatal);
        showXlsxIssues(parsed.issues);
        return;
      }
      if (!parsed.rows.length) {
        setStatus(els.batchXlsxStatus, '没有可导入的分数：所有带分数的行都有问题，详见下方清单');
        showXlsxIssues(parsed.issues);
        return;
      }

      const res = applyImported(parsed.rows, 'excel');
      showXlsxIssues(parsed.issues);
      setStatus(els.batchXlsxStatus,
        `读取到 ${parsed.rows.length} 行有分数，填入 ${res.filled} 人` +
        (parsed.issues.length ? `，${parsed.issues.length} 处问题未导入（见下）。` : '。') +
        '请逐行核对后保存。');
    };
    reader.onerror = () => setStatus(els.batchXlsxStatus, '文件读取失败，请重试');
    reader.readAsArrayBuffer(file);
  }

  function clearXlsxIssues() {
    if (!els.batchXlsxIssues) return;
    els.batchXlsxIssues.hidden = true;
    els.batchXlsxIssues.innerHTML = '';
  }

  function showXlsxIssues(issues) {
    if (!els.batchXlsxIssues) return;
    const list = issues || [];
    if (!list.length) { clearXlsxIssues(); return; }
    const MAX = 12;
    const items = list.slice(0, MAX).map(x => `<li>${esc(x)}</li>`).join('');
    const more = list.length > MAX ? `<li>另有 ${list.length - MAX} 处问题未列出</li>` : '';
    els.batchXlsxIssues.innerHTML = `<b>发现 ${list.length} 处问题</b>，以下行已跳过，可手改或改表格重传：<ul>${items}${more}</ul>`;
    els.batchXlsxIssues.hidden = false;
  }

  /**
   * 解析并校验表格。返回 { rows, issues, fatal }
   *   rows   可导入的 [{name, score}]（姓名在本班、分数合法、文件内不重复）
   *   issues 逐条异常说明（含 Excel 行号），用于面板展示
   *   fatal  整份文件不可用的原因（缺表头/缺列），此时不出行
   */
  function parseSheet(aoa) {
    const issues = [];
    let headerRow = -1, nameCol = -1, scoreCol = -1;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      const row = (aoa[i] || []).map(v => String(v == null ? '' : v).trim());
      const ni = row.findIndex(v => /姓名|名字|学生/.test(v));
      const si = row.findIndex(v => /分数|成绩|得分|分值/.test(v));
      if (ni >= 0 && si >= 0) { headerRow = i; nameCol = ni; scoreCol = si; break; }
    }
    if (headerRow < 0) {
      return { rows: [], issues, fatal: '没有找到表头：前 10 行需包含「姓名」和「分数」两列，请用下载的模板填写' };
    }

    const roster = new Set(rosterOf(els.batchClass ? els.batchClass.value : '').map(s => normalizeName(s.student_name)));
    const seen = new Map();   // 规范化姓名 -> 首次出现的行号
    const rows = [];

    for (let i = headerRow + 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const name = String(row[nameCol] == null ? '' : row[nameCol]).trim();
      const raw = String(row[scoreCol] == null ? '' : row[scoreCol]).trim();
      const line = i + 1;                       // Excel 里看到的行号
      if (!name && !raw) continue;              // 整行空白：正常，静默跳过
      if (!name) { issues.push(`第 ${line} 行：有分数「${raw}」但没有姓名，已跳过`); continue; }
      if (!raw) continue;                       // 只有姓名没分数：缺考/未录入，静默跳过
      if (!roster.has(normalizeName(name))) {
        issues.push(`第 ${line} 行「${name}」：不在本班名单，已跳过`);
        continue;
      }
      const key = normalizeName(name);
      if (seen.has(key)) {
        issues.push(`第 ${line} 行「${name}」：与本文件第 ${seen.get(key)} 行重复，已跳过`);
        continue;
      }
      if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
        issues.push(`第 ${line} 行「${name}」：分数「${raw}」不是数字，已跳过`);
        continue;
      }
      const n = Number(raw);
      if (!isFinite(n) || n < 0 || n > 150) {
        issues.push(`第 ${line} 行「${name}」：分数「${raw}」超出 0~150，已跳过`);
        continue;
      }
      seen.set(key, line);
      rows.push({ name, score: String(Math.round(n * 10) / 10) });
    }
    return { rows, issues, fatal: '' };
  }

  /* ---------- 保存批次 ---------- */
  async function onBatchSave() {
    if (state.batchSaving) return;
    const cls = els.batchClass.value;
    const examName = els.batchName.value.trim();
    const subject = els.batchSubject.value.trim();
    const examDate = els.batchDate.value || todayStr();
    const note = els.batchNote.value.trim();

    if (!cls) { toast('请选择班级'); return; }
    if (!examName) { toast('请先填写考试名称'); els.batchName.focus(); return; }
    const rows = state.batchRows.filter(r => String(r.score || '').trim() !== '');
    if (!rows.length) { toast('还没有填写任何学生的分数'); return; }
    const bad = rows.find(r => sanitizeScore(r.score) === null);
    if (bad) { toast(`「${bad.student_name}」的分数无效，请填写 0~150 的数字`); return; }

    const payloadRows = rows.map(r => ({
      student_id: r.student_id || null,
      student_name: r.student_name,
      score: Number(sanitizeScore(r.score))
    }));
    const mult = batchMultiplier();
    const visible = isParentVisible(els.batchHideParent);

    state.batchSaving = true;
    els.btnBatchSave.disabled = true;
    els.btnBatchSave.textContent = '正在保存…';
    try {
      let imageBlob = null, fileName = null;
      if (state.batchImageBlob) { imageBlob = state.batchImageBlob; fileName = uuidName() + '.jpg'; }
      const wr = await runWrite({ name: 'exam_batch_save', params: {
        class: cls,
        exam_name: examName,
        subject: subject || null,
        exam_date: examDate,
        note: note || null,
        imageBlob,
        fileName,
        multiplier: mult,
        visible,
        rows: payloadRows
      } });
      if (!wr.ok) throw new Error((wr.data && wr.data.message) || '保存失败');

      const awarded = (wr.res && wr.res.awarded) || 0;
      const people = (wr.res && wr.res.students) || rows.length;
      if (wr.queued) {
        toast('已离线保存，联网后自动同步');
      } else if (wr.res && wr.res.fallback) {
        toast('已保存，但未发放星光值：请先执行 116 号数据库脚本');
      } else {
        toast(`已保存「${examName}」` +
          (visible ? '，家长可见' : '，不发送给家长') +
          (awarded > 0 ? ` · ${people} 人共得星光 ${awarded}` : ''));
      }
      resetBatchForm();
      await loadBatchList();
    } catch (err) {
      toast('保存失败：' + ((err && err.message) || '请稍后再试'));
    } finally {
      state.batchSaving = false;
      els.btnBatchSave.disabled = false;
      syncSaveLabels();
    }
  }

  function resetBatchForm() {
    els.batchName.value = '';
    els.batchNote.value = '';
    els.batchSubject.value = '';
    els.batchDate.value = todayStr();
    state.batchImageBlob = null;
    els.batchImg.value = '';
    setStatus(els.batchImgStatus, '');
    els.batchXlsx.value = '';
    setStatus(els.batchXlsxStatus, '');
    els.batchUnmatched.hidden = true;
    els.batchUnmatched.innerHTML = '';
    clearXlsxIssues();
    if (els.batchMultiplier) els.batchMultiplier.value = '1';
    if (els.batchHideParent) els.batchHideParent.checked = false;
    syncSaveLabels();
    resetBatchTable();
  }

  /* ---------- 历史成绩单列表 ---------- */
  async function loadBatchList() {
    if (!els.batchBox) return;
    els.batchBox.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载成绩单…</div>';
    let rows = null, offline = false;
    try {
      const r = await supabase
        .from('exam_batch')
        .select('id,class,exam_name,subject,exam_date,note,image_url,create_at,star_multiplier,visible_parent,exam_score(student_name,score,star_awarded)')
        .order('exam_date', { ascending: false })
        .order('create_at', { ascending: false })
        .limit(100);
      if (r.error) {
        const msg = String((r.error && r.error.message) || r.error || '');
        if (/fetch|network|Failed|timeout|Load failed/i.test(msg)) { offline = true; }
        else {
          els.batchBox.innerHTML = '<div class="t-empty">功能未启用，需执行 database/105-exam-batch.sql</div>';
          return;
        }
      } else { rows = r.data || []; await window.Offline.set('exam_batches', { rows }); }
    } catch (e) { offline = true; }
    if (offline) {
      const v = await window.Offline.get('exam_batches');
      rows = (v && v.rows) || null;
      if (!rows) { els.batchBox.innerHTML = '<div class="t-empty">离线无缓存，请先联网</div>'; return; }
      toast('离线模式 · 显示缓存');
    }
    state.batches = rows || [];
    if (!state.batches.length) {
      els.batchBox.innerHTML = '<div class="t-empty">暂无成绩单</div>';
      return;
    }
    renderBatchList();
  }

  function renderBatchList() {
    els.batchBox.innerHTML = state.batches.map(b => {
      const scores = (b.exam_score || []).map(s => Number(s.score)).filter(n => isFinite(n));
      const stars = (b.exam_score || []).reduce((a, s) => a + (Number(s.star_awarded) || 0), 0);
      const avg = scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : 0;
      const open = !!state.batchDetailOpen[b.id];
      const mult = Number(b.star_multiplier);
      const multOk = STAR_MULTIPLIERS.indexOf(mult) >= 0;
      const starTxt = (stars || (multOk && mult !== 1))
        ? ` · 星光 ${stars}${multOk && mult !== 1 ? '（' + MULT_LABEL[mult] + '）' : ''}`
        : '';
      const hidden = b.visible_parent === false;
      const detail = open
        ? `<div class="batch-item-note">${(b.exam_score || []).map(s => `${esc(s.student_name)} ${s.score == null ? '—' : fmtNum(s.score)}${Number(s.star_awarded) ? '(+' + Number(s.star_awarded) + ')' : ''}`).join('　｜　')}</div>`
        : '';
      return `<div class="batch-item" data-id="${esc(b.id)}">
        <div class="batch-item-info">
          <div class="batch-item-title">${esc(b.exam_name)}<span>${esc(b.class)} · ${esc(b.exam_date || '')}${b.subject ? ' · ' + esc(b.subject) : ''}</span>${hidden ? '<span class="badge-hidden">家长不可见</span>' : ''}</div>
          <div class="batch-item-sub">已录 ${scores.length} 人${scores.length ? ' · 平均 ' + fmtNum(avg) : ''}${starTxt}${b.image_url ? ' · <a href="' + esc(b.image_url) + '" target="_blank" rel="noopener">查看成绩单图</a>' : ''}</div>
          ${b.note ? `<div class="batch-item-note">${esc(b.note)}</div>` : ''}
          ${detail}
        </div>
        <div class="batch-item-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-detail="${esc(b.id)}">${open ? '收起明细' : '查看明细'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-del="${esc(b.id)}" data-url="${esc(b.image_url || '')}">${I.trash('ico-sm')} 删除</button>
        </div>
      </div>`;
    }).join('');
    $$('[data-detail]', els.batchBox).forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.detail;
      state.batchDetailOpen[id] = !state.batchDetailOpen[id];
      renderBatchList();
    }));
    $$('[data-del]', els.batchBox).forEach(btn => btn.addEventListener('click', () => onBatchDelete(btn.dataset.del, btn.dataset.url)));
  }

  async function onBatchDelete(id, url) {
    if (!window.confirm('删除这次成绩单？所有分数一并删除，已发的星光值会扣回')) return;
    let path = null;
    if (url) {
      const m = String(url).match(/exam-papers\/([^?#]+)/);
      if (m) { try { path = decodeURIComponent(m[1]); } catch (e) {} }
    }
    try {
      const wr = await runWrite({ name: 'exam_batch_delete', params: { id, path } });
      if (!wr.ok) throw new Error((wr.data && wr.data.message) || '删除失败');
      const refund = (wr.res && wr.res.refund) || 0;
      toast(wr.queued
        ? '已离线删除，联网后同步'
        : (refund ? `成绩单已删除，扣回星光 ${refund}` : '成绩单已删除'));
      delete state.batchDetailOpen[id];
      await loadBatchList();
    } catch (err) {
      toast('删除失败：' + ((err && err.message) || '请稍后再试'));
    }
  }

  window.TeacherExam = { activate, refreshBatch: loadBatchList };
})();
