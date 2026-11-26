/**
 * 学生端逻辑：班级头像墙（浏览全班/自己的表现）+ 自评提交
 * 数据权限（anon）：
 *   - student_directory 视图：只读，仅班级+学生姓名（不含家长姓名）
 *   - daily_record：可 SELECT 全班记录（头像墙）、仅可 INSERT 自己的新记录
 *   - behavior_tags：只读启用标签
 * Supabase SDK 通过 js/vendor/supabase.js 本地引入（全局 window.supabase）
 */
/* 配置守卫：js/config.js 未加载（网络中断/文件缺失）时不抛 TypeError，
   降级为 supabase=null，页面显示「尚未连接数据库」提示而不是白屏 */
const SUPABASE_CFG = window.SUPABASE_CONFIG || null;
const supabase = (window.supabase && SUPABASE_CFG && SUPABASE_CFG.url)
  ? window.supabase.createClient(SUPABASE_CFG.url, SUPABASE_CFG.anonKey)
  : null;
const ready = !!supabase &&
  !String(SUPABASE_CFG.url || '').includes('YOUR_PROJECT_REF');

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
  if (els.checkinSeatModal && els.checkinSeatModal.classList.contains('show')) { els.checkinSeatModal.classList.remove('show'); return true; }
  if (els.checkinModal && els.checkinModal.classList.contains('show')) { els.checkinModal.classList.remove('show'); return true; }
  if (els.detailModal.classList.contains('show')) { els.detailModal.classList.remove('show'); return true; }
  if (els.avatarModal.classList.contains('show')) { els.avatarModal.classList.remove('show'); return true; }
  if (els.successOverlay.classList.contains('show')) { els.successOverlay.classList.remove('show'); return true; }
  if (els.prizeModal && els.prizeModal.classList.contains('show')) { els.prizeModal.classList.remove('show'); return true; }
  // v167：商店 / 转盘 / 头像框页 → 回个人主页
  if (els.frameView && !els.frameView.hidden) { closeFramePage(); return true; }
  if (els.shopView && !els.shopView.hidden) { closeShop(); return true; }
  if (els.lotteryView && !els.lotteryView.hidden) { closeLottery(); return true; }
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
  1: { key: 'sad',    lv: 1, label: '需要加油' },
  2: { key: 'down',   lv: 2, label: '有点低落' },
  3: { key: 'normal', lv: 3, label: '一般' },
  4: { key: 'good',   lv: 4, label: '不错' },
  5: { key: 'happy',  lv: 5, label: '很棒' }
};
const MOOD_MAP = Object.fromEntries(Object.values(MOOD_LEVELS).map(m => [m.key, m]));
const MOOD_BY_LEVEL = l => MOOD_LEVELS[Math.min(5, Math.max(1, l))];
const STAR_TEXT = ['', '还需加油', '继续努力', '还不错', '很棒', '超级棒'];
const PRAISE = {
  happy:  ['记录好了，明天也保持好心情'],
  good:   ['做得不错，继续'],
  normal: ['每天进步一点点'],
  down:   ['明天试着多做一件积极的小事'],
  sad:    ['明天会是新的一天']
};
const AVATARS = Array.from({ length: 24 }, (_, i) => 'animal' + (i + 1));

/* ---------- 校园头像（24 款，星光商店兑换） ---------- */
const AVATAR_BASE = 'assets/avatars/';
/* v46：新增 sweet11~18 / game9~15 头像以 SVG(内嵌 webp) 形式提供，旧头像仍为 webp */
const SVG_AVATAR_KEYS = new Set([
  'sweet11','sweet12','sweet13','sweet14','sweet15','sweet16','sweet17','sweet18',
  'game9','game10','game11','game12','game13','game14','game15'
]);
/* v146(RSK-16)：墙用小图白名单——仅对 >25KB 的大头像生成过 256px 的 `-s.webp`；
   墙上卡片用 256 小图（加载快），详情/预览仍用原图（保质量）。其余小头像无小图、直接原图。 */
const AVATAR_SM_KEYS = new Set([
  'fantasy1','fantasy3','fantasy5','fantasy6','fantasy7',
  'game1','game2','game3','game4','game5','game6','game7','game8',
  'mecha1','mecha2','mecha4','mecha5','nature1','nature2','nature3',
  'sweet1','sweet2','sweet5','sweet6','sweet7','sweet8','sweet9','sweet10',
  'game16','game17','game18','nature5','nature6','nature7','nature8',
  'sweet19','sweet20','sweet21','sweet22',
  'warrior1','warrior2','warrior3','warrior4','warrior5','warrior6',
  'fantasy8','fantasy9','fantasy10','fantasy11',
  'xian1','xian2','xian3','xian4','xian5',
  'chibi1','chibi2','chibi3','chibi4',
  'moe1','moe2','moe3','moe4','moe5','moe6','moe7','moe8','moe9','moe10',
  'bunny','doll','flower','gothic','horn','lotus','twin',
  /* v194：10 张海报头像，512 主图 + 256 缩略图成对 */
  'poster1','poster2','poster3','poster4','poster5',
  'poster6','poster7','poster8','poster9','poster10',
  /* v203：两张横向插画裁出的头像，512 主图 + 128 缩略图成对 */
  'portrait1','portrait2',
  /* v205：7 张漫画头像，512 主图 + 256 缩略图成对 */
  'comic1','comic2','comic3','comic4','comic5','comic6','comic7'
]);
function avatarFile(key, sm) {
  if (sm && AVATAR_SM_KEYS.has(key)) return key + '-s.webp';
  return key + (SVG_AVATAR_KEYS.has(key) ? '.svg' : '.webp');
}
/* v196：学生等级体系停用——头像、头像框一律「已兑换即可佩戴」，
   原 CAMPUS_UNLOCK_LEVEL / NEW_LEVEL_MAP / LEGEND / CHIBI / MOE 等级档位常量已移除。 */

const EMOJI_CHANGE_LIMIT = 2;

/* ---------- v105：头像框（CSS 光环）与成就 ---------- */
// 头像框目录：服务端只校验「已兑换」，佩戴不设等级门槛
const FRAMES = [
  { key: 'none',    name: '无框',   icon: I['circle-dot'](), need: '默认佩戴' },
  { key: 'bronze',  name: '暖阳环', icon: I.medal('rk rk3'), need: '星光商店兑换' },
  { key: 'silver',  name: '月光环', icon: I.medal('rk rk2'), need: '星光商店兑换' },
  { key: 'gold',    name: '阳光环', icon: I.medal('rk rk1'), need: '星光商店兑换' },
  { key: 'rainbow', name: '彩虹环', icon: I.rainbow(), need: '星光商店兑换' },
  { key: 'star',    name: '星光环', icon: I.star(), need: '星光商店兑换' },
  { key: 'heart',   name: '爱心环', icon: I.heart(), need: '星光商店兑换' },
  { key: 'crown',   name: '冠军环', icon: '', need: '星光商店兑换' },
  /* v130(RSK-11)：12 款游戏风头像框 */
  { key: 'tac',     name: '军事战术', icon: I.award(), need: '星光商店兑换' },
  { key: 'sakura',  name: '樱花甜心', icon: '', need: '星光商店兑换' },
  { key: 'gun',     name: '射击战士', icon: I.target(), need: '星光商店兑换' },
  { key: 'pixie',   name: '花漾精灵', icon: '', need: '星光商店兑换' },
  { key: 'mecha',   name: '雷霆机甲', icon: I.robot(), need: '星光商店兑换' },
  { key: 'magic',   name: '魔法星梦', icon: I.sparkle(), need: '星光商店兑换' },
  { key: 'wolf',    name: '战狼之王', icon: '', need: '星光商店兑换' },
  { key: 'rose',    name: '玫瑰公主', icon: '', need: '星光商店兑换' },
  { key: 'fairy',   name: '花灵仙子', icon: I.leaf(), need: '星光商店兑换' },
  { key: 'dragon',  name: '龙魂战甲', icon: '', need: '星光商店兑换' },
  { key: 'queen',   name: '星光女王', icon: I.moon(), need: '星光商店兑换' },
  { key: 'princess', name: '梦幻公主', icon: '', need: '星光商店兑换' },
  /* v142：七风格进阶头像框 */
  { key: 'huadian',  name: '鎏金蝶舞', icon: '', need: '星光商店兑换' },
  { key: 'blossom',  name: '樱吹雪',   icon: '', need: '星光商店兑换' },
  { key: 'ink',      name: '水墨国韵', icon: '', need: '星光商店兑换' },
  { key: 'spring',   name: '春日芳菲', icon: '', need: '星光商店兑换' },
  { key: 'redlily',  name: '彼岸绯红', icon: '', need: '星光商店兑换' },
  { key: 'mask',     name: '暗夜鬼面', icon: '', need: '星光商店兑换' },
  { key: 'neonwolf', name: '霓虹狼影', icon: '', need: '星光商店兑换' },
  /* v155：魔法星空 6 款 + 兽耳小铺 9 款（新增款式，原 27 款不变） */
  { key: 'ice',      name: '冰晶雪翼', icon: '', need: '星光商店兑换' },
  { key: 'moon',     name: '月神羽翼', icon: I.moon(), need: '星光商店兑换' },
  { key: 'crystal',  name: '水晶星梦', icon: '', need: '星光商店兑换' },
  { key: 'silk',     name: '丝带蝶舞', icon: I.ribbon(), need: '星光商店兑换' },
  { key: 'goldwing', name: '鎏金圣翼', icon: '', need: '星光商店兑换' },
  { key: 'kitty',    name: '月眠猫咪', icon: '', need: '星光商店兑换' },
  { key: 'devilcat', name: '恶魔小猫', icon: '', need: '星光商店兑换' },
  { key: 'angelcat', name: '天使小猫', icon: '', need: '星光商店兑换' },
  { key: 'clover',   name: '四叶祝福', icon: I.leaf(), need: '星光商店兑换' },
  { key: 'neko',     name: '奇幻猫耳', icon: I.paw(), need: '星光商店兑换' },
  { key: 'sweets',   name: '甜心点心', icon: '', need: '星光商店兑换' },
  { key: 'goth',     name: '暗黑哥特', icon: '', need: '星光商店兑换' },
  { key: 'broken',   name: '破碎之心', icon: '', need: '星光商店兑换' },
  { key: 'mono',     name: '黑白猫耳', icon: '', need: '星光商店兑换' },
  { key: 'tech',     name: '机能兽耳', icon: '', need: '星光商店兑换' },
  /* v161：紫晶蝶梦（新增款式） */
  { key: 'ribbon',   name: '紫晶蝶梦', icon: '', need: '星光商店兑换' },
  /* v162：四款新头像框（用户定制素材：赛博幻梦/霓虹脉冲/彩虹独角兽/黑金曜石） */
  { key: 'cyber',   name: '赛博幻梦', icon: I.robot(), need: '星光商店兑换' },
  { key: 'pulse',   name: '霓虹脉冲', icon: '', need: '星光商店兑换' },
  { key: 'unicorn', name: '彩虹独角兽', icon: '', need: '星光商店兑换' },
  { key: 'onyx',    name: '黑金曜石', icon: '', need: '星光商店兑换' },
  /* v164：白玫瑰黑羽（用户定制素材） */
  { key: 'rosefeather', name: '白玫瑰黑羽', icon: '', need: '星光商店兑换' },
  /* v193：像素头盔两套（用户定制素材，方形覆盖式，与其余环形框不同口径） */
  { key: 'goldhelm',   name: '黄金头盔', icon: '', need: '星光商店兑换' },
  { key: 'diamondhelm', name: '钻石头盔', icon: '', need: '星光商店兑换' }
];
/* ---------- v173：个人卡片主题（三套水彩羽毛角饰） ----------
   与数据库 shop_item(item_type='theme') 的 item_key 一一对应；
   更换主题走 RPC set_student_card_theme，佩戴信息存在 student_info.card_theme。 */
const CARD_THEMES = [
  { key: 'feather-moon',   name: '月羽星穹', file: 'feather-moon.webp',   desc: '奶金与淡紫' },
  { key: 'feather-violet', name: '紫羽流风', file: 'feather-violet.webp', desc: '薰衣草紫' },
  { key: 'feather-night',  name: '夜羽星尘', file: 'feather-night.webp',  desc: '雾蓝夜空' },
  { key: 'feather-rose',   name: '樱羽星砂', file: 'feather-rose.webp',   desc: '粉紫珠光' },
  { key: 'sky-pastel',     name: '云海晨光', file: 'sky-pastel.webp',     desc: '粉蓝晴空' },
  /* v203：18 套「场景」主题，素材是学生的实景插画，统一重制成卡片比例 480×452；
     裁切时已把主要视觉主体推到卡面横向 80%（头像圆右边界之外），不会被人像挡住 */
  { key: 'scene-tunnel',     name: '萤光隧道', file: 'scene-tunnel.webp',     desc: '林间绿光' },
  { key: 'scene-snow',       name: '雪原红伞', file: 'scene-snow.webp',       desc: '雪野孤影' },
  { key: 'scene-moonrange',  name: '月照苍山', file: 'scene-moonrange.webp',  desc: '雾山冷月' },
  { key: 'scene-bamboo',     name: '竹影灯暖', file: 'scene-bamboo.webp',     desc: '暖橘竹灯' },
  { key: 'scene-lighthouse', name: '星海灯塔', file: 'scene-lighthouse.webp', desc: '星海夜幕' },
  { key: 'scene-stargirl',   name: '星夜少女', file: 'scene-stargirl.webp',   desc: '深蓝星河' },
  { key: 'scene-sakura',     name: '樱湖远山', file: 'scene-sakura.webp',     desc: '粉樱湖光' },
  { key: 'scene-nightcat',   name: '夜庭黑猫', file: 'scene-nightcat.webp',   desc: '夜色庭院' },
  { key: 'scene-meadow',     name: '草地白猫', file: 'scene-meadow.webp',     desc: '森野草绿' },
  { key: 'scene-ink',        name: '水墨剑影', file: 'scene-ink.webp',        desc: '水墨江湖' },
  { key: 'scene-forest',     name: '林隙晨光', file: 'scene-forest.webp',     desc: '林间光束' },
  { key: 'scene-cloudfield', name: '花田云海', file: 'scene-cloudfield.webp', desc: '蓝云暮色' },
  { key: 'scene-iceblue',    name: '冰蓝幻境', file: 'scene-iceblue.webp',    desc: '冰蓝群像' },
  { key: 'scene-whitehair',  name: '白夜回眸', file: 'scene-whitehair.webp',  desc: '白发粉霞' },
  { key: 'scene-sealight',   name: '海天光柱', file: 'scene-sealight.webp',   desc: '海上晨光' },
  { key: 'scene-valley',     name: '山谷村庄', file: 'scene-valley.webp',     desc: '青山雪顶' },
  { key: 'scene-pink',       name: '粉樱少女', file: 'scene-pink.webp',       desc: '粉樱羽翼' },
  { key: 'scene-lava',       name: '熔岩星尘', file: 'scene-lava.webp',       desc: '星球赤焰' },
  /* v206：4 套「合影」主题，素材是五人横构图，统一 480×452。
     原图一比一完整保留在卡面下半部，上方是同一张图模糊后的同色延伸（扩图，不裁人），
     人脸落在头像圆之外，姓名带压在人物胸口/腿部。 */
  { key: 'crew1', name: '彩泡欢歌', file: 'crew1.webp', desc: '白底彩泡' },
  { key: 'crew2', name: '草间晴日', file: 'crew2.webp', desc: '草地午后' },
  { key: 'crew3', name: '台前灯暖', file: 'crew3.webp', desc: '舞台灯火' },
  { key: 'crew4', name: '猫耳浮光', file: 'crew4.webp', desc: '波点猫耳' }
];
const CARD_THEME_BASE = 'assets/themes/';
function cardThemeFile(key) {
  const t = CARD_THEMES.find(x => x.key === key);
  return t ? CARD_THEME_BASE + t.file : '';
}
function cardThemeName(key) {
  const t = CARD_THEMES.find(x => x.key === key);
  return t ? t.name : '';
}
// 卡片主题层：整幅羽饰图铺作卡片背景，中央靠柔光留白（见 css v198 区块）
function cardThemeHTML(key) {
  if (!CARD_THEMES.some(x => x.key === key)) return '';
  return `<div class="card-theme" aria-hidden="true" data-t="${key}"></div>`;
}
// 给容器套用/清除主题（data-ct 驱动 CSS 变量）
function applyCardTheme(el, key) {
  if (!el) return;
  const ok = key && CARD_THEMES.some(x => x.key === key);
  if (!ok) {
    el.removeAttribute('data-ct');
    const old = el.querySelector(':scope > .card-theme');
    if (old) old.remove();
    return;
  }
  el.setAttribute('data-ct', key);
  if (!el.querySelector(':scope > .card-theme')) {
    el.insertAdjacentHTML('afterbegin', cardThemeHTML(key));
  }
}
const XP_PER_POSITIVE = 2;

/* ---------- v167：星光值体系（原「经验值」整体改为「星光值」） ---------- */
// 说明：数据库 student_info.xp 保留为「累计获得星光值」（只增不减，用于累计与排行）；
//      student_wallet.balance 为可消费余额（货币），兑换只扣余额。
const STAR_LABEL = '星光值';
const STAR_ICON = I.star();

/* v143(RSK-15)：学生端禁用手机查看，教师秘钥解锁。改秘钥只需改这一行 */
const MOBILE_ACCESS_KEY = 'teacher2026';
const MOBILE_UNLOCK_KEY = 'sp_mobile_unlocked';
function isMobileDevice() {
  try {
    if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MQQBrowser/i.test(navigator.userAgent || '')) return true;
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return true;
  } catch (e) { /* 忽略检测异常 */ }
  return false;
}
function ensureMobileGate() {
  if (!isMobileDevice()) return;
  try { if (localStorage.getItem(MOBILE_UNLOCK_KEY) === '1') return; } catch (e) { /* 忽略 */ }
  if (document.getElementById('mobileLock')) return;
  const ov = document.createElement('div');
  ov.id = 'mobileLock';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:linear-gradient(160deg,#0b1526,#101d36);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;color:#fff;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;';
  ov.innerHTML =
    '<div style="font-size:30px">' + I['wifi-off']() + '</div>' +
    '<div style="font-size:20px;font-weight:700;letter-spacing:1px">学生端暂不支持手机查看</div>' +
    '<div style="font-size:13px;color:#93a5c4;line-height:1.8">请用电脑浏览器访问。<br>教师需在手机上查看，请输入秘钥。</div>' +
    '<input id="mKeyInput" type="password" placeholder="输入教师秘钥" autocomplete="off" style="width:220px;padding:10px 12px;border-radius:8px;border:1px solid #3b5b8a;background:#0e1a2c;color:#fff;font-size:15px;outline:none;text-align:center;margin-top:6px">' +
    '<div id="mKeyErr" style="font-size:12px;color:#ff6b6b;height:16px"></div>' +
    '<button id="mKeyBtn" style="padding:10px 34px;border-radius:8px;border:none;background:#2f6fed;color:#fff;font-size:15px;font-weight:600;cursor:pointer">解锁查看</button>';
  document.body.appendChild(ov);
  const input = document.getElementById('mKeyInput');
  const err = document.getElementById('mKeyErr');
  const doUnlock = () => {
    const v = (input.value || '').trim();
    if (v === MOBILE_ACCESS_KEY) {
      try { localStorage.setItem(MOBILE_UNLOCK_KEY, '1'); } catch (e) { /* 忽略 */ }
      ov.remove();
    } else {
      err.textContent = '秘钥错误，请重试';
      input.value = '';
      input.focus();
    }
  };
  document.getElementById('mKeyBtn').addEventListener('click', doUnlock);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });
  input.focus();
}
/* v170：追加 7 款独立命名头像（bunny/doll/flower/gothic/horn/lotus/twin） */
const SOLO_AVATAR_KEYS = ['bunny','doll','flower','gothic','horn','lotus','twin'];
/* v197：补上 game18（像素·勇者）与 poster1-10（海报头像）——
   这两批是 129/130 号脚本后来上架的，正则没跟上，导致 isImgKey 判假、
   avatarForName 回退成按姓名哈希分配的小动物头像（像素勇者会显示成海豚/小狗）。 */
const IMG_KEY_RE = /^(girl[1-8]|boy[1-8]|neutral[1-8]|animal([1-9]|1[0-9]|2[0-4])|sweet([1-9]|1[0-9]|2[0-2])|game([1-9]|1[0-8])|poster([1-9]|10)|nature[1-8]|mecha[1-5]|warrior[1-6]|fantasy([1-9]|1[0-1])|xian[1-5]|chibi[1-4]|moe([1-9]|10)|portrait([1-9]|1[0-9])|comic[1-7]|bunny|doll|flower|gothic|horn|lotus|twin)$/;
function isImgKey(k) { return IMG_KEY_RE.test(String(k || '')); }
function isAnimalKey(k) { return /^animal([1-9]|1[0-9]|2[0-4])$/.test(String(k || '')); }
function isNewKey(k) { return /^(sweet([1-9]|1[0-9]|2[0-2])|game([1-9]|1[0-8])|poster([1-9]|10)|nature[1-8]|mecha[1-5]|warrior[1-6]|fantasy([1-9]|1[0-1])|xian[1-5]|chibi[1-4]|moe([1-9]|10)|portrait([1-9]|1[0-9])|comic[1-7])$/.test(String(k || '')); }

/* v140：旧 Q 版头像（cyber/mecha/rider/ultra×8）已删除，历史已选学生自动迁移到对应新款写实头像 */
const LEGACY_AVATAR_MAP = {
  cyber: 'animal1', mecha: 'animal1', rider: 'animal1', ultra: 'animal1'
};
/* v1.3：旧 Q 版与已删除典藏头像（mg/arm/wp/magic/star/guofeng/dou/cat）统一迁移到保留的小动物/校园头像，
   按名字哈希稳定分配，避免历史学生头像失效；avatarForName 中 isImgKey 兜底最终保证合法 */
function migrateLegacyAvatar(key) {
  const k = String(key || '');
  // v152.9：mecha1-4 已是新款「机甲战士」，不再是旧Q版；旧Q版仅 cyber/rider/ultra
  const m = /^(cyber|rider|ultra)([1-8])$/.exec(k);
  if (m) return LEGACY_AVATAR_MAP[m[1]];
  // 有效图片 key 直接保留（含 mecha1-4、warrior1-5、fantasy、xian 等新款）
  if (isImgKey(k)) return k;
  const h = hashCode(k);
  return 'animal' + (((h % 24) + 24) % 24 + 1);
}
const sfx = window.SFX || {
  tap(){}, back(){}, star(){}, tagOn(){}, tagOff(){}, sub(){}, moodUp(){}, moodDown(){}, pick(){}, success(){}, oops(){}
};

/* ---------- v107：统一离线层辅助 ---------- */
const isNetErr = e => !navigator.onLine || /fetch|network|Failed to fetch|NetworkError|Load failed|timeout/i.test((e && e.message) || '');

/* v163(RSK-19)：数据请求超时兜底——海外 Supabase 节点在弱网下可能长时间挂起，
 * 无超时会导致页面永久停留在加载态；超时后走缓存或错误提示，不再卡死。 */
var DATA_TIMEOUT = 15000;
function withTimeout(promise, ms) {
  var timer = null;
  var t = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
  });
  return Promise.race([promise, t]).finally(function () { clearTimeout(timer); });
}
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
// v178(F-02)：白名单改为映射表——新增接口只在这里登记一行；未登记的 op 显式报错，
// 不再静默返回 { ok:false }（v173「点使用无反应」的根因）。签名与返回值结构不变。
const WRITE_HANDLERS = {
  submit_today: p => supabase.rpc('submit_today', p),
  submit_task: p => supabase.rpc('submit_task', p),
  set_student_avatar: p => supabase.rpc('set_student_avatar', p),
  set_student_frame: p => supabase.rpc('set_student_frame', p),
  set_student_card_theme: p => supabase.rpc('set_student_card_theme', p),   // v173 卡片主题佩戴
  confirm_challenge_levels: p => supabase.rpc('confirm_challenge_levels', p) // v152 挑战任务多档位
};
// v204：任务提交被业务规则拒绝时的文案
function taskFailText(res) {
  const why = (res && res.reason) || '';
  if (why === 'graded_locked') return '老师已经评定过这项任务，不能自行改动';
  if (why === 'future_task') return '还没到任务日期，暂时不能提交';
  if (why === 'class_mismatch') return '任务不属于本班，请刷新后重试';
  if (why === 'no_student') return '这个名字不在名单里';
  if (why === 'bad_grade') return '评级无效，请重新选择';
  return '保存失败，请重试';
}

