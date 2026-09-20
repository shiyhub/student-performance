/**
 * 轻量音效（WebAudio 实时合成，无音频文件，离线可用）
 * 用法：window.SFX.tap() / star(n) / tagOn(positive) / moodUp() / success() ...
 * 静音偏好存 localStorage，所有页面共享一个开关。
 */
(function () {
  var MUTE_KEY = 'sp_sound_off';
  var ctx = null;
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { ctx = new AC(); } catch (e) { ctx = null; } }
    }
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // 单个音符
  function tone(freq, delay, dur, type, vol) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    var t = c.currentTime + (delay || 0);
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }

  function seq(notes) {
    notes.forEach(function (n) { tone(n.f, n.t || 0, n.d || 0.12, n.type || 'sine', n.v || 0.12); });
  }

  var STAR_FREQ = [523.25, 587.33, 659.25, 698.46, 783.99]; // C5 D5 E5 F5 G5

  var SFX = {
    get muted() { return muted; },
    unlock: function () { ac(); },
    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
    },
    // 普通点击
    tap: function () { tone(500, 0, 0.07, 'triangle', 0.07); },
    // 返回 / 关闭（更轻）
    back: function () { tone(360, 0, 0.07, 'triangle', 0.06); },
    // 星星（按第几颗升调）
    star: function (n) { tone(STAR_FREQ[Math.max(0, Math.min(4, (n || 1) - 1))], 0, 0.14, 'sine', 0.13); },
    // 勾中标签：positive=上扬两音；negative=低柔两音
    tagOn: function (positive) {
      if (positive === false) { seq([{ f: 392, d: 0.1, type: 'triangle', v: 0.09 }, { f: 330, t: 0.07, d: 0.1, type: 'triangle', v: 0.08 }]); }
      else { seq([{ f: 659.25, d: 0.09, type: 'triangle', v: 0.1 }, { f: 880, t: 0.06, d: 0.1, type: 'sine', v: 0.09 }]); }
    },
    // 取消勾选
    tagOff: function () { seq([{ f: 466.16, d: 0.06, type: 'triangle', v: 0.06 }, { f: 392, t: 0.04, d: 0.07, type: 'triangle', v: 0.06 }]); },
    // 二级小选项
    sub: function () { tone(740, 0, 0.06, 'sine', 0.07); },
    // 心情升 / 降
    moodUp: function () { seq([{ f: 523.25, d: 0.09, v: 0.1 }, { f: 659.25, t: 0.07, d: 0.09, v: 0.1 }, { f: 783.99, t: 0.14, d: 0.12, v: 0.11 }]); },
    moodDown: function () { seq([{ f: 392, d: 0.09, type: 'triangle', v: 0.09 }, { f: 329.63, t: 0.08, d: 0.12, type: 'triangle', v: 0.09 }]); },
    // 选头像：俏皮的“啵”
    pick: function () { tone(620, 0, 0.08, 'triangle', 0.1); tone(932, 0.06, 0.1, 'sine', 0.08); },
    // 提交成功：小喇叭式上行音阶
    success: function () {
      seq([
        { f: 523.25, d: 0.12, v: 0.12 },
        { f: 659.25, t: 0.1, d: 0.12, v: 0.12 },
        { f: 783.99, t: 0.2, d: 0.12, v: 0.12 },
        { f: 1046.5, t: 0.3, d: 0.22, v: 0.14 }
      ]);
    },
    // 错误 / 提醒（柔和，不刺耳）
    oops: function () { tone(300, 0, 0.14, 'triangle', 0.09); tone(260, 0.12, 0.16, 'triangle', 0.09); }
  };

  window.SFX = SFX;

  // 首次触摸/点击时解锁音频（浏览器要求由用户手势启动）
  document.addEventListener('pointerdown', function once() {
    SFX.unlock();
    document.removeEventListener('pointerdown', once);
  }, { passive: true });
})();
