/* ============================================================
 * precache.js —— v111 全量预缓存：联网时把数据全部拉下来存本地
 * ------------------------------------------------------------
 * 目标：学校经常无网络。联网时主动把"所有班级/所有学生/所有任务/
 *       提交/记录/考试元数据"缓存到本地，断网后与在线体验一致。
 * 存储：复用 Offline（IndexedDB kv 表）
 * 用法：
 *   Precache.runTeacher(onProgress)  → 教师端：全校全量预缓存
 *   Precache.runStudent(cls, onProgress) → 学生端：本班全量预缓存
 *   onProgress({ done, total, label }) → 进度回调
 * ============================================================ */
(function () {
  'use strict';
  const LIMIT = 500;
  const DAYS = 7;               // 预缓存近 7 天任务/提交/报告
  const CONCURRENCY = 5;        // 并发请求数

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dateStr(offset) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // 并发池：items 逐个执行 fn，同时最多 CONCURRENCY 个
  async function pool(items, fn) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const idx = i++;
        try { await fn(items[idx], idx); } catch (e) { /* 单项失败不阻塞 */ }
      }
    };
    const n = Math.min(CONCURRENCY, items.length || 1);
    await Promise.all(Array.from({ length: n }, worker));
  }
  async function save(key, fetcher) {
    try {
      const res = await fetcher();
      if (res && !res.error && res.data !== undefined && res.data !== null) {
        await window.Offline.set(key, { data: res.data, ts: Date.now() });
        return true;
      }
      if (res && res.data === null && !res.error) { await window.Offline.set(key, { data: [], ts: Date.now() }); return true; }
      return false;
    } catch (e) { return false; }
  }

  const Precache = {
    running: false,
    lastResult: null,
    async getClasses() {
      let classes = [];
      try {
        const r = await supabase.from('student_info').select('class').order('class');
        if (!r.error) {
          classes = Array.from(new Set((r.data || []).map(s => s.class))).sort();
          await window.Offline.set('classes_all', { data: (r.data || []), ts: Date.now() });
        }
      } catch (e) {}
      if (!classes.length) {
        const v = await window.Offline.get('classes_all');
        classes = Array.from(new Set(((v && v.data) || []).map(s => s.class))).sort();
      }
      return classes;
    },

    /* ---------- 教师端：全校全量 ---------- */
    async runTeacher(onProgress) {
      if (this.running) return false;
      this.running = true;
      const steps = [];
      const classes = await this.getClasses();
      const dates = [todayStr(), dateStr(-1), dateStr(-2), dateStr(-3), dateStr(-4), dateStr(-5), dateStr(-6)];

      // 基础数据
      steps.push(['全校名单', () => supabase.from('student_info').select('id, class, student_name').order('class').order('student_name'), 'students_roster']);
      steps.push(['行为标签', () => supabase.from('behavior_tags').select('id,label,tag_type,options,category,score,sort_order,history_unique').eq('is_active', true).order('sort_order'), 'tags']);

      // 每班数据
      classes.forEach(cls => {
        steps.push([cls + ' 座位表', () => supabase.from('seat_grid').select('student_name,seat_row,seat_col').eq('class', cls), 'seat_' + cls]);
        steps.push([cls + ' 近7天任务', () => supabase.from('daily_task').select('*').eq('class', cls).gte('task_date', dateStr(-6)).order('task_date', { ascending: false }), 'tasks_all_' + cls]);
        steps.push([cls + ' 近7天提交', () => supabase.from('task_submission').select('*').eq('class', cls).gte('task_date', dateStr(-6)).limit(LIMIT), 'subs_all_' + cls]);
        steps.push([cls + ' 表现记录', () => supabase.from('daily_record').select('*').eq('class', cls).order('create_at', { ascending: false }).limit(LIMIT), 'records_all_' + cls]);
        steps.push([cls + ' 家长记录', () => supabase.from('home_note').select('*').eq('class', cls).limit(LIMIT), 'notes_all_' + cls]);
        steps.push([cls + ' 考试元数据', () => supabase.from('exam_paper').select('*').eq('class', cls).limit(LIMIT), 'papers_all_' + cls]);
        dates.forEach(d => {
          steps.push([cls + ' ' + d + ' 报告', async () => {
            // mock/真实库的 RPC 只返回 tasks；补齐 allStudents/seatMap 供离线报告渲染学生卡片
            const [r, seat, roster] = await Promise.all([
              supabase.rpc('get_class_task_report', { p_class: cls, p_date: d }),
              supabase.from('seat_grid').select('student_name,seat_row,seat_col').eq('class', cls),
              supabase.from('student_info').select('student_name').eq('class', cls)
            ]);
            if (r.error) return r;
            const seatMap = {};
            ((seat && seat.data) || []).forEach(x => { seatMap[x.student_name] = { r: x.seat_row, c: x.seat_col }; });
            return { error: null, data: {
              allStudents: ((roster && roster.data) || []).map(s => s.student_name),
              tasks: (r.data && r.data.tasks) || [],
              seatMap
            } };
          }, 'taskreport_' + cls + '_' + d]);
        });
      });

      const total = steps.length;
      let done = 0, okN = 0;
      const onStep = (label, ok) => { done++; if (ok) okN++; if (onProgress) onProgress({ done, total, label: label || '' }); };
      await pool(steps, async ([label, fetcher, key]) => {
        const ok = await save(key, fetcher);
        onStep(label, ok);
      });
      this.running = false;
      this.lastResult = { total, ok: okN };
      return true;
    },

    /* ---------- 学生端：本班全量 ---------- */
    async runStudent(cls, onProgress) {
      if (this.running) return false;
      if (!cls) return false;
      this.running = true;

      // 1) 班级墙数据包（名单 + 提交 + 今日任务 + 座位）——裸结构与 loadWall 读取一致
      const steps = [];
      steps.push(['行为标签', () => supabase.from('behavior_tags').select('id,label,tag_type,options,category,score,sort_order,history_unique').eq('is_active', true).order('sort_order'), 'tags']);
      steps.push(['往日任务', () => supabase.from('daily_task').select('id,title,detail,task_date,task_type,due_time').eq('class', cls).gte('task_date', dateStr(-6)).lt('task_date', todayStr()).order('task_date', { ascending: false }), 'sp_past_' + cls]);
      steps.push(['班级列表', () => supabase.from('student_info').select('class').order('class'), 'classes']);

      // 2) 全班每个学生：今日任务(含完成状态) + 成就/头像档案
      let roster = [];
      try {
        const r = await supabase.from('student_directory').select('student_name').eq('class', cls);
        roster = (r && !r.error && r.data) || [];
      } catch (e) {}
      let total = steps.length + roster.length * 2 + 1;
      let done = 0, okN = 0;
      const onStep = (label, ok) => { done++; if (ok) okN++; if (onProgress) onProgress({ done, total, label: label || '' }); };
      // 墙数据包：组装与 loadWall 缓存一致的裸结构（断网刷新时 loadWall 直接读）
      try {
        const [dir, rec, seat, task, sub] = await Promise.all([
          supabase.from('student_directory').select('*').eq('class', cls),
          supabase.from('daily_record').select('*').eq('class', cls).order('create_at', { ascending: false }).limit(LIMIT),
          supabase.from('seat_grid').select('student_name,seat_row,seat_col').eq('class', cls),
          supabase.from('daily_task').select('id,title,detail,task_date,task_type,due_time').eq('class', cls).gte('task_date', todayStr()),
          supabase.from('daily_record').select('*').eq('class', cls).limit(1)
        ]);
        const seatMap = {};
        ((seat && seat.data) || []).forEach(x => { seatMap[x.student_name] = { r: x.seat_row, c: x.seat_col }; });
        await window.Offline.set('wall_' + cls, {
          roster: (dir && dir.data) || [], records: (rec && rec.data) || [],
          seatMap, tasks: (task && task.data) || [], subs: [], ts: Date.now()
        });
        onStep('班级墙', true);
      } catch (e2) { onStep('班级墙', false); }
      await pool(steps, async ([label, fetcher, key]) => {
        const ok = await save(key, fetcher);
        onStep(label, ok);
      });

      await pool(roster, async (s) => {
        const name = s.student_name;
        const ok1 = await save('task_' + cls + '_' + name, () => supabase.rpc('get_today_task', { p_class: cls, p_student: name }));
        onStep(name + ' 今日任务', ok1);
        const ok2 = await save('profile_' + cls + '_' + name, () => supabase.rpc('get_student_profile', { p_class: cls, p_student: name }));
        onStep(name + ' 档案', ok2);
      });
      this.running = false;
      this.lastResult = { total, ok: okN };
      return true;
    }
  };
  window.Precache = Precache;
})();