// 个别接口“HTTP 成功但业务失败”，沿用原有判定（判据与改版前逐字一致）
const WRITE_OK_CHECK = {
  set_student_avatar: d => !!(d && d.ok !== false),
  // v204：教师已评级 / 任务未到日期 / 档位重复 等业务拒绝，不能当成保存成功
  submit_task: d => !!(d && d.ok !== false),
  confirm_challenge_levels: d => !!(d && d.ok !== false)
};
async function syncRunner(op) {
  const name = op && op.name;
  const handler = WRITE_HANDLERS[name];
  if (!handler) {
    console.error('[syncRunner] 未登记的操作：' + name + '（请补到 WRITE_HANDLERS）');
    const err = new Error('unregistered_op: ' + name);
    err.unregistered = true;
    throw err;
  }
  const r = await handler(op.params || {});
  const check = WRITE_OK_CHECK[name];
  return { ok: !r.error && (!check || check(r.data)), data: r.data, error: r.error };
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
    // v204：业务拒绝也把返回体带出去，调用方才能提示具体原因（如教师已评级）
    return { ok: false, queued: false, res: r.data };
  } catch (e) {
    if (isNetErr(e)) { await window.Offline.enqueue(op); return { ok: true, queued: true }; }
    if (e && e.unregistered) return { ok: false, queued: false, reason: 'unregistered', error: e.message };
    return { ok: false, queued: false };
  }
}
// 联网后同步全部离线操作
async function flushOfflineQueue() {
  if (!window.Offline || !window.Offline.online) return;
  const n = await window.Offline.drain(syncRunner);
  if (n > 0) {
    toast('已同步 ' + n + ' 条离线操作');
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
  offlineBanner.textContent = '离线模式 · 显示本地缓存，操作稍后同步';
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
  identityStar: $('#identityStar'),
  identityXpText: $('#identityXpText'),
  btnOpenShop: $('#btnOpenShop'),
  // v167：星光商店
  shopView: $('#shopView'),
  btnShopBack: $('#btnShopBack'),
  shopConfigBanner: $('#shopConfigBanner'),
  shopWalletLabel: $('#shopWalletLabel'),
  shopWalletValue: $('#shopWalletValue'),
  shopWalletSub: $('#shopWalletSub'),
  shopTabs: $('#shopTabs'),
  shopLoading: $('#shopLoading'),
  shopGroups: $('#shopGroups'),
  // v167：班级转盘
  lotteryView: $('#lotteryView'),
  btnLotteryBack: $('#btnLotteryBack'),
  lotteryConfigBanner: $('#lotteryConfigBanner'),
  lotteryClassName: $('#lotteryClassName'),
  lotteryClassLv: $('#lotteryClassLv'),
  lotteryChance: $('#lotteryChance'),
  lotteryWheel: $('#lotteryWheel'),
  btnSpin: $('#btnSpin'),
  btnSpinMain: $('#btnSpinMain'),
  btnLotteryHistory: $('#btnLotteryHistory'),
  lotteryTip: $('#lotteryTip'),
  lotterySub: $('#lotterySub'),
  lotteryHistoryCard: $('#lotteryHistoryCard'),
  lotteryHistoryBody: $('#lotteryHistoryBody'),
  prizeModal: $('#prizeModal'),
  prizeIcon: $('#prizeIcon'),
  prizeName: $('#prizeName'),
  prizeDesc: $('#prizeDesc'),
  btnPrizeClose: $('#btnPrizeClose'),
  avatarModal: $('#avatarModal'),
  // v160：头像框独立页面（个人主页头像下方入口）
  btnOpenFrames: $('#btnOpenFrames'),
  btnPickAvatarHint: $('#btnPickAvatarHint'),
  frameView: $('#frameView'),
  btnFrameBack: $('#btnFrameBack'),
  frameConfigBanner: $('#frameConfigBanner'),
  framePreviewCard: $('#framePreviewCard'),
  framePreviewAvatar: $('#framePreviewAvatar'),
  framePreviewName: $('#framePreviewName'),
  framePreviewTip: $('#framePreviewTip'),
  framePageGrid: $('#framePageGrid'),
  frameCountTip: $('#frameCountTip'),
  avatarModalEmoji: $('#avatarModalEmoji'),
  avatarPicker: $('#avatarPicker'),
  avatarHint: $('#avatarHint'),
  btnAvatarClose: $('#btnAvatarClose'),
  leaderboardModal: $('#leaderboardModal'),
  lbTitle: $('#lbTitle'),
  lbSub: $('#lbSub'),
  lbIcon: $('#lbIcon'),
  leaderboardBody: $('#leaderboardBody'),
  btnLbClose: $('#btnLbClose'),
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
  todayTaskCard: $('#todayTaskCard'),
  todayTaskBox: $('#todayTaskBox'),
  personalTaskCard: $('#personalTaskCard'),
  personalTaskBox: $('#personalTaskBox'),
  challengeTaskCard: $('#challengeTaskCard'),
  challengeTaskBox: $('#challengeTaskBox'),
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
  achCard: $('#achCard'), achGrid: $('#achGrid'), achCount: $('#achCount'),
  // v178：五维成长（雷达 + 条形 + 本周维度勋章）
  dimCard: $('#dimCard'), dimRadar: $('#dimRadar'), dimBars: $('#dimBars'), dimMedal: $('#dimMedal'),
  // v213：班级打卡 / 座位点名
  dimNote: $('#dimNote'),
  checkinModal: $('#checkinModal'), ciGrid: $('#ciGrid'), ciSub: $('#ciSub'), ciHeadIcon: $('#ciHeadIcon'),
  btnCheckinClose: $('#btnCheckinClose'), btnCheckinLottery: $('#btnCheckinLottery'),
  checkinSeatModal: $('#checkinSeatModal'), csTitle: $('#csTitle'), csSub: $('#csSub'),
  csHeadIcon: $('#csHeadIcon'), csBoard: $('#csBoard'), csPool: $('#csPool'),
  csCount: $('#csCount'), csAll: $('#csAll'), csNone: $('#csNone'), csSubmit: $('#csSubmit'),
  btnCsClose: $('#btnCsClose')
};

const state = {
  // 墙
  classes: [],
  currentClass: '',
  includeTest: false,   // v195：?test=1 时把测试学生并入班级墙
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
  ,
  // v167：星光值 / 商店 / 班级转盘
  wallet: { balance: 0, total_earned: 0, total_spent: 0 },  // 我的星光值钱包
  owned: { avatar: new Set(), frame: new Set(['none']) },   // 已拥有（可佩戴）的装扮
  shopItems: [],          // 商店商品缓存
  shopTab: 'avatar',      // 商店当前分类
  shopFolded: {},         // v191：商店内分组折叠状态（键为 分类:分组名，缺省=展开）
  firstDiscount: false,   // 首次购买半价是否仍可用
  classProgress: null,    // 班级星光值/等级/抽奖机会
  wheelPrizes: [],        // 转盘奖项
  spinning: false,        // 转盘动画中
  // v173：个人卡片主题（''/null = 未佩戴）
  myCardTheme: null,
  // v167.4：换装扮时的「仅显示已拥有」筛选（记忆到本次会话，不落库）
  avatarOwnedOnly: false,
  frameOwnedOnly: false
};

/* =====================================================================
 * v116：任务区折叠 + 区内滚动
 *   ① 每块任务卡标题右侧加折叠按钮，折叠状态记在 localStorage；
 *   ② 内容区默认显示约 5 行（矮屏 4 行），超出在卡内滚动；
 *   ③ 行高按实际渲染结果实测，字号/密度变化后自动重算。
 * ===================================================================== */
const TASK_FOLD_MAP = [
  { card: 'pastTaskCard', body: 'pastTaskBody' },        // 往日任务
  { card: 'taskCard', body: 'taskBody' },                // 今日任务（每日任务）
  { card: 'reciteTaskCard', body: 'reciteTaskBody' },    // 背诵任务
  { card: 'dictationTaskCard', body: 'dictationTaskBody' }, // 默写任务
  { card: 'todayTaskCard', body: 'todayTaskBox' },       // 教师手动分配
  { card: 'personalTaskCard', body: 'personalTaskBox' }, // 个人任务
  { card: 'challengeTaskCard', body: 'challengeTaskBox' } // 挑战任务
];
const TASK_DEFAULT_ROWS = 5;

function taskFoldStore() {
  try { return JSON.parse(localStorage.getItem('spTaskFold') || '{}') || {}; } catch (e) { return {}; }
}
function saveTaskFold(id, folded) {
  try {
    const m = taskFoldStore();
    m[id] = !!folded;
    localStorage.setItem('spTaskFold', JSON.stringify(m));
  } catch (e) {}
}
/** 显示行数：矮屏少一行，避免首屏被任务占满；卡片可用 data-rows 单独覆盖 */
function visibleTaskRows() {
  const h = window.innerHeight || 800;
  return h < 720 ? 4 : TASK_DEFAULT_ROWS;
}
function measureTaskRowHeight(body) {
  const kids = Array.from(body.children).filter(el => el.offsetHeight > 0);
  if (!kids.length) return 0;
  const hs = kids.slice(0, 6).map(el => {
    const cs = window.getComputedStyle(el);
    return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  }).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)] || 0;   // 中位数，避免首行是说明文字把高度带偏
}
function applyTaskFoldHeight(body) {
  if (!body) return;
  const rowH = measureTaskRowHeight(body);
  if (!rowH) return;                            // 卡片还没显示，等可见后再量
  const custom = parseInt(body.dataset.rows, 10);
  const rows = custom > 0 ? custom : visibleTaskRows();
  body.style.setProperty('--task-row-h', rowH + 'px');
  body.style.setProperty('--task-rows', String(rows));
  body.classList.toggle('is-scrollable', body.scrollHeight > rowH * rows + 2);
}
function initTaskFolds() {
  const store = taskFoldStore();
  TASK_FOLD_MAP.forEach(pair => {
    const cardEl = document.getElementById(pair.card);
    const bodyEl = document.getElementById(pair.body);
    if (!cardEl || !bodyEl) return;
    const title = cardEl.querySelector('.card-title');
    if (!title || title.querySelector('.task-fold')) return;

    bodyEl.classList.add('task-scroll');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'task-fold';
    title.appendChild(btn);

    function setFolded(folded) {
      cardEl.classList.toggle('task-folded', folded);
      btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      btn.title = folded ? '展开' : '收起';
      btn.innerHTML = folded ? I['chevron-down']() : I['chevron-up']();
      if (!folded) applyTaskFoldHeight(bodyEl);
    }
    setFolded(!!store[pair.card]);

    btn.addEventListener('click', () => {
      const folded = !cardEl.classList.contains('task-folded');
      setFolded(folded);
      saveTaskFold(pair.card, folded);
    });

    applyTaskFoldHeight(bodyEl);

    // 内容重渲染（任务条数变化）后重新量高度
    if (window.MutationObserver) {
      let timer = 0;
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => applyTaskFoldHeight(bodyEl), 60);
      }).observe(bodyEl, { childList: true });
    }
    // 卡片从隐藏变可见时补量一次（首屏本卡可能还在加载）
    if (window.ResizeObserver) {
      new ResizeObserver(() => applyTaskFoldHeight(bodyEl)).observe(cardEl);
    }
  });

  window.addEventListener('resize', () => {
    TASK_FOLD_MAP.forEach(pair => {
      const bodyEl = document.getElementById(pair.body);
      if (bodyEl) applyTaskFoldHeight(bodyEl);
    });
  });
}

