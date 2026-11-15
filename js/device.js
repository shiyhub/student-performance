/* ============================================================
 * 设备检测 · 教师端布局切换
 * ------------------------------------------------------------
 * 判定当前是「电脑」还是「手机」，结果写到 <html data-device="pc|mobile">，
 * 布局全部交给 CSS（css/teacher.css 末尾的 v171 区块），JS 只管判定。
 *
 * 判定顺序（任何一项命中即停）：
 *   1. 视口宽度 < 860        → 手机（含电脑把窗口拖得很窄的情况）
 *   2. 手机 UA                → 手机
 *   3. 平板 UA / iPadOS 触屏  → 宽度 < 1180 为手机，否则电脑
 *   4. 其余                   → 电脑（含触摸一体机、投影大屏）
 *
 * 触摸屏不等于手机：一体机、4K 教学大屏 UA 是桌面系统、视口也宽，
 * 走电脑端横屏布局，不会因为「能触摸」被误降到手机排版。
 *
 * 手动切换：点击设备按钮按 自动 → 电脑 → 手机 → 自动 循环，
 * 仅本次会话有效（刷新回到自动），避免在一台机器上锁死后带到另一台。
 *
 * v180 · 与 teacher.html 内联兜底的分工：
 *   - teacher.html 的 <html> 静态写死 data-device="pc"，并内联一段同口径的
 *     「先判一次」脚本。即使本文件没上传/加载失败，也不会退化成全站手机版。
 *   - 本文件正常加载时按 detect() 重新判定，并接管手动切换、resize 跟随，
 *     同时把 data-device-src 标成 device.js（排障时一眼看出是哪层生效）。
 * ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var ORDER = ['auto', 'pc', 'mobile'];
  var NAME = { auto: '自动', pc: '电脑', mobile: '手机' };

  var state = { auto: 'pc', manual: null, device: 'pc' };
  var timer = 0;

  function viewportW() {
    return Math.round(window.innerWidth || root.clientWidth || 0);
  }

  function detect() {
    var w = viewportW();
    var ua = navigator.userAgent || '';
    var android = /Android/i.test(ua);
    var phoneUA = /iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(ua) ||
                  (android && /Mobile/i.test(ua));
    var padUA = /iPad/i.test(ua) ||
                (android && !/Mobile/i.test(ua)) ||
                /Tablet|PlayBook|Silk/i.test(ua);
    // iPadOS 13 起默认伪装成 macOS，靠触点数与 Safari 特征兜底识别
    var touchMac = (navigator.maxTouchPoints || 0) > 2 &&
                   /Macintosh|Mac OS X/i.test(ua) &&
                   !/Chrome\//i.test(ua);

    if (w > 0 && w < 860) return 'mobile';
    if (phoneUA) return 'mobile';
    if (padUA || touchMac) return w < 1180 ? 'mobile' : 'pc';
    return 'pc';
  }

  function paint() {
    var text = state.manual
      ? NAME[state.manual] + ' · 手动'
      : '自动 · ' + NAME[state.auto];
    var icon = (state.manual || state.auto) === 'pc' ? 'monitor' : 'phone';

    var btn = document.getElementById('btnDevice');
    if (btn) {
      var use = btn.querySelector('use');
      if (use) use.setAttribute('href', '#i-' + icon);
      var label = document.getElementById('deviceText');
      if (label) label.textContent = text;
      btn.title = '切换布局：自动 / 电脑 / 手机';
    }

    var info = document.getElementById('deviceInfo');
    if (info) {
      info.textContent = text + ' · ' + viewportW() + '×' + Math.round(window.innerHeight || 0);
    }
  }

  function render(notify) {
    var dev = state.manual || state.auto;
    root.setAttribute('data-device', dev);
    root.setAttribute('data-layout', state.manual ? 'manual' : 'auto');
    root.setAttribute('data-device-src', 'device.js');   // 排障用：与内联兜底区分
    state.device = dev;
    if (window.SPDevice) {
      window.SPDevice.device = dev;
      window.SPDevice.mode = state.manual ? 'manual' : 'auto';
    }
    paint();
    if (notify) {
      try {
        window.dispatchEvent(new CustomEvent('devicechange', {
          detail: { device: dev, mode: state.manual ? 'manual' : 'auto', width: viewportW() }
        }));
      } catch (e) {}
    }
  }

  function refresh() {
    var d = detect();
    if (d === state.auto) {
      if (!state.manual) render(false);
      return;
    }
    state.auto = d;
    render(true);
  }

  function onResize() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 160);
  }

  function setDevice(d) {
    if (d === 'auto') state.manual = null;
    else if (d === 'pc' || d === 'mobile') state.manual = d;
    else return;
    render(true);
  }

  function cycle() {
    var i = ORDER.indexOf(state.manual || 'auto');
    setDevice(ORDER[(i + 1) % ORDER.length]);
  }

  // 对外接口：布局脚本或测试可直接读 window.SPDevice.device
  window.SPDevice = {
    device: 'pc',
    mode: 'auto',
    detect: detect,
    set: setDevice,
    cycle: cycle,
    toggle: cycle,
    width: viewportW
  };

  state.auto = detect();
  render(false);

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize);
  if (window.matchMedia) {
    var mq = window.matchMedia('(pointer: coarse)');
    if (mq.addEventListener) mq.addEventListener('change', onResize);
    else if (mq.addListener) mq.addListener(onResize);
  }

  function bind() {
    ['btnDevice', 'btnDevice2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', cycle);
    });
    paint();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
