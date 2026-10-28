
async function loadTags() {
  let data = null, error = null;
  if (!window.Offline || !window.Offline.online) {
    const v = await window.Offline.get('tags');
    data = (v && v.data) || null;
  } else {
    const res = await supabase
      .from('behavior_tags')
      .select('id, label, tag_type, options, category, score, sort_order, history_unique')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    data = res.data; error = res.error;
    if (!error && data) await window.Offline.set('tags', { data });
    if (error || !data) { const v = await window.Offline.get('tags'); data = (v && v.data) || null; }
  }

  els.tagsLoading.hidden = true;
  if (!data) {
    try { data = JSON.parse(localStorage.getItem('sp_tags') || 'null'); } catch(e) {}
    if (!data) { els.tagsFailed.hidden = false; return; }
  } else {
    try { localStorage.setItem('sp_tags', JSON.stringify(data)); } catch(e) {}
  }
  // 兼容旧数据
  data.forEach(t => {
    if (!Array.isArray(t.options)) t.options = [];
    if (t.category !== 'negative') t.category = 'positive';
    if (typeof t.score !== 'number') t.score = t.category === 'negative' ? -1 : 1;
  });
  state.tags = data;
  await loadDoneItems();
  renderTagGrid();
  updateMood();
}

// 方案A：只重渲染标签区（数据已在 state，不重查网络）
function renderTagGrid() {
  if (!state.tags) return;
  els.posGrid.innerHTML = '';
  els.negGrid.innerHTML = '';
  els.textTagsBox.innerHTML = '';
  let hasNeg = false;
  state.tags.forEach(t => {
    if (t.tag_type === 'check') {
      const node = buildCheckTag(t);
      if (t.category === 'negative') { els.negGrid.appendChild(node); hasNeg = true; }
      else els.posGrid.appendChild(node);
    } else {
      els.textTagsBox.appendChild(buildTextTag(t));
    }
  });
  els.negGroup.hidden = !hasNeg;
  if (!state.tags.length) {
    els.posGrid.innerHTML = '<span class="text-muted">老师还没有设置表现标签。</span>';
  }
  els.tagsBox.hidden = false;
}

// 方案A：本地合并当天记录（与服务端"按人按天合并"同口径，不新增重复行）
function mergeLocalRecord(cls, name, items, mood, serverToday) {
  // v128(RSK-08)：优先用服务端返回的 record_date（服务器日期为准），避免设备日期错误时错日
  const today = serverToday || todayStr();
  const existing = state.records.find(r =>
    r.class === cls && r.student_name === name && String(r.record_date).slice(0, 10) === today);
  if (existing) {
    const oldItems = (existing.behavior && Array.isArray(existing.behavior.items)) ? existing.behavior.items : [];
    const seen = new Set(oldItems.map(it => it.id + '|' + (it.value || '')));
    const fresh = items.filter(it => !seen.has(it.id + '|' + (it.value || '')));
    existing.behavior = { mood: mood || (existing.behavior && existing.behavior.mood) || 'normal', items: oldItems.concat(fresh) };
    existing.create_at = new Date().toISOString();
  } else {
    state.records.unshift({
      id: 'local_' + Date.now(),
      student_name: name, class: cls, record_date: today,
      self_evaluation: 0,
      behavior: { mood: mood || 'normal', items },
      teacher_comment: null, create_at: new Date().toISOString()
    });
  }
}

// v123：离线/兜底入队后统一做本地反馈——记录合并、标签即时置灰、墙缓存持久化（刷新后保持）
function applyLocalSubmitFeedback(cls, name, items) {
  mergeLocalRecord(cls, name, items, MOOD_BY_LEVEL(state.moodLevel).key);
  items.forEach(it => {
    const tg = (state.tags || []).find(x => String(x.id) === String(it.id));
    if (tg && tg.history_unique !== false) {
      if (!state.doneItems[tg.id]) state.doneItems[tg.id] = new Set();
      state.doneItems[tg.id].add(it.value || null);
    }
  });
  renderTagGrid();
  const wallSnap = { roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, cachedAt: Date.now() };
  try { localStorage.setItem('sp_wall_cache_' + cls, JSON.stringify(wallSnap)); } catch (e) {}
  window.Offline.set('wall_' + cls, Object.assign({}, wallSnap, { subs: state.todayTaskSubs }));
}