/* v190：成就卡与五维卡折叠。默认折叠，不记忆状态（每次进入主页都是收起） */
function initCardFolds() {
  const pairs = [
    { card: els.achCard, host: '.card-title' },
    { card: els.dimCard, host: '.dim-head' }
  ];
  pairs.forEach(p => {
    const cardEl = p.card;
    if (!cardEl) return;
    const host = cardEl.querySelector(p.host);
    if (!host || host.querySelector('.card-fold')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'task-fold card-fold';
    btn.title = '展开';
    btn.setAttribute('aria-expanded', 'false');
    host.appendChild(btn);

    function setFolded(folded) {
      cardEl.classList.toggle('card-folded', folded);
      btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      btn.title = folded ? '展开' : '收起';
      btn.innerHTML = folded ? I['chevron-down']() : I['chevron-up']();
    }
    setFolded(true);

    btn.addEventListener('click', () => {
      sfx.tap();
      setFolded(!cardEl.classList.contains('card-folded'));
    });
  });
}

init();

function init() {
  els.wallDate.textContent = todayLabel();
  els.todayLabel.textContent = todayLabel();
  renderStars();
  renderMoodPreview();
  bindEvents();
  initTaskFolds();
  initCardFolds();
  prefillIdentity();
  updateMood();

  if (!ready) {
    els.wallConfigBanner.hidden = false;
    els.configBanner.hidden = false;
    els.btnSubmit.disabled = true;
    if(els.btnGoWrite) els.btnGoWrite.disabled = true;
    els.wallLoading.hidden = true;
    els.tagsLoading.hidden = true;
    els.tagsFailed.hidden = false;
    els.tagsFailed.textContent = '尚未配置完成，请联系老师';
    return;
  }
  loadTags();
  loadClasses();
  Nav.enable();   // RSK-10：初始化完成，之后打开子视图才计入返回栈
}

/* =====================================================================
 * 班级头像墙
 * ===================================================================== */

async function loadClasses() {
  // v127：① 本地班级缓存秒取 → 立即进墙（网络随后静默刷新，首屏不再等网络）
  let cached = [];
  try { cached = JSON.parse(localStorage.getItem('sp_classes') || '[]'); } catch (e) {}
  if (!cached.length) { try { const v = await window.Offline.get('classes'); cached = (v && v.data) || []; } catch (e2) {} }
  if (cached.length) {
    state.classes = cached;
    enterWallFlow();
  }

  // ② 后台网络刷新班级列表（成功则更新下拉；失败且有缓存则保持缓存界面）
  let data = null, error = null;
  try {
    const res = await supabase.from('student_directory').select('class');
    data = res.data; error = res.error || null;
  } catch (e) { error = e; }
  // 视图查询失败（旧设备/权限被改动）→ 尝试直接读 student_info 兜底
  if (error || !data || !data.length) {
    try {
      const r2 = await supabase.from('student_info').select('class');
      if (!r2.error && r2.data && r2.data.length) { data = r2.data; error = null; }
      else if (!error) error = r2.error;
    } catch (e2) { if (!error) error = e2; }
  }
  if (error || !data || !data.length) {
    if (!state.classes.length) {
      try { state.classes = JSON.parse(localStorage.getItem('sp_classes') || '[]'); } catch(e) { state.classes = []; }
      if (!state.classes.length) { try { const v = await window.Offline.get('classes'); state.classes = (v && v.data) || []; } catch(e2) {} }
      if (!state.classes.length) {
        els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">班级名单加载失败：'
          + esc((error && error.message) || '网络异常')
          + '<br><button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="loadClasses()">' + I.sync() + ' 重新加载</button></span>';
        return;
      }
      enterWallFlow();
      return;
    }
    return;   // 有缓存：保持已进入的界面
  }
  state.classes = Array.from(new Set((data || []).map(x => x.class))).sort();
  try { localStorage.setItem('sp_classes', JSON.stringify(state.classes)); } catch(e) {}
  try { await window.Offline.set('classes', { data: state.classes }); } catch(e) {}
  if (!state.classes.length) {
    els.wallLoading.hidden = true;
    els.wallEmpty.hidden = false;
    if(els.btnGoWrite) els.btnGoWrite.disabled = true;
    return;
  }
  // 网络成功：更新班级下拉（若缓存先行时尚未进墙，则进墙）
  els.wallClass.innerHTML = state.classes
    .map(c => `<option value="${esc(c)}"${c === state.currentClass ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');
  if (!state._wallEntered) enterWallFlow();
}

// v127：班级列表就绪后进入班级墙（缓存先行与网络成功两条路径共用）
function enterWallFlow() {
  let saved = '';
  try { const o = JSON.parse(localStorage.getItem('sp_identity') || '{}'); saved = o.class || ''; } catch (e) {}
  const params = new URLSearchParams(location.search);
  const fromUrl = (params.get('class') || '').trim();
  state.currentClass = state.classes.includes(fromUrl) ? fromUrl
                    : state.classes.includes(saved) ? saved
                    : state.classes[0];

  // 老师预览模式：?readonly=1&student=姓名 —— 自动以该学生身份打开，禁止提交
  state.readonly = params.get('readonly') === '1';
  state.previewName = (params.get('student') || '').trim();
  // v195：测试模式 ?test=1 —— 把测试学生并入班级墙，可正常提交
  state.includeTest = params.get('test') === '1';
  const tBanner = document.getElementById('testModeBanner');
  if (tBanner) tBanner.hidden = !state.includeTest;

  ensureMobileGate(); // v143：手机端未解锁一律先过秘钥门（含已保存身份与老师预览）

  els.wallClass.innerHTML = state.classes
    .map(c => `<option value="${esc(c)}"${c === state.currentClass ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');

  // v179：不再设身份关卡——40 人共用一台白板，先进墙，谁填谁点自己的卡片/点名换人。
  //       错填由教师端「撤销 / 恢复」兜底。
  state._wallEntered = true;
  loadWall().then(() => {
    if (state.readonly && state.previewName) {
      showForm(state.previewName);
      applyReadonlyMode();
    } else if (state.includeTest && state.previewName) {
      showForm(state.previewName);   // 测试模式：以测试学生身份直接进入表单，可提交
    }
    // v179：本班全量预缓存原来挂在身份门确认之后，门去掉后挪到这里（每班每次进站一次）
    prefetchClassOnce(state.currentClass);
  });
  flushPending();
}

// 后台预缓存本班全量（名单/任务/成就头像），断网体验与在线一致；每班每页只做一次
function prefetchClassOnce(cls) {
  if (!cls) return;
  state._prefetched = state._prefetched || {};
  if (state._prefetched[cls]) return;
  state._prefetched[cls] = true;
  if (!window.Precache || !window.Offline || !window.Offline.online) return;
  setTimeout(() => {
    try { window.Precache.runStudent(cls, () => {}); } catch (e) {}
  }, 1500);
}

/* ---------------- v179：点名面板（替代原「设备信任门」） ----------------
   40 人共用一台教室白板，效率优先：
   · 不再要求手输姓名、不再拿名单做校验、不再拦截进墙
   · 点名字即认人（一次点击），点错/填错由教师端「撤销 / 恢复」兜底
   · 名单没加载出来时可就地手写名字（不做校验，直接提交，失败会有明确提示） */
let pickerRoster = [];
let pickerClass = '';

function openNamePicker(opts) {
  const box = document.getElementById('namePicker');
  if (!box) return false;
  state._pickerCb = (opts && typeof opts.onPick === 'function') ? opts.onPick : null;
  const clsSel = document.getElementById('npClass');
  const cur = state.currentClass || (state.classes && state.classes[0]) || '';
  if (clsSel) {
    // 当前班级可能不在已加载的班级列表里（手输/旧缓存），补进去，避免下拉显示与实际不一致
    const list = (state.classes || []).slice();
    if (cur && !list.includes(cur)) list.unshift(cur);
    clsSel.innerHTML = (list.length ? list : [cur]).map(c =>
      `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
    clsSel.value = cur;
  }
  pickerClass = cur;
  const s = document.getElementById('npSearch');
  if (s) s.value = '';
  const m = document.getElementById('npManual');
  if (m) m.value = '';
  box.hidden = false;
  loadPickerRoster(pickerClass);
  if (s) setTimeout(() => { try { s.focus(); } catch (e) {} }, 30);
  return true;
}

function closeNamePicker() {
  const box = document.getElementById('namePicker');
  if (box) box.hidden = true;
  state._pickerCb = null;
}

async function loadPickerRoster(cls) {
  pickerClass = cls || pickerClass;
  let list = [];
  // ① 同班直接用墙上已有名单（零请求）
  if (pickerClass === state.currentClass && (state.roster || []).length) {
    list = state.roster.map(s => s.student_name);
  }
  // ② 本地墙缓存
  if (!list.length) {
    try {
      const w = await window.Offline.get('wall_' + pickerClass);
      list = ((w && w.roster) || []).map(s => s.student_name);
    } catch (e) {}
  }
  // ③ 最后才走网络
  if (!list.length) {
    try {
      const r = await supabase.rpc('get_class_roster', { p_class: pickerClass });
      if (!r.error && Array.isArray(r.data)) list = r.data.map(x => x.student_name);
    } catch (e) {}
  }
  pickerRoster = (list || []).map(x => String(x || '').trim()).filter(Boolean);
  renderPickerGrid();
}

function renderPickerGrid() {
  const grid = document.getElementById('npGrid');
  const empty = document.getElementById('npEmpty');
  if (!grid) return;
  const kw = (document.getElementById('npSearch') || {}).value || '';
  const me = (els.inpName && els.inpName.value || '').trim();
  const names = pickerRoster.filter(n => !kw || n.includes(kw.trim()));
  grid.innerHTML = names.map(n =>
    `<button type="button" class="np-name${n === me ? ' is-me' : ''}" data-np="${esc(n)}">${esc(n)}</button>`).join('');
  if (empty) empty.hidden = !!names.length;
  $$('[data-np]', grid).forEach(b => b.addEventListener('click', () => pickName(b.dataset.np)));
}

// 选中填写人：写表单隐藏域 + 记住本机 + 刷新该生数据
function pickName(name) {
  const nm = String(name || '').trim();
  if (!nm) return;
  const cls = pickerClass || state.currentClass;
  const clsChanged = !!cls && cls !== state.currentClass;
  if (cls) {
    state.currentClass = cls;
    els.inpClass.value = cls;
    if (els.wallClass) els.wallClass.value = cls;
  }
  els.inpName.value = nm;
  try { localStorage.setItem('sp_identity', JSON.stringify({ class: els.inpClass.value, studentName: nm })); } catch (e) {}
  const cb = state._pickerCb;
  closeNamePicker();
  renderIdentityName();
  refreshForIdentity();
  if (typeof cb === 'function') { try { cb(nm); } catch (e) {} }
  if (clsChanged) loadWall();   // 换了班级：墙上的名单也要跟着换
  sfx.tap();
}

// 表单身份条：当前填写人一目了然，点一下即可换人
function renderIdentityName() {
  const nm = (els.inpName && els.inpName.value || '').trim();
  const cls = (els.inpClass && els.inpClass.value || '').trim();
  const nEl = document.getElementById('idWhoName');
  const cEl = document.getElementById('idWhoClass');
  const btn = document.getElementById('btnPickMe');
  if (nEl) nEl.textContent = nm || '点我选名字';
  if (cEl) cEl.textContent = cls || '';
  if (btn) btn.classList.toggle('is-empty', !nm);
}

// 换了填写人后，把依赖身份的卡片按新身份刷新一遍
function refreshForIdentity() {
  if (!els.inpName || !els.inpName.value.trim()) return;
  if (els.formView && !els.formView.hidden) {
    loadProfile(); loadWallet(); loadShopCatalog();
    loadStudentTask(); loadPastTasks(); updateSubmitStatus();
    loadTodayTasks(); loadPersonalTasks(); loadChallengeTasks();
  }
  if (els.shopView && !els.shopView.hidden) {
    Promise.resolve(loadWallet())
      .then(() => loadShopCatalog())
      .then(() => renderShop())
      .catch(() => {});
  }
}

function applyReadonlyMode() {
  // 隐藏提交按钮，顶部加预览提示
  const banner = document.createElement('div');
  banner.className = 'preview-banner';
  banner.innerHTML = '' + I.eye() + ' 预览模式（只读）';
  const card = document.querySelector('.identity-card') || document.querySelector('main');
  if (card && !document.querySelector('.preview-banner')) card.prepend(banner);
  if (els.btnSubmit) {
    els.btnSubmit.style.display = 'none';
    const tip = document.createElement('div');
    tip.className = 'text-muted';
    tip.style.cssText = 'margin-top:10px;text-align:center;';
    tip.textContent = '（预览模式不能提交）';
    // v187：按钮已在「今天的小表现」卡片内，提示跟随按钮，不再挂到整个表单末尾
    (els.btnSubmit.parentElement || els.formView).appendChild(tip);
  }
}

async function loadWall() {
  els.wallEmpty.hidden = true;
  const cls = state.currentClass;
  if (!cls) { els.wallEmpty.hidden = false; return; }
  const sem = els.wallSemester ? els.wallSemester.value : '';

  // v127+v145(RSK-15)：① 先渲染本地缓存 → 首屏秒开（网络数据随后静默刷新）
  let cache = null;
  try { cache = await window.Offline.get(wallKey(cls)); } catch (e) {}
  if (!cache) { try { cache = JSON.parse(localStorage.getItem(wallCacheKey(cls)) || 'null'); } catch (e2) { cache = null; } }
  const hasCache = !!(cache && Array.isArray(cache.roster) && cache.roster.length);
  if (hasCache) {
    state.roster = cache.roster || [];
    state.records = cache.records || [];
    state.seatMap = cache.seatMap || {};
    state.todayTaskDefs = cache.tasks || [];
    state.todayTaskSubs = cache.subs || [];
    renderWall();   // 本地数据立即渲染
  } else {
    els.matesGrid.hidden = true;
    els.wallLoading.hidden = false;
    els.wallLoading.innerHTML = '<span class="spinner"></span>正在加载同学们…';
  }

  // v145(RSK-15)：60 秒内缓存视为新鲜直接复用——班级墙数据变化不频繁，
  // 避免每次进出墙都跨洋请求（数据库在海外，弱网下 RTT 高）。超时才后台刷新。
  const CACHE_TTL = 60 * 1000;
  if (hasCache && cache.cachedAt && (Date.now() - cache.cachedAt) < CACHE_TTL) {
    els.wallLoading.hidden = true;
    return;
  }

  // ② v145(RSK-15)：优先走聚合 RPC get_wall_data（名单+近30天记录+今日任务+座位+提交，1 次往返）
  //    需先在 Supabase 执行 58-get-wall-data.sql；RPC 不可用（未执行/离线）时自动回退原多请求
  let wallData = null;
  try {
    if ((!window.Offline || window.Offline.online)) {
      const r = await withTimeout(supabase.rpc('get_wall_data', Object.assign((sem && sem !== '全部') ? { p_class: cls, p_semester: sem } : { p_class: cls }, { p_include_test: !!state.includeTest })), DATA_TIMEOUT);
      if (r && !r.error && r.data && r.data.ok !== false) wallData = r.data;
    }
  } catch (e) { wallData = null; }

  if (wallData) {
    state.roster = wallData.roster || [];
    state.records = wallData.records || [];
    const seatArr = wallData.seat || [];
    if (Array.isArray(seatArr) && seatArr.length) {
      const m = {};
      seatArr.forEach(s => { m[s.student_name] = (Number(s.seat_row) * 6 + Number(s.seat_col)); });
      state.seatMap = m;
    }
    state.todayTaskDefs = wallData.tasks || [];
    state.todayTaskSubs = wallData.subs || [];
    if (wallData.progress && wallData.progress.ok !== false) state.classProgress = wallData.progress;
    try { localStorage.setItem(wallCacheKey(cls), JSON.stringify({ roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, cachedAt: Date.now() })); } catch(e) {}
    await window.Offline.set(wallKey(cls), { roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, subs: state.todayTaskSubs, cachedAt: Date.now() });
    if (!state.roster.length) {
      els.wallEmpty.hidden = false;
      return;
    }
    els.wallLoading.hidden = true;
    renderWall();   // 静默重绘为最新数据
    return;
  }

  // ③ 回退：原多请求并行（v145：records 加近 30 天时间窗，墙只需近期状态；累计天数由 get_student_profile 计算）
  const since = new Date(); since.setDate(since.getDate() - 30);
  const p2 = n => String(n).padStart(2, '0');
  const sinceStr = `${since.getFullYear()}-${p2(since.getMonth()+1)}-${p2(since.getDate())}`;
  const recQ = supabase.from('daily_record')
      .select('id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at')
      .eq('class', cls)
      .gte('record_date', sinceStr);
  if (sem && sem !== '全部') recQ.eq('semester', sem);
  let rosterRes = {}, recordRes = {}, taskDefRes = {};
  try {
    [rosterRes, recordRes, taskDefRes] = await withTimeout(Promise.all([
      supabase.from('student_directory')
        .select('*')
        .eq('class', cls)
        .order('student_name'),
      recQ
        .order('record_date', { ascending: false })
        .order('create_at', { ascending: false })
        .limit(500),
      supabase.from('daily_task')
        .select('id,title,task_type')
        .eq('class', cls).eq('task_date', todayStr())
    ]), DATA_TIMEOUT);
  } catch (e) {
    // 断网/网络错误：标记失败，走缓存（已在上面渲染过缓存则不打扰）
    rosterRes.error = { message: 'offline' };
    recordRes.error = { message: 'offline' };
  }

  if (rosterRes.error || recordRes.error) {
    els.wallLoading.hidden = true;
    if (!hasCache) {
      els.wallLoading.hidden = false;
      els.wallLoading.innerHTML = '<span class="banner banner-error" style="margin:0;">加载失败，请刷新重试</span>';
    }
    return;   // 有缓存：静默保持已渲染的缓存界面
  }
  // v195：RPC 不可用时的回退路径同样按测试口径过滤
  const rawRoster = rosterRes.data || [];
  const testRosterVisible = x => x.is_test && x.test_enabled &&
    (state.includeTest || x.test_show_on_wall);
  state.roster = rawRoster.filter(x => !x.is_test || testRosterVisible(x));
  // 记录只在测试模式并入：普通模式下即使上墙也不参与平均星级/今日人数
  const hiddenTest = new Set(rawRoster
    .filter(x => x.is_test && !state.includeTest)
    .map(x => x.student_name));
  state.records = (recordRes.data || []).filter(r => !hiddenTest.has(r.student_name));
  try { await loadClassProgress(); } catch (e) {}
  // 座位表：只有在线真正拿到数据才重建；离线/失败保留缓存值（否则座位布局丢失且会被空表覆盖）
  try {
    const seatRes = await supabase.from('seat_grid').select('seat_row,seat_col,student_name').eq('class', state.currentClass);
    if (seatRes && !seatRes.error && seatRes.data && seatRes.data.length) {
      const m = {};
      seatRes.data.forEach(s => { m[s.student_name] = (s.seat_row*6 + s.seat_col); });
      state.seatMap = m;
    }
  } catch(e) {}
  // 今日任务：在线拿到数据才覆盖；离线保留缓存值（离线也显示已发布任务）
  if (taskDefRes && !taskDefRes.error && taskDefRes.data) {
    state.todayTaskDefs = taskDefRes.data || [];
  }
  // task_submission 没有 task_date/class 列，按当天任务 id 查提交
  let todayTaskSubs = [];
  if (state.todayTaskDefs.length) {
    const ids = state.todayTaskDefs.map(t => t.id);
    const subRes = await supabase.rpc('get_today_subs', { p_task_ids: ids });
    todayTaskSubs = (subRes && subRes.data) || [];
  }
  state.todayTaskSubs = todayTaskSubs;
  try { localStorage.setItem(wallCacheKey(cls), JSON.stringify({ roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, cachedAt: Date.now() })); } catch(e) {}
  await window.Offline.set(wallKey(cls), { roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, subs: todayTaskSubs, cachedAt: Date.now() });
  if (!state.roster.length) {
    els.wallEmpty.hidden = false;
    return;
  }
  els.wallLoading.hidden = true;
  renderWall();   // 静默重绘为最新数据
}
// v161(⑤修复)：loadWallData 墙轻刷新钩子（原由分片脚本定义；分片停止加载后在此补回，
// 供保存成功等回调刷新班级墙，避免陈旧展示）
window.loadWallData = () => { try { loadWall(); } catch (e) { console.warn('loadWallData', e); } };

// v195：测试模式（?test=1）用独立缓存键，测试名单不会写进普通学生的墙缓存
function wallKey(cls) { return 'wall_' + cls + (state.includeTest ? '_test' : ''); }
function wallCacheKey(cls) { return 'sp_wall_cache_' + cls + (state.includeTest ? '_test' : ''); }

// v188：班级等级曲线（与 database/125-class-level-curve.sql 同口径）
// 升到 2/3/4/5 级分别需 500 / 1000 / 1500 / 2000，5 级以后每级固定 2000，上限 99 级
const CLASS_MAX_LV = 99;
const CLASS_LV_COST = [500, 1000, 1500, 2000];
function classLevelCost(lv) { return lv <= 4 ? CLASS_LV_COST[lv - 1] : 2000; }
function classNeedXp(lv) { let s = 0; for (let i = 1; i < lv; i++) s += classLevelCost(i); return s; }
function classLevelOf(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let lv = 1, need = 0;
  while (lv < CLASS_MAX_LV && x >= need + classLevelCost(lv)) { need += classLevelCost(lv); lv++; }
  return lv;
}

function renderWall() {
  const recs = state.records;
  // v128(RSK-08)：今日判定以服务端日期为准（提交后校正），设备日期错误不导致错日
  const today = state.serverToday || todayStr();

  // 全班汇总（未打星的记录不计入平均星级）
  const classRated = recs.filter(r => Number(r.self_evaluation) > 0);
  const classAvg = classRated.length
    ? (classRated.reduce((s, r) => s + Number(r.self_evaluation), 0) / classRated.length).toFixed(1)
    : null;
  const classToday = recs.filter(r => r.record_date === today).length;

  // v167：班级星光值 = 学生星光值转化累计（服务端 class_progress，学生消费不影响班级星光值）
  const prog = state.classProgress || null;
  const classXp = prog ? (Number(prog.xp) || 0) : state.roster.reduce((s2, x) => s2 + (Number(x.xp) || 0), 0);
  // v188：曲线改为 500/1000/1500/2000，之后每级 2000（离线兜底与服务端同口径）
  const classLv = prog ? (Number(prog.level) || 1) : classLevelOf(classXp);
  const maxed = classLv >= CLASS_MAX_LV;
  const nextNeed = prog && prog.next_need != null
    ? Number(prog.next_need)
    : (maxed ? 0 : classNeedXp(classLv + 1));
  const leftNeed = prog && prog.next_level_need != null ? Number(prog.next_level_need) : Math.max(0, nextNeed - classXp);
  const chances = prog ? (Number(prog.chances) || 0) : 0;
  const classLvText = nextNeed ? `Lv${classLv} · 再${leftNeed}升Lv${classLv + 1}` : `Lv${classLv} · 满级`;

  let html = '';

  // 全班汇总卡：点班级头像 → 转盘抽奖（v167）
  const classCard = `<div class="class-card-inner">
      <button type="button" class="class-avatar-btn" data-classdraw="1" title="点击班级头像进入转盘抽奖">
        <span class="class-avatar-emoji">${I.users('ico-lg')}</span>
        <span class="class-lv-badge">Lv.${classLv}</span>
        ${chances > 0 ? `<span class="class-chance-dot" title="可抽奖 ${chances} 次">${chances}</span>` : ''}
      </button>
      <div class="class-card-info">
        <div class="class-card-name">${esc(state.currentClass)} 全班</div>
        <div class="class-card-xp">${I.heart()} 班级星光值 <b>${classXp}</b> · ${classLvText}</div>
        <div class="class-card-sub">共 ${state.roster.length} 人${chances > 0 ? ` · 可抽奖 ${chances} 次` : ''}</div>
      </div>
      <button type="button" class="class-detail-btn" data-detail="__all__">全班记录 ›</button>
    </div>`;
  const slot = document.getElementById('wallClassCard');
  if (slot) slot.innerHTML = classCard;

  // 按座位编排：空位保留，按 seat_row*6+col 定位
  // v128(RSK-07)：槽位数动态计算（默认 42 格；学生/座位超 42 时按 6 列向上扩展），超员不错位
  // 注意：seatMap 为 { 学生名: 槽位索引 }，取槽位索引必须用 Object.values()（key 是姓名，Number(姓名)=NaN）
  const useSeat = state.seatMap && Object.keys(state.seatMap).length;
  const slotOf = {};
  if (useSeat) Object.entries(state.seatMap).forEach(([n,i]) => slotOf[i] = n);
  const seatSlots = useSeat ? Object.values(state.seatMap).map(Number) : [];
  const maxSeatSlot = seatSlots.length ? Math.max.apply(null, seatSlots) : -1;
  const slotCount = Math.max(42, Math.ceil(Math.max(state.roster.length, maxSeatSlot + 1) / 6) * 6);
  const ordered = [];
  if (useSeat) {
    for (let i=0;i<slotCount;i++) {
      const n = slotOf[i];
      if (n) ordered.push(state.roster.find(s=>s.student_name===n));
      else ordered.push(null); // 空位占位
    }
    state.roster.forEach(s => {
      const placed = Object.values(state.seatMap).some(v => v === state.seatMap[s.student_name]);
      if (!placed) ordered.push(s);
    });
  } else {
    state.roster.forEach(s=>ordered.push(s));
  }
  // v167.3：星光值榜 TOP5 角花装饰——只有真正获得过星光值（xp>0）的同学参与排名，
  //         全班都是 0 时不排名，避免开局人人挂角标。
  const rankMap = {};
  // v195：测试学生不参与星光值排名（即使显示在墙上）
  const rankedRoster = state.roster.filter(x => !x.is_test && (Number(x.xp) || 0) > 0)
    .sort((a,b) => (Number(b.xp)||0) - (Number(a.xp)||0));
  if (rankedRoster.length) {
    rankedRoster.slice(0,5).forEach((s,idx) => { rankMap[s.student_name] = idx + 1; });
  }
  ordered.forEach((s) => {
    if (!s) { html += `<div class="mate seat-empty"></div>`; return; }
    const mine = recs.filter(r => r.student_name === s.student_name);
    const mineRated = mine.filter(r => Number(r.self_evaluation) > 0);
    const avg = mineRated.length
      ? (mineRated.reduce((sum, r) => sum + Number(r.self_evaluation), 0) / mineRated.length).toFixed(1)
      : null;
    const todayRecs = mine.filter(r => r.record_date === today);
    const todayRec = todayRecs.length ? todayRecs[todayRecs.length - 1] : null;
    const todayMood = todayRec ? MOOD_MAP[todayRec.mood || (todayRec.behavior && todayRec.behavior.mood)] : null;
    // 卡片上不再贴「完成数/总数」胶囊角标：数字去除后，是否完成由教师端把控与查看
    const todayLevel = todayMood
      ? Number(Object.keys(MOOD_LEVELS).find(l => MOOD_LEVELS[l].key === todayMood.key)) || 3
      : 0;

    const av = avatarForName(s.student_name, s.avatar, true);   // v146：墙上用 256 小图（加载快，详情/预览仍用原图）
    const ringCls = todayLevel ? ` mood-l${todayLevel}` : '';
    const frameCls = s.frame ? ` framed frame-${s.frame}` : '';
    const moodInline = todayMood
      ? `<span class="mate-today" title="今日心情：${todayMood.label}">${I.mood(todayMood.lv)}</span>` : '';

    const rank = rankMap[s.student_name] || 0;   // v150：星光值榜名次（1-5）
    const testTag = s.is_test ? '<span class="mate-test-tag">测试</span>' : '';
    // v191：移除 v155 的右上角魔法星空装饰（自适配差，卡角被裁切），只保留左上/右下金色角标
    // v173：个人卡片主题（未购买则不渲染角饰层）
    const ct = (s.card_theme && CARD_THEMES.some(t => t.key === s.card_theme)) ? s.card_theme : '';
    const ctAttr = ct ? ` data-ct="${ct}"` : '';
    html += `<button class="mate${rank ? ` rank-${rank}` : ''}"${ctAttr} data-detail="${esc(s.student_name)}">
        ${ct ? cardThemeHTML(ct) : ''}
        ${rank ? `<span class="rank-corner"><i>${rank}</i></span><span class="rank-corner rank-corner-br"></span>` : ''}
        <span class="mate-avatar${ringCls}${frameCls}${AVATAR_PARTICLES[av.key] ? ' ap-breathe' : ''} ${av.kind === 'img' ? 'is-img' : ''}" style="background:${av.bg};${AVATAR_PARTICLES[av.key] ? `--glow:${AVATAR_PARTICLES[av.key].glow};` : ''}">${avatarInner(av)}${avatarParticlesHTML(s.avatar)}${frameParticlesHTML(s.frame)}</span>
        <span class="mate-name">${moodInline}<span class="mate-name-t">${esc(s.student_name)}</span>${testTag}<span class="mate-star" title="可消费星光值">${I.star('ico-xs')}<span class="ms-n">${Number(s.star) || 0}</span></span></span>
      </button>`;
  });

  els.matesGrid.classList.toggle('seat-mode', !!useSeat);
  els.matesGrid.innerHTML = html;
  els.matesGrid.hidden = false;

  // 班级星光值进度（v167.3：移除「今日已填写 x/y 人」进度，避免新周期全是 0 的空统计）
  const cp = id => document.getElementById(id);
  if (cp('cpXp')) {
    cp('cpXp').textContent = classXp;
    cp('cpNext').textContent = nextNeed ? `Lv${classLv}  再${leftNeed} 升 Lv${classLv + 1}${chances ? ` · 可抽奖 ${chances} 次` : ''}` : `Lv${classLv} 满级`;
    const pct = prog ? (Number(prog.pct) || 0) : (maxed ? 100 : (() => {
      const prev = classNeedXp(classLv), next = classNeedXp(classLv + 1);
      return Math.min(100, Math.max(0, (classXp - prev) / Math.max(1, next - prev) * 100));
    })());
    cp('cpFill').style.width = pct + '%';
  }

  $$('.mate', els.matesGrid).forEach(btn => {
    btn.addEventListener('click', () => {
      sfx.tap();
      const key = btn.dataset.detail;
      if (key === '__all__') openClassDetail(classAvg, classToday);
      // v188：点学生头像直接进该生主页，不再先弹详情卡再点「去填写」
      else { Nav.push('form'); showForm(key); }
    });
  });

  // v167：点班级头像 → 转盘抽奖
  const classSlot = document.getElementById('wallClassCard');
  if (classSlot) {
    const avBtn = classSlot.querySelector('[data-classdraw]');
    if (avBtn) avBtn.addEventListener('click', () => { sfx.tap(); openCheckin(); });   // v213：原转盘入口改为打卡面板
    const detailBtn = classSlot.querySelector('[data-detail="__all__"]');
    if (detailBtn) detailBtn.addEventListener('click', () => { sfx.tap(); openClassDetail(classAvg, classToday); });
  }
}

// v188：星光墙点击头像已改为直接进主页，本函数暂无入口；保留供班级详情外的单人查看场景复用
function openStudentDetail(name) {
  const rows = state.records
    .filter(r => r.student_name === name)
    .sort((a, b) => (a.record_date < b.record_date ? 1 : a.record_date > b.record_date ? -1 :
                      (a.create_at < b.create_at ? 1 : -1)));
  const rosterRow = state.roster.find(s => s.student_name === name);
  const av = avatarForName(name, rosterRow && rosterRow.avatar);
  paintAvatar(els.detailAvatar, av);
  applyFrameTo(els.detailAvatar, rosterRow && rosterRow.frame);
  els.detailName.textContent = name;
  const rated = rows.filter(r => Number(r.self_evaluation) > 0);
  const avg = rated.length
    ? (rated.reduce((s, r) => s + Number(r.self_evaluation), 0) / rated.length).toFixed(1)
    : null;
  const starOf = rosterRow ? (Number(rosterRow.star) || 0) : 0;
  els.detailSub.textContent = (rows.length
    ? `共 ${rows.length} 条记录${avg ? ' · 平均 ' + avg + ' 星' : ''}`
    : '还没有记录') + ` · 星光 ${starOf}`;
  // v146(RSK-16)：墙 records 已瘦身（不含 items/teacher_comment），明细点开详情时按需拉取
  els.detailBody.innerHTML = '<div class="detail-loading" style="padding:24px 10px;color:#98a69f;">正在加载详细记录…</div>';
  state.detailName = name;
  els.detailFoot.hidden = false;
  els.detailModal.classList.add('show');
  Nav.push('detail');   // RSK-10：打开详情弹窗
  fetchDetailRecords(name).then(full => {
    if (state.detailName !== name) return;   // 已切换到其他详情/关闭
    const rows2 = (full || []).filter(r => r.student_name === name)
      .sort((a, b) => (a.record_date < b.record_date ? 1 : a.record_date > b.record_date ? -1 :
                        (a.create_at < b.create_at ? 1 : -1)));
    const rated2 = rows2.filter(r => Number(r.self_evaluation) > 0);
    const avg2 = rated2.length
      ? (rated2.reduce((s, r) => s + Number(r.self_evaluation), 0) / rated2.length).toFixed(1)
      : null;
    els.detailSub.textContent = rows2.length
      ? `共 ${rows2.length} 条记录${avg2 ? ' · 平均 ' + avg2 + ' 星' : ''}`
      : '还没有记录';
    els.detailBody.innerHTML = renderRecordTimeline(rows2);
  });
}

function openClassDetail(avg, todayCount) {
  els.detailAvatar.textContent = '';
  els.detailAvatar.style.background = 'linear-gradient(135deg,#ffe6c9,#d8f0e2)';
  els.detailName.textContent = state.currentClass + ' · 全班';
  els.detailSub.textContent = `共 ${state.records.length} 条记录 · 今日 ${todayCount} 条`;
  // v146(RSK-16)：全班明细同样按需拉取（墙瘦身记录不含明细）
  els.detailBody.innerHTML = '<div class="detail-loading" style="padding:24px 10px;color:#98a69f;">正在加载全班详细记录…</div>';
  state.detailName = '';
  els.detailFoot.hidden = true;
  els.detailModal.classList.add('show');
  Nav.push('detail');   // RSK-10：打开班级详情弹窗
  fetchDetailRecords(null).then(full => {
    if (els.detailName.textContent !== state.currentClass + ' · 全班') return;
    const rows2 = full || [];
    const today2 = state.serverToday || todayStr();
    const todayCount2 = rows2.filter(r => r.record_date === today2).length;
    els.detailSub.textContent = `共 ${rows2.length} 条记录 · 今日 ${todayCount2} 条`;
    els.detailBody.innerHTML = renderRecordTimeline(rows2);
  });
}

// v146(RSK-16)：详情弹窗按需拉取完整记录（含 behavior 明细 items / 教师评语）
// 优先网络单查（30 天窗口，单人或全班）；失败回退本地墙精简记录（明细缺失但界面正常）
async function fetchDetailRecords(name) {
  const cls = state.currentClass;
  if (!cls) return name ? [] : state.records;
  const since = new Date(); since.setDate(since.getDate() - 30);
  const p2 = n => String(n).padStart(2, '0');
  const sinceStr = `${since.getFullYear()}-${p2(since.getMonth()+1)}-${p2(since.getDate())}`;
  try {
    let q = supabase.from('daily_record')
      .select('id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at')
      .eq('class', cls)
      .gte('record_date', sinceStr)
      .order('record_date', { ascending: false })
      .order('create_at', { ascending: false })
      .limit(500);
    if (name) q = q.eq('student_name', name);
    const r = await q;
    if (r && !r.error && Array.isArray(r.data)) return r.data;
  } catch (e) {}
  return name ? state.records.filter(x => x.student_name === name) : state.records;
}

function renderClassRanking() {
  const byName = new Map();
  state.records.forEach(r => {
    if (!(Number(r.self_evaluation) > 0)) return;
    if (!byName.has(r.student_name)) byName.set(r.student_name, { name: r.student_name, sum: 0, n: 0 });
    const x = byName.get(r.student_name);
    x.sum += Number(r.self_evaluation);
    x.n += 1;
  });
  const list = Array.from(byName.values())
    .map(x => ({ name: x.name, avg: x.sum / x.n, n: x.n }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n)
    .slice(0, 10);
  if (!list.length) return '';
  const medals = ['' + I.medal('rk rk1') + '', '' + I.medal('rk rk2') + '', '' + I.medal('rk rk3') + ''];
  return `<div class="detail-day-head"><span>${I.star()} 平均星级榜（前10名）</span></div>
    <div class="detail-rec">${list.map((x, i) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13.5px;">
        <span style="width:26px;text-align:center;">${medals[i] || (i + 1)}</span>
        <b style="flex:1;">${esc(x.name)}</b>
        <span style="color:#b5791b;font-weight:700;">${I.star('ico-xs')}${x.avg.toFixed(1)}</span>
        <span class="text-muted" style="font-size:12px;">${x.n}条</span>
      </div>`).join('')}</div>`;
}

function renderRecordTimeline(rows) {
  if (!rows.length) {
    return '<div class="empty" style="padding:24px 10px;">暂无表现记录</div>';
  }
  // 按日期分组（入参已按日期、时间倒序）
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
    html += `<div class="detail-day-head"><span>${formatDate(g.date)}</span><span>${g.rows.length} 条</span></div>`;
    g.rows.forEach(r => {
      const starCount = Number(r.self_evaluation) || 0;
      const stars = starCount
        ? I.starRow(starCount)
        : '<span class="text-muted" style="letter-spacing:0;">本次未打星</span>';
      const mood = MOOD_MAP[r.mood || (r.behavior && r.behavior.mood)];

      let itemsHtml = '';
      const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items.filter(it => it && typeof it === 'object') : [];
      if (items.length) {
        itemsHtml = '<ul class="detail-items">';
        items.forEach(it => {
          const neg = it.category === 'negative';
          const liCls = neg ? ' class="is-neg"' : '';
          const tick = neg
            ? '<span class="neg-tick">!</span>'
            : '<span class="tick"></span>';
          if (it.type === 'text') {
            itemsHtml += `<li${liCls}><b>${esc(it.label || '')}：</b>${esc(it.value || '')}</li>`;
          } else if (it.value) {
            itemsHtml += `<li${liCls}>${tick}${esc(it.label || '')} <span class="sub-val">· ${esc(it.value)}</span></li>`;
          } else {
            itemsHtml += `<li${liCls}>${tick}${esc(it.label || '')}</li>`;
          }
        });
        itemsHtml += '</ul>';
      }

      const comment = (r.teacher_comment || '').trim();
      const commentHtml = comment
        ? `<div class="detail-comment"><b>老师评语：</b>${esc(comment)}</div>`
        : '';

      html += `<div class="detail-rec">
          <div class="detail-rec-line">
            <span>${mood ? I.mood(mood.lv) + ' ' + mood.label : ''}</span>
            <span class="rec-time">${formatTime(r.create_at)}</span>
          </div>
          <div class="detail-stars">${stars}</div>
          ${itemsHtml}
          ${commentHtml}
        </div>`;
    });
  });
  return html;
}

/* =====================================================================
 * 自评表单（原有逻辑）
 * ===================================================================== */

function renderStars() {
  if (!els.starsRow) return; // 打星模块已移除
  els.starsRow.innerHTML = '';
}

/* ---------- 头像（emoji 或校园图片；按姓名稳定取卡通动物 + 底色兜底） ---------- */
function avatarForName(name, saved, sm) {
  const h = hashCode(String(name || ''));
  const mod = n => ((h % n) + n) % n;
  let key = saved && String(saved).trim() ? String(saved).trim() : '';
  key = migrateLegacyAvatar(key);   // v140：旧 Q 版头像 key 自动迁移到新写实款
  if (isImgKey(key)) {
    return { kind: 'img', key, src: AVATAR_BASE + avatarFile(key, sm), bg: '#ffffff' };
  }
  // 未保存过头像：按姓名稳定分配一个小动物
  const animal = AVATARS[mod(AVATARS.length)];
  return { kind: 'img', key: animal, src: AVATAR_BASE + animal + '.webp', bg: '#ffffff' };
}
function avatarInner(av) {
  return av.kind === 'img'
    ? `<img class="avatar-img" src="${av.src}" alt="" loading="lazy">`
    : `<span class="avatar-emoji">${av.emoji}</span>`;
}
function paintAvatar(el, av) {
  if (!el) return;
  el.innerHTML = avatarInner(av);
  el.style.background = av.bg;
  attachAvatarFx(el, av.key);
}

// 当前表单里"这个学生"的头像：优先本次选择，其次名单里已保存的，最后按姓名分配
function currentAvatar() {
  const name = (els.inpName && els.inpName.value || '').trim();
  if (state.myAvatar) return avatarForName(name || '我', state.myAvatar);
  const row = currentRosterRow();
  return avatarForName(name || '我', row && row.avatar);
}

// 当前学生的累计星光值（名单行）
// v152：老缓存/旧 RPC 名单可能没有 class 字段——先按"班级+姓名"匹配，匹配不到再退化为"仅姓名"匹配
function currentRosterRow() {
  const name = (els.inpName && els.inpName.value || '').trim();
  if (!name) return null;
  let row = state.roster.find(s =>
    s.student_name === name && (!state.currentClass || s.class === state.currentClass));
  if (!row && state.currentClass) {
    row = state.roster.find(s => s.student_name === name);
  }
  return row || null;
}

/* ---------- 今日心情：由勾选的积极/消极表现自动计算（5 档） ---------- */
function calcMoodLevel() {
  let delta = 0;
  for (const t of state.tags) {
    const score = Number(t.score) || (t.category === 'negative' ? -1 : 1);
    if (t.tag_type === 'check') {
      if (state.checkChosen[t.id]) delta += score;
    } else if ((state.textValues[t.id] || '').trim()) {
      delta += score;
    }
  }
  return Math.min(5, Math.max(1, 3 + delta));
}

function updateMood() {
  state.moodLevel = calcMoodLevel();
  renderStars();
  renderMoodPreview();
}

function renderMoodPreview() {
  const level = state.moodLevel || 3;
  const m = MOOD_BY_LEVEL(level);
  const av = currentAvatar();
  els.mpAvatar.innerHTML = `${avatarInner(av)}<span class="mp-badge">${I.mood(level)}</span>`;
  els.mpAvatar.style.background = av.bg;
  attachAvatarFx(els.mpAvatar, av.key);
  paintAvatar(els.identityAvatarEmoji, av);
  paintAvatar(els.avatarModalEmoji, av);
  els.mpLevel.innerHTML = `${I.mood(level)} ${m.label}`;
  renderIdentityLevel();
  const card = document.getElementById('moodPreviewCard');
  if (card) {
    card.classList.remove('lvl1', 'lvl2', 'lvl3', 'lvl4', 'lvl5');
    card.classList.add('lvl' + level);
  }
  if (els.moodMeter) {
    els.moodMeter.querySelectorAll('span').forEach(s =>
      s.classList.toggle('on', Number(s.dataset.l) <= level));
  }
}

// 身份卡：星光值余额 + 累计星光值
// v196：等级体系停用，不再显示 Lv 与升级进度，只保留累计星光值
function renderIdentityLevel() {
  const row = currentRosterRow();
  const cum = row ? (Number(row.xp) || 0) : 0;            // 累计获得星光值
  const bal = Number(state.wallet && state.wallet.balance) || 0;  // 可消费余额
  if (els.identityStar) els.identityStar.textContent = bal;
  if (els.identityXpText) els.identityXpText.textContent = `累计 ${cum}`;
  const wrap = document.querySelector('.identity-avatar');
  if (wrap) wrap.classList.remove('frame-l3', 'frame-l4', 'frame-l5');
  applyFrameTo(els.identityAvatarEmoji, row && row.frame);
}

async function loadTags() {
  let data = null, error = null;
  if (!window.Offline || !window.Offline.online) {
    const v = await window.Offline.get('tags');
    data = (v && v.data) || null;
  } else {
    const res = await supabase
      .from('behavior_tags')
      .select('id, label, tag_type, options, category, score, sort_order, history_unique, xp_value')
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
    els.posGrid.innerHTML = '<span class="text-muted">暂无表现标签</span>';
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
    const oldItems = (existing.behavior && Array.isArray(existing.behavior.items)) ? existing.behavior.items.filter(it => it && typeof it === 'object') : [];
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
  try { localStorage.setItem(wallCacheKey(cls), JSON.stringify(wallSnap)); } catch (e) {}
  window.Offline.set(wallKey(cls), Object.assign({}, wallSnap, { subs: state.todayTaskSubs }));
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
    const w = await window.Offline.get(wallKey(cls));
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
        const w = await window.Offline.get(wallKey(cls));
        rows = (w && w.records) || [];
        if (!rows.length) {
          let v = await window.Offline.get('records_all_' + cls);
          if (v && v.ts && Date.now() - v.ts > 7 * 86400 * 1000) v = null;
          rows = (v && v.data) || [];
        }
      }
    } catch (e) {
      const w = await window.Offline.get(wallKey(cls));
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
    const items = (r.behavior && Array.isArray(r.behavior.items)) ? r.behavior.items.filter(it => it && typeof it === 'object') : [];
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
  chip.textContent = wholeDone ? t.label + ' ' : t.label;
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
    hint.textContent = '再选一个具体的';
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
        b.textContent = opt + ' ';
      }
      b.addEventListener('click', () => {
        sfx.sub();
        if (!Array.isArray(state.checkOption[t.id])) state.checkOption[t.id] = [];
        const arr = state.checkOption[t.id];
        const ix = arr.indexOf(opt);
        if (ix >= 0) { arr.splice(ix, 1); b.classList.remove('active'); b.textContent = opt; }
        else { arr.push(opt); b.classList.add('active'); b.textContent = ' ' + opt; }
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
  input.placeholder = '选填，最多 600 字';
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
  // v179：点名面板（换填写人 / 首次认人 / 被拦截时补认人）
  const pickMe = document.getElementById('btnPickMe');
  if (pickMe) pickMe.addEventListener('click', () => { sfx.tap(); openNamePicker({}); });
  const npBox = document.getElementById('namePicker');
  if (npBox) {
    document.getElementById('npClose').addEventListener('click', () => { sfx.back(); closeNamePicker(); });
    npBox.addEventListener('click', e => { if (e.target === npBox) { sfx.back(); closeNamePicker(); } });
    document.getElementById('npClass').addEventListener('change', e => loadPickerRoster(e.target.value));
    document.getElementById('npSearch').addEventListener('input', renderPickerGrid);
    const manualGo = () => {
      const v = (document.getElementById('npManual').value || '').trim();
      if (!v) return;
      pickName(v);
    };
    document.getElementById('npManualGo').addEventListener('click', manualGo);
    document.getElementById('npManual').addEventListener('keydown', e => { if (e.key === 'Enter') manualGo(); });
  }
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
  // v213：班级打卡（入口在班级头像，原转盘移入面板）
  els.btnCheckinClose.addEventListener('click', () => { sfx.back(); closeCheckin(); });
  els.checkinModal.addEventListener('click', e => { if (e.target === els.checkinModal) { sfx.back(); closeCheckin(); } });
  els.ciGrid.addEventListener('click', e => {
    const b = e.target.closest('.ci-item');
    if (b && b.dataset.id) openCheckinSeat(b.dataset.id);
  });
  els.btnCheckinLottery.addEventListener('click', () => { closeCheckin(); openLottery(); });
  els.btnCsClose.addEventListener('click', () => { sfx.back(); closeCheckinSeat(); });
  els.checkinSeatModal.addEventListener('click', e => { if (e.target === els.checkinSeatModal) { sfx.back(); closeCheckinSeat(); } });
  els.csBoard.addEventListener('click', e => {
    const b = e.target.closest('.cs-seat');
    if (!b || b.classList.contains('empty')) return;
    const n = b.dataset.name;
    if (!n) return;
    if (checkinState.picked.has(n)) checkinState.picked.delete(n); else checkinState.picked.add(n);
    b.classList.toggle('on', checkinState.picked.has(n));
    updateCsCount();
  });
  els.csPool.addEventListener('click', e => {
    const b = e.target.closest('.cs-chip');
    if (!b) return;
    const n = b.dataset.name;
    if (!n) return;
    if (checkinState.picked.has(n)) checkinState.picked.delete(n); else checkinState.picked.add(n);
    b.classList.toggle('on', checkinState.picked.has(n));
    updateCsCount();
  });
  els.csAll.addEventListener('click', () => {
    (state.roster || []).map(r => r.student_name).filter(Boolean)
      .forEach(n => { if (!checkinState.done.has(n)) checkinState.picked.add(n); });
    renderCsBoard();
  });
  els.csNone.addEventListener('click', () => { checkinState.picked.clear(); renderCsBoard(); });
  els.csSubmit.addEventListener('click', submitCs);

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
  if (els.btnPickAvatarHint) els.btnPickAvatarHint.addEventListener('click', () => { sfx.tap(); openAvatarPicker(); });
  // v160：更换头像框独立入口 → 独立页面
  if (els.btnOpenFrames) els.btnOpenFrames.addEventListener('click', () => { openFramePage(); });
  if (els.btnFrameBack) els.btnFrameBack.addEventListener('click', () => { closeFramePage(); });
  els.btnAvatarClose.addEventListener('click', () => { sfx.back(); els.avatarModal.classList.remove('show'); });
  els.avatarModal.addEventListener('click', e => {
    if (e.target === els.avatarModal) { sfx.back(); els.avatarModal.classList.remove('show'); }
  });

  // v152.3：雏菊榜单（左：星光榜 / 右：挑战榜）
  const flowerLeft = document.getElementById('flowerLeft');
  const flowerRight = document.getElementById('flowerRight');
  if (flowerLeft) flowerLeft.addEventListener('click', () => { sfx.tap(); openLeaderboard('xp'); });
  if (flowerRight) flowerRight.addEventListener('click', () => { sfx.tap(); openLeaderboard('challenge'); });
  els.btnLbClose.addEventListener('click', () => { sfx.back(); els.leaderboardModal.classList.remove('show'); });
  els.leaderboardModal.addEventListener('click', e => {
    if (e.target === els.leaderboardModal) { sfx.back(); els.leaderboardModal.classList.remove('show'); }
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

  // v167：星光商店 / 班级转盘
  if (els.btnOpenShop) els.btnOpenShop.addEventListener('click', openShop);
  if (els.btnShopBack) els.btnShopBack.addEventListener('click', closeShop);
  if (els.shopTabs) els.shopTabs.addEventListener('click', e => {
    const b = e.target.closest('[data-shop-tab]');
    if (!b) return;
    state.shopTab = b.dataset.shopTab;
    sfx.tap();
    renderShop();
  });
  if (els.btnLotteryBack) els.btnLotteryBack.addEventListener('click', closeLottery);
  if (els.btnSpin) els.btnSpin.addEventListener('click', spinLottery);
  if (els.btnSpinMain) els.btnSpinMain.addEventListener('click', spinLottery);
  if (els.btnLotteryHistory) els.btnLotteryHistory.addEventListener('click', () => {
    if (!els.lotteryHistoryCard) return;
    els.lotteryHistoryCard.hidden = !els.lotteryHistoryCard.hidden;
    if (!els.lotteryHistoryCard.hidden) { loadLotteryHistory(); els.lotteryHistoryCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  });
  if (els.btnPrizeClose) els.btnPrizeClose.addEventListener('click', () => { sfx.back(); els.prizeModal.classList.remove('show'); });
  if (els.prizeModal) els.prizeModal.addEventListener('click', e => {
    if (e.target === els.prizeModal) { sfx.back(); els.prizeModal.classList.remove('show'); }
  });
}

function updateSoundButton() {
  if (!els.btnSound) return;
  els.btnSound.innerHTML = sfx.muted ? I['volume-off']('ico-lg') : I.volume('ico-lg');
  els.btnSound.classList.toggle('is-off', !!sfx.muted);
}

/* ---------------- 头像选择 ---------------- */

async function openAvatarPicker() {
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) return needIdentity();   // v179：直接点名，不再拦
  if (ready) { els.avatarModal.classList.add('show'); }
  if (ready) await Promise.all([loadWallet(), loadShopCatalog()]);
  renderAvatarPicker();
  renderMoodPreview();
  els.avatarModal.classList.add('show');
  Nav.push('avatar');
}

/* v167.4：通用「仅显示已拥有」筛选条（头像 / 头像框共用） */
function buildOwnFilter(onlyOwned, onChange, label) {
  const bar = document.createElement('div');
  bar.className = 'own-filter';
  bar.innerHTML = `
    <button type="button" class="of-btn${onlyOwned ? '' : ' on'}" data-own="all">全部${label}</button>
    <button type="button" class="of-btn${onlyOwned ? ' on' : ''}" data-own="owned">仅显示已拥有</button>`;
  bar.querySelectorAll('.of-btn').forEach(b => b.addEventListener('click', () => {
    sfx.tap();
    onChange(b.dataset.own === 'owned');
  }));
  return bar;
}

/* v167.4：头像选择器改为可重渲染，支持筛选 */
function renderAvatarPicker() {
  const cur = currentAvatar();
  const onlyOwned = !!state.avatarOwnedOnly;

  els.avatarPicker.innerHTML = '';

  // 顶部：星光值 + 商店入口（v167：不再按等级解锁，改为星光值兑换）
  const tip = document.createElement('div');
  tip.className = 'avatar-shop-tip';
  tip.innerHTML = `<span>${I.star()} 星光值 <b>${state.wallet.balance}</b></span>
    <button type="button" class="avatar-shop-go">去商店 ${I.shop('ico-sm')}</button>`;
  els.avatarPicker.appendChild(tip);
  tip.querySelector('.avatar-shop-go').addEventListener('click', () => {
    els.avatarModal.classList.remove('show');
    openShop();
  });

  // 筛选：全部 / 仅显示已拥有
  els.avatarPicker.appendChild(buildOwnFilter(onlyOwned, v => {
    state.avatarOwnedOnly = v;
    renderAvatarPicker();
  }, '头像'));

  // —— 免费小动物头像（默认拥有，筛选时也始终可见）——
  const emojiSec = document.createElement('div');
  emojiSec.className = 'avatar-sec';
  emojiSec.innerHTML = `<div class="avatar-sec-title">${I.paw()} 免费头像<span class="avatar-sec-tip ok">默认拥有</span></div>`;
  const emojiGrid = document.createElement('div');
  emojiGrid.className = 'avatar-grid avatar-grid-img';
  AVATARS.forEach(key => emojiGrid.appendChild(buildImgChoice(key, cur.key, true, 0)));
  emojiSec.appendChild(emojiGrid);
  els.avatarPicker.appendChild(emojiSec);

  // —— 商店头像（拥有即可佩戴）——
  const list = (state.shopItems || []).filter(x => x.item_type === 'avatar');
  const groups = [];
  list.forEach(it => {
    const g = it.group_name || '其他';
    let box = groups.find(x => x.name === g);
    if (!box) { box = { name: g, items: [] }; groups.push(box); }
    box.items.push(it);
  });
  if (!groups.length && ready) {
    const warn = document.createElement('div');
    warn.className = 'avatar-sec';
    warn.innerHTML = '<div class="avatar-sec-tip">商品未加载，请联系老师</div>';
    els.avatarPicker.appendChild(warn);
  }
  let shown = 0;
  groups.forEach(g => {
    const ownedCount = g.items.filter(it => it.owned || ownsItem('avatar', it.item_key)).length;
    const items = onlyOwned
      ? g.items.filter(it => it.owned || ownsItem('avatar', it.item_key))
      : g.items;
    if (!items.length) return;          // 筛选后没有可佩戴的，整组隐藏
    shown++;
    const sec = document.createElement('div');
    sec.className = 'avatar-sec';
    sec.innerHTML = `<div class="avatar-sec-title">${esc(g.name)}<span class="avatar-sec-tip">${ownedCount}/${g.items.length} 已拥有</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'avatar-grid avatar-grid-img';
    items.forEach(it => grid.appendChild(
      buildImgChoice(it.item_key, cur.key, it.owned || ownsItem('avatar', it.item_key), shopPriceOf('avatar', it.item_key))));
    sec.appendChild(grid);
    els.avatarPicker.appendChild(sec);
  });

  if (onlyOwned && !shown && ready) {
    const empty = document.createElement('div');
    empty.className = 'avatar-sec';
    empty.innerHTML = '<div class="own-empty">暂无已拥有的头像</div>';
    els.avatarPicker.appendChild(empty);
  }
}


function buildEmojiChoice(emoji, selectedKey) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'avatar-choice' + (emoji === selectedKey ? ' selected' : '');
  b.textContent = emoji;
  b.addEventListener('click', () => onChooseAvatar(emoji, b));
  return b;
}

function buildImgChoice(key, selectedKey, owned, price) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'avatar-choice avatar-choice-img'
    + (key === selectedKey ? ' selected' : '')
    + (owned ? '' : ' locked');
  b.innerHTML = owned
    ? `<img src="${AVATAR_BASE}${avatarFile(key)}" alt="" loading="lazy">`
    : `<img src="${AVATAR_BASE}${avatarFile(key)}" alt="" loading="lazy"><span class="avatar-lock">${I.lock()}<em>${I.star()}${price || 0}</em></span>`;
  b.addEventListener('click', () => {
    if (!owned) {
      sfx.oops();
      toast(`未拥有 · ${price || 0} 星光值兑换`);
      return;
    }
    onChooseAvatar(key, b);
  });
  return b;
}

// v152.9：换头像/头像框后同步墙缓存（含 Offline 缓存），刷新不再回退旧头像
function persistWallCache() {
  const cls = state.currentClass;
  if (!cls) return;
  const payload = {
    roster: state.roster, records: state.records, seatMap: state.seatMap,
    tasks: state.todayTaskDefs, subs: state.todayTaskSubs, cachedAt: Date.now()
  };
  try { localStorage.setItem(wallCacheKey(cls), JSON.stringify(payload)); } catch (e) {}
  try { if (window.Offline && window.Offline.set) window.Offline.set(wallKey(cls), payload); } catch (e) {}
}

async function onChooseAvatar(key, btn) {
  sfx.pick();
  const res = await persistAvatar(key);
  if (!res || res.ok === false) {
    const reason = res && res.reason;
    sfx.oops();
    if (reason === 'not_owned') {
      toast('未拥有，请先兑换');
    } else if (reason === 'no_student') {
      toast('这个名字不在名单里');
    } else if (reason === 'error') {
      toast('保存失败，请重试');
    } else {
      toast('保存失败，请重试');
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
  // v152.9：同步刷新墙卡片与缓存，避免刷新页面后显示旧头像
  persistWallCache();
  renderWall();
  loadWallet();
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

/* v197：类名映射改为从 FRAMES 自动派生。
   v152（七款进阶）、v160（十五款星空/兽耳）都因手写映射漏项，出现「已佩戴但身份卡/详情不显示」；
   v193 的 goldhelm / diamondhelm 第三次踩到同一处——只要新增框就必须记得往这里补一行。
   改为按 FRAMES 生成后，新增框只改上面一处即可。 */
const FRAME_CLASS = Object.fromEntries(
  FRAMES.map(f => [f.key, f.key === 'none' ? '' : 'frame-' + f.key])
);

/* ---------------- v137(RSK-13)：头像框粒子注入 ----------------
   配置见文件顶部 FRAME_PARTICLES/FP_SHAPE_CLS/FP_ANIM_CLS */

/* ---------------- v139：写实少年头像粒子 + 呼吸光效 ----------------
   配置见文件顶部 AVATAR_PARTICLES；ap-layer 相对头像容器 130%，粒子环带贴合头像圆形外缘 */

/* 生成一个头像粒子（相对 .ap-layer，宽=头像容器×1.3） */
function apOne(cfg, i) {
  const ang = Math.random() * Math.PI * 2;
  const rad = 34 + Math.random() * 10;            // 相对 ap-layer 宽度的环带：落在头像圆边缘内外
  const cx = 50 + Math.cos(ang) * rad;
  const cy = 50 + Math.sin(ang) * rad;
  const s  = 1.0 + Math.random() * 1.7;           // 粒子大小
  const c  = cfg.colors[i % cfg.colors.length];
  const shape = cfg.shapes[i % cfg.shapes.length];
  const dur = 2.6 + Math.random() * 2.6;
  const delay = -Math.random() * 5.5;
  const cls = 'fp-p ' + (FP_SHAPE_CLS[shape] || '') + ' ' + (FP_ANIM_CLS[cfg.anim] || 'fp-a-float');
  const glow = shape === 'star' || shape === 'ember' ? `box-shadow:0 0 ${s * 1.8}px ${c};` : `box-shadow:0 0 ${s * 1.1}px ${c};`;
  return `<i class="${cls}" style="left:${cx.toFixed(1)}%;top:${cy.toFixed(1)}%;width:${s.toFixed(2)}%;height:${s.toFixed(2)}%;background:${c};${glow}animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;"></i>`;
}

/* 字符串版：班级墙卡片头像（renderWall 拼接用） */
function avatarParticlesHTML(key) {
  const cfg = AVATAR_PARTICLES[key];
  if (!cfg) return '';
  let h = `<span class="ap-layer">`;
  for (let i = 0; i < cfg.n; i++) h += apOne(cfg, i);
  return h + '</span>';
}

/* DOM 版：为头像容器挂粒子层 + 呼吸光效（身份头像/详情头像/选择器预览） */
function attachAvatarFx(el, key) {
  if (!el) return;
  el.classList.remove('ap-breathe');
  el.style.setProperty('--glow', '0,0,0');
  el.querySelectorAll(':scope > .ap-layer').forEach(x => x.remove());
  const cfg = AVATAR_PARTICLES[key];
  if (!cfg) return;
  el.classList.add('ap-breathe');
  el.style.setProperty('--glow', cfg.glow);
  let h = '<span class="ap-layer">';
  for (let i = 0; i < cfg.n; i++) h += apOne(cfg, i);
  el.insertAdjacentHTML('beforeend', h + '</span>');
}

/* 生成一个粒子的内联样式（相对 .fp-layer，宽=元素直径×1.76） */
function fpOne(cfg, i, W) {
  const ang = Math.random() * Math.PI * 2;
  const rad = 26 + Math.random() * 8;            // 相对 fp-layer 宽度的百分比环带
  const cx = 50 + Math.cos(ang) * rad;
  const cy = 50 + Math.sin(ang) * rad;
  const s  = 1.2 + Math.random() * 1.9;          // 相对 fp-layer 宽度的百分比大小
  const c  = cfg.colors[i % cfg.colors.length];
  const shape = cfg.shapes[i % cfg.shapes.length];
  const dur = 2.8 + Math.random() * 2.8;
  const delay = -Math.random() * 5.5;
  const cls = 'fp-p ' + (FP_SHAPE_CLS[shape] || '') + ' ' + (FP_ANIM_CLS[cfg.anim] || 'fp-a-float');
  const glow = shape === 'star' || shape === 'ember' ? `box-shadow:0 0 ${s * 1.8}px ${c};` : `box-shadow:0 0 ${s * 1.1}px ${c};`;
  return `<i class="${cls}" style="left:${cx.toFixed(1)}%;top:${cy.toFixed(1)}%;width:${s.toFixed(2)}%;height:${s.toFixed(2)}%;background:${c};${glow}animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;"></i>`;
}

/* 字符串版：班级墙卡片头像（renderWall 拼接用） */
function frameParticlesHTML(key) {
  const cfg = FRAME_PARTICLES[key];
  if (!cfg) return '';
  let h = `<span class="fp-layer fp-${key}">`;
  for (let i = 0; i < cfg.n; i++) h += fpOne(cfg, i, 0);
  return h + '</span>';
}

/* DOM 版：applyFrameTo 后为元素挂粒子层（身份头像/详情头像） */
function attachParticles(el, key) {
  if (!el) return;
  el.querySelectorAll(':scope > .fp-layer').forEach(x => x.remove());
  const cfg = FRAME_PARTICLES[key];
  if (!cfg) return;
  const layer = document.createElement('span');
  layer.className = 'fp-layer fp-' + key;
  layer.innerHTML = frameParticlesHTML(key);
  el.appendChild(layer);
}

/* ---------------- v160：头像框独立页面 + 解锁逻辑重写（与 student-d.js 同实现） ----------------
   学生端头像框从头像区拆出：个人主页头像下方「更换头像框」入口 → 独立页面 #frameView。
   解锁集合 calcUnlockedFrames 与 95/96 号服务端口径完全一致；
   打开页面时强制 loadProfile() 刷新，避免旧缓存导致 7 级不解锁。 */
// v167：头像框不再按等级/成就解锁——改为星光商店兑换，拥有即可佩戴
function ownedFrameKeys() {
  const un = new Set(['none']);
  const st = state.owned && state.owned.frame;
  if (st) st.forEach(k => un.add(k));
  return un;
}

// 商品显示名以服务端 shop_item.name 为准（改名只需动数据库，前端不用跟着发版）；
// 未加载到目录时退回本地常量
function shopNameOf(type, key) {
  const it = (state.shopItems || []).find(x => x.item_type === type && x.item_key === key);
  return (it && it.name) ? it.name : '';
}

function frameNameOf(key) {
  const dyn = shopNameOf('frame', key);
  if (dyn) return dyn;
  const f = FRAMES.find(x => x.key === key);
  return f ? f.name : (key === 'none' ? '无框' : key);
}

function updateFramePreview(frameKey) {
  if (!els.framePreviewAvatar) return;
  const av = currentAvatar();
  paintAvatar(els.framePreviewAvatar, av);
  applyFrameTo(els.framePreviewAvatar, frameKey || state.myFrame || 'none');
}

function renderFramePage() {
  const grid = els.framePageGrid;
  if (!grid) return;
  const row = currentRosterRow();
  const curFrame = state.myFrame || (row && row.frame) || 'none';
  const ownedSet = ownedFrameKeys();
  updateFramePreview(curFrame);
  if (els.framePreviewName) {
    const cls = (els.inpClass.value || '').trim();
    const nm = (els.inpName.value || '').trim();
    els.framePreviewName.textContent = cls ? cls + ' · ' + nm : (nm || '未选择学生');
  }
  if (els.framePreviewTip) {
    els.framePreviewTip.textContent = `当前佩戴：${frameNameOf(curFrame)} · 我的星光值 ${state.wallet.balance}`;
  }
  grid.innerHTML = '';
  // v167.4：筛选条（全部 / 仅显示已拥有）
  const filterHost = document.getElementById('frameOwnFilter');
  if (filterHost) {
    filterHost.innerHTML = '';
    filterHost.appendChild(buildOwnFilter(!!state.frameOwnedOnly, v => {
      state.frameOwnedOnly = v;
      renderFramePage();
    }, '头像框'));
  }
  const onlyOwned = !!state.frameOwnedOnly;
  let shownCount = 0;
  FRAMES.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'frame-choice fc-' + f.key + (f.key === curFrame ? ' selected' : '');
    const owned = f.key === 'none' || ownedSet.has(f.key);
    if (onlyOwned && !owned) return;   // 筛选时只显示已拥有的
    shownCount++;
    const price = f.key === 'none' ? 0 : shopPriceOf('frame', f.key);
    b.innerHTML = `<span class="fc-ring"></span>` +
      (owned ? `<span class="fc-owned"></span>` : `<span class="fc-lock">${I.lock()}<em>${I.star()}${price}</em></span>`);
    b.title = frameNameOf(f.key) + (owned ? '（已拥有）' : `（${price} 星光值兑换）`);
    b.addEventListener('click', () => {
      if (!owned) {
        sfx.oops();
        toast(`未拥有 · ${price} 星光值兑换`);
        return;
      }
      onChooseFrame(f.key, b);
    });
    grid.appendChild(b);
  });
  if (els.frameCountTip) {
    const total = FRAMES.length;
    const got = FRAMES.filter(f => f.key === 'none' || ownedSet.has(f.key)).length;
    els.frameCountTip.textContent = onlyOwned ? `显示 ${shownCount} 个 · 已拥有 ${got}/${total}` : `已拥有 ${got}/${total}`;
  }
}

async function openFramePage() {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return needIdentity(openFramePage);   // v179：就地点名后继续
  sfx.tap();
  if (els.wallView) els.wallView.hidden = true;
  if (els.formView) els.formView.hidden = true;
  if (els.frameView) els.frameView.hidden = false;
  window.scrollTo(0, 0);
  if (els.frameConfigBanner) els.frameConfigBanner.hidden = !!ready;
  await Promise.all([loadProfile(), loadWallet(), loadShopCatalog()]);  // 打开即刷新，含星光值/已拥有装扮
  renderFramePage();
  if (typeof Nav !== 'undefined' && Nav.push) Nav.push('frames');
}

function closeFramePage() {
  sfx.back();
  if (els.frameView) els.frameView.hidden = true;
  if (els.formView) els.formView.hidden = false;
  window.scrollTo(0, 0);
  if (typeof Nav !== 'undefined' && Nav.pop) Nav.pop();
}

function buildFrameSection() {
  const sec = document.createElement('div');
  sec.className = 'avatar-sec';
  sec.innerHTML = `<div class="avatar-sec-title">${I.sparkle()} 头像框<span class="avatar-sec-tip">商店兑换</span></div>`;
  const grid = document.createElement('div');
  grid.className = 'frame-grid';
  const row = currentRosterRow();
  const curFrame = state.myFrame || (row && row.frame) || 'none';
  const unlockedSet = ownedFrameKeys();
  FRAMES.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'frame-choice fc-' + f.key + (f.key === curFrame ? ' selected' : '');
    const unlocked = f.key === 'none' || unlockedSet.has(f.key);
    b.innerHTML = `<span class="fc-ring"></span>` +
      (unlocked ? '' : `<span class="fc-lock">${I.lock()}<em>${f.need}</em></span>`);
    b.addEventListener('click', () => {
      if (!unlocked) { sfx.oops(); toast('未拥有，请先兑换'); return; }
      onChooseFrame(f.key, b);
    });
    grid.appendChild(b);
  });
  sec.appendChild(grid);
  els.avatarPicker.appendChild(sec);
}

async function onChooseFrame(key, btn) {
  sfx.pick();
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) return needIdentity(() => onChooseFrame(key, btn));   // v179
  const wr = await runWrite({ name: 'set_student_frame', params: { p_class: cls, p_student: name, p_frame: key } });
  if (!wr.ok) { toast('保存失败，请重试'); return; }
  if (wr.queued) {
    state.myFrame = key;
    const row = currentRosterRow();
    if (row) row.frame = key;
    els.avatarPicker.querySelectorAll('.frame-choice').forEach(x => x.classList.toggle('selected', x === btn));
    applyFrameTo(els.identityAvatarEmoji, key);
    if (els.frameView && !els.frameView.hidden) renderFramePage();
    persistWallCache(); renderWall();
    toast('已离线选好，联网后自动同步');
    setTimeout(() => els.avatarModal.classList.remove('show'), 260);
    return;
  }
  if (!wr.res || wr.res.ok === false) {
    toast(wr.res && wr.res.reason === 'not_owned' ? '未拥有，请先兑换' : '保存失败，请重试');
    return;
  }
  state.myFrame = key;
  const row = currentRosterRow();
  if (row) row.frame = key;
  els.avatarPicker.querySelectorAll('.frame-choice').forEach(x => x.classList.toggle('selected', x === btn));
  applyFrameTo(els.identityAvatarEmoji, key);
  if (els.frameView && !els.frameView.hidden) renderFramePage();
  persistWallCache(); renderWall();
  toast(key === 'none' ? '已取下头像框' : '头像框戴好啦，真好看！');
  setTimeout(() => els.avatarModal.classList.remove('show'), 260);
}

/* ---------------- v105：成就 ---------------- */
async function loadProfile() {
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!ready || !cls || !name) { hideProfileCards(); return; }
  let data;
  try {
    const r = await supabase.rpc('get_student_profile', { p_class: cls, p_student: name });
    if (r.error) throw r.error;
    data = r.data;
    if (data) await window.Offline.set('profile_' + cls + '_' + name, { data });
  } catch (e) {
    const v = await window.Offline.get('profile_' + cls + '_' + name);
    data = (v && v.data) || null;
    if (!data) { hideProfileCards(); return; }
  }
  if (!data || data.ok === false) { hideProfileCards(); return; }

  state.profile = data;
  state.myFrame = data.frame || 'none';
  // v178：卡片主题随档案一起返回（省掉独立请求）；旧后端无该字段时才回退轻量接口
  let ctVal;
  if (data.card_theme !== undefined) {
    ctVal = data.card_theme || null;
  } else {
    try {
      const tr = await withTimeout(supabase.rpc('get_student_card_theme', { p_class: cls, p_student: name }), DATA_TIMEOUT);
      if (!tr.error && tr.data && tr.data.ok !== false) ctVal = tr.data.card_theme || null;
    } catch (e) { /* 忽略，走 roster 兜底 */ }
    if (!ctVal) {
      const r0 = currentRosterRow();
      if (r0 && r0.card_theme) ctVal = r0.card_theme;
    }
  }
  state.myCardTheme = (ctVal && CARD_THEMES.some(t => t.key === ctVal)) ? ctVal : null;
  // v197：主题只在星光墙的学生卡片上展示，个人主页身份卡不再套用（避免装饰压住头像与文字）
  applyCardTheme(document.getElementById('identityCard'), null);

  const achs = data.achievements || [];
  renderAchievements(achs);
  renderDims(data.dims);
  applyFrameTo(els.identityAvatarEmoji, state.myFrame);

  // 新解锁成就：对比本机已见列表，逐个弹提示
  const seenKey = 'sp_seen_ach_' + cls + '_' + name;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch (e) {}
  const seenSet = new Set(seen);
  const fresh = achs.filter(a => a.unlocked && !seenSet.has(a.key));
  // v178：新增维度成就后，老账号首次加载可能一次解锁多枚——超过 3 枚合并成一条，避免提示刷屏
  if (fresh.length > 3) toast(`解锁 ${fresh.length} 个新成就`);
  else if (fresh.length) fresh.forEach(a => toast(`解锁成就「${a.name}」${a.icon}`));
  if (fresh.length) sfx.success();
  try { localStorage.setItem(seenKey, JSON.stringify(achs.filter(a => a.unlocked).map(a => a.key))); } catch (e) {}
}

// 无身份 / 无档案时收起个人档案类卡片
function hideProfileCards() {
  if (els.achCard) els.achCard.hidden = true;
  if (els.dimCard) els.dimCard.hidden = true;
}

/* ---------------- 成就墙（v181：分组 + 奖励位） ----------------
   后端 achievement_def 提供 group_key / group_name / reward_avatar / reward_frame；
   未执行 121 号补丁时这些字段缺失 → 自动退化为单组、空奖励位。 */
const ACH_GROUPS = [
  { key: 'start',  name: '启程' },
  { key: 'study',  name: '学习' },
  { key: 'five',   name: '五育' },
  { key: 'growth', name: '成长' },
  { key: 'honor',  name: '荣誉' }
];

// 奖励位：空 key = 占位（虚线），有 key = 点亮该头像 / 头像框
function achRewardSlot(kind, key) {
  if (!key) {
    return `<span class="rw-slot rw-empty" title="${kind === 'avatar' ? '成就奖励头像位' : '成就奖励头像框位'}">` +
      (kind === 'avatar' ? I.user() : I['circle-dot']()) + `</span>`;
  }
  if (kind === 'avatar') {
    const av = avatarForName(key, key, true);
    return `<span class="rw-slot rw-on rw-av-on" title="成就奖励头像">${avatarInner(av)}</span>`;
  }
  return `<span class="rw-slot rw-on rw-fr-on" title="成就奖励头像框">` +
    `<img src="assets/frames/frame-${esc(key)}.webp" alt="" loading="lazy" ` +
    `onerror="this.style.display='none'"></span>`;
}

function renderAchievements(achs) {
  if (!els.achGrid) return;
  els.achCard.hidden = false;
  const list = achs || [];
  const done = list.filter(a => a.unlocked).length;
  els.achCount.textContent = `${done}/${list.length}`;

  // 分组（保持 ACH_GROUPS 顺序；未知分组追加在最后）
  const groups = ACH_GROUPS.map(g => ({ key: g.key, name: g.name, items: [] }));
  const byKey = new Map(groups.map(g => [g.key, g]));
  const other = { key: '_other', name: '更多', items: [] };
  list.forEach(a => (byKey.get(a.group_key) || other).items.push(a));
  const shown = groups.filter(g => g.items.length);
  if (other.items.length) shown.push(other);

  els.achGrid.innerHTML = shown.map(g => {
    const gd = g.items.filter(a => a.unlocked).length;
    const items = g.items.map(a => {
      const unlocked = !!a.unlocked;
      const target = Number(a.target) || 1;
      const cur = Math.min(Number(a.cur) || 0, target);
      // 已解锁：显示达成说明；未解锁：可量化目标显示进度，其余显示说明
      const sub = unlocked ? (a.desc || '')
        : (a.show_progress !== false && target > 1) ? `${cur}/${target}`
        : (a.desc || '');
      return `<div class="ach-item ${unlocked ? 'unlocked' : 'locked'}" title="${esc(a.desc || '')}">
        <div class="ach-rw">${achRewardSlot('avatar', a.reward_avatar)}${achRewardSlot('frame', a.reward_frame)}</div>
        <div class="ach-ic">${unlocked ? (a.icon || '') : '' + I.lock() + ''}</div>
        <div class="ach-n">${esc(a.name)}</div>
        <div class="ach-p">${esc(sub)}</div>
      </div>`;
    }).join('');
    return `<div class="ach-group" data-g="${esc(g.key)}">
      <div class="ach-group-head"><span>${esc(g.name)}</span><b>${gd}/${g.items.length}</b></div>
      <div class="ach-grid">${items}</div>
    </div>`;
  }).join('');
}

/* ---------------- v178：五维成长（德智体美劳） ----------------
   累计口径 = student_info.xp_de/xp_zhi/xp_ti/xp_mei/xp_lao
   周口径   = 本周（周一起）表现记录的维度得分（服务端 student_dims 计算）
   配色与教师端 DIM_META 同口径：德红 / 智蓝 / 体绿 / 美紫 / 劳橙 */
const DIMS = [
  { key: 'de',  name: '德', icon: 'hand-heart', color: '#e74c3c', medal: '德育之星' },
  { key: 'zhi', name: '智', icon: 'book-open',  color: '#2e86de', medal: '智育之星' },
  { key: 'ti',  name: '体', icon: 'dumbbell',   color: '#27ae60', medal: '体育之星' },
  { key: 'mei', name: '美', icon: 'palette',    color: '#9b59b6', medal: '美育之星' },
  { key: 'lao', name: '劳', icon: 'broom',      color: '#e67e22', medal: '劳动之星' }
];

function renderDims(dims) {
  if (!els.dimCard || !els.dimBars) return;
  if (!dims || dims.ok === false) { els.dimCard.hidden = true; return; }
  const total = dims.total || {};
  const normObj = dims.norm || null;
  const hasNorm = !!(normObj && Object.keys(normObj).length);
  const vals = DIMS.map(d => Number(total[d.key]) || 0);
  const sum = vals.reduce((a, b) => a + b, 0);

  // v213：不再拿「五维最大值」当尺子。
  // 有 norm 就用它（按班级同维度均值归一，60 = 班均，封顶 100），刻度固定 100；
  // 旧库没跑 140 脚本时回退到原来的 max 基准，保证这块不消失。
  const maxV = Math.max.apply(null, vals.concat([50]));
  const scale = Math.ceil(maxV / 50) * 50;
  const display = DIMS.map(d => {
    if (hasNorm) return Math.min(100, Math.max(0, Number(normObj[d.key]) || 0));
    return Math.min(100, (Number(total[d.key]) || 0) / scale * 100);
  });

  // 雷达：五边形，外圈 = scale
  const cx = 60, cy = 62, R = 42;
  const pt = (i, r) => {
    const a = (-90 + i * 72) * Math.PI / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const poly = k => DIMS.map((d, i) => pt(i, R * k).map(n => n.toFixed(1)).join(',')).join(' ');
  const shape = DIMS.map((d, i) => pt(i, R * display[i] / 100).map(n => n.toFixed(1)).join(',')).join(' ');
  const axes = DIMS.map((d, i) => {
    const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 11);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="dr-axis"/>` +
           `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" class="dr-lab" style="fill:${d.color}">${d.name}</text>`;
  }).join('');
  els.dimRadar.innerHTML =
    `<svg viewBox="0 0 120 126" role="img" aria-label="五维累计 ${sum} 星">` +
    `<polygon points="${poly(1)}" class="dr-ring"/>` +
    `<polygon points="${poly(0.66)}" class="dr-ring"/>` +
    `<polygon points="${poly(0.33)}" class="dr-ring"/>` +
    axes +
    `<polygon points="${shape}" class="dr-shape"/>` +
    `</svg>`;

  // 条形：与雷达同口径（归一值），末端仍显示真实累计分
  els.dimBars.innerHTML = DIMS.map(d => {
    const v = Number(total[d.key]) || 0;
    const pct = display[DIMS.indexOf(d)];
    return `<div class="dim-row" style="--dim-c:${d.color}">
      <span class="dim-tag">${I[d.icon]()}</span>
      <span class="dim-track"><i style="width:${pct.toFixed(1)}%"></i></span>
      <b class="dim-val">${v}</b>
    </div>`;
  }).join('');

  // v213：把算法口径写出来，避免家长/学生以为图缩水了
  if (els.dimNote) {
    if (hasNorm) {
      els.dimNote.hidden = false;
      els.dimNote.textContent = '按班级平均水平均衡显示：60 = 班均，满分 100';
    } else {
      els.dimNote.hidden = true;
    }
  }

  // 本周维度勋章：本周得分最高的维度（低于门槛则显示还差多少）
  const medalEl = els.dimMedal;
  if (medalEl) {
    const top = dims.top;
    const topXp = Number(dims.top_xp) || 0;
    const min = Number(dims.medal_min) || 5;
    const meta = DIMS.find(d => d.key === top);
    const weekSum = Number(dims.week_sum) || 0;
    const prevMeta = DIMS.find(d => d.key === dims.prev_top);
    const prevXp = Number(dims.prev_xp) || 0;
    const tip = (prevMeta && prevXp >= min) ? `上周：${prevMeta.medal} +${prevXp}` : '上周没有维度勋章';
    if (meta && topXp >= min) {
      medalEl.innerHTML = `<span class="dm-badge" style="--dim-c:${meta.color}" title="${tip}">${I.medal()}<b>${meta.medal}</b><em>+${topXp}</em></span>`;
    } else {
      medalEl.innerHTML = `<span class="dm-none" title="${tip}">本周 +${weekSum} · 满 ${min} 得勋章</span>`;
    }
  }
  els.dimCard.hidden = false;
}

/* ============================================================
   v167：星光值钱包 / 星光商店 / 班级转盘
   ============================================================ */
// v179：没选填写人时不再"提示去填姓名"（那等于把人拦在门口），直接弹点名面板；
//       选完名字自动继续刚才的动作（after 回调）
function needIdentity(after) {
  return openNamePicker({ onPick: typeof after === 'function' ? after : null });
}

// 拉取我的钱包（余额 / 累计 / 已拥有装扮）
async function loadWallet() {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!ready || !cls || !name) { renderIdentityLevel(); return null; }
  try {
    const r = await withTimeout(supabase.rpc('get_student_wallet', { p_class: cls, p_student: name }), DATA_TIMEOUT);
    if (r.error) throw r.error;
    const d = r.data;
    if (!d || d.ok === false) { renderIdentityLevel(); return null; }
    state.wallet = { balance: Number(d.balance) || 0, total_earned: Number(d.total_earned) || 0, total_spent: Number(d.total_spent) || 0 };
    state.owned = { avatar: new Set(), frame: new Set(['none']), theme: new Set() };
    (d.inventory || []).forEach(x => { if (state.owned[x.item_type]) state.owned[x.item_type].add(x.item_key); });
    const row = currentRosterRow();
    if (row) { row.xp = d.xp; row.star = Number(d.balance) || 0; }
    if (d.class && d.class.ok !== false) state.classProgress = d.class;
    renderIdentityLevel();
    return d;
  } catch (e) {
    renderIdentityLevel();
    return null;
  }
}

// 是否拥有某件装扮（免费小动物头像默认拥有）
function ownsItem(type, key) {
  if (type === 'avatar' && isAnimalKey(key)) return true;
  if (type === 'frame' && key === 'none') return true;
  return !!(state.owned && state.owned[type] && state.owned[type].has(key));
}

function shopPriceOf(type, key) {
  const it = (state.shopItems || []).find(x => x.item_type === type && x.item_key === key);
  if (!it) return 0;
  // 首次半价期间，选择器里显示的就是实际要扣的价，避免与商店不一致
  return it.pay_price == null ? (Number(it.price) || 0) : Number(it.pay_price);
}

/* ---------------- 星光商店 ---------------- */
async function openShop() {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return needIdentity(openShop);
  sfx.tap();
  if (els.wallView) els.wallView.hidden = true;
  if (els.formView) els.formView.hidden = true;
  if (els.frameView) els.frameView.hidden = true;
  if (els.lotteryView) els.lotteryView.hidden = true;
  if (els.shopView) els.shopView.hidden = false;
  if (els.shopConfigBanner) els.shopConfigBanner.hidden = !!ready;
  window.scrollTo(0, 0);
  if (els.shopLoading) els.shopLoading.hidden = false;
  if (els.shopGroups) els.shopGroups.hidden = true;
  await Promise.all([loadWallet(), loadShopCatalog()]);
  renderShop();
  if (typeof Nav !== 'undefined' && Nav.push) Nav.push('shop');
}

function closeShop() {
  sfx.back();
  if (els.shopView) els.shopView.hidden = true;
  if (els.formView) els.formView.hidden = false;
  window.scrollTo(0, 0);
  renderIdentityLevel();
  if (typeof Nav !== 'undefined' && Nav.pop) Nav.pop();
}

async function loadShopCatalog() {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!ready || !cls || !name) { state.shopItems = []; return; }
  try {
    const r = await withTimeout(supabase.rpc('get_shop_catalog', { p_class: cls, p_student: name }), DATA_TIMEOUT);
    if (!r.error && r.data && r.data.ok !== false) {
      state.shopItems = r.data.items || [];
      state.firstDiscount = !!r.data.first_discount;
      if (r.data.balance != null) state.wallet.balance = Number(r.data.balance) || 0;
    }
  } catch (e) { /* 保留旧缓存 */ }
}

/* 首次半价时，现价在前、原价划掉在后 */
function priceHTML(price, pay) {
  if (pay < price) return `<span class="shop-cut">${pay}<s>${price}</s></span>`;
  return String(price);
}

function shopItemTile(it) {
  const owned = it.owned || ownsItem(it.item_type, it.item_key);
  const equipped = it.equipped;
  const price = Number(it.price) || 0;
  const pay = it.pay_price == null ? price : Number(it.pay_price);
  const held = Number(it.held) || 0;
  const afford = state.wallet.balance >= pay;
  let thumb;
  if (it.item_type === 'avatar') {
    thumb = `<span class="shop-thumb is-img"><img src="${AVATAR_BASE}${avatarFile(it.item_key)}" alt="" loading="lazy"></span>`;
  } else if (it.item_type === 'daily') {
    thumb = `<span class="shop-thumb daily-thumb">${I.ticket('ico-2x')}</span>`;
  } else if (it.item_type === 'theme') {
    const f = cardThemeFile(it.item_key);
    thumb = f
      ? `<span class="shop-thumb theme-thumb" data-t="${it.item_key}"><img src="${f}" alt="" loading="lazy"></span>`
      : `<span class="shop-thumb theme-thumb" data-t="${it.item_key}">${I.sparkle('ico-2x')}</span>`;
  } else {
    thumb = `<span class="shop-thumb frame-choice fc-${it.item_key}"><span class="fc-ring"></span></span>`;
  }
  let btn;
  if (it.item_type === 'daily') {
    // 日常卡可重复购买：持有中显示「使用」，下方始终保留购买按钮
    btn = `<div class="shop-btn-row">` +
      (held > 0 ? `<button type="button" class="shop-btn use" data-use-card="${it.item_key}">使用${held > 1 ? ` ${held}` : ''}</button>` : '') +
      (price === 0
        ? `<button type="button" class="shop-btn use" data-buy="${it.item_key}">领取</button>`
        : `<button type="button" class="shop-btn buy${afford ? '' : ' poor'}" data-buy="${it.item_key}">${I.star()} ${priceHTML(price, pay)}</button>`) +
      `</div>`;
  } else {
    btn = equipped
      ? `<span class="shop-btn equipped">已佩戴</span>`
      : owned
        ? `<button type="button" class="shop-btn use" data-use="${it.item_type}:${it.item_key}">使用</button>`
        : price === 0
          ? `<button type="button" class="shop-btn use" data-buy="${it.item_key}">领取</button>`
          : `<button type="button" class="shop-btn buy${afford ? '' : ' poor'}" data-buy="${it.item_key}">${I.star()} ${priceHTML(price, pay)}</button>`;
  }
  return `<div class="shop-item${owned ? ' owned' : ''}">
      ${thumb}
      <div class="shop-name">${esc(it.name || it.item_key)}</div>
      ${btn}
    </div>`;
}

/* v191：商店分组折叠（仅「头像」「头像框」两个分类）。默认展开，状态只在本次会话内记忆 */
const SHOP_FOLDABLE = { avatar: 1, frame: 1 };
function shopGroupHTML(key, title, gridHTML) {
  const foldable = !!SHOP_FOLDABLE[state.shopTab];
  const folded = foldable && !!state.shopFolded[key];
  const btn = foldable
    ? `<button type="button" class="task-fold shop-fold" data-fold="${esc(key)}" title="${folded ? '展开' : '收起'}" aria-expanded="${folded ? 'false' : 'true'}">${folded ? I['chevron-down']() : I['chevron-up']()}</button>`
    : '';
  return `<section class="shop-group${folded ? ' shop-folded' : ''}">` +
    `<div class="shop-group-title">${title}${btn}</div>` +
    `<div class="shop-grid">${gridHTML}</div></section>`;
}

function renderShop() {
  if (!els.shopGroups) return;
  if (els.shopLoading) els.shopLoading.hidden = true;
  els.shopGroups.hidden = false;
  if (els.shopWalletLabel) els.shopWalletLabel.textContent = `我的星光值：${state.wallet.balance}`;
  if (els.shopWalletValue) els.shopWalletValue.textContent = state.wallet.balance;
  if (els.shopWalletSub) els.shopWalletSub.textContent =
    `累计获得 ${state.wallet.total_earned} · 已消费 ${state.wallet.total_spent}`;
  $$('.shop-tab', els.shopTabs || document).forEach(b =>
    b.classList.toggle('active', b.dataset.shopTab === state.shopTab));

  const list = (state.shopItems || []).filter(x => x.item_type === state.shopTab);
  const groups = [];
  list.forEach(it => {
    const g = it.group_name || '其他';
    let box = groups.find(x => x.name === g);
    if (!box) { box = { name: g, items: [] }; groups.push(box); }
    box.items.push(it);
  });

  let html = state.firstDiscount ? '<div class="shop-promo">首次兑换半价</div>' : '';
  // v173：主题分类置顶「不使用主题」，方便随时取下
  if (state.shopTab === 'theme') {
    html += shopGroupHTML('theme:__head__', `${I.sparkle()} 我的卡片主题`,
      `<div class="shop-item${state.myCardTheme ? '' : ' owned'}">
          <span class="shop-thumb theme-thumb theme-none">${I['circle-dot']('ico-2x')}</span>
          <div class="shop-name">不使用主题</div>
          ${state.myCardTheme
            ? `<button type="button" class="shop-btn use" data-use="theme:">取下</button>`
            : `<span class="shop-btn equipped">当前</span>`}
        </div>`);
  }
  // 免费头像区（小动物 24 款，默认拥有）
  if (state.shopTab === 'avatar') {
    html += shopGroupHTML('avatar:__free__',
      `${I.paw()} 免费头像<span class="shop-group-tip">默认拥有，可随意更换</span>`,
      AVATARS.map(k => `<div class="shop-item owned">
        <span class="shop-thumb is-img"><img src="${AVATAR_BASE}${avatarFile(k)}" alt="" loading="lazy"></span>
        <div class="shop-name">小动物</div>
        <button type="button" class="shop-btn use" data-use="avatar:${k}">使用</button>
      </div>`).join(''));
  }

  groups.forEach(g => {
    html += shopGroupHTML(`${state.shopTab}:${g.name}`,
      `${esc(g.name)}<span class="shop-group-tip">${g.items.length} 件</span>`,
      g.items.map(shopItemTile).join(''));
  });

  if (!groups.length && state.shopTab !== 'avatar') {
    html += `<div class="empty">暂无商品，请联系老师</div>`;
  }
  els.shopGroups.innerHTML = html;

  // v191：分组折叠开关（头像 / 头像框两类的每个分组各一个，默认展开）
  $$('[data-fold]', els.shopGroups).forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.fold;
    const sec = b.closest('.shop-group');
    const folded = !state.shopFolded[key];
    state.shopFolded[key] = folded;
    if (sec) sec.classList.toggle('shop-folded', folded);
    b.setAttribute('aria-expanded', folded ? 'false' : 'true');
    b.title = folded ? '展开' : '收起';
    b.innerHTML = folded ? I['chevron-down']() : I['chevron-up']();
    sfx.tap();
  }));

  $$('[data-buy]', els.shopGroups).forEach(b => b.addEventListener('click', () => buyShopItem(b.dataset.buy, b)));
  $$('[data-use-card]', els.shopGroups).forEach(b => b.addEventListener('click', () => useDailyCard(b.dataset.useCard, b)));
  $$('[data-use]', els.shopGroups).forEach(b => b.addEventListener('click', () => {
    const [type, key] = b.dataset.use.split(':');
    if (type === 'avatar') doChooseAvatar(key);
    else if (type === 'frame') doChooseFrame(key);
    else if (type === 'theme') doChooseCardTheme(key);
  }));
}

async function buyShopItem(key, btn) {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return needIdentity(() => buyShopItem(key, btn));
  const it = (state.shopItems || []).find(x => x.item_key === key);
  if (!it) return toast('商品已下架，请刷新商店');   // v178(F-04)：目录过期时给反馈，不再静默返回
  const pay = it.pay_price == null ? Number(it.price || 0) : Number(it.pay_price);
  if (state.wallet.balance < pay) {
    sfx.oops();
    return toast(`还差 ${pay - state.wallet.balance} 星光值`);
  }
  if (btn) btn.disabled = true;
  try {
    const r = await supabase.rpc('buy_shop_item', { p_class: cls, p_student: name, p_item_key: key });
    if (r.error) throw r.error;
    const res = r.data || {};
    if (!res.ok) {
      sfx.oops();
      if (res.reason === 'not_enough') toast(`还差 ${Number(res.price || 0) - Number(res.balance || 0)} 星光值`);
      else if (res.reason === 'owned') toast('这件已经拥有啦');
      else toast('兑换失败，请稍后再试');
      if (btn) btn.disabled = false;
      return;
    }
    sfx.success();
    toast(`已兑换 ${it.name}`);
    await Promise.all([loadWallet(), loadShopCatalog()]);
    renderShop();   // v178(F-06)：删除重复的第二次 renderShop
    await loadProfile();
  } catch (e) {
    sfx.oops();
    toast('兑换失败，请检查网络后重试');
    if (btn) btn.disabled = false;
  }
}

/* 日常卡（免作业卡等）：消耗 1 张，老师端当日可见 */
async function useDailyCard(key, btn) {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return needIdentity(() => useDailyCard(key, btn));
  const it = (state.shopItems || []).find(x => x.item_key === key);
  const label = it ? it.name : '这张卡';
  if (!window.confirm(`使用 1 张${label}？`)) return;
  if (btn) btn.disabled = true;
  try {
    const r = await supabase.rpc('use_coupon', { p_class: cls, p_student: name, p_item_key: key });
    if (r.error) throw r.error;
    const res = r.data || {};
    if (!res.ok) {
      sfx.oops();
      toast(res.reason === 'not_owned' ? '没有可用的卡' : '使用失败，请稍后再试');
      if (btn) btn.disabled = false;
      return;
    }
    sfx.success();
    toast(`${label}已使用`);
    await loadShopCatalog();
    renderShop();
  } catch (e) {
    sfx.oops();
    toast('使用失败，请检查网络后重试');
    if (btn) btn.disabled = false;
  }
}

// 商店内直接「使用」
async function doChooseAvatar(key) {
  const btn = null;
  const res = await persistAvatar(key);
  if (!res || res.ok === false) {
    sfx.oops();
    if (res && res.reason === 'not_owned') toast('这款还没拥有，先用星光值兑换吧～');
    else if (res && res.reason === 'no_student') { toast('这个名字不在名单里'); needIdentity(() => doChooseAvatar(key)); }
    else toast('保存失败，请重试');
    return;
  }
  sfx.pick();
  state.myAvatar = key;
  const row = currentRosterRow();
  if (row) row.avatar = key;
  persistWallCache(); renderWall(); renderMoodPreview();
  await loadShopCatalog();
  if (els.shopView && !els.shopView.hidden) renderShop();
  toast('换好啦！');
}

async function doChooseFrame(key) {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return needIdentity(() => doChooseFrame(key));
  const wr = await runWrite({ name: 'set_student_frame', params: { p_class: cls, p_student: name, p_frame: key } });
  if (!wr.ok || (wr.res && wr.res.ok === false)) {
    sfx.oops();
    toast(wr.res && wr.res.reason === 'not_owned' ? '这个头像框还没拥有，先去商店兑换吧～' : '保存失败，请重试');
    return;
  }
  sfx.pick();
  state.myFrame = key;
  const row = currentRosterRow();
  if (row) row.frame = key;
  applyFrameTo(els.identityAvatarEmoji, key);
  persistWallCache(); renderWall();
  await loadShopCatalog();
  if (els.shopView && !els.shopView.hidden) renderShop();
  toast(key === 'none' ? '已取下头像框' : '头像框戴好啦，真好看！');
}

/* v173：卡片主题佩戴（null = 取下） */
async function doChooseCardTheme(key) {
  const cls = (els.inpClass.value || '').trim();
  const name = (els.inpName.value || '').trim();
  if (!cls || !name) return needIdentity(() => doChooseCardTheme(key));
  const val = key || null;
  const wr = await runWrite({ name: 'set_student_card_theme', params: { p_class: cls, p_student: name, p_card_theme: val } });
  if (!wr.ok || (wr.res && wr.res.ok === false)) {
    sfx.oops();
    const reason = wr.res && wr.res.reason;
    toast(reason === 'not_owned' ? '这个主题还没拥有' : '保存失败，请重试');
    return;
  }
  sfx.pick();
  state.myCardTheme = val;
  const row = currentRosterRow();
  if (row) row.card_theme = val;
  // v197：个人主页不套主题，换完直接回星光墙看效果
  applyCardTheme(document.getElementById('identityCard'), null);
  persistWallCache(); renderWall();
  await loadShopCatalog();
  if (els.shopView && !els.shopView.hidden) renderShop();
  toast(val ? `已换上「${cardThemeName(val)}」，到星光墙就能看到` : '已取下卡片主题');
}

/* ---------------- 班级转盘抽奖 ---------------- */
async function openLottery() {
  const cls = state.currentClass || (els.inpClass.value || '').trim();
  if (!cls) { toast('请先选择班级'); return; }
  sfx.tap();
  if (els.wallView) els.wallView.hidden = true;
  if (els.formView) els.formView.hidden = true;
  if (els.shopView) els.shopView.hidden = true;
  if (els.frameView) els.frameView.hidden = true;
  if (els.lotteryView) els.lotteryView.hidden = false;
  if (els.lotteryConfigBanner) els.lotteryConfigBanner.hidden = !!ready;
  window.scrollTo(0, 0);
  if (els.lotteryClassName) els.lotteryClassName.textContent = cls + ' · 全班';
  await Promise.all([loadClassProgress(), loadWheelPrizes(), loadLotteryHistory()]);
  renderLottery();
  if (typeof Nav !== 'undefined' && Nav.push) Nav.push('lottery');
}

function closeLottery() {
  sfx.back();
  if (els.lotteryView) els.lotteryView.hidden = true;
  if (els.wallView) els.wallView.hidden = false;
  window.scrollTo(0, 0);
  loadWall();
  if (typeof Nav !== 'undefined' && Nav.pop) Nav.pop();
}

async function loadClassProgress() {
  const cls = state.currentClass || (els.inpClass.value || '').trim();
  if (!ready || !cls) return null;
  try {
    const r = await withTimeout(supabase.rpc('get_class_progress', { p_class: cls }), DATA_TIMEOUT);
    if (!r.error && r.data && r.data.ok !== false) { state.classProgress = r.data; return r.data; }
  } catch (e) { /* 忽略 */ }
  return state.classProgress;
}

async function loadWheelPrizes() {
  if (!ready) return;
  try {
    const r = await withTimeout(supabase.rpc('get_lottery_prizes'), DATA_TIMEOUT);
    if (!r.error && Array.isArray(r.data) && r.data.length) state.wheelPrizes = r.data;
  } catch (e) { /* 忽略 */ }
  if (!state.wheelPrizes.length) {
    state.wheelPrizes = [
      { prize_key: 'star_50', name: '星光值 +50', icon: I.star() },
      { prize_key: 'star_100', name: '星光值 +100', icon: I['star-fill']() },
      { prize_key: 'class_50', name: '全班星光 +50', icon: I.sparkle() },
      { prize_key: 'thanks', name: '谢谢参与', icon: I.leaf() }
    ];
  }
}

function renderLottery() {
  const p = state.classProgress || { xp: 0, level: 1, chances: 0, next_need: 500 };
  if (els.lotteryClassLv) els.lotteryClassLv.textContent = 'Lv.' + (p.level || 1);
  if (els.lotteryChance) {
    const n = Number(p.chances) || 0;
    els.lotteryChance.textContent = n > 0 ? `可抽奖 ${n} 次` : '暂无可抽奖次数';
    els.lotteryChance.classList.toggle('has', n > 0);
  }
  if (els.lotteryTip) {
    els.lotteryTip.textContent = (Number(p.chances) || 0) > 0
      ? '点开始抽奖'
      : `班级星光 ${p.xp || 0} · 再 ${p.next_level_need != null ? p.next_level_need : (p.next_need || 0)} 升 Lv.${(p.level || 1) + 1}`;
  }
  if (els.btnSpinMain) els.btnSpinMain.disabled = (Number(p.chances) || 0) <= 0 || state.spinning;
  if (els.btnSpin) els.btnSpin.disabled = (Number(p.chances) || 0) <= 0 || state.spinning;

  const prizes = state.wheelPrizes || [];
  const n = Math.max(1, prizes.length);
  const sector = 360 / n;
  if (els.lotteryWheel) {
    const stops = prizes.map((x, i) => {
      const c = i % 2 === 0 ? '#fff3d6' : '#ffe3b3';
      return `${c} ${i * sector}deg ${(i + 1) * sector}deg`;
    }).join(',');
    els.lotteryWheel.style.background = `conic-gradient(${stops})`;
    els.lotteryWheel.innerHTML = prizes.map((x, i) => {
      const ang = ((i + 0.5) * sector - 90) * Math.PI / 180;
      // 容器宽度百分比：50% 即环边，37% ≈ 环半径的 0.74，贴近环内但不压线
      const rad = 37;
      const left = 50 + rad * Math.cos(ang);
      const top = 50 + rad * Math.sin(ang);
      const short = String(x.name || '').replace(/星光值|全班星光|头像框|头像/g, '').replace(/一节$/, '').trim();
      return `<span class="wheel-label" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%">` +
        `<i>${x.icon}<em>${esc(short)}</em></i></span>`;
    }).join('');
  }
}

async function loadLotteryHistory() {
  const cls = state.currentClass || (els.inpClass.value || '').trim();
  if (!ready || !cls || !els.lotteryHistoryBody) return;
  try {
    const r = await supabase.rpc('get_class_draw_history', { p_class: cls, p_limit: 10 });
    if (r.error) throw r.error;
    const rows = Array.isArray(r.data) ? r.data : [];
    els.lotteryHistoryCard.hidden = !rows.length;
    els.lotteryHistoryBody.innerHTML = rows.map(x => `
      <div class="lh-row">
        <span class="lh-icon">${prizeIcon(x)}</span>
        <span class="lh-name">${esc(x.name || '')}</span>
        <span class="lh-meta">Lv.${x.level}${x.student_name ? ' · ' + esc(x.student_name) : ''}</span>
        <span class="lh-time">${formatTime(x.drawn_at)}</span>
      </div>`).join('');
  } catch (e) { /* 忽略 */ }
}

async function spinLottery() {
  const cls = state.currentClass || (els.inpClass.value || '').trim();
  if (!cls || state.spinning) return;
  const chance = Number((state.classProgress || {}).chances) || 0;
  if (chance <= 0) { sfx.oops(); return toast('暂无抽奖机会'); }

  state.spinning = true;
  if (els.btnSpinMain) els.btnSpinMain.disabled = true;
  if (els.btnSpin) els.btnSpin.disabled = true;
  sfx.tap();

  const name = (els.inpName.value || '').trim();
  let res = null;
  try {
    const r = await supabase.rpc('class_lottery_draw', { p_class: cls, p_student: name });
    if (r.error) throw r.error;
    res = r.data;
  } catch (e) {
    state.spinning = false;
    renderLottery();
    sfx.oops();
    return toast('抽奖失败，请检查网络后重试');
  }
  if (!res || res.ok === false) {
    state.spinning = false;
    renderLottery();
    sfx.oops();
    return toast(res && res.reason === 'no_chance' ? '暂无抽奖机会' : '抽奖失败，请稍后再试');
  }

  // 转盘停在对应扇区
  const prizes = state.wheelPrizes || [];
  const n = Math.max(1, prizes.length);
  const sector = 360 / n;
  let idx = prizes.findIndex(x => x.prize_key === res.prize_key);
  if (idx < 0) idx = 0;
  const target = 360 * 6 + (360 - (idx * sector + sector / 2));
  if (els.lotteryWheel) {
    els.lotteryWheel.style.transition = 'transform 3.8s cubic-bezier(.16,.84,.24,1)';
    els.lotteryWheel.style.transform = `rotate(${target}deg)`;
  }
  if (typeof sfx.star === 'function') sfx.star();

  setTimeout(() => {
    state.spinning = false;
    if (els.lotteryWheel) {
      els.lotteryWheel.style.transition = 'none';
      els.lotteryWheel.style.transform = `rotate(${target % 360}deg)`;
    }
    showPrize(res);
    loadClassProgress().then(renderLottery);
    loadWallet();
    loadLotteryHistory();
  }, 3900);
}

/* v168：奖品图标按 prize_type 映射到自制图标集，不再依赖库里存的 emoji */
const PRIZE_ICONS = { star: 'star', class_star: 'heart', avatar: 'image', frame: 'ribbon', none: 'leaf', course: 'book-open' };
function prizeIcon(p, cls) {
  const key = PRIZE_ICONS[(p && p.prize_type) || 'none'] || 'gift';
  return I[key](cls);
}

function showPrize(res) {
  if (!els.prizeModal) return;
  els.prizeIcon.innerHTML = prizeIcon(res);
  els.prizeName.textContent = `恭喜！${res.name || '中奖啦'}`;
  let desc = `班级升到 Lv.${res.level} 的奖励`;
  if (res.prize_type === 'star') desc += ` · 已存入你的星光值`;
  else if (res.prize_type === 'class_star') desc += ` · 全班每人 +${res.prize_value}`;
  else if (res.prize_type === 'avatar' || res.prize_type === 'frame') desc += ' · 已放入衣柜';
  else if (res.prize_type === 'course') desc += ' · 找老师约上课时间';
  else desc += ' · 下次一定中大奖';
  els.prizeDesc.textContent = desc;
  els.prizeModal.classList.add('show');
  if (typeof sfx.success === 'function') sfx.success();
}

function showForm(presetName) {
  if (!state.currentClass) { toast('请先选择班级'); return; }
  els.inpClass.value = state.currentClass;
  if (presetName) {
    els.inpName.value = presetName;
    try {
      localStorage.setItem('sp_identity',
        JSON.stringify({ class: state.currentClass, studentName: presetName }));
    } catch (e) {}
  }
  state.myAvatar = null;   // 进入表单先显示该学生已保存的头像
  els.wallView.hidden = true;
  els.formView.hidden = false;
  if (els.frameView) els.frameView.hidden = true;
  if (els.shopView) els.shopView.hidden = true;
  if (els.lotteryView) els.lotteryView.hidden = true;
  loadProfile();           // 成就 + 已拥有装扮
  loadWallet();            // v167：星光值余额
  loadShopCatalog();       // v167：商店目录（换头像时判定是否已拥有）
  window.scrollTo({ top: 0 });
  updateMood();
  renderIdentityName();    // v179：身份条显示当前填写人（空则显示「点我选名字」）
  resetSelections();
  loadTags();
  loadStudentTask();
  loadPastTasks();
  updateSubmitStatus();
  loadTodayTasks();
  loadPersonalTasks();
  loadChallengeTasks();
}

// v114：显示"今天是否已提交"（离线时用缓存判断，让学生知道填过没有，避免重复填报）
async function updateSubmitStatus() {
  const el = els.submitStatus;
  if (!el) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { el.hidden = true; return; }
  const today = todayStr();
  let myToday = [];
  if (!window.Offline || !window.Offline.online) {
    const v = await window.Offline.get(wallKey(cls));
    myToday = ((v && v.records) || []).filter(r => r.student_name === name && r.record_date === today);
    if (!myToday.length) {
      const v2 = await window.Offline.get('records_all_' + cls);
      myToday = ((v2 && v2.data) || []).filter(r => r.student_name === name && r.record_date === today);
    }
  } else {
    myToday = (state.records || []).filter(r => r.student_name === name && r.record_date === today);
  }
  if (myToday.length) {
    el.hidden = false;
    el.textContent = `今天已提交 ${myToday.length} 次`;
    el.className = 'submit-status submit-status-ok';
  } else {
    el.hidden = true;
    el.className = 'submit-status';
  }
}

// v148：今日任务（教师手动分配，学生确认完成才加分）
async function loadTodayTasks() {
  const card = els.todayTaskCard, box = els.todayTaskBox;
  if (!card || !box) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { card.hidden = true; return; }
  const today = todayStr();
  let rows = [];
  try {
    const r = await supabase.from('manual_task')
      .select('id,status,behavior_tags(label, xp_value, category)')
      .eq('class', cls).eq('student_name', name).eq('task_date', today);
    if (!r.error) rows = r.data || [];
  } catch (e) {}
  if (!rows.length) { card.hidden = true; return; }
  card.hidden = false;
  box.innerHTML = rows.map(t => {
    const tag = t.behavior_tags || {};
    const done = t.status === 'done';
    return `<div class="today-task-row${done ? ' done' : ''}">
      <div class="today-task-info">
        <span class="today-task-label">${esc(tag.label || '(任务)')}</span>
        <span class="today-task-state${done ? ' ok' : ''}">${done ? '' + I['check-circle']() + ' 已完成' : '' + I.hourglass() + ' 待完成'}</span>
      </div>
      ${done ? '' : `<button type="button" class="btn btn-warn btn-sm" data-confirm="${t.id}">${I['check-circle']()} 我完成了</button>`}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-confirm]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.confirm;
    btn.disabled = true;
    try {
      const r = await supabase.rpc('confirm_manual_task', { p_task_id: id });
      if (r.error) { toast('确认失败，请重试'); btn.disabled = false; return; }
      const d = r.data || {};
      if (d.ok === false) { toast('确认失败：' + (d.reason || '')); btn.disabled = false; return; }
      sfx.success();
      toast(`完成啦！${Number(d.xp_delta) > 0 ? '星光值+' + d.xp_delta : '已记录'}`);
      loadTodayTasks();
      updateSubmitStatus();
      if (window.loadWallData) loadWallData();
    } catch (e) { toast('确认失败，请检查网络'); btn.disabled = false; }
  }));
}

// v149：个人任务（教师自定义内容，确认完成按教师定分值+维度加分）
async function loadPersonalTasks() {
  const card = els.personalTaskCard, box = els.personalTaskBox;
  if (!card || !box) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { card.hidden = true; return; }
  const today = todayStr();
  let rows = [];
  try {
    const r = await supabase.from('personal_task')
      .select('id,status,content,dim,xp_value,deadline,task_date')
      .eq('class', cls).eq('student_name', name)
      .lte('task_date', today)
      .or(`status.eq.done,deadline.is.null,deadline.gte.${today}`);
    if (!r.error) rows = r.data || [];
  } catch (e) {}
  if (!rows.length) { card.hidden = true; return; }
  card.hidden = false;
  const dimName = { de: '' + I.heart() + '德', zhi: '' + I['book-open']() + '智', ti: '' + I.dumbbell() + '体', mei: '' + I.palette() + '美', lao: '' + I.broom() + '劳' };
  box.innerHTML = rows.map(t => {
    const done = t.status === 'done';
    const dl = t.deadline ? ` · 截止 ${String(t.deadline).slice(5)}` : '';
    return `<div class="today-task-row${done ? ' done' : ''}">
      <div class="today-task-info">
        <span class="today-task-label">${I.target()} ${esc(t.content)}</span>
        <span class="today-task-state${done ? ' ok' : ''}">${done ? '' + I['check-circle']() + ' 已完成' : '' + I.hourglass() + ' 待完成'}</span>
      </div>
      <div class="today-task-sub">${dimName[t.dim] || ''} · 星光值+${t.xp_value}${dl}</div>
      ${done ? '' : `<button type="button" class="btn btn-warn btn-sm" data-confirm-ptask="${t.id}">${I['check-circle']()} 我完成了</button>`}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-confirm-ptask]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.confirmPtask;
    btn.disabled = true;
    try {
      const r = await supabase.rpc('confirm_personal_task', { p_task_id: id });
      if (r.error) { toast('确认失败，请重试'); btn.disabled = false; return; }
      const d = r.data || {};
      if (d.ok === false) { toast('确认失败：' + (d.reason || '')); btn.disabled = false; return; }
      sfx.success();
      toast(`完成啦！星光值+${d.xp_delta}`);
      loadPersonalTasks();
      updateSubmitStatus();
      if (window.loadWallData) loadWallData();
    } catch (e) { toast('确认失败，请检查网络'); btn.disabled = false; }
  }));
}

// v150 + v152：挑战任务（教师布置，学生自选达成档位，星光值按教师自定义方案）
// v152 重写：配合 82 号 SQL —— 提交走 confirm_challenge_levels（多档位数组、增量合并、
// done_levels 列持久化）；离线提交自动入队联网同步
const CHALLENGE_LEVELS = (() => { const a = []; for (let lv = 10; lv <= 110; lv += 5) a.push(lv); return a; })();
async function loadChallengeTasks() {
  const card = els.challengeTaskCard, box = els.challengeTaskBox;
  if (!card || !box) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { card.hidden = true; return; }
  let rows = [];
  try {
    const r = await supabase.from('challenge_task')
      .select('id,status,title,dim,levels,done_levels,task_date')
      .eq('class', cls).eq('student_name', name)
      .neq('status', 'cancelled')
      .order('task_date', { ascending: false });
    if (!r.error) rows = r.data || [];
  } catch (e) {}
  if (!rows.length) { card.hidden = true; return; }
  card.hidden = false;
  const dimName = { de: '' + I.heart() + '德', zhi: '' + I['book-open']() + '智', ti: '' + I.dumbbell() + '体', mei: '' + I.palette() + '美', lao: '' + I.broom() + '劳' };
  const defaultLevels = CHALLENGE_LEVELS.map(lv => [lv, lv / 5]);
  box.innerHTML = rows.map(t => {
    const scheme = Array.isArray(t.levels) && t.levels.length ? t.levels : defaultLevels;
    const doneArr = Array.isArray(t.done_levels) ? t.done_levels : [];
    const doneSet = new Set(doneArr.map(Number));
    const allDone = t.status === 'done' || (scheme.length > 0 && doneArr.length >= scheme.length);
    const chips = scheme.map((lv) => {
      const lvNum = Number(lv && lv[0]);
      const xp = Number(lv && lv[1]) || 0;
      const on = doneSet.has(lvNum);
      return `<label class="chg-chip ${on ? 'on' : ''}">
        <input type="checkbox" value="${lvNum}" ${on ? 'disabled checked' : ''} data-lv="${t.id}">
        ${lvNum}
      </label>`;
    }).join('');
    return `<div class="today-task-row ${allDone ? 'done' : ''}">
      <div class="today-task-info">
        <span class="today-task-label">${I.trophy()} ${esc(t.title)}</span>
        <span class="today-task-state ${allDone ? 'ok' : ''}">${allDone ? '' + I.trophy() + ' 全部达成 ' + doneArr.length + '/' + scheme.length : '已达成 ' + doneArr.length + '/' + scheme.length + ' 档'}</span>
      </div>
      <div class="today-task-sub">${dimName[t.dim] || ''} · 勾选本次新达成的档位，可多选一次提交</div>
      <div class="chg-chip-box">${chips}</div>
      ${allDone ? '' : `<div style="margin-top:6px;"><button type="button" class="btn btn-warn btn-sm" data-confirm-challenge="${t.id}">${I['check-circle']()} 提交达成</button></div>`}
    </div>`;
  }).join('');
  // v152.2：勾选档位高亮（未达成档位勾选时点亮，提交后由 .on 置灰覆盖）
  box.querySelectorAll('.chg-chip input:not(:disabled)').forEach(cb => cb.addEventListener('change', () => {
    const chip = cb.closest('.chg-chip');
    if (chip) chip.classList.toggle('sel', cb.checked);
  }));
  box.querySelectorAll('[data-confirm-challenge]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.confirmChallenge;
    const checks = box.querySelectorAll(`input[data-lv="${id}"]:not(:disabled):checked`);
    const lvList = Array.from(checks).map(c => parseInt(c.value, 10));
    if (!lvList.length) { toast('请先勾选本次达成的档位'); return; }
    btn.disabled = true;
    try {
      const wr = await runWrite({ name: 'confirm_challenge_levels', params: { p_task_id: id, p_levels: lvList } });
      if (!wr.ok) { toast('提交失败，请重试'); btn.disabled = false; return; }
      if (wr.queued) { toast('已离线保存，联网后自动同步'); loadChallengeTasks(); btn.disabled = false; return; }
      const d = wr.res || {};
      if (d.ok === false) { toast('提交失败：' + (d.reason || '')); btn.disabled = false; return; }
      sfx.success();
      const newN = (Array.isArray(d.new_levels) ? d.new_levels.length : (lvList.length || 0));
      toast(`已达成 ${newN} 档，星光值+${d.xp_delta}`);
      loadChallengeTasks();
      updateSubmitStatus();
      if (window.loadWallData) loadWallData();
    } catch (e) { toast('提交失败，请检查网络'); btn.disabled = false; }
  }));
}

