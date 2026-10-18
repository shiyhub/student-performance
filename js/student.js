/**
 * 学生端逻辑：班级头像墙（浏览全班/自己的表现）+ 自评提交
 * 数据权限（anon）：
 *   - student_directory 视图：只读，仅班级+学生姓名（不含家长姓名）
 *   - daily_record：可 SELECT 全班记录（头像墙）、仅可 INSERT 自己的新记录
 *   - behavior_tags：只读启用标签
 * Supabase SDK 通过 js/vendor/supabase.js 本地引入（全局 window.supabase）
 */
const supabase = window.supabase
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
  : null;
const ready = !!supabase &&
  !String((window.SUPABASE_CONFIG || {}).url || '').includes('YOUR_PROJECT_REF');

/* ===== 返回导航（RSK-10）：浏览器返回键 / 手机返回手势 → 返回上一级菜单 =====
 * 打开子视图（墙/表单/弹窗）时 push 一层 history；
 * 用户按浏览器返回（PC 返回键 / 手机手势 / 安卓返回键）触发 popstate → NavBack()
 * 按当前 UI 状态逐层回退：弹窗 → 表单 → 墙 → 班级选择页；根视图不拦截（正常退出）。
 * file:// 直接打开时 pushState 失败不影响功能（仅无法拦截返回）。
 */
