/* ============================================================================
 * 自制图标系统 · icons.js
 * ----------------------------------------------------------------------------
 * 设计规范（全站统一，勿单独改某个图标的线宽/圆角）：
 *   · 画布 24×24，可视区 2–22，四周留 2 的呼吸位
 *   · 主形描边 1.7（由 .ico 的 CSS 统一注入，符号内不写 stroke-width）
 *   · 端点/拐角全部 round；不使用尖角、不使用渐变、不使用投影
 *   · 辅形用 fill="currentColor" fill-opacity=".14" 做轻填充，形成双色层次
 *   · 颜色一律走 currentColor —— 白底深字、深底白字、选中态主色，自动跟随
 * 用法：
 *   I.star()                        → <svg class="ico"><use href="#i-star"/></svg>
 *   I.star('ico-lg')                → 追加类名
 *   I.mood(5) / I.rank(1)           → 语义化快捷方式
 * ========================================================================== */
(function () {
  'use strict';

  /* --- 图形本体：键名即 symbol id 的后半段 ------------------------------- */
  var S = {

    /* ---------- 基础操作 ---------- */
    check: '<path d="M5 12.6l4.5 4.5L19 7.6"/>',
    'check-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M8.2 12.4l2.7 2.7L16 9.3"/>',
    'check-square': '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4"/><path d="M8 12.4l2.8 2.8L16.2 9.4"/>',
    close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>',
    'x-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
    plus: '<path d="M12 5.6v12.8M5.6 12h12.8"/>',
    'plus-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M12 8.2v7.6M8.2 12h7.6"/>',
    minus: '<path d="M5.6 12h12.8"/>',
    edit: '<path d="M4.6 19.4l4.2-.9L19 8.2a2 2 0 0 0-2.8-2.8L5.9 15.2z"/><path d="M15.3 6.4l2.3 2.3"/>',
    trash: '<path d="M4.8 7.2h14.4"/><path d="M9.4 7.2V5.5c0-.8.6-1.4 1.4-1.4h2.4c.8 0 1.4.6 1.4 1.4v1.7"/><path d="M6.7 7.2l.8 11.2c.1 1 .9 1.7 1.9 1.7h5.2c1 0 1.8-.7 1.9-1.7l.8-11.2"/><path d="M10.3 10.9v5.4M13.7 10.9v5.4"/>',
    copy: '<rect x="9" y="9" width="10.2" height="10.2" rx="2.4"/><path d="M15 9V6.6c0-1.4-1.1-2.6-2.6-2.6H6.6C5.1 4 4 5.2 4 6.6v5.8c0 1.4 1.1 2.6 2.6 2.6H9"/>',
    save: '<path d="M5 6.4C5 5.1 6.1 4 7.4 4h8.5L20 8.1v9.5c0 1.3-1.1 2.4-2.4 2.4H7.4C6.1 20 5 18.9 5 17.6z"/><path d="M8.4 4v5h6.6V4"/><path d="M8.4 15.2h7.2"/>',
    download: '<path d="M12 4.6v10.6"/><path d="M7.8 11.2L12 15.4l4.2-4.2"/><path d="M4.8 19.4h14.4"/>',
    upload: '<path d="M12 15.4V4.8"/><path d="M7.8 9L12 4.8 16.2 9"/><path d="M4.8 19.4h14.4"/>',
    refresh: '<path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.3"/><path d="M19.6 4.9v3.6h-3.6"/>',
    search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.7 15.7L20 20"/>',
    filter: '<path d="M4.4 6.8h15.2M7.4 12h9.2M10.2 17.2h3.6"/>',
    sort: '<path d="M7 4.8v14.4"/><path d="M4.4 16.4L7 19l2.6-2.6"/><path d="M13.6 5.4h6M13.6 10.4h4.6M13.6 15.4h3.2"/>',
    link: '<path d="M10.2 13.8a3.7 3.7 0 0 0 5.2 0l2.5-2.5a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4"/><path d="M13.8 10.2a3.7 3.7 0 0 0-5.2 0l-2.5 2.5a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4"/>',
    external: '<path d="M14 4.6h5.4V10"/><path d="M19.4 4.6l-7.6 7.6"/><path d="M18 14.2v4.4c0 1.1-.9 2-2 2H5.6c-1.1 0-2-.9-2-2V7.6c0-1.1.9-2 2-2H10"/>',
    more: '<circle cx="5.6" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.35" fill="currentColor" stroke="none"/>',
    'more-v': '<circle cx="12" cy="5.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="18.4" r="1.35" fill="currentColor" stroke="none"/>',
    drag: '<circle cx="9" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="17.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
    settings: '<path d="M4 7.6h4.6M12.4 7.6H20M4 16.4h6.6M14.4 16.4H20"/><circle cx="10.5" cy="7.6" r="2.1"/><circle cx="12.5" cy="16.4" r="2.1"/>',
    print: '<path d="M7 9.2V4.8h10v4.4"/><rect x="4.6" y="9.2" width="14.8" height="6.4" rx="1.8"/><path d="M8 15.6v3.6h8v-3.6"/>',
    qr: '<rect x="3.8" y="3.8" width="6.2" height="6.2" rx="1.4"/><rect x="14" y="3.8" width="6.2" height="6.2" rx="1.4"/><rect x="3.8" y="14" width="6.2" height="6.2" rx="1.4"/><path d="M14 14h2.8v2.8H14z" fill="currentColor" stroke="none"/><path d="M18.2 18.2h2v2h-2z" fill="currentColor" stroke="none"/>',
    pin: '<path d="M12 20.4s6-6.3 6-10.6A6 6 0 0 0 6 9.8c0 4.3 6 10.6 6 10.6z"/><circle cx="12" cy="9.8" r="2.2"/>',

    /* ---------- 方向 ---------- */
    'arrow-left': '<path d="M19.4 12H4.6"/><path d="M10.6 5.8L4.4 12l6.2 6.2"/>',
    'arrow-right': '<path d="M4.6 12h14.8"/><path d="M13.4 5.8L19.6 12l-6.2 6.2"/>',
    'arrow-up': '<path d="M12 19.4V4.6"/><path d="M5.8 10.6L12 4.4l6.2 6.2"/>',
    'arrow-down': '<path d="M12 4.6v14.8"/><path d="M5.8 13.4L12 19.6l6.2-6.2"/>',
    'chevron-down': '<path d="M6.6 9.6L12 15l5.4-5.4"/>',
    'chevron-up': '<path d="M6.6 14.4L12 9l5.4 5.4"/>',
    'chevron-left': '<path d="M14.4 6.6L9 12l5.4 5.4"/>',
    'chevron-right': '<path d="M9.6 6.6L15 12l-5.4 5.4"/>',
    'arrow-return': '<path d="M9.4 5.6L4 11l5.4 5.4"/><path d="M4.4 11h10.2a5 5 0 0 1 0 10h-2.4"/>',

    /* ---------- 状态 / 提示 ---------- */
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none"/>',
    alert: '<path d="M12 4.4l8.2 14.2H3.8z"/><path d="M12 9.6v4"/><circle cx="12" cy="16.1" r="1" fill="currentColor" stroke="none"/>',
    'alert-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4v5.2"/><circle cx="12" cy="16.1" r="1" fill="currentColor" stroke="none"/>',
    help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.4 9.5a2.7 2.7 0 0 1 5.3.6c0 1.9-2.7 2.1-2.7 3.9"/><circle cx="12" cy="16.4" r="1" fill="currentColor" stroke="none"/>',
    lock: '<rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.4"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/><circle cx="12" cy="15.1" r="1.1" fill="currentColor" stroke="none"/>',
    unlock: '<rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.4"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.3-1.3"/><circle cx="12" cy="15.1" r="1.1" fill="currentColor" stroke="none"/>',
    eye: '<path d="M2.8 12S6.2 6.2 12 6.2 21.2 12 21.2 12 17.8 17.8 12 17.8 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.9"/>',
    'eye-off': '<path d="M4.2 8.2C3.4 9.3 2.8 12 2.8 12s3.4 5.8 9.2 5.8c1.5 0 2.8-.4 4-1"/><path d="M9.3 6.6c.9-.3 1.8-.4 2.7-.4 5.8 0 9.2 5.8 9.2 5.8s-1 1.8-2.8 3.4"/><path d="M4.4 4.4l15.2 15.2"/><path d="M9.9 9.9a2.9 2.9 0 0 0 4.2 4.2"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 1.9"/>',
    calendar: '<rect x="3.8" y="6.2" width="16.4" height="14" rx="2.4"/><path d="M8.2 4v3.4M15.8 4v3.4M3.8 10.6h16.4"/>',
    'calendar-check': '<rect x="3.8" y="6.2" width="16.4" height="14" rx="2.4"/><path d="M8.2 4v3.4M15.8 4v3.4M3.8 10.6h16.4"/><path d="M9 15.4l1.9 1.9 4-4"/>',
    bell: '<path d="M6.8 15.6h10.4l-1.4-2.4V9.9a4.1 4.1 0 0 0-8.2 0v3.3z"/><path d="M10 18.4a2.2 2.2 0 0 0 4 0"/>',
    wifi: '<path d="M4 9.2a11.2 11.2 0 0 1 16 0"/><path d="M7.2 12.8a7 7 0 0 1 9.6 0"/><path d="M10.2 16.2a3.1 3.1 0 0 1 3.6 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
    'wifi-off': '<path d="M4 9.2a11.2 11.2 0 0 1 5-2.7"/><path d="M7.2 12.8a7 7 0 0 1 3.2-1.7"/><path d="M4.4 4.4l15.2 15.2"/><path d="M14.6 7a11.2 11.2 0 0 1 5.4 2.2"/><path d="M14.4 12.2a7 7 0 0 1 2.6 1"/>',
    cloud: '<path d="M7 18.2h9.6a3.6 3.6 0 0 0 .4-7.2 5.3 5.3 0 0 0-10.2-1.4A4 4 0 0 0 7 18.2z"/>',
    'cloud-up': '<path d="M7 18.2h9.6a3.6 3.6 0 0 0 .4-7.2 5.3 5.3 0 0 0-10.2-1.4A4 4 0 0 0 7 18.2z"/><path d="M12 16V9.4"/><path d="M9.6 11.6L12 9.2l2.4 2.4"/>',
    sync: '<path d="M5.2 12A6.8 6.8 0 0 1 17 7.4"/><path d="M19.2 4.8v3.6h-3.6"/><path d="M18.8 12A6.8 6.8 0 0 1 7 16.6"/><path d="M4.8 19.2v-3.6h3.6"/>',
    hourglass: '<path d="M6.8 4h10.4"/><path d="M6.8 20h10.4"/><path d="M7.6 4v3.4c0 2.2 4.4 3.6 4.4 4.6s-4.4 2.4-4.4 4.6V20"/><path d="M16.4 4v3.4c0 2.2-4.4 3.6-4.4 4.6s4.4 2.4 4.4 4.6V20"/>',
    shield: '<path d="M12 3.8l7 2.6v5.4c0 4-2.9 6.9-7 8.4-4.1-1.5-7-4.4-7-8.4V6.4z"/><path d="M9.2 11.9l2 2 3.6-3.7"/>',
    flag: '<path d="M6 4.4v15.2"/><path d="M6 5.2h10.2l-1.9 3.7 1.9 3.7H6"/>',
    fire: '<path d="M12.9 3.4c-.5 2.7-2.4 3.8-3.7 5.6a6.6 6.6 0 0 0-1.2 3.9c0 3.3 2.3 5.5 5.4 5.5 3 0 5.2-2 5.2-5 0-3.9-3.9-6.6-5.7-10z"/><path d="M12.2 20.1c1.4 0 2.4-1 2.4-2.3 0-1.7-2.1-3.2-2.1-3.2s-2.1 1.5-2.1 3.2c0 1.3 1 2.3 2.4 2.3z" fill="currentColor" fill-opacity=".14"/>',

    /* ---------- 人物 / 组织 ---------- */
    user: '<circle cx="12" cy="8.2" r="3.7"/><path d="M5 20.2c0-3.6 3.1-5.7 7-5.7s7 2.1 7 5.7"/>',
    users: '<circle cx="9.2" cy="8.2" r="3.3"/><path d="M3.2 19.6c0-3.2 2.7-5 6-5s6 1.8 6 5"/><path d="M15.6 5.3a3.3 3.3 0 0 1 0 5.8"/><path d="M17.2 14.9c2.2.7 3.6 2.4 3.6 4.7"/>',
    'user-plus': '<circle cx="10" cy="8.2" r="3.6"/><path d="M3.4 20.2c0-3.5 2.9-5.6 6.6-5.6 1.1 0 2.1.2 3 .6"/><path d="M18 13.4v5.4M15.3 16.1h5.4"/>',
    'user-check': '<circle cx="10" cy="8.2" r="3.6"/><path d="M3.4 20.2c0-3.5 2.9-5.6 6.6-5.6.9 0 1.8.1 2.6.4"/><path d="M15.4 16.2l1.9 1.9 3.5-3.9"/>',
    'id-card': '<rect x="3.2" y="5.6" width="17.6" height="12.8" rx="2.4"/><circle cx="8.6" cy="10.8" r="1.9"/><path d="M5.8 15.6c.4-1.4 1.5-2.1 2.8-2.1s2.4.7 2.8 2.1"/><path d="M13.6 10.2h4.4M13.6 13.6h4.4"/>',
    school: '<path d="M2.8 20.4h18.4"/><path d="M5.2 20.4V9.8l6.8-3.9 6.8 3.9v10.6"/><path d="M9.6 20.4v-5.2h4.8v5.2"/><path d="M12 5.9V3.4"/>',
    graduation: '<path d="M3 9.6L12 5.4l9 4.2-9 4.2z"/><path d="M7 11.8v4.4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.4"/><path d="M20.6 10.2v4.8"/>',
    book: '<path d="M4.6 6.4c0-1.1.9-2 2-2h12.2v13.6H6.6c-1.1 0-2 .9-2 2z"/><path d="M4.6 17.6h14.2"/>',
    'book-open': '<path d="M12 6.6C10.3 5.1 7.8 4.7 4.6 5.1v12.4c3.2-.4 5.7 0 7.4 1.5 1.7-1.5 4.2-1.9 7.4-1.5V5.1c-3.2-.4-5.7 0-7.4 1.5z"/><path d="M12 6.6v12.4"/>',
    notebook: '<rect x="5" y="3.8" width="13.4" height="16.4" rx="2.2"/><path d="M9 3.8v16.4"/><path d="M12 8.4h4M12 12h3"/>',
    scroll: '<path d="M6.6 5h10.2a1.8 1.8 0 0 1 1.8 1.8v12.6a1.8 1.8 0 0 0 1.8 1.8H8.4a1.8 1.8 0 0 1-1.8-1.8z"/><path d="M9.4 9.2h6.4M9.4 12.8h4.6"/>',
    archive: '<path d="M3.6 8.4l1.5-4h13.8l1.5 4z"/><path d="M4.8 8.4v10.4c0 .8.6 1.4 1.4 1.4h11.6c.8 0 1.4-.6 1.4-1.4V8.4"/><path d="M10 12.6h4"/>',
    box: '<path d="M12 3.6l7.4 3.9v9L12 20.4 4.6 16.5v-9z"/><path d="M4.6 7.5L12 11.4l7.4-3.9"/><path d="M12 11.4v9"/>',

    /* ---------- 内容类型 ---------- */
    clipboard: '<path d="M9.2 4.6h5.6v2.6H9.2z"/><path d="M8.8 6H7.2C6.2 6 5.4 6.8 5.4 7.8v11c0 1 .8 1.8 1.8 1.8h9.6c1 0 1.8-.8 1.8-1.8v-11c0-1-.8-1.8-1.8-1.8h-1.6"/><path d="M8.8 11.4h6.4M8.8 15.2h4.2"/>',
    list: '<path d="M8.8 7h10.6M8.8 12h10.6M8.8 17h10.6"/><circle cx="4.9" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.9" cy="17" r="1.2" fill="currentColor" stroke="none"/>',
    checklist: '<path d="M10 6.6h9.4M10 12h9.4M10 17.4h9.4"/><path d="M3.6 6.2l1.6 1.6L8 5"/><path d="M3.6 11.6l1.6 1.6L8 10.4"/><path d="M3.6 17l1.6 1.6L8 15.8"/>',
    task: '<path d="M9.2 4.6h5.6v2.6H9.2z"/><path d="M8.8 6H7.2C6.2 6 5.4 6.8 5.4 7.8v11c0 1 .8 1.8 1.8 1.8h9.6c1 0 1.8-.8 1.8-1.8v-11c0-1-.8-1.8-1.8-1.8h-1.6"/><path d="M9 13.4l1.9 1.9 4-4.2"/>',
    target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    tag: '<path d="M4.2 11.6V5.4c0-.7.5-1.2 1.2-1.2h6.2l8.4 8.4c.5.5.5 1.3 0 1.8l-5.4 5.4c-.5.5-1.3.5-1.8 0z"/><circle cx="8.4" cy="8.4" r="1.4"/>',
    tags: '<path d="M9.4 4.2h4.6l7.6 7.6c.5.5.5 1.3 0 1.8l-4.6 4.6c-.5.5-1.3.5-1.8 0l-7.6-7.6V5.4c0-.7.5-1.2 1.2-1.2z"/><circle cx="12.4" cy="8.2" r="1.2"/><path d="M4.4 8.6v5.8l6.2 6.2"/>',
    folder: '<path d="M4 8.2c0-1 .8-1.8 1.8-1.8h3.6l2.2 2.6h6.6c1 0 1.8.8 1.8 1.8v7.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8z"/>',
    file: '<path d="M6.4 4.6h7.2L18.2 9v10.4H6.4z"/><path d="M13.2 4.8v4.6h4.6"/><path d="M9.2 13h6M9.2 16.2h4"/>',
    paper: '<rect x="4.6" y="3.8" width="14.8" height="16.4" rx="2.2"/><path d="M8 8.6h8M8 12h8M8 15.4h4.6"/>',
    image: '<rect x="3.4" y="5.2" width="17.2" height="13.6" rx="2.4"/><circle cx="8.8" cy="10" r="1.7"/><path d="M4.2 17l4.6-4.4 3.3 3 2.7-2.4 4.5 4"/>',
    camera: '<path d="M4 9c0-1 .8-1.8 1.8-1.8h2.1l1.4-2.1h5.4l1.4 2.1h2.1c1 0 1.8.8 1.8 1.8v9c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8z"/><circle cx="12" cy="12.9" r="3.4"/>',
    'chart-bar': '<path d="M4.2 19.6h15.6"/><path d="M7.4 19.6v-5.4" stroke-width="2.6"/><path d="M12 19.6V9.4" stroke-width="2.6"/><path d="M16.6 19.6v-8.2" stroke-width="2.6"/>',
    'chart-pie': '<circle cx="12" cy="12" r="8.4"/><path d="M12 12V3.6"/><path d="M12 12l7.6 4.2"/>',
    'chart-line': '<path d="M4.2 4.4v15.2h15.6"/><path d="M6.6 15.6l3.6-4.2 3 2.6 4.6-6"/>',
    grid: '<rect x="3.8" y="3.8" width="6.8" height="6.8" rx="2"/><rect x="13.4" y="3.8" width="6.8" height="6.8" rx="2"/><rect x="3.8" y="13.4" width="6.8" height="6.8" rx="2"/><rect x="13.4" y="13.4" width="6.8" height="6.8" rx="2"/>',
    seat: '<path d="M7.6 12.4V5.6c0-.9.7-1.6 1.6-1.6h5.6c.9 0 1.6.7 1.6 1.6v6.8"/><rect x="5.4" y="12.4" width="13.2" height="3.2" rx="1.4"/><path d="M7.6 15.6v4.6M16.4 15.6v4.6"/>',
    pencil: '<path d="M16.4 4.4a2 2 0 0 1 2.8 2.8L9.8 16.6l-3.9 1.1 1.1-3.9z"/><path d="M14.6 6.2l3.2 3.2"/>',
    brush: '<path d="M15.2 4.6l4.2 4.2-8.6 8.6-4.2-4.2z"/><path d="M6.6 13.2l4.2 4.2"/><path d="M6.6 17.4c-1.6 0-2.6 1-3 3 2 0 3-.6 3.6-1.6"/>',
    music: '<path d="M9.2 18.2V6.6l9.2-2.1v11.6"/><circle cx="6.6" cy="18.2" r="2.6"/><circle cx="15.8" cy="16.1" r="2.6"/>',
    dumbbell: '<path d="M4 9.4v5.2M7.2 7.2v9.6M16.8 7.2v9.6M20 9.4v5.2M7.2 12h9.6"/>',
    broom: '<path d="M19.8 4.2l-6.9 6.9"/><path d="M10.9 9.9l3.2 3.2"/><path d="M10.2 10.6a1.1 1.1 0 0 1 1.6 0l2.2 2.2a1.1 1.1 0 0 1 0 1.6l-5.6 5.4H4.2v-4.2z"/><path d="M7.6 13.8l2.6 2.6M9.8 11.6l2.6 2.6"/>',
    'hand-heart': '<path d="M12 9.4l-1-1.2a2.2 2.2 0 0 0-3.4 2.7L12 15.1l4.4-4.2a2.2 2.2 0 0 0-3.4-2.7z"/><path d="M3.8 14.6c2.2 2.2 5 3.4 8.2 3.4s6-1.2 8.2-3.4"/><path d="M3.8 14.6v3.6c0 1 .8 1.8 1.8 1.8h12.8c1 0 1.8-.8 1.8-1.8v-3.6"/>',
    palette: '<path d="M12 3.6c-4.7 0-8.4 3.7-8.4 8.3 0 4.6 3.7 8 8.4 8 1.2 0 1.9-.8 1.9-1.8 0-.6-.2-1-.6-1.5-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h1.7c3 0 4.5-1.7 4.5-4.3 0-3.2-3.9-5.6-8.8-5.6z"/><circle cx="7.9" cy="10.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="11.2" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.1" fill="currentColor" stroke="none"/>',

    /* ---------- 星光 / 经济 ---------- */
    star: '<path d="M12 3.9l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 10.1l5.9-.8z"/>',
    'star-fill': '<path d="M12 3.9l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 10.1l5.9-.8z" fill="currentColor" fill-opacity=".16"/>',
    stars: '<path d="M9.4 4.6l1.7 3.5 3.8.5-2.8 2.7.7 3.8-3.4-1.9-3.4 1.9.7-3.8L4.8 8.6l3.8-.5z" fill="currentColor" fill-opacity=".14"/><path d="M16.6 12.4l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z"/>',
    sparkle: '<path d="M12 3.8l1.7 4.7 4.7 1.7-4.7 1.7L12 16.6l-1.7-4.7L5.6 10.2l4.7-1.7z"/><path d="M17.8 15.4l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
    coin: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="5.6"/><path d="M12 9.2l.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3z" fill="currentColor" stroke="none" fill-opacity=".5"/>',
    wallet: '<rect x="3.4" y="6.2" width="17.2" height="12.6" rx="2.6"/><path d="M3.4 10.4h17.2"/><circle cx="16.6" cy="14.6" r="1.5"/>',
    shop: '<path d="M4.2 9.4l1.7-4.6h12.2l1.7 4.6z"/><path d="M5.6 9.4v10h12.8v-10"/><path d="M9.6 19.4v-4.6h4.8v4.6"/><path d="M4.2 9.4a2.4 2.4 0 0 0 4.4 1.4 2.4 2.4 0 0 0 4.4 0 2.4 2.4 0 0 0 4.4 0 2.4 2.4 0 0 0 2.4-1.4"/>',
    cart: '<circle cx="9.6" cy="19" r="1.5"/><circle cx="17.6" cy="19" r="1.5"/><path d="M3.2 4.2h2.3l2.5 10.4h9.9L20.4 7.6H6.4"/>',
    gift: '<rect x="3.8" y="9.4" width="16.4" height="10.2" rx="1.8"/><path d="M3.8 9.4h16.4"/><path d="M12 9.4v10.2"/><path d="M8.6 9.2c-1.6 0-2.7-1-2.7-2.2S6.9 4.8 8.6 4.8c2.3 0 3.4 4.4 3.4 4.4s1.1-4.4 3.4-4.4c1.7 0 2.7 1 2.7 2.2s-1.1 2.2-2.7 2.2"/>',
    ticket: '<path d="M4 8.6c0-.9.7-1.6 1.6-1.6h12.8c.9 0 1.6.7 1.6 1.6v1.9a1.7 1.7 0 0 0 0 3.4v1.9c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6v-1.9a1.7 1.7 0 0 0 0-3.4z"/><path d="M14.4 7.6v8.8" stroke-dasharray="2 2.4"/>',
    wheel: '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6v16.8M3.6 12h16.8M6.1 6.1l11.8 11.8M17.9 6.1L6.1 17.9"/><circle cx="12" cy="12" r="2"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/>',
    crown: '<path d="M4.4 17.6l-1.2-9.2 5 3.4L12 5l3.8 6.8 5-3.4-1.2 9.2z"/><path d="M4.4 17.6h15.2"/>',
    trophy: '<path d="M8 4.2h8v4.6a4 4 0 0 1-8 0z"/><path d="M8 5.6H5.6a2.6 2.6 0 0 0 2.6 4.2"/><path d="M16 5.6h2.4a2.6 2.6 0 0 1-2.6 4.2"/><path d="M12 12.8v3.4"/><path d="M9.2 19.8h5.6v-3.6H9.2z"/>',
    medal: '<circle cx="12" cy="14.6" r="5.2"/><path d="M8.4 9.6L6.2 3.8M15.6 9.6l2.2-5.8"/><path d="M12 12.2l.8 1.7 1.8.2-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.2z" fill="currentColor" stroke="none" fill-opacity=".45"/>',
    award: '<circle cx="12" cy="9.2" r="5.2"/><path d="M9.2 13.6L7.6 20.4l4.4-2.3 4.4 2.3-1.6-6.8"/>',
    ribbon: '<path d="M10.6 12L4.7 8.3a.9.9 0 0 0-1.4.8v5.8a.9.9 0 0 0 1.4.8z"/><path d="M13.4 12l5.9-3.7a.9.9 0 0 1 1.4.8v5.8a.9.9 0 0 1-1.4.8z"/><circle cx="12" cy="12" r="1.6"/>',
    leaf: '<path d="M19.6 4.4C10 4.4 4.6 8.2 4.6 14.4c0 1.9.7 3.4 1.5 4.4 2.9-5.3 6.7-7.3 10.6-8.3-3.4 1.8-6.5 4.3-8.5 8.8 1.4.7 3 .5 4.3 0 5.3-2 6.9-8 7.7-14.9z" fill="currentColor" fill-opacity=".12"/>',
    rainbow: '<path d="M3.4 17.6a8.6 8.6 0 0 1 17.2 0"/><path d="M6.6 17.6a5.4 5.4 0 0 1 10.8 0"/><path d="M9.8 17.6a2.2 2.2 0 0 1 4.4 0"/>',
    paw: '<path d="M12 12.2c2.4 0 4.4 1.6 4.4 3.8 0 2-1.6 3.4-4.4 3.4s-4.4-1.4-4.4-3.4c0-2.2 2-3.8 4.4-3.8z"/><ellipse cx="7.2" cy="9.6" rx="1.6" ry="2"/><ellipse cx="16.8" cy="9.6" rx="1.6" ry="2"/><ellipse cx="10" cy="6.8" rx="1.5" ry="1.9"/><ellipse cx="14" cy="6.8" rx="1.5" ry="1.9"/>',
    lantern: '<path d="M9.4 3.4h5.2"/><path d="M12 3.4v2.2"/><path d="M8.8 8.2a4.3 4.3 0 0 1 6.4 0c.3.3.4.6.4 1v4.4c0 2.6-1.6 4.4-3.6 4.4s-3.6-1.8-3.6-4.4V9.2c0-.4.1-.7.4-1z"/><path d="M12 8.4v9.6"/><path d="M9.8 20.4h4.4"/><path d="M12 18v2.4"/>',
    moon: '<path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4"/>',

    /* ---------- 通讯 / 其它 ---------- */
    message: '<path d="M4.2 7.4c0-1.3 1-2.4 2.4-2.4h10.8c1.3 0 2.4 1.1 2.4 2.4v7.2c0 1.3-1.1 2.4-2.4 2.4H9.6l-4.2 3.2c-.6.5-1.2.1-1.2-.7z"/>',
    send: '<path d="M20.4 4.2L3.8 10.8l6.6 2.8 2.8 6.6z"/><path d="M10.4 13.6l4.4-4.4"/>',
    key: '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H20"/><path d="M16.8 12v3.2M14.4 12v2.2"/>',
    database: '<ellipse cx="12" cy="6.4" rx="7" ry="2.8"/><path d="M5 6.4v11.2c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6.4"/><path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8"/>',
    server: '<rect x="3.6" y="4.4" width="16.8" height="6.2" rx="1.8"/><rect x="3.6" y="13.4" width="16.8" height="6.2" rx="1.8"/><path d="M7 7.5h.2M7 16.5h.2"/>',
    robot: '<rect x="4.4" y="7.6" width="15.2" height="11.4" rx="3.4"/><path d="M12 3.6v4"/><circle cx="9" cy="12.6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12.6" r="1.3" fill="currentColor" stroke="none"/><path d="M9.4 16h5.2"/><path d="M2.2 11.4v3.4M21.8 11.4v3.4"/>',
    home: '<path d="M3.8 10.4L12 3.8l8.2 6.6v8.4c0 .9-.7 1.6-1.6 1.6H5.4c-.9 0-1.6-.7-1.6-1.6z"/><path d="M9.4 20.4v-6h5.2v6"/>',
    logout: '<path d="M14.6 8.2V6.4c0-1.1-.9-2-2-2H6.4c-1.1 0-2 .9-2 2v11.2c0 1.1.9 2 2 2H12.6c1.1 0 2-.9 2-2v-1.8"/><path d="M9.6 12h10.6"/><path d="M17.2 9l3 3-3 3"/>',
    wave: '<path d="M8.2 11.6V6.4a1.6 1.6 0 0 1 3.2 0v4.6"/><path d="M11.4 11V5.2a1.6 1.6 0 0 1 3.2 0v5.8"/><path d="M14.6 11.2V6.8a1.6 1.6 0 0 1 3.2 0v7.4c0 3.5-2.4 6-6 6-2.6 0-4.2-1.2-5.4-3.4l-2-3.6a1.7 1.7 0 0 1 2.8-1.9l1.1 1.5"/>',

    /* ---------- 补充语义 ---------- */
    heart: '<path d="M12 20.2l-1.5-1.4C5.6 14.4 3.2 12.2 3.2 9.4A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.8 2.8c0 2.8-2.4 5-7.3 9.4z"/>',
    thumb: '<path d="M7.4 10.6v9.2H4.8a1.4 1.4 0 0 1-1.4-1.4v-6.4a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M7.4 10.6l3.4-6.4a1.9 1.9 0 0 1 3.5 1.3l-.7 3.5h4.6a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7.4"/>',
    rocket: '<path d="M13.4 4.6c2.9-1 6.4-1.4 6.4-1.4s-.4 3.5-1.4 6.4c-.9 2.6-3.2 4.6-5.8 5.5l-3-3c.9-2.6 2.9-4.9 5.5-5.8z"/><path d="M9.6 12.1L4.4 13l2.9 2.9 2.9 2.9.9-5.2"/><circle cx="15.2" cy="8.8" r="1.5"/>',
    mic: '<rect x="8.8" y="3.4" width="6.4" height="10.4" rx="3.2"/><path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.8v2.8"/><path d="M9 20.6h6"/>',
    drop: '<path d="M12 3.8c3.2 3.7 5.6 6.6 5.6 9.4a5.6 5.6 0 0 1-11.2 0c0-2.8 2.4-5.7 5.6-9.4z"/>',
    volume: '<path d="M4.4 9.6h3.2L12 5.8v12.4l-4.4-3.8H4.4z"/><path d="M15.4 9.2a3.8 3.8 0 0 1 0 5.6"/><path d="M17.8 6.8a7 7 0 0 1 0 10.4"/>',
    'volume-off': '<path d="M4.4 9.6h3.2L12 5.8v12.4l-4.4-3.8H4.4z"/><path d="M15.6 9.8l4.8 4.8M20.4 9.8l-4.8 4.8"/>',
    phone: '<rect x="6.6" y="2.8" width="10.8" height="18.4" rx="2.6"/><path d="M10.4 18.4h3.2"/>',
    monitor: '<rect x="2.6" y="3.6" width="18.8" height="12.8" rx="2.2"/><path d="M12 16.4v3.4"/><path d="M8.6 19.8h6.8"/>',
    'circle-dot': '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
    beaker: '<path d="M9.4 3.6h5.2"/><path d="M10.4 3.6v5.6L6.2 18a1.6 1.6 0 0 0 1.4 2.4h8.8a1.6 1.6 0 0 0 1.4-2.4l-4.2-8.8V3.6"/><path d="M7.8 14.6h8.4"/>',
    gamepad: '<rect x="2.8" y="7.6" width="18.4" height="9.6" rx="4.8"/><path d="M7.6 10.4v3.2M6 12h3.2"/><circle cx="16.2" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="18.2" cy="13" r="1.1" fill="currentColor" stroke="none"/>',

    /* ---------- 心情 1~5 ---------- */
    'mood-1': '<circle cx="12" cy="12" r="8.6"/><circle cx="9.2" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><path d="M8 16.6c.9-1.5 2.3-2.3 4-2.3s3.1.8 4 2.3"/>',
    'mood-2': '<circle cx="12" cy="12" r="8.6"/><circle cx="9.2" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><path d="M8.6 16c.7-1 1.9-1.6 3.4-1.6s2.7.6 3.4 1.6"/>',
    'mood-3': '<circle cx="12" cy="12" r="8.6"/><circle cx="9.2" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><path d="M8.8 15.2h6.4"/>',
    'mood-4': '<circle cx="12" cy="12" r="8.6"/><circle cx="9.2" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9.9" r="1.1" fill="currentColor" stroke="none"/><path d="M8.6 14.4c.7 1 1.9 1.6 3.4 1.6s2.7-.6 3.4-1.6"/>',
    'mood-5': '<circle cx="12" cy="12" r="8.6"/><circle cx="9.2" cy="9.7" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9.7" r="1.1" fill="currentColor" stroke="none"/><path d="M7.8 13.8c.9 1.7 2.4 2.6 4.2 2.6s3.3-.9 4.2-2.6"/>'
  };

  /* --- 语义别名：让调用处读起来是「做什么」而不是「长什么样」 ------------- */
  var A = {
    /* 教师端标签栏 */
    tabRecord: 'clipboard', tabTask: 'checklist', tabPersonal: 'target', tabChallenge: 'trophy',
    tabTag: 'tag', tabAuto: 'robot', tabExam: 'camera', tabBatch: 'medal', tabStats: 'chart-bar',
    tabSeat: 'seat', tabStar: 'star', tabScore: 'book-open',
    /* 五育 */
    de: 'hand-heart', zhi: 'book-open', ti: 'dumbbell', mei: 'palette', lao: 'broom',
    /* 状态 */
    ok: 'check-circle', no: 'x-circle', warn: 'alert', tip: 'info',
    /* 经济 */
    star2: 'star', coin2: 'coin'
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function build() {
    var parts = [];
    for (var k in S) if (S.hasOwnProperty(k)) {
      parts.push('<symbol id="i-' + k + '" viewBox="0 0 24 24">' + S[k] + '</symbol>');
    }
    return '<svg id="spIconSprite" aria-hidden="true" focusable="false" ' +
      'style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none">' +
      parts.join('') + '</svg>';
  }

  function mount() {
    if (document.getElementById('spIconSprite')) return;
    var holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.innerHTML = build();
    if (document.body) {
      document.body.insertBefore(holder, document.body.firstChild);
    } else {
      // 脚本在 <head> 里执行时 body 还不存在：先挂 head，
      // 这样后面的静态 HTML 一解析出来就能立刻取到符号，不会出现「先空白再出图」
      (document.head || document.documentElement).appendChild(holder);
    }
  }

  /* 核心输出：一个图标就是一个字符串，可放进任何模板字面量 / innerHTML */
  function ico(name, cls) {
    var real = A[name] || name;
    if (!S[real]) real = 'info';
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false">' +
      '<use href="#i-' + real + '"/></svg>';
  }

  ico.mood = function (lv) {
    var n = Math.min(5, Math.max(1, parseInt(lv, 10) || 3));
    return ico('mood-' + n);
  };
  /* 名次：同一个奖牌造型，靠类名给金/银/铜三色，形状语言保持一致 */
  ico.rank = function (i) {
    var n = parseInt(i, 10) || 0;
    if (n >= 1 && n <= 3) return ico('medal', 'rk rk' + n);
    return '';
  };
  /* 自评星级：固定 5 颗，实心=已打，空心=未打。三端统一走这里，
     不要再在模板里手拼 ★/☆ 或空字符串。 */
  ico.starRow = function (n) {
    var k = Math.min(5, Math.max(0, parseInt(n, 10) || 0));
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += ico('star', i <= k ? 'sr sr-on' : 'sr sr-off');
    }
    return out;
  };
  ico.names = function () { return Object.keys(S); };
  ico.has = function (name) { return !!S[A[name] || name]; };
  ico.mount = mount;
  ico.sprite = build;

  /* 让两种写法都成立：
     I.star()            —— 名字是合法标识符时最顺手
     I['check-circle']() —— 带连字符的名字只能这样写
     两者都返回同一段 <svg> 字符串，可放在模板字面量或 innerHTML 里 */
  Object.keys(S).forEach(function (k) {
    ico[k] = function (cls) { return ico(k, cls); };
  });

  mount();

  /* 若脚本在 <head> 里执行，符号会先落在 head；等 body 出现后挪进 body，
     这样它和其它元素同处一个渲染上下文，兼容性最稳（id 不变，已渲染的 use 不受影响）。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById('spIconSprite');
      var holder = el && el.parentNode;
      if (holder && holder.parentNode === document.documentElement && document.body) {
        document.body.insertBefore(holder, document.body.firstChild);
      }
    });
  }

  window.I = ico;
})();