async function loadPastTasks() {
  if (!els.pastTaskCard) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { els.pastTaskCard.hidden = true; return; }
  els.pastTaskCard.hidden = false;
  const since = new Date(); since.setDate(since.getDate() - 6);
  const p = n => String(n).padStart(2, '0');
  const sinceStr = `${since.getFullYear()}-${p(since.getMonth()+1)}-${p(since.getDate())}`;
  try {
    // 往日任务列表：离线/失败时用最近缓存（sp_past_<cls>）
    let tasks = null;
    try {
      const r = await supabase.from('daily_task')
        .select('id,title,detail,task_date,task_type,due_time')
        .eq('class', cls).gte('task_date', sinceStr).lt('task_date', todayStr())
        .order('task_date', { ascending: false });
      tasks = r.data;
      if (!r.error && tasks) { try { localStorage.setItem('sp_past_' + cls, JSON.stringify(tasks)); } catch(e) {} }
    } catch (e) { tasks = null; }
    if (!tasks) { try { tasks = JSON.parse(localStorage.getItem('sp_past_' + cls) || '[]'); } catch(e2) { tasks = []; } }
    const taskIds = tasks.map(t => t.id);
    // 提交记录：走专用 RPC get_my_task_subs（security definer，绕过 RLS，只返回该生自己的提交）
    // v129：此前直查 task_submission 被 RLS 过滤为空 → 往日任务永远显示"已截止"（RSK-09）
    let subs = null;
    try {
      const r = await supabase.rpc('get_my_task_subs', { p_student: name });
      subs = r && r.data;
      if (!r || r.error || !subs) {
        try { subs = JSON.parse(localStorage.getItem('sp_past_subs_' + cls + '_' + name) || '[]'); } catch(e2) { subs = []; }
      } else {
        try { localStorage.setItem('sp_past_subs_' + cls + '_' + name, JSON.stringify(subs)); } catch(e) {}
      }
    } catch(e) {
      try { subs = JSON.parse(localStorage.getItem('sp_past_subs_' + cls + '_' + name) || '[]'); } catch(e2) { subs = []; }
    }
    const gradeMap = {}; subs.forEach(s => gradeMap[s.task_id] = s.grade);
    const gLabel = { none:'' + I.hourglass() + '未完成', done:'' + I['check-circle']() + '完成', good:'' + I.thumb() + '优秀A', perfect:'' + I.trophy() + '完美A+' };
    if (!(tasks||[]).length) { els.pastTaskBody.innerHTML = '<p class="text-muted">近 7 天无任务</p>'; return; }
    const now = new Date(); now.setHours(0,0,0,0);
    // 截止日期按本地时区解析（'YYYY-MM-DD' 字符串若用 new Date 会被当 UTC，导致当天任务上午就"已截止"）
    const parseLocalDate = dStr => {
      const m = String(dStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dStr);
    };
    const fmtLocal = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    els.pastTaskBody.innerHTML = (tasks||[]).map(t => {
      const cur = gradeMap[t.id];
      // 截止判断：有 due_time 用它；没有则默认任务发布后一周
      let dueDate = t.due_time ? parseLocalDate(t.due_time) : null;
      if (!dueDate && t.task_date) { dueDate = parseLocalDate(t.task_date); dueDate.setDate(dueDate.getDate() + 7); }
      const active = dueDate ? dueDate >= now : false;
      const dueStr = t.due_time ? ` 截止${String(t.due_time).slice(0,10)}`
                  : (t.task_date ? ` 截止${(()=>{const d=parseLocalDate(t.task_date);d.setDate(d.getDate()+7);return fmtLocal(d);})()}` : '');
      const head = `<div class="past-line1">${t.task_type==='homework'?I.home():I.school()} ${(t.task_date||'').slice(5)} ${esc(t.title)}${dueStr}</div>`;
      if (!active) {
        return `<div class="past-row">${head}<div class="past-grade">${gLabel[cur] || '已截止'}</div></div>`;
      }
      const btns = TASK_GRADES.map(g =>
        `<button type="button" class="stu-task-grade sm ${g.key === cur ? 'on' : ''}" data-grade="${g.key}" data-task="${t.id}">${g.icon} ${g.label}</button>`
      ).join('');
      return `<div class="past-row active stack">${head}<div class="past-grade">${btns}</div><div class="stu-task-result" data-result="past-${t.id}"></div></div>`;
    }).join('');
    els.pastTaskBody.querySelectorAll('.stu-task-grade').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (state.readonly) { sfx.oops(); toast('预览模式不能提交哦～'); return; }
        const grade = btn.dataset.grade, taskId = btn.dataset.task;
        const wr = await runWrite({ name: 'submit_task', params: { p_class: cls, p_student: name, p_task_id: taskId, p_grade: grade } });
        if (!wr.ok) { sfx.oops(); toast(taskFailText(wr.res)); return; }
        const d = wr.res || {};
        sfx.pick();
        const xpGain = (d.xp_delta || 0) > 0 ? ` 星光值+${d.xp_delta}` : '';
        toast(wr.queued ? '已离线保存，联网后自动同步' : (grade === 'perfect' ? `太棒啦！${xpGain}` : grade === 'good' ? `真不错！${xpGain}` : '已保存'));
        const pastResult = document.querySelector(`[data-result="past-${taskId}"]`);
        if (pastResult) pastResult.textContent = wr.queued ? '已离线保存，联网后自动同步' : '';
        // 离线：同步更新本地往日任务缓存，重渲染时按钮/状态即时反映
        if (wr.queued) {
          try {
            const key = 'sp_past_subs_' + cls + '_' + name;
            const subs = JSON.parse(localStorage.getItem(key) || '[]');
            const i = subs.findIndex(x => x.task_id === taskId);
            if (i >= 0) subs[i].grade = grade; else subs.push({ task_id: taskId, grade });
            localStorage.setItem(key, JSON.stringify(subs));
          } catch (e) {}
        }
        const row = state.roster.find(s => s.class === cls && s.student_name === name);
        if (!wr.queued && row && typeof d.xp === 'number') { row.xp = d.xp; }
        renderIdentityLevel();
        loadPastTasks();
        loadWall();
      });
    });
  } catch(e) { els.pastTaskBody.innerHTML = ''; }
}
function showWall() {
  els.formView.hidden = true;
  if (els.frameView) els.frameView.hidden = true;
  if (els.shopView) els.shopView.hidden = true;
  if (els.lotteryView) els.lotteryView.hidden = true;
  els.wallView.hidden = false;
  window.scrollTo({ top: 0 });
  loadWall();
}
/* ---------------- v213：班级打卡 + 座位点名 ----------------
   入口：星光墙的班级头像（原转盘入口移入面板底部）。
   加分口径：打卡项自带 dim 与 xp，提交后由 submit_checkin 在同一事务里
   写 checkin_log、加 student_info.xp 与对应维度列，不落 daily_record。
   同一天同一项同一人只记一次，重复提交由数据库唯一索引挡住。 */