const Nav = (() => {
  let depth = 0, ready = false;
  const marks = [];
  function enable() { ready = true; }
  function push(mark) {
    if (!ready) return;
    if (marks.length && marks[marks.length - 1] === mark) return;   // 同层重复打开不叠加
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

// 学生端回退：按当前 UI 状态回退最深一层（幂等，只操作 UI，不产生新 push）
function NavBack() {
  if (els.detailModal.classList.contains('show')) { els.detailModal.classList.remove('show'); return true; }
  if (els.avatarModal.classList.contains('show')) { els.avatarModal.classList.remove('show'); return true; }
  if (els.successOverlay.classList.contains('show')) { els.successOverlay.classList.remove('show'); return true; }
  if (els.formView && !els.formView.hidden) {
    els.formView.hidden = true; els.wallView.hidden = false;
    window.scrollTo({ top: 0 }); loadWall();
    return true;
  }
  if (els.wallView && !els.wallView.hidden) {
    const gate = document.getElementById('deviceGate');
    if (gate) { gate.hidden = false; els.wallView.hidden = true; return true; }
  }
  return false;   // 根视图（班级选择/表单初始页）：不拦截，正常退出
}

const $ = (sel, root) => (root || document).querySelector(sel);

/* ---------------- v137(RSK-13)：头像框粒子主题（顶部声明，避免 init 同步路径 TDZ）-----
   每款框专属粒子：颜色/形状/动画，只出现在框外围环带，不遮挡中心头像
   形状：dot 光点 / spark 细光 / petal 花瓣 / star 星点 / ember 焰粒 / bolt 电光
   动画：float 上浮 / rise 上升 / ember 火焰 / twinkle 闪烁 / petal 飘落 / bolt 电流 */
const FRAME_PARTICLES = {
  /* 旧 7 款 CSS 环 */
  bronze:{ n:5, colors:['#cd7f32','#e8b46b'], shapes:['dot'], anim:'twinkle' },
  silver:{ n:5, colors:['#cfe0f0','#9fb6cc'], shapes:['dot'], anim:'twinkle' },
  gold:  { n:6, colors:['#f5b945','#ffd700','#fff3c4'], shapes:['dot','spark'], anim:'rise' },
  rainbow:{n:6, colors:['#ff5f6d','#ffc371','#7be495','#4facfe','#c471ed'], shapes:['dot'], anim:'twinkle' },
  star:  { n:6, colors:['#ffd54a','#fff8dc'], shapes:['star','dot'], anim:'twinkle' },
  heart: { n:6, colors:['#ff8fb1','#ffc1d8','#ff5f8f'], shapes:['dot','petal'], anim:'float' },
  crown: { n:7, colors:['#f5b945','#ffe08a','#fff'], shapes:['dot','star'], anim:'rise' },
  /* 新 12 款游戏框 */
  tac:    { n:7, colors:['#7ea04a','#ff9a3c','#d9e6a8'], shapes:['dot','spark'], anim:'ember' },
  gun:    { n:7, colors:['#ff6a3c','#ffd166','#ff9e5e'], shapes:['spark','dot'], anim:'ember' },
  dragon: { n:8, colors:['#ff4d2e','#ffb347','#ffd700'], shapes:['ember','dot','spark'], anim:'ember' },
  mecha:  { n:8, colors:['#4fc3f7','#a8e6ff','#3a7bd5'], shapes:['bolt','dot'], anim:'bolt' },
  wolf:   { n:7, colors:['#c0c8d8','#7eb8ff','#e8eef7'], shapes:['dot','spark'], anim:'rise' },
  sakura: { n:8, colors:['#ffb7d5','#ff8fb3','#ffe3ef'], shapes:['petal','dot'], anim:'petal' },
  magic:  { n:8, colors:['#b388ff','#7c4dff','#64d8ff'], shapes:['star','dot'], anim:'twinkle' },
  princess:{n:9, colors:['#ffc7e0','#ffd700','#fff'], shapes:['star','dot'], anim:'twinkle' },
  queen:  { n:8, colors:['#e0d9ff','#c9a7ff','#fff'], shapes:['star','dot'], anim:'twinkle' },
  rose:   { n:8, colors:['#ff5f8f','#ff9ebc','#ffd0dd'], shapes:['petal','dot'], anim:'petal' },
  fairy:  { n:8, colors:['#7ee787','#a5f3b5','#d4ff9e'], shapes:['dot','spark'], anim:'float' },
  pixie:  { n:8, colors:['#ff9ef0','#c792ff','#ffd166'], shapes:['dot','star'], anim:'float' }
};
const FP_SHAPE_CLS = { dot:'', spark:'fp-spark', petal:'fp-petal', star:'fp-star', ember:'fp-ember', bolt:'fp-bolt' };
const FP_ANIM_CLS  = { float:'fp-a-float', rise:'fp-a-rise', ember:'fp-a-ember', twinkle:'fp-a-twinkle', petal:'fp-a-petal', bolt:'fp-a-bolt' };

/* v139：写实帅气少年头像专属粒子 + 呼吸光效（mg=机甲系列 arm=铠甲系列 wp=武器系列） */
const AVATAR_PARTICLES = {};

// 心情 5 档（索引即等级 1~5），由勾选项自动计算：3 起步，积极 +1，消极 -1
const MOOD_LEVELS = {
  1: { key: 'sad',    emoji: '😢', label: '需要加油' },
  2: { key: 'down',   emoji: '😟', label: '有点低落' },
  3: { key: 'normal', emoji: '😐', label: '一般' },
  4: { key: 'good',   emoji: '🙂', label: '不错' },
  5: { key: 'happy',  emoji: '😄', label: '很棒' }
};
const MOOD_MAP = Object.fromEntries(Object.values(MOOD_LEVELS).map(m => [m.key, m]));
const MOOD_BY_LEVEL = l => MOOD_LEVELS[Math.min(5, Math.max(1, l))];
const STAR_TEXT = ['', '还需加油', '继续努力', '还不错', '很棒', '超级棒'];
const PRAISE = {
  happy:  ['太棒啦！明天也要保持好心情！', '你今天闪闪发光，继续加油！'],
  good:   ['做得不错，为你点赞！', '稳稳进步中，明天会更好！'],
  normal: ['记录下来就是进步，明天加油！', '没关系，每天进步一点点！'],
  down:   ['明天试着多做一个积极的小表现吧！', '有一点小低落很正常，老师陪着你！'],
  sad:    ['愿意说出来就很勇敢，老师和家长都爱你！', '明天会是新的一天，陪你一起加油！']
};
const AVATARS = Array.from({ length: 24 }, (_, i) => 'animal' + (i + 1));

/* ---------- 校园头像（24 款，3 级解锁）与经验等级 ---------- */
const AVATAR_BASE = 'assets/avatars/';
/* v46：新增 sweet11~18 / game9~15 头像以 SVG(内嵌 webp) 形式提供，旧头像仍为 webp */
const SVG_AVATAR_KEYS = new Set([
  'sweet11','sweet12','sweet13','sweet14','sweet15','sweet16','sweet17','sweet18',
  'game9','game10','game11','game12','game13','game14','game15'
]);
function avatarFile(key) {
  return key + (SVG_AVATAR_KEYS.has(key) ? '.svg' : '.webp');
}
const CAMPUS_GROUPS = [
  { name: '女生款', prefix: 'girl',    count: 8 },
  { name: '男生款', prefix: 'boy',     count: 8 },
  { name: '中性款', prefix: 'neutral', count: 8 }
];
const CAMPUS_KEYS = CAMPUS_GROUPS.reduce((arr, g) => {
  for (let i = 1; i <= g.count; i++) arr.push(g.prefix + i);
  return arr;
}, []);
const CAMPUS_UNLOCK_LEVEL = 3;
/* v2.1：新头像四档（按图片质量 Lv4/5/6/7 解锁；sweet 最亲民 → fantasy 最华丽）
   v2.1 追加：game1~8 硬核游戏风并入 Lv4（与甜美少女并存） */
const NEW_GROUPS = [
  { name: '甜美少女', prefix: 'sweet',   count: 18, level: 4, emoji: '🎀' },
  { name: '游戏风',   prefix: 'game',    count: 15, level: 4, emoji: '🎮' },
  { name: '森系田园', prefix: 'nature',  count: 4,  level: 5, emoji: '🌿' },
  { name: '机甲战士', prefix: 'mecha',   count: 4,  level: 6, emoji: '🛡️' },
  { name: '奇幻神域', prefix: 'fantasy', count: 7,  level: 7, emoji: '✨' }
];
const NEW_KEYS = NEW_GROUPS.reduce((arr, g) => {
  for (let i = 1; i <= g.count; i++) arr.push(g.prefix + i);
  return arr;
}, []);
const NEW_LEVEL_MAP = Object.fromEntries(NEW_KEYS.map(k => [k, NEW_GROUPS.find(g => k.startsWith(g.prefix)).level]));
const EMOJI_CHANGE_LIMIT = 2;
// 各级所需经验下限：L1=0 / L2=20 / L3=60 / L4=120 / L5=200 / L6=400 / L7=600
// v142(RSK-14)：等级上限提升至 Lv.12 —— L8=900 / L9=1300 / L10=1800 / L11=2500 / L12=3500（与数据库 level_from_xp 同口径）
const XP_LEVELS = [0, 20, 60, 120, 200, 400, 600, 900, 1300, 1800, 2500, 3500];

/* ---------- v105：头像框（CSS 光环）与成就 ---------- */
// 头像框目录：解锁条件由服务端 set_student_frame 校验，这里只负责展示
const FRAMES = [
  { key: 'none',    name: '无框',   icon: '⚪', need: '默认佩戴' },
  { key: 'bronze',  name: '铜环',   icon: '🥉', need: '累计记录 10 天' },
  { key: 'silver',  name: '银环',   icon: '🥈', need: '累计记录 30 天' },
  { key: 'gold',    name: '金环',   icon: '🥇', need: '升到 Lv.5' },
  { key: 'rainbow', name: '彩虹环', icon: '🌈', need: '升到 Lv.12 满级' },
  { key: 'star',    name: '星光环', icon: '⭐', need: '累计 20 次积极表现' },
  { key: 'heart',   name: '爱心环', icon: '💗', need: '获得 5 次完美 A+' },
  { key: 'crown',   name: '皇冠环', icon: '👑', need: '班级经验前三' },
  /* v130(RSK-11)：12 款游戏风头像框，按等级开放 */
  { key: 'tac',     name: '军事战术', icon: '🎖️', need: '升到 Lv.2' },
  { key: 'sakura',  name: '樱花甜心', icon: '🌸', need: '升到 Lv.2' },
  { key: 'gun',     name: '射击战士', icon: '🎯', need: '升到 Lv.3' },
  { key: 'pixie',   name: '花漾精灵', icon: '🧚', need: '升到 Lv.3' },
  { key: 'mecha',   name: '雷霆机甲', icon: '🤖', need: '升到 Lv.4' },
  { key: 'magic',   name: '魔法星梦', icon: '✨', need: '升到 Lv.4' },
  { key: 'wolf',    name: '战狼之王', icon: '🐺', need: '升到 Lv.5' },
  { key: 'rose',    name: '玫瑰公主', icon: '🌹', need: '升到 Lv.5' },
  { key: 'fairy',   name: '花灵仙子', icon: '🌿', need: '升到 Lv.5' },
  { key: 'dragon',  name: '龙魂战甲', icon: '🐉', need: '升到 Lv.6' },
  { key: 'queen',   name: '星光女王', icon: '🌙', need: '升到 Lv.6' },
  { key: 'princess', name: '梦幻公主', icon: '👸', need: '升到 Lv.6' }
];
const XP_PER_POSITIVE = 2;
const IMG_KEY_RE = /^(girl[1-8]|boy[1-8]|neutral[1-8]|animal([1-9]|1[0-9]|2[0-4])|sweet([1-9]|1[0-8])|game([1-9]|1[0-5])|nature[1-4]|mecha[1-4]|fantasy[1-7])$/;
function isImgKey(k) { return IMG_KEY_RE.test(String(k || '')); }
function isAnimalKey(k) { return /^animal([1-9]|1[0-9]|2[0-4])$/.test(String(k || '')); }
function isNewKey(k) { return /^(sweet([1-9]|1[0-8])|game([1-9]|1[0-5])|nature[1-4]|mecha[1-4]|fantasy[1-7])$/.test(String(k || '')); }

/* v140：旧 Q 版头像（cyber/mecha/rider/ultra×8）已删除，历史已选学生自动迁移到对应新款写实头像 */
const LEGACY_AVATAR_MAP = {
  cyber: 'animal1', mecha: 'animal1', rider: 'animal1', ultra: 'animal1'
};
/* v1.3：旧 Q 版与已删除典藏头像（mg/arm/wp/magic/star/guofeng/dou/cat）统一迁移到保留的小动物/校园头像，
   按名字哈希稳定分配，避免历史学生头像失效；avatarForName 中 isImgKey 兜底最终保证合法 */
function migrateLegacyAvatar(key) {
  const k = String(key || '');
  const m = /^(cyber|mecha|rider|ultra)([1-8])$/.exec(k);
  if (m) return LEGACY_AVATAR_MAP[m[1]];
  if (/^(girl|boy|neutral|animal|sweet|game|nature|mecha|fantasy)/.test(k)) return k;
  const h = hashCode(k);
  return 'animal' + (((h % 24) + 24) % 24 + 1);
}
function levelFromXp(xp) {
  let lv = 1;
  for (let i = 0; i < XP_LEVELS.length; i++) if ((xp || 0) >= XP_LEVELS[i]) lv = i + 1;
  return lv;
}
function xpProgress(xp, level) {
  if (level >= XP_LEVELS.length) return { pct: 100, left: 0, maxed: true };
  const lo = XP_LEVELS[level - 1], hi = XP_LEVELS[level];
  return { pct: Math.min(100, Math.max(0, ((xp - lo) / (hi - lo)) * 100)), left: hi - (xp || 0), maxed: false };
}
const sfx = window.SFX || {
  tap(){}, back(){}, star(){}, tagOn(){}, tagOff(){}, sub(){}, moodUp(){}, moodDown(){}, pick(){}, success(){}, oops(){}
};

/* ---------- v107：统一离线层辅助 ---------- */
const isNetErr = e => !navigator.onLine || /fetch|network|Failed to fetch|NetworkError|Load failed|timeout/i.test((e && e.message) || '');
// 读操作：在线=网络优先+写缓存；离线/失败=读缓存
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
// 写操作执行器：返回 { ok, data }
async function syncRunner(op) {
  const p = op.params || {};
  try {
    if (op.name === 'submit_today') { const r = await supabase.rpc('submit_today', p); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'submit_task') { const r = await supabase.rpc('submit_task', p); return { ok: !r.error, data: r.data, error: r.error }; }
    if (op.name === 'set_student_avatar') { const r = await supabase.rpc('set_student_avatar', p); return { ok: !r.error && r.data && r.data.ok !== false, data: r.data, error: r.error }; }
    if (op.name === 'set_student_frame') { const r = await supabase.rpc('set_student_frame', p); return { ok: !r.error && r.data && r.data.ok !== false, data: r.data, error: r.error }; }
  } catch (e) { throw e; }
  return { ok: false };
}
// 写操作统一入口：在线直连（网络失败自动入队），离线直接入队；返回 { ok, queued, res }
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
// 联网后同步全部离线操作
async function flushOfflineQueue() {
  if (!window.Offline || !window.Offline.online) return;
  const n = await window.Offline.drain(syncRunner);
  if (n > 0) {
    toast('📡 已同步 ' + n + ' 条离线操作');
    loadWall(); loadTags(); loadProfile(); loadStudentTask();
  }
}
// 离线横幅
let offlineBanner = null;
function ensureOfflineBanner() {
  if (offlineBanner || !document.body) return;
  offlineBanner = document.createElement('div');
  offlineBanner.id = 'offlineBanner';
  offlineBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#4e6b5c;color:#fff;text-align:center;font-size:13px;padding:6px 10px;box-shadow:0 2px 6px rgba(0,0,0,.15);';
  offlineBanner.textContent = '📴 离线模式：正在显示本地缓存，你的操作会先保存，联网后自动同步';
  offlineBanner.hidden = true;
  document.body.appendChild(offlineBanner);
}
window.StudentSync = async () => { await flushOfflineQueue(); };
if (window.Offline) {
  window.Offline.subscribe(v => {
    ensureOfflineBanner();
    if (offlineBanner) offlineBanner.hidden = v;
    if (v) flushOfflineQueue();
  });
  window.Offline.mountBadge();
}

/* ---------- 页面元素 ---------- */
const els = {
  // 墙
  wallView: $('#wallView'),
  formView: $('#formView'),
  wallDate: $('#wallDate'),
  wallConfigBanner: $('#wallConfigBanner'),
  wallClass: $('#wallClass'),
  wallSemester: $('#wallSemester'),
  wallLoading: $('#wallLoading'),
  matesGrid: $('#matesGrid'),
  wallEmpty: $('#wallEmpty'),
  btnGoWrite: $('#btnGoWrite'),
  btnBackWall: $('#btnBackWall'),
  // 详情弹窗
  detailModal: $('#detailModal'),
  detailAvatar: $('#detailAvatar'),
  detailName: $('#detailName'),
  detailSub: $('#detailSub'),
  detailBody: $('#detailBody'),
  detailFoot: $('#detailFoot'),
  btnDetailWrite: $('#btnDetailWrite'),
  btnDetailClose: $('#btnDetailClose'),
  // 头像选择
  btnPickAvatar: $('#btnPickAvatar'),
  identityAvatarEmoji: $('#identityAvatarEmoji'),
  identityLevel: $('#identityLevel'),
  identityXpFill: $('#identityXpFill'),
  identityXpText: $('#identityXpText'),
  avatarModal: $('#avatarModal'),
  avatarModalEmoji: $('#avatarModalEmoji'),
  avatarPicker: $('#avatarPicker'),
  avatarHint: $('#avatarHint'),
  btnAvatarClose: $('#btnAvatarClose'),
  btnSound: $('#btnSound'),
  // 表单
  todayLabel: $('#todayLabel'),
  configBanner: $('#configBanner'),
  inpClass: $('#inpClass'),
  inpName: $('#inpName'),
  starsRow: $('#starsRow'),
  starCaption: $('#starCaption'),
  mpAvatar: $('#mpAvatar'),
  mpBadge: $('#mpBadge'),
  mpLevel: $('#mpLevel'),
  moodMeter: $('#moodMeter'),
  tagsLoading: $('#tagsLoading'),
  tagsBox: $('#tagsBox'),
  tagsFailed: $('#tagsFailed'),
  posGrid: $('#posGrid'),
  negGrid: $('#negGrid'),
  negGroup: $('#negGroup'),
  textTagsBox: $('#textTagsBox'),
  btnSubmit: $('#btnSubmit'),
  submitStatus: $('#submitStatus'),
  successOverlay: $('#successOverlay'),
  successMsg: $('#successMsg'),
  btnAgain: $('#btnAgain'),
  btnWallFromSuccess: $('#btnWallFromSuccess'),
  confettiBox: $('#confettiBox'),
  taskCard: $('#taskCard'),
  taskBody: $('#taskBody'),
  reciteTaskCard: $('#reciteTaskCard'), reciteTaskBody: $('#reciteTaskBody'),
  dictationTaskCard: $('#dictationTaskCard'), dictationTaskBody: $('#dictationTaskBody'),
  pastTaskCard: $('#pastTaskCard'),
  pastTaskBody: $('#pastTaskBody'),
  achCard: $('#achCard'), achGrid: $('#achGrid'), achCount: $('#achCount')
};

const state = {
  // 墙
  classes: [],
  currentClass: '',
  roster: [],
  records: [],
  detailName: '',
  serverToday: null,  // v128(RSK-08)：服务端"今日"日期（提交后校正，设备日期错误时不导致错日）
  // 表单
  stars: 0,
  moodLevel: 3,
  myAvatar: null,    // 学生本次选择/已保存的头像 emoji（null 时按姓名自动分配）
  myFrame: null,     // v105：本次选择/已佩戴的头像框 key（null=跟随名单）
  profile: null,     // v105：get_student_profile 返回的成就档案
  tags: [],
  checkChosen: {},   // 勾选型标签：{ [tagId]: true }
  checkOption: {},   // 勾选型标签选中的二级选项：{ [tagId]: '数学课堂作业' }
  textValues: {},
  doneItems: {}   // 当天已提交过的二级项：{ [tagId]: Set(已选value) }
};