// 加载已提交过的二级项，历史唯一的标签置灰不可重复得分
async function loadDoneItems() {
  state.doneItems = {};
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return;
  let rows = null;
  if (!window.Offline || !window.Offline.online) {
    // v124(Bug-10/11)：离线优先学生端最近的墙缓存（在线加载时实时刷新，最接近数据库），
    // 教师端预缓存快照仅作兜底，且超过 7 天视为过期（防止清理后残留测试项导致离线多置灰）
    const w = await window.Offline.get('wall_' + cls);
    rows = (w && w.records) || [];
    if (!rows.length) {
      let v = await window.Offline.get('records_all_' + cls);
      if (v && v.ts && Date.now() - v.ts > 7 * 86400 * 1000) v = null;
      rows = (v && v.data) || [];
    }
  } else {
    try {
      const { data } = await supabase.from('daily_record')
        .select('behavior, student_name')
        .eq('class', cls).eq('student_name', name)
        .order('create_at', { ascending: false })
        .limit(500);
      rows = data || [];
      if (!rows.length) {
        const w = await window.Offline.get('wall_' + cls);
        rows = (w && w.records) || [];
        if (!rows.length) {
          let v = await window.Offline.get('records_all_' + cls);
          if (v && v.ts && Date.now() - v.ts > 7 * 86400 * 1000) v = null;
          rows = (v && v.data) || [];
        }
      }
    } catch (e) {
      const w = await window.Offline.get('wall_' + cls);
      rows = (w && w.records) || [];
      if (!rows.length) {
        let v = await window.Offline.get('records_all_' + cls);
        if (v && v.ts && Date.now() - v.ts > 7 * 86400 * 1000) v = null;
        rows = (v && v.data) || [];
      }
    }
  }
  (rows || []).forEach(r => {
    if (r.student_name !== name) return;
    const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items : [];
    items.forEach(it => {
      const tid = it.id;
      if (!state.doneItems[tid]) state.doneItems[tid] = new Set();
      // 不可重复标签：只要出现过即记录；value 为空（教师批量评价/一级标签）用 null 标记"整标签已评"
      state.doneItems[tid].add(it.value || null);
    });
  });
}