const CI_DIM_LABEL = { de: '德', zhi: '智', ti: '体', mei: '美', lao: '劳' };
const CI_ICON_RULES = [
  { kw: ['劳动', '卫生', '扫地', '打扫', '值日'], icon: '🧹' },
  { kw: ['作业', '学习', '阅读', '朗读', '背诵', '写字'], icon: '📘' },
  { kw: ['牛奶', '奶箱', '课间奶'], icon: '🥛' },
  { kw: ['佳肴', '午餐', '餐桶', '饭菜', '送餐'], icon: '🍱' }
];
function ciIcon(it) {
  const ic = String((it && it.icon) || '').trim();
  // 教师直接填 emoji 时优先用它；字母串视为图标键，走下面的名称匹配
  if (ic && !/^[a-z0-9_-]+$/i.test(ic)) return ic;
  const n = String((it && it.name) || '');
  for (const r of CI_ICON_RULES) if (r.kw.some(k => n.includes(k))) return r.icon;
  return '✅';
}

const checkinState = { items: [], item: null, picked: new Set(), done: new Set(), dayMap: {} };

async function openCheckin(reopen) {
  const cls = state.currentClass || (els.inpClass.value || '').trim();
  if (!cls) { toast('请先选择班级'); return; }
  if (!reopen) {
    sfx.tap();
    els.checkinModal.classList.add('show');
    Nav.push('checkin');
  }
  els.ciHeadIcon.textContent = '🧹';
  els.ciSub.textContent = cls + ' · ' + todayStr();
  els.ciGrid.innerHTML = '<div class="ci-empty"><span class="spinner"></span>正在加载打卡项…</div>';

  if (!ready) {
    els.ciGrid.innerHTML = '<div class="ci-empty">系统还没连上，暂时打不了卡</div>';
    return;
  }

  let items = [];
  try {
    const r = await withTimeout(supabase.rpc('get_checkin_items'), DATA_TIMEOUT);
    if (r && r.error) throw r.error;
    if (r && r.data && r.data.ok !== false) items = r.data.items || [];
  } catch (e) {
    els.ciGrid.innerHTML = '<div class="ci-empty">打卡功能还没启用<br>' +
      '<span style="font-size:12px;color:#a9b6b0">请先在 Supabase 执行 database/140-checkin-and-dim-norm.sql</span></div>';
    return;
  }

  let dayMap = {};
  try {
    const d = await withTimeout(supabase.rpc('get_checkin_day', { p_class: cls }), DATA_TIMEOUT);
    if (d && !d.error && d.data && d.data.ok) {
      (d.data.items || []).forEach(g => { dayMap[g.id] = g.names || []; });
    }
  } catch (e) { /* 今日记录拿不到不影响打卡 */ }

  checkinState.items = items;
  checkinState.dayMap = dayMap;
  renderCheckinItems();
}

