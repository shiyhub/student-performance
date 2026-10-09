/**
 * 教师端 · 试卷拍照模块
 * 流程：选班级/学生 → 拍照/选图 → 本地 tesseract 识别分数（可手改）
 *       → 上传 Supabase Storage(exam-papers) → 写入 exam_paper → 家长端可见
 * 学生端不引入本文件，也无法查询 exam_paper（RLS + 独立 RPC）。
 * OCR 资源全部本地：js/vendor/tesseract/，不依赖外网 CDN。
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
    examOcrStatus: $('#examOcrStatus'),
    btnExamSave: $('#btnExamSave'),
    btnExamReset: $('#btnExamReset'),
    examBox: $('#examBox')
  };

  const TESS_DIR = 'js/vendor/tesseract/';
  const state = {
    ready: false,
    students: [],        // [{id, class, student_name}]
    imageBlob: null,     // 压缩后的 jpeg Blob
    previewUrl: '',
    ocrBusy: false,
    saving: false
  };
  let ocrWorkerPromise = null;

  function todayStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function uuidName() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ------------ 标签页激活（首次加载名单） ------------ */
  async function activate() {
    if (state.ready) return;
    state.ready = true;
    els.examDate.value = todayStr();
    bindEvents();
    await loadRoster();
    await loadPapers();
  }

  function bindEvents() {
    els.examClass.addEventListener('change', fillStudents);
    els.examFile.addEventListener('change', onFilePicked);
    els.btnExamSave.addEventListener('click', onSave);
    els.btnExamReset.addEventListener('click', resetForm);
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
      if (!data) { toast('离线且暂无名单缓存：请先联网打开过一次考试页'); state.ready = false; return; }
    } else {
      await window.Offline.set('exam_roster', { rows: data || [] });
    }
    state.students = data || [];
    const classes = Array.from(new Set(state.students.map(s => s.class))).sort();
    els.examClass.innerHTML = classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    fillStudents();
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
      setOcrStatus('图片处理失败，可以换一张试试（仍可手动填写分数后保存）。');
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
        corePath: TESS_DIR,                 // 自动选 tesseract-core[-simd].wasm.js
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
    setOcrStatus('正在识别卷面上的分数（首次识别需加载识别引擎，约需十几秒，请稍候）…');
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
        setOcrStatus('没有自动识别到分数，请手动填写后保存。');
      }
    } catch (err) {
      setOcrStatus((err && err.message === 'OCR_TIMEOUT')
        ? '识别超时（超过 60 秒），可再试一次，或直接手动填写分数后保存。'
        : '分数识别失败，可以手动填写分数后保存。');
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

    if (!cls || !studentId) { toast('请先选择班级和学生'); return; }
    if (!state.imageBlob) { toast('请先拍照或选择试卷图片'); return; }

    let score = null;
    if (scoreRaw) {
      const n = Number(scoreRaw);
      if (isNaN(n) || n <= 0 || n > 150) { toast('分数请填写 0~150 之间的数字'); return; }
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
        note: note || null
      } });
      if (!wr.ok) throw new Error('保存失败');

      toast(wr.queued ? '已离线保存，联网后自动上传 ✅' : '已保存，家长可以在查询页看到这份试卷啦');
      resetForm();
      await loadPapers();
    } catch (err) {
      toast('上传失败：' + ((err && err.message) || '请稍后再试'));
    } finally {
      state.saving = false;
      els.btnExamSave.disabled = false;
      els.btnExamSave.textContent = '保存并发送给家长';
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
      if (!rows) { els.examBox.innerHTML = '<div class="t-empty">离线且暂无缓存：请先联网打开过试卷列表。</div>'; return; }
      toast('离线模式：显示上次缓存的试卷');
    }
    const data = rows;
    if (!rows.length) {
      els.examBox.innerHTML = '<div class="t-empty">还没有上传过试卷。</div>';
      return;
    }
    els.examBox.innerHTML = rows.map(r => {
      const score = (r.score !== null && r.score !== undefined && r.score !== '')
        ? parseFloat(Number(r.score).toFixed(1)) + ' 分'
        : (r.score_text || '成绩待补');
      return `<div class="exam-item" data-id="${esc(r.id)}">
        <a class="exam-thumb" href="${esc(r.image_url)}" target="_blank" rel="noopener">
          <img src="${esc(r.image_url)}" alt="试卷" loading="lazy">
        </a>
        <div class="exam-info">
          <div class="exam-line1"><b>${esc(r.student_name)}</b><span>${esc(r.class)}</span></div>
          <div class="exam-line2">${esc(r.record_date)} · ${esc(r.subject || '未填科目')} · <b class="exam-score">${esc(String(score))}</b></div>
          ${r.note ? `<div class="exam-line3">${esc(r.note)}</div>` : ''}
        </div>
        <button type="button" class="btn btn-ghost btn-sm exam-del" data-del="${esc(r.id)}" data-url="${esc(r.image_url)}">🗑️ 删除</button>
      </div>`;
    }).join('');

    $$('.exam-del', els.examBox).forEach(btn => {
      btn.addEventListener('click', () => onDelete(btn.dataset.del, btn.dataset.url));
    });
  }

  async function onDelete(id, url) {
    if (!window.confirm('确定删除这份试卷吗？删除后家长端也看不到了。')) return;
    let path = null;
    if (url) {
      const m = String(url).match(/exam-papers\/([^?#]+)/);
      if (m) { try { path = decodeURIComponent(m[1]); } catch (e) {} }
    }
    try {
      const wr = await runWrite({ name: 'exam_delete', params: { id, path } });
      if (!wr.ok) throw new Error('删除失败');
      toast(wr.queued ? '已离线删除，联网后同步 ✅' : '试卷已删除');
      await loadPapers();
    } catch (err) {
      toast('删除失败：' + ((err && err.message) || '请稍后再试'));
    }
  }

  window.TeacherExam = { activate };
})();
