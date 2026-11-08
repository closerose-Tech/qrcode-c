/*!
 * QRQ · 校准手柄（四角 / 基准线端点）拖动
 * 关键点：手柄坐标保存在“源图像素”空间，指针坐标是“显示像素”空间，
 *        命中判定必须先把手柄投到显示空间，位移再换算回源空间；
 *        否则两套坐标差着几百像素，表现为“怎么拖都没反应”。
 * 兼容：Pointer Events（安卓 WebView / Chrome / Safari）→ 触摸 → 鼠标。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    root.QRQ.Handles = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HIT = 26;          // 命中半径（显示像素），手机上约等于 52px 直径的触摸区
  var CURSOR_HIT = 30;

  function bind(cv, cfg) {
    if (!cv) return null;
    if (cv.__handles) return cv.__handles;

    cv.style.touchAction = 'none';
    cv.style.webkitUserSelect = 'none';

    var st = { mode: null, active: -1, grab: null, snap: null };

    function metrics() {
      var r = cv.getBoundingClientRect();
      var s = cfg.size() || { w: cv.width, h: cv.height };
      var sw = s.w || 1, sh = s.h || 1;
      return {
        left: r.left, top: r.top,
        cw: r.width || 1, ch: r.height || 1,
        sw: sw, sh: sh,
        kx: sw / (r.width || 1), ky: sh / (r.height || 1)
      };
    }
    function toSrc(cx, cy, m) {
      m = m || metrics();
      return { x: (cx - m.left) * m.kx, y: (cy - m.top) * m.ky };
    }
    function toDisp(p, m) {
      m = m || metrics();
      return { x: p.x / m.kx, y: p.y / m.ky };
    }

    function pts() { return cfg.points() || []; }

    function clampSrc(p) {
      var s = cfg.size() || {};
      return {
        x: Math.max(0, Math.min(s.w || cv.width, p.x)),
        y: Math.max(0, Math.min(s.h || cv.height, p.y))
      };
    }

    function nearest(d, m) {
      var arr = pts(), best = -1, bd = HIT;
      for (var i = 0; i < arr.length; i++) {
        var q = toDisp(arr[i], m);
        var dd = Math.sqrt((q.x - d.x) * (q.x - d.x) + (q.y - d.y) * (q.y - d.y));
        if (dd <= bd) { bd = dd; best = i; }
      }
      return best;
    }

    function inside(d, m) {
      var src = cfg.polyPoints ? cfg.polyPoints() : pts();
      var arr = src.map(function (p) { return toDisp(p, m); });
      if (arr.length < 3) return false;
      var hit = false;
      for (var i = 0, j = arr.length - 1; i < arr.length; j = i++) {
        var a = arr[i], b = arr[j];
        if (((a.y > d.y) !== (b.y > d.y)) &&
            (d.x < (b.x - a.x) * (d.y - a.y) / ((b.y - a.y) || 1e-6) + a.x)) hit = !hit;
      }
      return hit;
    }

    function fire() { if (cfg.onDrag) cfg.onDrag(st.active, st.mode); }

    function start(cx, cy, ev) {
      if (!pts().length) return false;
      var m = metrics();
      var d = { x: cx - m.left, y: cy - m.top };
      var i = nearest(d, m);

      if (i >= 0) {
        st.mode = 'point'; st.active = i;
      } else if (cfg.dragAll !== false && inside(d, m)) {
        st.mode = 'all'; st.active = -1;
        st.grab = toSrc(cx, cy, m);
        st.snap = pts().map(function (p) { return { x: p.x, y: p.y }; });
      } else {
        return false;
      }

      cv.__active = st.active;
      if (ev && ev.pointerId !== undefined && cv.setPointerCapture) {
        try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      if (cfg.onStart) cfg.onStart();
      fire();
      return true;
    }

    function move(cx, cy, ev) {
      if (!st.mode) return false;
      var m = metrics();

      if (st.mode === 'point') {
        if (!cfg.setPoint) { st.mode = null; return false; }
        cfg.setPoint(st.active, clampSrc(toSrc(cx, cy, m), m));
      } else {
        var p = toSrc(cx, cy, m);
        var dx = p.x - st.grab.x, dy = p.y - st.grab.y;
        var x0 = -Infinity, x1 = Infinity, y0 = -Infinity, y1 = Infinity;
        st.snap.forEach(function (q) {
          x0 = Math.max(x0, -q.x); x1 = Math.min(x1, m.sw - q.x);
          y0 = Math.max(y0, -q.y); y1 = Math.min(y1, m.sh - q.y);
        });
        dx = Math.max(x0, Math.min(x1, dx));
        dy = Math.max(y0, Math.min(y1, dy));
        st.snap.forEach(function (q, i) { cfg.setPoint(i, { x: q.x + dx, y: q.y + dy }); });
      }

      fire();
      if (ev) kill(ev);
      return true;
    }

    function end() {
      if (!st.mode) return;
      st.mode = null; st.active = -1; st.grab = null; st.snap = null;
      cv.__active = -1;
      fire();
    }

    function kill(e) {
      if (e && e.cancelable) e.preventDefault();
    }

    function point(e) {
      var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t) return { x: t.clientX, y: t.clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function hover(ev) {
      if (st.mode) return;
      var m = metrics();
      var d = { x: ev.clientX - m.left, y: ev.clientY - m.top };
      var i = nearest(d, m);
      cv.style.cursor = i >= 0 ? 'grab' : (inside(d, m) ? 'move' : 'default');
    }

    if (window.PointerEvent) {
      cv.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button > 0) return;
        var p = point(e);
        if (start(p.x, p.y, e)) kill(e);
      });
      cv.addEventListener('pointermove', function (e) { hover(e); });
      // 位移与抬起挂在 window 上：即使指针移出画布、或指针捕获失效也不会丢事件
      window.addEventListener('pointermove', function (e) {
        if (!st.mode) return;
        var p = point(e);
        move(p.x, p.y, e);
      }, { passive: false });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('blur', end);
    }

    // 触摸兜底（极老内核不支持 Pointer Events 时）
    cv.addEventListener('touchstart', function (e) {
      if (st.mode) return;
      var p = point(e);
      if (start(p.x, p.y, e)) kill(e);
    }, { passive: false });
    cv.addEventListener('touchmove', function (e) {
      if (!st.mode) return;
      var p = point(e);
      move(p.x, p.y, e);
    }, { passive: false });
    cv.addEventListener('touchend', end);
    cv.addEventListener('touchcancel', end);

    // 鼠标兜底
    cv.addEventListener('mousedown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      if (start(e.clientX, e.clientY, e)) kill(e);
    });
    window.addEventListener('mousemove', function (e) {
      if (!st.mode) return;
      move(e.clientX, e.clientY, e);
    });
    window.addEventListener('mouseup', end);

    var api = { active: function () { return st.active; }, dragging: function () { return !!st.mode; } };
    cv.__handles = api;
    return api;
  }

  /* 把四边形按质心等比放大（用于让默认框把码图/标签整体括住） */
  function scaleBox(quad, k) {
    var cx = 0, cy = 0;
    quad.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= quad.length; cy /= quad.length;
    return quad.map(function (p) {
      return { x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k };
    });
  }

  /* 与图像边界求交后夹紧，避免放大后越界 */
  function clampQuad(quad, w, h) {
    return quad.map(function (p) {
      return { x: Math.max(1, Math.min(w - 1, p.x)), y: Math.max(1, Math.min(h - 1, p.y)) };
    });
  }

  return { bind: bind, scaleBox: scaleBox, clampQuad: clampQuad, HIT: HIT, CURSOR_HIT: CURSOR_HIT };
});