function renderCheckinItems() {
  const items = checkinState.items;
  if (!items.length) {
    els.ciGrid.innerHTML = '<div class="ci-empty">还没有打卡项<br>' +
      '<span style="font-size:12px;color:#a9b6b0">请老师在教师端「打卡管理」里添加</span></div>';
    return;
  }
  els.ciGrid.innerHTML = items.map(it => {
    const cnt = (checkinState.dayMap[it.id] || []).length;
    return `<button class="ci-item" type="button" data-id="${esc(it.id)}" data-dim="${esc(it.dim)}">
      <span class="ci-ico">${ciIcon(it)}</span>
      <span class="ci-txt">
        <span class="ci-name">${esc(it.name)}</span>
        <span class="ci-meta">
          <span class="ci-dim">${esc(CI_DIM_LABEL[it.dim] || '劳')}</span>
          <span class="ci-item-xp">+${Number(it.xp) || 0} 星光</span>
          ${cnt ? `<span>今日 ${cnt} 人</span>` : ''}
        </span>
      </span>
    </button>`;
  }).join('');
}

function openCheckinSeat(itemId) {
  const it = checkinState.items.find(x => x && x.id === itemId);
  if (!it) return;
  sfx.tap();
  checkinState.item = it;
  checkinState.picked = new Set();
  checkinState.done = new Set(checkinState.dayMap[it.id] || []);
  els.csTitle.textContent = it.name;
  els.csSub.textContent = `计入${CI_DIM_LABEL[it.dim] || '劳'}育 · 每人 +${Number(it.xp) || 0} 星光`;
  els.csHeadIcon.textContent = ciIcon(it);
  renderCsBoard();
  els.checkinModal.classList.remove('show');
  els.checkinSeatModal.classList.add('show');
  Nav.push('checkinSeat');
}