function buildCheckTag(t) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-tag' + (t.category === 'negative' ? ' is-neg' : '');
  // 不可重复标签置灰：doneSet 含 null 标记 → 整标签已评（教师批量/一级标签）；含具体值 → 该二级项已评
  const doneSet = state.doneItems[t.id];
  const wholeDone = t.history_unique !== false && doneSet && doneSet.has(null);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip' + (t.category === 'negative' ? ' chip-neg' : '') + (wholeDone ? ' done' : '');
  chip.textContent = wholeDone ? t.label + ' ✓' : t.label;
  if (wholeDone) {
    chip.disabled = true;
  } else {
    chip.addEventListener('click', () => toggleCheckTag(t, chip, wrap));
  }
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
      // 历史唯一标签：整标签已评或该具体二级项已评 → 置灰
      const optDone = wholeDone || (doneSet && doneSet.has(opt));
      if (t.history_unique !== false && optDone) {
        b.classList.add('done');
        b.disabled = true;
        b.textContent = opt + ' ✓';
      }
      b.addEventListener('click', () => {
        sfx.sub();
        if (!Array.isArray(state.checkOption[t.id])) state.checkOption[t.id] = [];
        const arr = state.checkOption[t.id];
        const ix = arr.indexOf(opt);
        if (ix >= 0) { arr.splice(ix, 1); b.classList.remove('active'); b.textContent = opt; }
        else { arr.push(opt); b.classList.add('active'); b.textContent = '✓ ' + opt; }
        // 一级标签显示已选数量
        chip.textContent = arr.length ? `${t.label}（已选${arr.length}）` : t.label;
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
  const input = document.createElement('textarea');
  input.className = 'input';
  input.rows = 3;
  input.maxLength = 600;
  input.placeholder = '填写今天的内容（选填，最多 600 字）';
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
  if(els.btnGoWrite) els.btnGoWrite.addEventListener('click', () => { sfx.tap(); Nav.push('form'); showForm(); });
  els.btnBackWall.addEventListener('click', () => { sfx.back(); Nav.push('wall'); showWall(); });
  els.wallClass.addEventListener('change', () => {
    state.currentClass = els.wallClass.value;
    try {
      const saved = JSON.parse(localStorage.getItem('sp_identity') || '{}');
      saved.class = state.currentClass;
      localStorage.setItem('sp_identity', JSON.stringify(saved));
    } catch (e) {}
    loadWall();
  });
  els.wallSemester?.addEventListener('change', () => {
    try { localStorage.setItem('sp_semester', els.wallSemester.value); } catch(e){}
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
    Nav.push('form');   // RSK-10：详情 → 表单
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
  // v160：更换头像框独立入口 → 独立页面
  if (els.btnOpenFrames) els.btnOpenFrames.addEventListener('click', () => { openFramePage(); });
  if (els.btnFrameBack) els.btnFrameBack.addEventListener('click', () => { closeFramePage(); });
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

  // —— v2.0：新头像四档（Lv4-7 按图片质量解锁）——
  NEW_GROUPS.forEach(g => {
    const unlocked = lv >= g.level;
    const sec = document.createElement('div');
    sec.className = 'avatar-sec newtier' + (unlocked ? '' : ' locked-sec');
    sec.innerHTML = unlocked
      ? `<div class="avatar-sec-title">${g.emoji} ${g.name}<span class="avatar-sec-tip ok">Lv.${g.level} 已解锁，可随意更换</span></div>`
      : `<div class="avatar-sec-title">🔒 ${g.emoji} ${g.name}<span class="avatar-sec-tip">升到 Lv.${g.level} 解锁（品质更高的头像）</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'avatar-grid avatar-grid-img';
    for (let i = 1; i <= g.count; i++) {
      grid.appendChild(buildImgChoice(g.prefix + i, cur.key, unlocked, g.level));
    }
    sec.appendChild(grid);
    els.avatarPicker.appendChild(sec);
  });

  // v160：头像框已独立成单独页面（个人主页头像下方「更换头像框」入口），弹窗只保留头像

  renderMoodPreview();
  els.avatarModal.classList.add('show');
  Nav.push('avatar');   // RSK-10：打开换头像弹窗
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
    ? `<img src="${AVATAR_BASE}${avatarFile(key)}" alt="" loading="lazy">`
    : `<img src="${AVATAR_BASE}${avatarFile(key)}" alt="" loading="lazy"><span class="avatar-lock">🔒<em>Lv${lockLevel}</em></span>`;
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
    } else if (reason === 'locked_tier' || isNewKey(key)) {
      const need = NEW_LEVEL_MAP[key] || 4;
      toast(`这款${need >= 6 ? '高' : '精'}品质头像要升到 Lv.${need} 才能用哦，继续加油～`);
    } else if (reason === 'limit') {
      toast(isAnimalKey(key)
        ? `小动物头像今天只能换 ${EMOJI_CHANGE_LIMIT} 次，明天再来换吧～`
        : `表情头像今天只能换 ${EMOJI_CHANGE_LIMIT} 次，明天再来换吧～`);
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
  const wr = await runWrite({ name: 'set_student_avatar', params: { p_class: cls, p_student: name, p_avatar: key } });
  if (!wr.ok) return { ok: false, reason: 'error' };
  if (wr.queued) return { ok: true, queued: true, changes_left: -1 };
  return wr.res || { ok: false, reason: 'error' };
}

/* ---------------- v105：头像框 ---------------- */
function applyFrameTo(el, frameKey) {
  if (!el) return;
  FRAMES.forEach(f => el.classList.remove('frame-' + f.key));
  el.classList.remove('framed');
  const k = (frameKey && FRAME_CLASS[frameKey]) ? frameKey : 'none';
  if (k !== 'none') el.classList.add('framed', 'frame-' + k);
  /* v137(RSK-13)：头像框粒子动效——换框时同步换粒子 */
  attachParticles(el, k);
}