function renderCsBoard() {
  const names = (state.roster || []).map(r => r.student_name).filter(Boolean);
  if (!names.length) {
    els.csBoard.innerHTML = '<div class="ci-empty" style="grid-column:1/-1">还没读到同学名单，先回班级墙刷新一下</div>';
    els.csPool.hidden = true;
    els.csPool.innerHTML = '';
    updateCsCount();
    return;
  }

  const seatMap = state.seatMap || {};
  const slot2name = Object.create(null);
  Object.keys(seatMap).forEach(n => {
    const s = Number(seatMap[n]);
    if (Number.isFinite(s) && s >= 0) slot2name[s] = n;
  });
  const hasSeat = Object.keys(slot2name).length > 0;
  let maxSlot = 0;
  Object.keys(slot2name).forEach(k => { maxSlot = Math.max(maxSlot, Number(k)); });

  const cols = 6;
  const rows = hasSeat
    ? Math.max(7, Math.floor(maxSlot / cols) + 1)
    : Math.max(7, Math.ceil(names.length / cols));

  let html = '';
  const placed = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nm = hasSeat ? slot2name[r * cols + c] : names[r * cols + c];
      if (!nm) { html += '<div class="cs-seat empty">·</div>'; continue; }
      placed.add(nm);
      const on = checkinState.picked.has(nm) ? ' on' : '';
      const done = checkinState.done.has(nm) ? '<span class="cs-done">已记</span>' : '';
      html += `<button class="cs-seat${on}" type="button" data-name="${esc(nm)}">${done}${esc(nm)}</button>`;
    }
  }
  els.csBoard.innerHTML = html;

  const rest = names.filter(n => !placed.has(n));
  if (rest.length) {
    els.csPool.hidden = false;
    els.csPool.innerHTML = `<div class="cs-pool-tip">未排座位（${rest.length} 人）</div>` +
      rest.map(n => `<button class="cs-chip${checkinState.picked.has(n) ? ' on' : ''}" type="button" data-name="${esc(n)}">${esc(n)}</button>`).join('');
  } else {
    els.csPool.hidden = true;
    els.csPool.innerHTML = '';
  }
  updateCsCount();
}

function updateCsCount() {
  const n = checkinState.picked.size;
  els.csCount.textContent = `已选 ${n} 人`;
  els.csSubmit.disabled = n === 0;
  els.csSubmit.textContent = n ? `提交打卡（${n} 人）` : '提交打卡';
}

function closeCheckin() { els.checkinModal.classList.remove('show'); }
function closeCheckinSeat() {
  els.checkinSeatModal.classList.remove('show');
  // 从点名面板退出时回到打卡项面板，而不是直接掉回星光墙
  if (els.checkinModal) els.checkinModal.classList.add('show');
}

async function submitCs() {
  const it = checkinState.item;
  const picked = Array.from(checkinState.picked);
  if (!it || !picked.length) { toast('先点座位选人'); return; }
  const cls = state.currentClass || (els.inpClass.value || '').trim();
  if (!cls) { toast('请先选择班级'); return; }

  els.csSubmit.disabled = true;
  els.csSubmit.textContent = '正在提交…';
  try {
    const r = await withTimeout(supabase.rpc('submit_checkin', {
      p_class: cls, p_item_id: it.id, p_students: picked
    }), 30000);
    if (r.error) throw r.error;
    const d = r.data || {};
    if (!d.ok) {
      const why = { item_disabled: '这项打卡已停用', no_item: '打卡项不存在', no_students: '还没有选人' }[d.reason] || '提交失败';
      toast(why);
      updateCsCount();
      return;
    }
    let msg = `已给 ${d.added} 人记上「${it.name}」`;
    if (d.skipped) msg += `，${d.skipped} 人今天已记过`;
    if (d.missing) msg += `，${d.missing} 人不在名单`;
    toast(msg);
    sfx.tap();
    els.checkinSeatModal.classList.remove('show');
    await openCheckin(true);     // 回到打卡面板，今日人数即时刷新
    loadWall();                  // 星光值变了，顺手刷新班级墙
  } catch (e) {
    toast('提交失败，检查网络后再试一次');
    updateCsCount();
  }
}

function closeDetail() { els.detailModal.classList.remove('show'); }

async function onSubmit() {
  if (!ready) return toast('系统尚未配置完成，请联系老师');
  if (state.readonly) { sfx.oops(); return toast('老师预览模式下不能提交记录哦～'); }
  const norm = s => String(s || '').replace(/[\u3000\s]+/g, ' ').trim();
  const cls = norm(els.inpClass.value);
  const name = norm(els.inpName.value);
  if (!cls || !name) { sfx.oops(); return needIdentity(); }   // v179：点名即认人，不校验名单
  updateMood();

  const items = [];
  const tagXpOf = t => {
    const v = Number(t.xp_value);
    if (Number.isFinite(v)) return v;
    return t.category === 'negative' ? 0 : 2;
  };
  for (const t of state.tags) {
    if (t.tag_type === 'check') {
      if (state.checkChosen[t.id]) {
        const opts = state.checkOption[t.id];
        const subArr = Array.isArray(opts) ? opts : (opts ? [opts] : []);
        if (Array.isArray(t.options) && t.options.length && !subArr.length) {
          sfx.oops();
          return toast(`请为「${t.label}」再选一个具体项目`);
        }
        const subVal = subArr.join('、');
        if (Array.isArray(t.options) && t.options.length) {
          // 有二级选项：一级标题本身不加星光值，按选中的二级数量逐个加
          subArr.forEach(opt => {
            items.push({ id: t.id, label: t.label, type: 'check', value: opt, category: t.category || 'positive', xp: tagXpOf(t) });
          });
        } else {
          items.push({ id: t.id, label: t.label, type: 'check', value: subVal || null, category: t.category || 'positive', xp: tagXpOf(t) });
        }
      }
    } else {
      const v = (state.textValues[t.id] || '').trim();
      if (v) items.push({ id: t.id, label: t.label, type: 'text', value: v.slice(0, 600), category: t.category || 'positive', xp: tagXpOf(t) });
    }
  }

  // 不允许提交空白表现（星级可以不打，但至少要选一个小表现）
  if (!items.length) {
    sfx.oops();
    return toast('请先选择表现');
  }

  els.btnSubmit.disabled = true;
  els.btnSubmit.textContent = '正在提交…';
  try {
    // v107：离线时直接入队，联网后自动同步（按人按天合并，不会重复加星光值）
    if (!window.Offline || !window.Offline.online) {
      const q = await window.Offline.enqueue({
        name: 'submit_today',
        params: { p_class: cls, p_student: name, p_mood: MOOD_BY_LEVEL(state.moodLevel).key, p_items: items }
      });
      if (q) {
        sfx.success();
        toast('已离线保存，联网后同步');
        applyLocalSubmitFeedback(cls, name, items);   // v123：记录合并+即时置灰+缓存持久化
        resetSelections();
        renderMoodPreview();
        updateSubmitStatus();   // v114：本地立即标记"今天已提交"（合并后记录已包含本次）
        celebrate(0);    // v114：离线提交也显示成功浮层，学生明确知道已填报
      } else { sfx.oops(); toast('本机存储失败，请换设备试试'); }
      return;
    }
    const { data: subRes, error: insertError } = await supabase.rpc('submit_today', {
      p_class: cls,
      p_student: name,
      p_mood: MOOD_BY_LEVEL(state.moodLevel).key,
      p_items: items
    });
    if (insertError) {
      if (isNetErr(insertError)) {
        const q = await window.Offline.enqueue({ name: 'submit_today', params: { p_class: cls, p_student: name, p_mood: MOOD_BY_LEVEL(state.moodLevel).key, p_items: items } });
        if (q) { sfx.success(); toast('已离线保存，联网后同步'); applyLocalSubmitFeedback(cls, name, items); resetSelections(); renderMoodPreview(); updateSubmitStatus(); celebrate(0); return; }
      }
      sfx.oops();
      if (/row-level security|policy|is_valid_student/i.test(insertError.message)) {
        toast('这个名字不在名单里');
        needIdentity();
      } else {
        throw insertError;
      }
      return;
    }
    if (!subRes || subRes.ok === false) {
      sfx.oops();
      if (subRes && subRes.reason === 'no_student') {
        toast('这个名字不在名单里');
        needIdentity();     // 保留已勾选的表现，换个名字就能提交
      } else if (subRes && subRes.reason === 'empty_items') {
        toast('请至少选择一项表现再提交');
      } else {
        toast('提交失败，请重试');
      }
      return;
    }
    // 合并模式下提示
    if (subRes.merged) {
      // 当天已有记录，本次为补充合并
    }

    // 以服务端返回的差额星光值为准（合并场景只加新增部分）
    const gainedXp = Number(subRes.xp_delta || 0);
    if (gainedXp > 0) {
      const row = state.roster.find(s => s.class === cls && s.student_name === name);
      if (row) {
        row.xp = Number(subRes.xp != null ? subRes.xp : (Number(row.xp) || 0) + gainedXp);
        row.star = (Number(row.star) || 0) + Math.max(0, gainedXp);
      }
      state.wallet.balance = (Number(state.wallet.balance) || 0) + Math.max(0, gainedXp);
      state.wallet.total_earned = (Number(state.wallet.total_earned) || 0) + Math.max(0, gainedXp);
      renderIdentityLevel();
    }

    try { localStorage.setItem('sp_identity', JSON.stringify({ class: cls, studentName: name })); } catch (e) {}
    sfx.success();
    celebrate(gainedXp);
    resetSelections();
    renderMoodPreview();
    // 方案A：本地增量更新，不再全量重拉（提交秒级完成）
    // v128(RSK-08)：以服务端 record_date 为"今日"基准，墙的今日判定与服务端一致
    if (subRes.record_date) state.serverToday = String(subRes.record_date).slice(0, 10);
    mergeLocalRecord(cls, name, items, MOOD_BY_LEVEL(state.moodLevel).key, state.serverToday);
    // 置灰：本次提交的不可重复项直接加入 doneItems（本地），标签区就地重渲染
    items.forEach(it => {
      const tg = (state.tags || []).find(x => String(x.id) === String(it.id));
      if (tg && tg.history_unique !== false) {
        if (!state.doneItems[tg.id]) state.doneItems[tg.id] = new Set();
        state.doneItems[tg.id].add(it.value || null);
      }
    });
    renderTagGrid();
    renderWall();  // 本地重绘头像墙（星光值/条数/评语即时更新）
    // v145(RSK-15)：提交成功即同步本地墙缓存（带 cachedAt，刷新不丢本次记录）
    try {
      const wallSnap = { roster: state.roster, records: state.records, seatMap: state.seatMap, tasks: state.todayTaskDefs, cachedAt: Date.now() };
      localStorage.setItem(wallCacheKey(cls), JSON.stringify(wallSnap));
      window.Offline.set(wallKey(cls), Object.assign({}, wallSnap, { subs: state.todayTaskSubs }));
    } catch (eCache) {}
    loadProfile();// 成就/头像框（单请求，轻量）
    loadWallet();  // v167：同步星光值余额
    loadClassProgress();  // v167：同步班级星光值/等级/抽奖机会
    // 后台静默全量同步一次（多设备/教师评语一致性，不阻塞界面）
    if (window.Offline && window.Offline.online) {
      setTimeout(() => { try { loadWall(); } catch (e3) {} }, 2500);
    }
  } catch (e) {
    // 断网/网络错误：先入队，联网自动补传（按人按天合并，不会重复加星光值）
    const offline = isNetErr(e);
    if (offline) {
      const q = await window.Offline.enqueue({ name: 'submit_today', params: { p_class: cls, p_student: name, p_mood: MOOD_BY_LEVEL(state.moodLevel).key, p_items: items } });
      if (q) { sfx.success(); toast('已离线保存，联网后同步'); applyLocalSubmitFeedback(cls, name, items); resetSelections(); renderMoodPreview(); updateSubmitStatus(); celebrate(0); }
      else { sfx.oops(); toast('本机存储失败，请换设备试试'); }
    } else {
      sfx.oops();
      toast('提交失败：' + ((e && e.message) || '请稍后再试'));
    }
  } finally {
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = '提交今天的表现';
  }
}

// 启动时 + 联网时，把本机待上传的操作补传（统一队列）
async function flushPending() {
  await flushOfflineQueue();
}
window.addEventListener('online', flushPending);

function resetSelections() {
  state.stars = 0;
  state.checkChosen = {};
  state.checkOption = {};
  state.textValues = {};
  renderStars();
  if (els.starCaption) els.starCaption.textContent = '';
  [els.posGrid, els.negGrid].forEach(grid => {
    grid.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
    grid.querySelectorAll('.sub-chip.active').forEach(c => c.classList.remove('active'));
    grid.querySelectorAll('.sub-options').forEach(s => { s.hidden = true; });
  });
  els.textTagsBox.querySelectorAll('input').forEach(i => { i.value = ''; });
  updateMood();
}

function prefillIdentity() {
  try {
    const saved = JSON.parse(localStorage.getItem('sp_identity') || 'null');
    if (saved) {
      els.inpClass.value = saved.class || '';
      els.inpName.value = saved.studentName || '';
    }
  } catch (e) {}
}

/* ---------- 鼓励动画 ---------- */

function celebrate(gainedXp) {
  const emojis = ['' + I.star() + '', '' + I['star-fill']() + '', '' + I.sparkle() + '', '' + I.sparkle() + '', '' + I.heart() + '', '' + I.rainbow() + '', '' + I.thumb() + '', '' + I.school() + '', '' + I.book() + ''];
  els.confettiBox.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.fontSize = (16 + Math.random() * 20) + 'px';
    piece.style.animationDuration = (2.4 + Math.random() * 2) + 's';
    piece.style.animationDelay = (Math.random() * 0.7) + 's';
    els.confettiBox.appendChild(piece);
  }
  let msg;
  if (gainedXp > 0) {
    msg = `本次获得 ${gainedXp} 星光值 · 现有 ${state.wallet.balance}`;
  } else {
    const pool = PRAISE[MOOD_BY_LEVEL(state.moodLevel).key] || PRAISE.good;
    msg = pool[Math.floor(Math.random() * pool.length)];
  }
  els.successMsg.textContent = msg;
  els.successOverlay.classList.add('show');
  Nav.push('success');   // RSK-10：提交成功浮层
  // 点任意处跳过庆祝
  const dismiss = () => {
    els.successOverlay.classList.remove('show');
    els.confettiBox.innerHTML = '';
    els.successOverlay.removeEventListener('click', dismiss);
  };
  els.successOverlay.addEventListener('click', dismiss);
  setTimeout(dismiss, 5200);
}

/* ---------- 工具 ---------- */

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayLabel() {
  const d = new Date();
  const w = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${w[d.getDay()]}`;
}
function formatDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const isToday = y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate();
  return `${m}月${d}日 星期${['日','一','二','三','四','五','六'][date.getDay()]}${isToday ? '（今天）' : ''}`;
}
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  msg = String(msg == null ? '' : msg).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\s{2,}/g, ' ').trim();
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ================= 今日学习任务 ================= */
const TASK_GRADES = [
  { key: 'none',    label: '还没做',   icon: I.hourglass() },
  { key: 'done',    label: '完成了',   icon: I['check-circle']() },
  { key: 'good',    label: '优秀 A',   icon: I.thumb() },
  { key: 'perfect', label: '完美 A+',  icon: I.trophy() }
];

async function loadStudentTask() {
  if (!els.taskCard) return;
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (!cls || !name) { els.taskCard.hidden = true; return; }
  els.taskCard.hidden = false;
  els.taskBody.innerHTML = '<div class="loading-row"><span class="spinner"></span>正在加载今日任务…</div>';
  let data;
  try {
    // SDK 网络失败返回 {data:null,error} 而不抛异常：必须显式检查 error，否则离线不回退缓存
    const r = await supabase.rpc('get_today_task', { p_class: cls, p_student: name });
    if (r && !r.error && r.data) {
      data = r.data;
      await window.Offline.set('task_' + cls + '_' + name, { data });
      try { localStorage.setItem('sp_task_' + cls + '_' + name, JSON.stringify(data)); } catch(e) {}
    } else { data = null; }
  } catch (e) { data = null; }
  if (!data) {
    // v111：任务缓存按 班级+姓名 隔离，避免离线时 A 的完成状态显示给 B
    const v = await window.Offline.get('task_' + cls + '_' + name);
    data = (v && v.data) || null;
    if (!data) { try { data = JSON.parse(localStorage.getItem('sp_task_' + cls + '_' + name) || 'null'); } catch(e2) { data = null; } }
  }
  if (!data) {
    // v114 兜底：个人任务缓存缺失时（如预缓存未完成），用班级墙里的今日任务定义，状态显示"还没做"
    const w = await window.Offline.get(wallKey(cls));
    const wt = (w && w.tasks) || [];
    if (wt.length) {
      data = { tasks: wt.map(t => ({ id: t.id, title: t.title, detail: t.detail, task_type: t.task_type, my_grade: 'none' })) };
    }
  }
  const tasks = (data && data.tasks) || [];
  const normal = tasks.filter(t => t.task_type !== 'recite' && t.task_type !== 'dictation');
  const recite = tasks.filter(t => t.task_type === 'recite');
  const dict = tasks.filter(t => t.task_type === 'dictation');

  function cardHtml(list, short) {
    if (!list.length) return null;
    return list.map(t => {
      const my = t.my_grade || 'none';
      const grades = short
        ? [['none','' + I.hourglass() + ' 未完成'],['done','' + I['check-circle']() + ' 完成']]
        : [['none','' + I.hourglass() + ' 还没做'],['done','' + I['check-circle']() + ' 完成了'],['good','' + I.thumb() + ' 优秀 A'],['perfect','' + I.trophy() + ' 完美 A+']];
      const done = my && my !== 'none';
      return `<div class="stu-task${done ? ' done' : ''}">
        <div class="stu-task-title">${escapeHtml(t.title)}</div>
        ${t.detail ? `<div class="stu-task-detail">${escapeHtml(t.detail)}</div>` : ''}
        <div class="stu-task-grades">` +
        grades.map(([k,label]) => `<button type="button" class="stu-task-grade ${k===my?'on':''}" data-grade="${k}" data-task="${t.id}">${label}</button>`).join('') +
        `</div><div class="stu-task-result" data-result="${t.id}"></div></div>`;
    }).join('');
  }

  els.taskCard.hidden = !normal.length;
  els.taskBody.innerHTML = normal.length ? cardHtml(normal, false) : '';
  els.reciteTaskCard.hidden = !recite.length;
  els.reciteTaskBody.innerHTML = recite.length ? cardHtml(recite, true) : '';
  els.dictationTaskCard.hidden = !dict.length;
  els.dictationTaskBody.innerHTML = dict.length ? cardHtml(dict, true) : '';

  document.querySelectorAll('.stu-task-grade').forEach(btn => {
    btn.addEventListener('click', () => onPickTaskGrade(btn.dataset.grade, btn.dataset.task, btn));
  });
}

async function onPickTaskGrade(grade, taskId, btn) {
  const cls = els.inpClass.value.trim();
  const name = els.inpName.value.trim();
  if (state.readonly) { sfx.oops(); toast('预览模式不能提交哦～'); return; }
  // v178(C2)：评分档位白名单——非法值不发请求（原先直接落到服务端 check 约束）
  if (['none', 'done', 'good', 'perfect'].indexOf(grade) < 0) { sfx.oops(); toast('评分无效'); return; }
  // v178(F-01)：与购买链路一致——无身份不发请求；v179 改为点名后自动续做
  if (!cls || !name) { sfx.oops(); return needIdentity(() => onPickTaskGrade(grade, taskId, btn)); }
  // "还没做"也提交：用于撤销之前的评分、回退星光值
  const wr = await runWrite({ name: 'submit_task', params: { p_class: cls, p_student: name, p_task_id: taskId, p_grade: grade } });
  if (!wr.ok) { sfx.oops(); toast(taskFailText(wr.res)); return; }
  const d = wr.res || {};
  sfx.pick();
  // 已评(非"还没做")任务卡片置灰；撤销评分则恢复
  const cardEl = btn.closest('.stu-task');
  if (cardEl) cardEl.classList.toggle('done', grade !== 'none');
  const resultEl = document.querySelector(`[data-result="${taskId}"]`);
  if (resultEl) {
    if (grade === 'none') {
      resultEl.textContent = '任务未完成';
    } else if (wr.queued) {
      resultEl.textContent = '已离线保存，联网后自动同步';
      // 离线：本地即时反映状态（按钮高亮 + 缓存），联网后以服务端为准
      document.querySelectorAll(`.stu-task-grade[data-task="${taskId}"]`).forEach(b => b.classList.toggle('on', b.dataset.grade === grade));
      try {
        const v = await window.Offline.get('task_' + cls + '_' + name);
        if (v && v.data && Array.isArray(v.data.tasks)) {
          v.data.tasks.forEach(t => { if (t.id === taskId) t.my_grade = grade; });
          await window.Offline.set('task_' + cls + '_' + name, v);
          try { localStorage.setItem('sp_task_' + cls + '_' + name, JSON.stringify(v.data)); } catch (e2) {}
        }
      } catch (e3) {}
    } else {
      const xpGain = (d.xp_delta || 0) > 0 ? ' 星光值+' + d.xp_delta : '';
      resultEl.textContent = grade === 'perfect' ? `完美完成${xpGain}`
                          : grade === 'good'    ? `完成良好${xpGain}`
                          :                       `已完成${xpGain}`;
      if (d.mood_awarded) resultEl.textContent += ' 心情+1';
    }
  }
  const row = state.roster.find(s => s.class === cls && s.student_name === name);
  if (!wr.queued && row && typeof d.xp === 'number') { row.xp = d.xp; }
  renderIdentityLevel();
  loadProfile();
  loadStudentTask();
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============ 天气联动主题（v21：自动读洞口县实时天气，可手动切换兜底） ============ */
(function () {
  var THEMES = ['sunny', 'cloudy', 'rainy', 'snowy'];
  var LABELS = { sunny: '晴', cloudy: '多云', rainy: '雨', snowy: '雪' };
  var root = document.documentElement;
  var deco = document.getElementById('skyDeco');
  var btn = document.getElementById('weatherSwitch');
  var flowerL = document.getElementById('flowerLeft');
  var flowerR = document.getElementById('flowerRight');
  if (!deco || !btn) return;
  var AUTO_KEY = 'sp_weather_auto';

  function codeToTheme(c) {
    c = Number(c);
    if (c === 0 || c === 1) return 'sunny';
    if (c === 2 || c === 3 || c === 45 || c === 48) return 'cloudy';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) return 'rainy';
    if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return 'snowy';
    return 'sunny';
  }

  // 分层均匀分布：n 个粒子把区域均匀分层，每层内随机抖动（近似均匀）
  function layerPos(i, n, jitter) {
    var seg = 100 / n;
    return seg * i + (Math.random() - 0.5) * seg * (jitter || 1);
  }

  /* ============ v173：雨 / 雪 Canvas 粒子引擎（重写） ============
     上一版的问题：
       1) 用 'lighter' 叠加 + 近白色描边，在浅色页面上几乎看不见；
       2) 画布压在内容层之下，雨雪只能出现在页面空白处；
       3) 雨丝过短且几乎无风，看起来像飘浮光点。
     本版做法：
       · source-over 正常混合，雨用深蓝灰、雪用"白心 + 淡蓝描边"，浅底可见；
       · 雨丝按风向倾斜，三层景深（远细短淡 / 近粗长浓）；
       · 雪花按瓣预渲染成离屏精灵，逐片缩放 + 旋转，避免每帧画矢量；
       · 密度按视口面积自适应，DPR 上限 2，reduced-motion 停用。 */
  var wxCanvas = document.getElementById('wxCanvas');
  var wxCtx = wxCanvas ? wxCanvas.getContext('2d') : null;
  var wxParticles = [];
  var wxMode = '';            // '' | 'rain' | 'snow'
  var wxRunning = false;
  var wxRafId = 0, wxLastT = 0, wxAcc = 0;
  var wxDPR = Math.min(window.devicePixelRatio || 1, 2);
  var wxW = 0, wxH = 0, wxMax = 400;
  var wxReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wxSnowSprites = [];

  var WX_CFG = {
    rain: {
      areaPer: 3600, maxN: 480,
      layers: [
        { share: 0.50, w: 1.0, lenMin: 10, lenMax: 16, spdMin: 560,  spdMax: 720,  vx: 20, alpha: 0.30 },
        { share: 0.34, w: 1.5, lenMin: 19, lenMax: 28, spdMin: 900,  spdMax: 1150, vx: 30, alpha: 0.42 },
        { share: 0.16, w: 2.2, lenMin: 32, lenMax: 48, spdMin: 1350, spdMax: 1700, vx: 42, alpha: 0.55 }
      ]
    },
    snow: {
      // v188：鹅毛大雪——雪团更大、下落更慢、横向飘移更明显，密度略降避免糊成一片
      areaPer: 5500, maxN: 320,
      layers: [
        { share: 0.46, rMin: 6.5, rMax: 10,  spdMin: 15, spdMax: 25, sway: 16, alpha: 0.55, spin: 0.12 },
        { share: 0.34, rMin: 11,  rMax: 16,  spdMin: 25, spdMax: 37, sway: 24, alpha: 0.74, spin: 0.10 },
        { share: 0.20, rMin: 17,  rMax: 25,  spdMin: 37, spdMax: 52, sway: 34, alpha: 0.95, spin: 0.08 }
      ]
    }
  };
  var WX_WIND = 18;           // 雪的横向漂移（px/s）
  var WX_SNOW_R = [9.5, 14.5, 21.5];   // 三层雪团精灵的参考半径

  /* 雪团精灵：多个大小不一的偏移圆叠出不规则蓬松轮廓，外圈只留很淡的冷调柔影
     （不做硬边），内部左上高光、右下微蓝，得到「鹅毛大雪」的棉絮块感。
     每层生成 3 个形状变体，避免同形重复被一眼看穿。 */
  var WX_SNOW_VAR = 3;        // 每层精灵变体数
  function wxBuildSnowSprites() {
    if (wxSnowSprites.length) return;
    try {
      if (!document.createElement('canvas').getContext) return;
    } catch (e) { return; }
    for (var k = 0; k < WX_SNOW_R.length; k++) {
      for (var v = 0; v < WX_SNOW_VAR; v++) wxBuildOneSnowSprite(WX_SNOW_R[k]);
    }
  }

  function wxBuildOneSnowSprite(r) {
    var pad = r * 0.66;
    var size = Math.ceil((r + pad) * 2);
    var cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(size * wxDPR);
    var c = cv.getContext('2d');
    c.scale(wxDPR, wxDPR);
    var cx = size / 2, cy = size / 2;

    // ① 软边凸起：实心白心 + 边缘渐隐（极淡冷调收尾），叠起来是一整团而不是一堆小球
    function puff(lx, ly, pr) {
      var lg = c.createRadialGradient(lx, ly, pr * 0.05, lx, ly, pr);
      lg.addColorStop(0, 'rgba(255,255,255,1)');
      lg.addColorStop(0.66, 'rgba(255,255,255,.98)');
      lg.addColorStop(0.86, 'rgba(248,253,255,.74)');
      lg.addColorStop(0.95, 'rgba(214,232,249,.34)');
      lg.addColorStop(1, 'rgba(200,222,244,0)');
      c.fillStyle = lg;
      c.beginPath(); c.arc(lx, ly, pr, 0, Math.PI * 2); c.fill();
    }
    c.save();
    puff(cx, cy, r * 1.00);                       // 中心主团
    var lobes = 5 + Math.round(Math.random() * 4);
    for (var j = 0; j < lobes; j++) {
      var a = (j / lobes) * Math.PI * 2 + Math.random() * 0.8;
      var dist = r * (0.30 + Math.random() * 0.40);
      var rr = r * (0.52 + Math.random() * 0.26);
      puff(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, rr);
    }
    // 边缘碎絮：2~3 个小凸起，破掉圆感
    var nub = 2 + Math.round(Math.random() * 1);
    for (var m = 0; m < nub; m++) {
      var na = Math.random() * Math.PI * 2;
      puff(cx + Math.cos(na) * r * 0.86, cy + Math.sin(na) * r * 0.86,
           r * (0.30 + Math.random() * 0.16));
    }
    c.restore();

    // ② 左上受光、右下略沉，给整团一点体积
    c.globalCompositeOperation = 'source-atop';
    var g = c.createRadialGradient(cx - r * 0.34, cy - r * 0.38, r * 0.05, cx, cy, r * 1.05);
    g.addColorStop(0, 'rgba(255,255,255,.60)');
    g.addColorStop(0.55, 'rgba(255,255,255,.10)');
    g.addColorStop(1, 'rgba(206,226,246,.22)');
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    c.globalCompositeOperation = 'source-over';

    wxSnowSprites.push({ cv: cv, size: size, r0: r });
  }

  function wxResize() {
    if (!wxCanvas || !wxCtx) return;
    wxW = window.innerWidth; wxH = window.innerHeight;
    wxCanvas.width = Math.round(wxW * wxDPR);
    wxCanvas.height = Math.round(wxH * wxDPR);
    wxCanvas.style.width = wxW + 'px';
    wxCanvas.style.height = wxH + 'px';
    wxCtx.setTransform(wxDPR, 0, 0, wxDPR, 0, 0);
    var cfg = WX_CFG[wxMode];
    wxMax = cfg ? Math.max(60, Math.min(cfg.maxN, Math.round((wxW * wxH) / cfg.areaPer))) : 300;
  }

  /* 按 share 抽层：远层多、近层少，形成景深 */
  function wxPickLayer(cfg) {
    var rnd = Math.random(), acc = 0, li = 0;
    for (var k = 0; k < cfg.layers.length; k++) {
      acc += cfg.layers[k].share;
      li = k;
      if (rnd <= acc) break;
    }
    return li;
  }

  function wxSpawn(force) {
    var cfg = WX_CFG[wxMode];
    if (!cfg || wxParticles.length >= wxMax) return;
    var li = wxPickLayer(cfg);
    var L = cfg.layers[li];
    var p = {
      l: li,
      x: Math.random() * (wxW + 80) - 40,
      y: force ? Math.random() * wxH : -40 - Math.random() * 50,
      phase: Math.random() * Math.PI * 2,
      alpha: L.alpha * (0.82 + Math.random() * 0.36)
    };
    if (wxMode === 'rain') {
      p.len = L.lenMin + Math.random() * (L.lenMax - L.lenMin);
      p.vy = L.spdMin + Math.random() * (L.spdMax - L.spdMin);
      p.vx = L.vx;
    } else {
      p.r = L.rMin + Math.random() * (L.rMax - L.rMin);
      p.vy = L.spdMin + Math.random() * (L.spdMax - L.spdMin);
      p.vx = WX_WIND + (Math.random() - 0.5) * 16;
      p.sway = L.sway * (0.7 + Math.random() * 0.7);
      p.swayFreq = 0.4 + Math.random() * 0.7;
      p.spin = L.spin ? (Math.random() < 0.5 ? -1 : 1) * L.spin * (0.6 + Math.random() * 0.8) : 0;
      p.rot = Math.random() * Math.PI * 2;
      p.spr = li * WX_SNOW_VAR + Math.floor(Math.random() * WX_SNOW_VAR);   // 该层随机取一个形状变体
    }
    wxParticles.push(p);
  }

  /* 生成速率：按"填满屏幕一次要多久"反推，避免开头空场或过密 */
  function wxRate() {
    var cfg = WX_CFG[wxMode];
    if (!cfg) return 0;
    var life = Math.max(0.9, wxH / (wxMode === 'rain' ? 950 : 32));
    return wxMax / life;
  }

  function wxDrawRain(t) {
    var cfg = WX_CFG.rain;
    for (var li = 0; li < cfg.layers.length; li++) {
      var L = cfg.layers[li];
      var avgVy = (L.spdMin + L.spdMax) / 2;
      wxCtx.strokeStyle = 'rgba(74,124,190,' + L.alpha + ')';
      wxCtx.lineWidth = L.w;
      wxCtx.lineCap = 'round';
      wxCtx.beginPath();
      var drew = false;
      for (var i = 0; i < wxParticles.length; i++) {
        var p = wxParticles[i];
        if (p.l !== li) continue;
        var dx = (p.vx / avgVy) * p.len;   // 雨丝顺着风向倾斜
        wxCtx.moveTo(p.x + dx, p.y - p.len);
        wxCtx.lineTo(p.x, p.y);
        drew = true;
      }
      if (drew) wxCtx.stroke();
    }
  }

  function wxDrawSnow(t) {
    wxBuildSnowSprites();
    for (var i = 0; i < wxParticles.length; i++) {
      var p = wxParticles[i];
      var sp = wxSnowSprites[p.spr] || wxSnowSprites[p.l * WX_SNOW_VAR] || wxSnowSprites[0];
      if (!sp) continue;
      var k = p.r / sp.r0;
      var sz = sp.size * k;
      var sway = Math.sin(t * p.swayFreq + p.phase) * p.sway;
      var x = p.x + sway, y = p.y;
      wxCtx.globalAlpha = Math.min(1, p.alpha);
      if (p.spin) {
        wxCtx.save();
        wxCtx.translate(x, y);
        wxCtx.rotate(p.rot);
        wxCtx.drawImage(sp.cv, -sz / 2, -sz / 2, sz, sz);
        wxCtx.restore();
      } else {
        wxCtx.drawImage(sp.cv, x - sz / 2, y - sz / 2, sz, sz);
      }
    }
    wxCtx.globalAlpha = 1;
  }

  function wxFrame(now) {
    if (!wxRunning) return;              // 停止后不再自续 raf（避免双循环）
    wxRafId = requestAnimationFrame(wxFrame);
    var dt = Math.min((now - wxLastT) / 1000, 0.05);
    wxLastT = now;
    var cfg = WX_CFG[wxMode];
    if (!cfg) return;

    wxAcc += wxRate() * dt;
    while (wxAcc >= 1) { wxSpawn(false); wxAcc -= 1; }

    wxCtx.clearRect(0, 0, wxW, wxH);
    var t = now / 1000;
    var i = wxParticles.length;
    while (i--) {
      var p = wxParticles[i];
      p.y += p.vy * dt;
      if (wxMode === 'snow') {
        p.x += (p.vx + Math.sin(t * p.swayFreq + p.phase) * p.sway) * dt;
        p.rot += p.spin * dt;
      } else {
        p.x += p.vx * dt;
      }
      if (p.y > wxH + 50 || p.x < -140 || p.x > wxW + 140) {
        wxParticles.splice(i, 1);
      }
    }

    if (wxMode === 'rain') wxDrawRain(t);
    else wxDrawSnow(t);
  }

  function wxStart(mode) {
    if (!wxCanvas || !wxCtx || wxReduced) return;
    if (wxMode === mode && wxRunning) return;
    wxMode = mode;
    wxParticles = [];
    wxAcc = 0;
    wxResize();
    if (mode === 'snow') wxBuildSnowSprites();
    // 首屏先铺 55%，剩下交给生成速率补齐，避免开场全空
    var seed = Math.min(wxMax, Math.round(wxMax * 0.62));
    for (var k = 0; k < seed; k++) wxSpawn(true);
    if (!wxRunning) {
      wxRunning = true;
      wxLastT = performance.now();
      wxRafId = requestAnimationFrame(wxFrame);
    }
  }

  function wxStop() {
    if (wxMode === '' && !wxRunning) return;
    wxMode = '';
    wxRunning = false;
    wxParticles = [];
    if (wxCtx) wxCtx.clearRect(0, 0, wxW, wxH);
  }

  window.addEventListener('resize', wxResize);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { wxRunning = false; }
    else if (wxMode) { wxRunning = true; wxLastT = performance.now(); wxRafId = requestAnimationFrame(wxFrame); }
  });

  function renderDeco(w) {
    deco.innerHTML = '';
    var narrow = window.innerWidth <= 900;
    var i, el;
    if (w === 'sunny') {
      var n = narrow ? 16 : 30;
      for (i = 0; i < n; i++) {
        el = document.createElement('span');
        el.className = 'star' + (i % 3 === 0 ? ' tw' : '');
        el.style.left = Math.max(0, Math.min(100, layerPos(i, n, 1.4))) + '%';
        el.style.top = Math.max(0, Math.min(100, layerPos((i * 7) % n, n, 1.4))) + '%';
        el.style.width = el.style.height = (2 + Math.random() * 3.5) + 'px';
        el.style.animationDuration = (6 + Math.random() * 8) + 's';
        el.style.animationDelay = (Math.random() * 8) + 's';
        deco.appendChild(el);
      }
      /* 太阳光斑：大号柔和金色光晕，均匀分布于页面（卡片后方） */
      var gn = narrow ? 2 : 4;
      var glowLeft = narrow ? [15, 85] : [6, 32, 68, 94];
      for (i = 0; i < gn; i++) {
        el = document.createElement('span');
        el.className = 'sun-glow';
        el.style.left = glowLeft[i] + '%';
        el.style.top = (8 + i * 22 + Math.random() * 8) + '%';
        el.style.width = el.style.height = (narrow ? 90 : 150 + i * 40) + 'px';
        el.style.animationDelay = (Math.random() * 4) + 's';
        deco.appendChild(el);
      }
    }
    if (w === 'rainy') {
      wxStart('rain');     // v3.0：Canvas 雨滴粒子（发光雨丝）
      return;
    }
    if (w === 'snowy') {
      wxStart('snow');     // v3.0：Canvas 雪花粒子（发光光点）
      return;
    }
    wxStop();
  }

  function setTheme(w, manual) {
    if (THEMES.indexOf(w) < 0) w = 'sunny';
    root.setAttribute('data-weather', w);
    if (flowerL) flowerL.src = 'assets/flowers/flower-' + w + '.webp';
    if (flowerR) flowerR.src = 'assets/flowers/flower-' + w + '.webp';
    renderDeco(w);
    btn.title = '天气：' + (LABELS[w] || w) + '（点按切换）';
    if (manual) {
      try { localStorage.setItem(AUTO_KEY, w + ':' + Date.now()); } catch (e) {}
    }
  }

  // 手动切换（演示/离线兜底；点击后 30 分钟内保持手动，之后恢复自动）
  var manualUntil = 0;
  var savedTheme = 'sunny';
  try {
    var mv = localStorage.getItem(AUTO_KEY);
    if (mv && mv.indexOf(':') > 0) {
      var parts = mv.split(':');
      manualUntil = Number(parts[1]) || 0;
      if (manualUntil > Date.now()) savedTheme = parts[0];
    }
  } catch (e) {}
  // 初始立即应用（默认/记忆主题），避免等待天气接口期间页面保持裸状态
  setTheme(savedTheme, false);
  btn.addEventListener('click', function () {
    var cur = root.getAttribute('data-weather') || 'sunny';
    var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    manualUntil = Date.now() + 30 * 60 * 1000;
    setTheme(next, true);
  });

  // 自动获取湖南省洞口县实时天气（Open-Meteo，免 key、支持跨域）
  var done = false;
  function fetchWeather() {
    if (done) return;
    done = true;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 7000) : null;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=27.0572&longitude=110.5759&current_weather=true', ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var code = d && d.current_weather && d.current_weather.weathercode;
        if (code !== undefined) setTheme(codeToTheme(code), false);
      })
      .catch(function () {
        if (Date.now() >= manualUntil) setTheme('sunny', false);  // 获取失败且未手动指定 → 默认晴天
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  fetchWeather();
})();
/* ============ v152.3：雏菊榜单（左：星光榜 / 右：挑战榜） ============ */
let lbCurrentStudent = '';

function openLeaderboard(kind) {
  const cls = (els.inpClass ? els.inpClass.value : '') || '';
  const name = (els.inpName ? els.inpName.value : '') || '';
  lbCurrentStudent = name;
  els.leaderboardModal.classList.add('show');
  if (kind === 'xp') {
    els.lbTitle.textContent = '星光榜';
    els.lbSub.textContent = cls ? cls + ' 全班累计星光值排名' : '全班累计星光值排名';
    els.lbIcon.textContent = '';
    loadLeaderboardXp(cls);
  } else {
    els.lbTitle.textContent = '挑战榜';
    els.lbSub.textContent = '点击榜单查看最高档位排名';
    els.lbIcon.textContent = '';
    loadLeaderboardChallenge(cls);
  }
}

async function loadLeaderboardXp(cls) {
  const box = els.leaderboardBody;
  box.innerHTML = '<div class="lb-empty">正在加载…</div>';
  if (!cls) { box.innerHTML = '<div class="lb-empty">请先选择班级</div>'; return; }
  let rows = [];
  try {
    const r = await supabase
      .from('student_info')
      .select('student_name,xp,level')
      .eq('class', cls)
      .order('xp', { ascending: false });
    if (!r.error) rows = r.data || [];
  } catch (e) {}
  if (!rows.length) { box.innerHTML = '<div class="lb-empty">暂无学生数据</div>'; return; }
  // v167.3：没有星光值就不排名——只对有星光值（xp>0）的同学排位，相同星光值并列同名次
  const ranked = rows.filter(s => (Number(s.xp) || 0) > 0);
  if (!ranked.length) {
    box.innerHTML = '<div class="lb-empty">暂无星光值，暂不排名</div>';
    return;
  }
  const medal = ['' + I.medal('rk rk1') + '', '' + I.medal('rk rk2') + '', '' + I.medal('rk rk3') + ''];
  let rank = 0, prevXp = null;
  box.innerHTML = ranked.map((s, i) => {
    const xp = Number(s.xp) || 0;
    if (prevXp === null || xp !== prevXp) { rank = i + 1; prevXp = xp; }
    const topCls = rank <= 3 ? `top${rank}` : '';
    const rankTxt = rank <= 3 ? medal[rank - 1] : rank;
    return `
    <div class="lb-row ${s.student_name === lbCurrentStudent ? 'me' : ''}">
      <span class="lb-rank ${topCls}">${rankTxt}</span>
      <span class="lb-name">${esc(s.student_name)}</span>
      <span class="lb-val">${I.star()}${xp}</span>
    </div>`;
  }).join('');
}

async function loadLeaderboardChallenge(cls) {
  const box = els.leaderboardBody;
  box.innerHTML = '<div class="lb-empty">正在加载…</div>';
  if (!cls) { box.innerHTML = '<div class="lb-empty">请先选择班级</div>'; return; }
  let rows = [];
  try {
    const r = await supabase
      .from('challenge_task')
      .select('id,title,task_date,status,student_name,max_level,done_levels')
      .eq('class', cls)
      .neq('status', 'cancelled');
    if (!r.error) rows = r.data || [];
  } catch (e) {}
  if (!rows.length) { box.innerHTML = '<div class="lb-empty">暂无挑战任务</div>'; return; }
  const groups = new Map();
  rows.forEach(t => {
    const key = t.title;
    if (!groups.has(key)) groups.set(key, { title: key, date: t.task_date || '', items: [] });
    groups.get(key).items.push(t);
  });
  const list = Array.from(groups.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  box.innerHTML = `
    <button type="button" class="lb-back" data-lb-back style="display:none;">${I['arrow-left']()} 返回榜单列表</button>
    <div id="lbList">${list.map(g => `
      <div class="lb-challenge-item" data-lb-challenge="${esc(g.title)}">
        <div class="lb-c-title">${I.trophy()} ${esc(g.title)}</div>
        <div class="lb-c-meta">${esc(g.date || '')} · ${g.items.length} 名学生参与</div>
      </div>`).join('')}</div>
    <div id="lbDetail" style="display:none"></div>`;
  box.querySelectorAll('[data-lb-challenge]').forEach(item => item.addEventListener('click', () => {
    sfx.tap();
    renderChallengeDetail(list, item.dataset.lbChallenge);
  }));
  box.querySelector('[data-lb-back]').addEventListener('click', () => {
    sfx.tap();
    document.getElementById('lbList').style.display = '';
    document.getElementById('lbDetail').style.display = 'none';
    box.querySelector('[data-lb-back]').style.display = 'none';
    els.lbSub.textContent = '点击榜单查看最高档位排名';
  });
}

function renderChallengeDetail(list, title) {
  const box = els.leaderboardBody;
  const g = list.find(x => x.title === title);
  if (!g) return;
  const medal = ['' + I.medal('rk rk1') + '', '' + I.medal('rk rk2') + '', '' + I.medal('rk rk3') + ''];
  const items = g.items.slice().sort((a, b) => {
    const ma = Number(a.max_level) || -1, mb = Number(b.max_level) || -1;
    return mb - ma;
  });
  document.getElementById('lbList').style.display = 'none';
  document.getElementById('lbDetail').style.display = '';
  document.getElementById('lbDetail').innerHTML = `
    <div class="lb-c-title" style="margin:4px 0 8px;">${I.trophy()} ${esc(title)} <span style="font-weight:400;color:#8a7a66;font-size:12px;">按最高档位排名</span></div>
    ${items.map((s, i) => {
      const lv = Number(s.max_level) || 0;
      const done = (Array.isArray(s.done_levels) ? s.done_levels : []).length;
      return `<div class="lb-row ${s.student_name === lbCurrentStudent ? 'me' : ''}">
        <span class="lb-rank ${i < 3 ? 'top' + (i + 1) : ''}">${i < 3 ? medal[i] : (i + 1)}</span>
        <span class="lb-name">${esc(s.student_name)}</span>
        <span class="lb-val">${lv ? lv + '档' : '未达成'}</span>
        ${done ? `<span class="text-muted" style="font-size:11px;">达成${done}档</span>` : ''}
      </div>`;
    }).join('')}`;
  box.querySelector('[data-lb-back]').style.display = '';
  els.lbSub.textContent = '「' + title + '」最高档位排名';
}
