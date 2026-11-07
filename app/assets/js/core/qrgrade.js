/*!
 * QRQ · 二维码质量测评引擎
 * 参照 ISO/IEC 15415（印刷 2D 符号质量）、ISO/IEC 29158（AIM-DPM）、
 * ISO/IEC 18004（QR Code 符号结构）计算分级参数
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    for (var k in api) root.QRQ[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function Q() { return root.QRQ || {}; }

  /* ============================ 分级锚点 ============================ */
  // 每个锚点 {v: 数值, g: 等级}，按 v 升序；等级在锚点间线性插值（对应 15415:2024 小数分级）
  var ANCHORS = {
    SC:  [{ v: 0, g: 0 }, { v: 20, g: 1 }, { v: 40, g: 2 }, { v: 55, g: 3 }, { v: 70, g: 4 }],
    MOD: [{ v: 0, g: 0 }, { v: 20, g: 1 }, { v: 30, g: 2 }, { v: 40, g: 3 }, { v: 50, g: 4 }],
    FPD: [{ v: 0, g: 4 }, { v: 9, g: 3 }, { v: 13, g: 2 }, { v: 17, g: 1 }, { v: 30, g: 0 }],
    ANU: [{ v: 6, g: 4 }, { v: 8, g: 3 }, { v: 10, g: 2 }, { v: 12, g: 1 }, { v: 25, g: 0 }],
    GNU: [{ v: 38, g: 4 }, { v: 50, g: 3 }, { v: 63, g: 2 }, { v: 75, g: 1 }, { v: 100, g: 0 }],
    UEC: [{ v: 25, g: 1 }, { v: 37, g: 2 }, { v: 50, g: 3 }, { v: 62, g: 4 }, { v: 100, g: 4 }],
    CC:  [{ v: 10, g: 0 }, { v: 15, g: 1 }, { v: 20, g: 2 }, { v: 25, g: 3 }, { v: 30, g: 4 }, { v: 100, g: 4 }],
    MR:  [{ v: 0, g: 0 }, { v: 5, g: 1.5 }, { v: 10, g: 2.5 }, { v: 15, g: 3.5 }, { v: 20, g: 4 }, { v: 100, g: 4 }]
  };

  function interp(value, anchors) {
    if (value === null || value === undefined || isNaN(value)) return null;
    var a = anchors;
    if (value <= a[0].v) return a[0].g;
    for (var i = 1; i < a.length; i++) {
      if (value <= a[i].v) {
        var p = a[i - 1], q = a[i];
        var t = (value - p.v) / (q.v - p.v);
        return p.g + (q.g - p.g) * t;
      }
    }
    return a[a.length - 1].g;
  }

  function letterOf(g) {
    if (g === null || g === undefined) return '—';
    if (g >= 3.5) return 'A';
    if (g >= 2.5) return 'B';
    if (g >= 1.5) return 'C';
    if (g >= 0.5) return 'D';
    return 'F';
  }

  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* ============================ 采样 ============================ */
  /* 以符号四边形为基准，在模块坐标系内采样；dx/dy 为模块偏移，sx/sy 为以中心为原点的缩放 */
  function sampleGrid(gray, w, h, quad, N, fit, sub) {
    var IMG = Q();
    var H = IMG.homographyFromUnitSquare(quad);
    var cells = new Float32Array(N * N);
    var lo = new Float32Array(N * N);
    var hi = new Float32Array(N * N);
    var dx = fit.dx || 0, dy = fit.dy || 0, sx = fit.sx || 1, sy = fit.sy || 1;
    var half = N / 2;
    var span = sub === 1 ? 0 : 0.625;
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var uc = (half + (c + 0.5 - half) * sx + dx) / N;
        var vr = (half + (r + 0.5 - half) * sy + dy) / N;
        var i = r * N + c;
        if (sub === 1) {
          var p = IMG.applyH(H, uc, vr);
          var val = IMG.bilinear(gray, w, h, p.x, p.y);
          cells[i] = val; lo[i] = val; hi[i] = val;
        } else {
          var sum = 0, mn = 255, mx = 0, n = 0;
          for (var a = 0; a < sub; a++) {
            for (var b = 0; b < sub; b++) {
              var du = (((a + 0.5) / sub) - 0.5) * span;
              var dv = (((b + 0.5) / sub) - 0.5) * span;
              var p2 = IMG.applyH(H, uc + du / N, vr + dv / N);
              var v2 = IMG.bilinear(gray, w, h, p2.x, p2.y);
              sum += v2;
              if (v2 < mn) mn = v2;
              if (v2 > mx) mx = v2;
              n++;
            }
          }
          cells[i] = sum / n;
          lo[i] = mn;
          hi[i] = mx;
        }
      }
    }
    return { means: cells, lo: lo, hi: hi, H: H };
  }

  /* 对比度统计：Rmax/Rmin 取各模块反射率的高/低 10% 均值，抑制噪声与污点 */
  function contrastStats(means, polarity) {
    var IMG = Q();
    var arr = Array.prototype.slice.call(means);
    var rTop = IMG.meanOfTop(arr, 0.1);
    var rBot = IMG.meanOfBottom(arr, 0.1);
    var rmax = Math.max(rTop, rBot);
    var rmin = Math.min(rTop, rBot);
    var sc = rmax - rmin;
    var gt = (rmax + rmin) / 2;
    var light = polarity ? rmin : rmax;
    var dark = polarity ? rmax : rmin;
    return { rmax: rmax, rmin: rmin, sc: sc, gt: gt, light: light, dark: dark };
  }

  function binarize(means, gt, polarity) {
    var out = new Uint8Array(means.length);
    for (var i = 0; i < means.length; i++) {
      var dark = means[i] < gt;
      out[i] = polarity ? (dark ? 0 : 1) : (dark ? 1 : 0);
    }
    return out;
  }

  /* 组的均值（明/暗），用于 DPM 的 CC 与 CMOD */
  function groupMeans(means, polarity) {
    var arr = Array.prototype.slice.call(means).sort(function (a, b) { return a - b; });
    var k = Math.max(1, Math.round(arr.length * 0.35));
    var low = 0, high = 0;
    for (var i = 0; i < k; i++) low += arr[i];
    for (var j = arr.length - k; j < arr.length; j++) high += arr[j];
    low /= k; high /= k;
    return polarity ? { mDark: high, mLight: low } : { mDark: low, mLight: high };
  }

  /* ============================ 假设搜索（网格微校准） ============================ */
  function evaluateFit(gray, w, h, quad, N, fit, polarity, ctx) {
    var QS = Q();
    var sg = sampleGrid(gray, w, h, quad, N, fit, 3);
    var st = contrastStats(sg.means, polarity);
    if (st.sc < 1) return { score: 1e9, bad: true };
    var bin = binarize(sg.means, st.gt, polarity);
    var fmt = QS.readFormat(bin, N);
    if (!fmt.valid) return { score: 1e8 + fmt.dmin, fmt: fmt, stats: st, bad: true };
    var cw = QS.readCodewords(bin, N, fmt.mask, ctx.map.fn);
    var rs = QS.rsAnalyze(cw, ctx.version, fmt.ecl);
    if (!rs) return { score: 1e8, fmt: fmt, stats: st, bad: true };
    // 主要指标：可纠正的错误码字数；次要指标：模块反射率离阈值的平均距离（越大越对准）
    var sep = 0;
    for (var i = 0; i < sg.means.length; i++) sep += Math.abs(sg.means[i] - st.gt);
    sep = sep / sg.means.length / (st.sc || 1);
    var penalty = (Math.abs(fit.dx || 0) + Math.abs(fit.dy || 0)) * 0.6 +
      (Math.abs((fit.sx || 1) - 1) + Math.abs((fit.sy || 1) - 1)) * 6;
    var score = rs.errorsCorrected * 1000 + rs.uncorrectableBlocks * 10000 - sep * 20 + penalty;
    return { score: score, fmt: fmt, stats: st, rs: rs, bw: bin, grid: sg, bad: false };
  }

  function fitGrid(gray, w, h, quad, N, version, polarityIn) {
    var QS = Q();
    var map = QS.buildMap(N, version);
    var ctx = { map: map, version: version };
    var best = null;
    var polarity = polarityIn === undefined ? 0 : polarityIn;

    function tryFit(dx, dy, sx, sy, pol) {
      var r = evaluateFit(gray, w, h, quad, N, { dx: dx, dy: dy, sx: sx, sy: sy }, pol, ctx);
      r.fit = { dx: dx, dy: dy, sx: sx, sy: sy };
      r.polarity = pol;
      if (!best || r.score < best.score) best = r;
      return r;
    }

    // 极性判定：同时试正常/反相，取更优
    var p0 = tryFit(0, 0, 1, 1, 0);
    var p1 = tryFit(0, 0, 1, 1, 1);
    polarity = (p1.score < p0.score) ? 1 : 0;
    best = null;

    var offs = [-0.3, -0.15, 0, 0.15, 0.3];
    for (var i = 0; i < offs.length; i++) {
      for (var j = 0; j < offs.length; j++) tryFit(offs[i], offs[j], 1, 1, polarity);
    }
    var coarse = { dx: best.fit.dx, dy: best.fit.dy };
    for (var a = -1; a <= 1; a++) {
      for (var b = -1; b <= 1; b++) {
        tryFit(coarse.dx + a * 0.075, coarse.dy + b * 0.075, 1, 1, polarity);
      }
    }
    var refined = { dx: best.fit.dx, dy: best.fit.dy };
    var scales = [0.97, 1, 1.03];
    for (var s = 0; s < scales.length; s++) {
      for (var s2 = 0; s2 < scales.length; s2++) {
        tryFit(refined.dx, refined.dy, scales[s], scales[s2], polarity);
      }
    }
    best.map = map;
    best.polarity = polarity;
    return best;
  }

  /* ============================ 网格非均匀性（定时图案边缘） ============================ */
  function timingDeviation(gray, w, h, H, N, gt, horizontal) {
    var IMG = Q();
    var start = 8, end = N - 8;
    if (end - start < 3) return null;
    var step = 1 / 20;
    var prev = null, deviations = [];
    for (var m = start; m <= end + 1e-9; m += step) {
      var u, v;
      if (horizontal) { u = m / N; v = (6 + 0.5) / N; }
      else { u = (6 + 0.5) / N; v = m / N; }
      var p = IMG.applyH(H, u, v);
      var val = IMG.bilinear(gray, w, h, p.x, p.y);
      if (prev !== null) {
        var a = prev.val - gt, b = val - gt;
        if (a === 0 || (a < 0) !== (b < 0)) {
          var t = a / (a - b);
          var pos = prev.m + (m - prev.m) * t;
          var nearest = Math.round(pos);
          if (nearest >= start && nearest <= end && Math.abs(pos - nearest) < 0.5) {
            deviations.push(Math.abs(pos - nearest));
          }
        }
      }
      prev = { m: m, val: val };
    }
    var expect = end - start;
    if (deviations.length < Math.max(4, expect * 0.5)) return null;
    var maxDev = 0;
    for (var i = 0; i < deviations.length; i++) maxDev = Math.max(maxDev, deviations[i]);
    return { maxDev: maxDev, count: deviations.length, expect: expect };
  }

  /* ============================ 静区检测 ============================ */
  function quietZone(gray, w, h, H, N, gt, polarity) {
    var IMG = Q();
    var sides = [
      { key: 'top', text: '上', cells: [] },
      { key: 'bottom', text: '下', cells: [] },
      { key: 'left', text: '左', cells: [] },
      { key: 'right', text: '右', cells: [] }
    ];
    var total = 0, bad = 0, missing = 0;
    var available = { top: 0, bottom: 0, left: 0, right: 0 };

    for (var k = 1; k <= 4; k++) {
      for (var i = 0; i < N; i++) {
        var pts = [
          { side: 'top', r: -k + 0.5, c: i + 0.5 },
          { side: 'bottom', r: N + k - 0.5, c: i + 0.5 },
          { side: 'left', r: i + 0.5, c: -k + 0.5 },
          { side: 'right', r: i + 0.5, c: N + k - 0.5 }
        ];
        for (var s = 0; s < pts.length; s++) {
          var pt = pts[s];
          var p = IMG.applyH(H, pt.c / N, pt.r / N);
          total++;
          if (p.x < 0 || p.y < 0 || p.x > w - 1 || p.y > h - 1) {
            missing++;
            continue;
          }
          var val = IMG.bilinear(gray, w, h, p.x, p.y);
          var isDark = polarity ? (val > gt) : (val < gt);
          if (isDark) bad++;
          else {
            // 该层该位置为浅色，记录静区可用宽度
          }
        }
      }
    }
    // 逐侧可用静区宽度：从符号边界向外，连续全为浅色的模块数
    function sideWidth(getPos) {
      var width = 0;
      for (var kk = 1; kk <= 4; kk++) {
        var ok = true;
        for (var ii = 0; ii < N; ii++) {
          var pos = getPos(kk, ii);
          var pp = IMG.applyH(H, pos.c / N, pos.r / N);
          if (pp.x < 0 || pp.y < 0 || pp.x > w - 1 || pp.y > h - 1) { ok = false; break; }
          var vv = IMG.bilinear(gray, w, h, pp.x, pp.y);
          var dk = polarity ? (vv > gt) : (vv < gt);
          if (dk) { ok = false; break; }
        }
        if (!ok) break;
        width = kk;
      }
      return width;
    }
    available.top = sideWidth(function (kk, ii) { return { r: -kk + 0.5, c: ii + 0.5 }; });
    available.bottom = sideWidth(function (kk, ii) { return { r: N + kk - 0.5, c: ii + 0.5 }; });
    available.left = sideWidth(function (kk, ii) { return { r: ii + 0.5, c: -kk + 0.5 }; });
    available.right = sideWidth(function (kk, ii) { return { r: ii + 0.5, c: N + kk - 0.5 }; });

    return {
      total: total,
      bad: bad,
      missing: missing,
      missingRatio: total ? missing / total : 1,
      damagedRatio: total ? bad / (total - missing || 1) : 1,
      available: available,
      minWidth: Math.min(available.top, available.bottom, available.left, available.right)
    };
  }

  /* ============================ 数据类型解析 ============================ */
  function describePayload(text) {
    var t = (text || '').trim();
    if (/^https?:\/\//i.test(t)) {
      var host = t.replace(/^https?:\/\//i, '').split(/[\/?#]/)[0];
      return { kind: 'URL', label: '网址', detail: host };
    }
    if (/^WIFI:/i.test(t)) return { kind: 'WIFI', label: '无线网络配置', detail: (t.match(/S:([^;]*)/i) || [, ''])[1] };
    if (/^BEGIN:VCARD/i.test(t)) {
      var fn = (t.match(/FN:([^\r\n]*)/i) || [, ''])[1];
      return { kind: 'VCARD', label: '联系人名片', detail: fn };
    }
    if (/^BEGIN:VEVENT/i.test(t)) return { kind: 'VEVENT', label: '日程事件', detail: '' };
    if (/^mailto:/i.test(t)) return { kind: 'MAILTO', label: '电子邮件', detail: t.slice(7) };
    if (/^tel:/i.test(t)) return { kind: 'TEL', label: '电话号码', detail: t.slice(4) };
    if (/^smsto:/i.test(t) || /^sms:/i.test(t)) return { kind: 'SMS', label: '短信', detail: t.replace(/^smsto?:/i, '') };
    if (/^geo:/i.test(t)) return { kind: 'GEO', label: '地理坐标', detail: t.slice(4) };
    if (/^[0-9]+$/.test(t)) return { kind: 'NUMERIC', label: '数字串', detail: t.length + ' 位' };
    return { kind: 'TEXT', label: '文本', detail: t.length + ' 字符' };
  }

  /* ============================ 图像清晰度（辅助） ============================ */
  function focusScore(gray, w, h, quad, N) {
    var IMG = Q();
    var H = IMG.homographyFromUnitSquare(quad);
    var p0 = IMG.applyH(H, 0, 0);
    var p1 = IMG.applyH(H, 1, 1);
    var x0 = Math.max(0, Math.floor(Math.min(p0.x, p1.x)));
    var x1 = Math.min(w - 1, Math.ceil(Math.max(p0.x, p1.x)));
    var y0 = Math.max(0, Math.floor(Math.min(p0.y, p1.y)));
    var y1 = Math.min(h - 1, Math.ceil(Math.max(p0.y, p1.y)));
    var sum = 0, sum2 = 0, count = 0;
    for (var y = y0 + 1; y < y1 - 1; y += 2) {
      for (var x = x0 + 1; x < x1 - 1; x += 2) {
        var i = y * w + x;
        var lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        sum += lap; sum2 += lap * lap; count++;
      }
    }
    if (!count) return null;
    var mean = sum / count;
    return Math.max(0, sum2 / count - mean * mean);
  }

  /* ============================ 主流程 ============================ */
  function analyze(imageData, options) {
    var t0 = Date.now();
    var opts = options || {};
    var IMG = Q();
    var QS = Q();
    var jsQR = opts.jsQR || (root && root.jsQR) || (root && root.QRQ && root.QRQ.jsQR);
    var standard = opts.standard === '29158' ? '29158' : '15415';
    var notes = [];
    var warnings = [];

    if (!jsQR) return { ok: false, reason: 'nolib', message: '解码库未加载' };

    var maxSide = opts.maxSide || 1400;
    var scaled = IMG.downscaleRGBA(imageData.data, imageData.width, imageData.height, maxSide);
    var gray = IMG.grayFromRGBA(scaled.data, scaled.width, scaled.height);

    // 多策略识读：原图 → 对比度拉伸（低对比度符号） → 原始分辨率
    var decoded = null;
    var attempts = [
      { data: scaled.data, gray: gray, w: scaled.width, h: scaled.height, tag: '原图' },
      { data: IMG.stretchRGBA(gray, scaled.width, scaled.height), gray: gray, w: scaled.width, h: scaled.height, tag: '对比度拉伸' }
    ];
    if (imageData.width !== scaled.width || imageData.height !== scaled.height) {
      attempts.push({
        data: imageData.data,
        gray: IMG.grayFromRGBA(imageData.data, imageData.width, imageData.height),
        w: imageData.width, h: imageData.height, tag: '原始分辨率'
      });
    }
    for (var ai = 0; ai < attempts.length && !decoded; ai++) {
      var a = attempts[ai];
      var tmp = jsQR(new Uint8ClampedArray(a.data), a.w, a.h, { inversionAttempts: 'attemptBoth' });
      if (tmp) decoded = { result: tmp, gray: a.gray, w: a.w, h: a.h, tag: a.tag };
    }

    if (!decoded) {
      return {
        ok: false,
        reason: 'nodecode',
        message: '未能识读二维码',
        standard: standard,
        timingMs: Date.now() - t0,
        hints: [
          '将二维码完整置于取景框内，保持 4 个模块以上的静区边距',
          '提高环境照度，避免反光与阴影；必要时开启补光',
          '保证对焦清晰，二维码占画面比例不小于 40%',
          '若为金属/塑料直接打标，改用 ISO/IEC 29158 (AIM-DPM) 评估模式'
        ]
      };
    }

    var res = decoded.result;
    var version = res.version || 1;
    var N = 17 + 4 * version;
    var loc = res.location;
    var quad = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];

    // 网格拟合
    var fit = fitGrid(decoded.gray, decoded.w, decoded.h, quad, N, version);
    var useQuad = quad;
    var map = fit.map;

    // 最终采样（5×5 子采样 ≈ 孔径）
    var sg = sampleGrid(decoded.gray, decoded.w, decoded.h, useQuad, N, fit.fit, 5);
    var stats = contrastStats(sg.means, fit.polarity);
    var bin = binarize(sg.means, stats.gt, fit.polarity);
    var fmt = fit.fmt || QS.readFormat(bin, N);
    var cw = QS.readCodewords(bin, N, fmt.mask, map.fn);
    var rs = QS.rsAnalyze(cw, version, fmt.ecl);

    if (!fmt.valid) {
      warnings.push('格式信息读取置信度低（汉明距离 ' + fmt.dmin + '），纠错余量可能偏差');
    }
    if (rs && !rs.ok) {
      warnings.push('存在超出纠错能力的纠错块，符号可能已受损');
    }
    if (fit.bad) {
      warnings.push('网格定位置信度低：图像可能存在较强畸变、模糊或遮挡');
    }

    // ---- 参数计算 ----
    var scPercent = stats.sc / 255 * 100;
    var gm = groupMeans(sg.means, fit.polarity);

    // 调制度（15415：MOD = 2|R-GT| / SC）
    var mods = new Float32Array(N * N);
    var modMin = 999;
    var scPx = stats.sc || 1;
    for (var i = 0; i < sg.means.length; i++) {
      var v = Math.abs(sg.means[i] - stats.gt) * 2 / scPx * 100;
      mods[i] = v;
      if (v < modMin) modMin = v;
    }
    // 单元调制度（29158：以明暗分布均值为尺度）
    var cmods = new Float32Array(N * N);
    var cmodMin = 999;
    var T2 = stats.gt;
    var dDen = Math.abs(T2 - gm.mDark) || 1;
    var lDen = Math.abs(gm.mLight - T2) || 1;
    for (var ci = 0; ci < sg.means.length; ci++) {
      var R = sg.means[ci];
      var cval;
      if (R < T2) cval = (T2 - R) / dDen;
      else cval = (R - T2) / lDen;
      cval = Math.max(0, Math.min(1.5, cval)) * 100;
      cmods[ci] = cval;
      if (cval < cmodMin) cmodMin = cval;
    }

    // 固定图形损伤
    var compResults = [];
    for (var ci2 = 0; ci2 < map.comps.length; ci2++) {
      var comp = map.comps[ci2];
      var badCount = 0;
      for (var k = 0; k < comp.cells.length; k++) {
        var rc = comp.cells[k];
        var ii = rc[0] * N + rc[1];
        var expect = map.exp[ii];
        if (expect < 0) continue;
        if ((bin[ii] ? 1 : 0) !== expect) badCount++;
      }
      var pct = comp.cells.length ? badCount / comp.cells.length * 100 : 0;
      compResults.push({
        key: comp.key,
        name: comp.name,
        modules: comp.cells.length,
        damaged: badCount,
        percent: pct,
        grade: interp(pct, ANCHORS.FPD)
      });
    }

    // 静区
    var qz = quietZone(decoded.gray, decoded.w, decoded.h, sg.H, N, stats.gt, fit.polarity);
    var qzPercent = qz.damagedRatio * 100;
    var qzGrade = null;
    var qzNote = '';
    if (qz.minWidth === 0) {
      qzPercent = null;
      qzNote = '图像已裁切至符号边缘，静区无法评估';
    } else {
      var widthAnchors = [0, 0.4, 1.2, 2.2, 4];
      var widthGrade = widthAnchors[Math.min(4, Math.max(0, qz.minWidth))];
      if (qz.missing > 0) widthGrade = Math.max(widthGrade, 1.5); // 图像裁切时保守处理
      qzGrade = Math.min(interp(qzPercent, ANCHORS.FPD), widthGrade);
      if (qz.minWidth < 4) qzNote = '实测静区 ' + qz.minWidth + ' 模块（要求 4）';
    }
    compResults.push({
      key: 'quiet',
      name: '静区（4 模块）',
      modules: qz.total - qz.missing,
      damaged: qz.bad,
      percent: qzPercent === null ? null : qzPercent,
      grade: qzGrade,
      note: qzNote
    });
    if (qz.minWidth === 0) {
      warnings.push('图像已裁切至符号边缘，静区无法评估；建议拍摄时留出至少 4 个模块边距');
    } else if (qz.minWidth < 4) {
      warnings.push('图像内静区仅 ' + qz.minWidth + ' 个模块（要求 4 个），请确认拍摄/截图是否裁切过紧');
    }

    var gradedComps = compResults.filter(function (c) { return c.grade !== null; });
    var fpdGrade = gradedComps.length ? Math.min.apply(null, gradedComps.map(function (c) { return c.grade; })) : null;
    var fpdPercent = gradedComps.length ? Math.max.apply(null, gradedComps.map(function (c) { return c.percent || 0; })) : null;
    var agGrade = gradedComps.length ? gradedComps.reduce(function (s, c) { return s + c.grade; }, 0) / gradedComps.length : null;

    // 轴向非均匀性
    var pTL = IMG.applyH(sg.H, 0, 0), pTR = IMG.applyH(sg.H, 1, 0);
    var pBR = IMG.applyH(sg.H, 1, 1), pBL = IMG.applyH(sg.H, 0, 1);
    var hPitch = ((Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y)) + (Math.hypot(pBR.x - pBL.x, pBR.y - pBL.y))) / 2 / N;
    var vPitch = ((Math.hypot(pBL.x - pTL.x, pBL.y - pTL.y)) + (Math.hypot(pBR.x - pTR.x, pBR.y - pTR.y))) / 2 / N;
    var anu = Math.abs(hPitch - vPitch) / ((hPitch + vPitch) / 2) * 100;

    // 网格非均匀性
    var devH = timingDeviation(decoded.gray, decoded.w, decoded.h, sg.H, N, stats.gt, true);
    var devV = timingDeviation(decoded.gray, decoded.w, decoded.h, sg.H, N, stats.gt, false);
    var gnu = null, gnuDetail = null;
    if (devH || devV) {
      var devs = [devH, devV].filter(Boolean);
      gnu = Math.max.apply(null, devs.map(function (d) { return d.maxDev; })) * 100;
      gnuDetail = devs;
    } else {
      warnings.push('定时图案边缘不足，网格非均匀性以控制点残差近似');
      gnu = fit.bad ? null : Math.max(0, (Math.abs(fit.fit.dx) + Math.abs(fit.fit.dy))) * 100;
    }

    // 未用纠错
    var uec = null, uecDetail = null;
    if (rs && rs.capacity > 0) {
      uec = (rs.capacity - rs.errorsCorrected) / rs.capacity * 100;
      if (uec < 0) uec = 0;
      uecDetail = rs;
    }

    // DPM 参数
    var cc = gm.mLight > 0 ? (gm.mLight - gm.mDark) / gm.mLight * 100 : 0;
    var mr = (gm.mLight - gm.mDark) / 255 * 100;

    // 调制度分级（考虑纠错余量的名义 UEC 规则）
    function modGradeOf(list, capacity) {
      var ths = [{ g: 4, v: 50, u: 62 }, { g: 3, v: 40, u: 50 }, { g: 2, v: 30, u: 37 }, { g: 1, v: 20, u: 25 }];
      if (!capacity) return { grade: interp(list[0], ANCHORS.MOD), rule: '仅按最低模块' };
      for (var i2 = 0; i2 < ths.length; i2++) {
        var bad = 0;
        for (var j2 = 0; j2 < list.length; j2++) if (list[j2] < ths[i2].v) bad++;
        var estErr = Math.ceil(bad / 8);
        var allowed = Math.floor(capacity * (1 - ths[i2].u / 100));
        if (estErr <= allowed) return { grade: ths[i2].g, rule: '按名义纠错余量折算' };
      }
      return { grade: interp(list[0], ANCHORS.MOD), rule: '仅按最低模块' };
    }

    var sortedMods = Array.prototype.slice.call(mods).sort(function (a, b) { return a - b; });
    var modGraded = modGradeOf(sortedMods, rs ? rs.capacity : 0);
    var sortedCmods = Array.prototype.slice.call(cmods).sort(function (a, b) { return a - b; });
    var cmodGraded = modGradeOf(sortedCmods, rs ? rs.capacity : 0);

    var uecGrade = uec === null ? null : interp(uec, ANCHORS.UEC);
    var scGrade = interp(scPercent, ANCHORS.SC);
    var anuGrade = interp(anu, ANCHORS.ANU);
    var gnuGrade = gnu === null ? null : interp(gnu, ANCHORS.GNU);
    var ccGrade = interp(cc, ANCHORS.CC);
    var mrGrade = interp(mr, ANCHORS.MR);

    // ---- 指标表 ----
    var metrics = [];
    if (standard === '29158') {
      metrics = [
        { key: 'CC', name: '单元对比度', en: 'Cell Contrast', value: cc, unit: '%', grade: ccGrade, desc: '明/暗单元平均反射率之差相对明单元的百分比，DPM 场景以统计阈值衡量。' },
        { key: 'CM', name: '单元调制度', en: 'Cell Modulation', value: cmodMin, unit: '%', grade: cmodGraded.grade, desc: '以明暗分布均值为尺度，衡量最差单元靠近阈值的程度，并按纠错余量折算。' },
        { key: 'MR', name: '最小反射率', en: 'Minimum Reflectance', value: mr, unit: '%', desc: '明暗单元绝对反射率差相对标定白的百分比，用于抑制纯相对对比度的失真。', grade: mrGrade },
        { key: 'FPD', name: '固定图形损伤', en: 'Fixed Pattern Damage', value: fpdPercent, unit: '%', grade: fpdGrade, desc: '定位图案、定时图案、校正图案与静区中错误模块占比，取最差项。' },
        { key: 'DDG', name: '分布性损伤', en: 'Distributed Damage', value: agGrade, unit: '级', grade: agGrade, desc: '固定图形各段损伤的平均等级，反映多点分散损伤的整体影响。' },
        { key: 'AN', name: '轴向非均匀性', en: 'Axial Nonuniformity', value: anu, unit: '%', grade: anuGrade, desc: '水平与垂直模块间距的差异比例，反映拉伸、拍角造成的非等比失真。' },
        { key: 'GN', name: '网格非均匀性', en: 'Grid Nonuniformity', value: gnu, unit: '%', grade: gnuGrade, desc: '实际模块中心相对理想等距网格的最大偏移，以模块尺寸百分比表示。' },
        { key: 'UEC', name: '未用纠错', en: 'Unused Error Correction', value: uec, unit: '%', grade: uecGrade, desc: '纠错能力剩余比例；本项由逐块 Reed-Solomon 解码测得，非估算。' }
      ];
    } else {
      metrics = [
        { key: 'SC', name: '符号对比度', en: 'Symbol Contrast', value: scPercent, unit: '%', grade: scGrade, desc: '符号内最亮与最暗模块反射率之差，空白色与实地色的分离能力。' },
        { key: 'MOD', name: '调制度', en: 'Modulation', value: modMin, unit: '%', grade: modGraded.grade, desc: '最差模块相对全局阈值的裕度（MOD=2|R−GT|/SC），按纠错余量折算等级。' },
        { key: 'FPD', name: '固定图形损伤', en: 'Fixed Pattern Damage', value: fpdPercent, unit: '%', grade: fpdGrade, desc: '定位图案、定时图案、校正图案与静区错误模块占比，取最差项。' },
        { key: 'AN', name: '轴向非均匀性', en: 'Axial Nonuniformity', value: anu, unit: '%', grade: anuGrade, desc: '水平与垂直模块间距差异比例，反映印刷拉伸或拍摄角度造成的变形。' },
        { key: 'GN', name: '网格非均匀性', en: 'Grid Nonuniformity', value: gnu, unit: '%', grade: gnuGrade, desc: '模块中心相对理想网格的最大偏移（按定时图案边缘实测）。' },
        { key: 'UEC', name: '未用纠错', en: 'Unused Error Correction', value: uec, unit: '%', grade: uecGrade, desc: '纠错能力剩余比例 =（可纠码字数 − 已纠正码字数）/ 可纠码字数。' }
      ];
    }

    // 综合等级 = 各参数最低等级（识读失败直接判 F）
    var allGrades = metrics.filter(function (m) { return m.grade !== null && m.grade !== undefined; }).map(function (m) { return m.grade; });
    allGrades.push(4);
    var overall = Math.min.apply(null, allGrades);
    if (!fmt.valid && fit.bad) overall = Math.min(overall, 1);
    if (rs && !rs.ok) overall = Math.min(overall, 1);

    var payload = res.data || '';
    var dataType = describePayload(payload);
    var focus = focusScore(decoded.gray, decoded.w, decoded.h, quad, N);

    // 条件提示
    var moduleSizePx = hPitch;
    if (moduleSizePx < 3.5) {
      warnings.push('模块尺寸仅 ' + round1(moduleSizePx) + ' px，采样分辨率不足，建议提高拍摄分辨率');
    }
    if (focus !== null && focus < 12) {
      warnings.push('图像清晰度偏低（' + round1(focus) + '），建议重新对焦拍摄');
    }
    if (fit.polarity) notes.push('检测到反相（浅色模块 / 深色底）符号，已按反相解析');

    var gradeValue = round1(overall);
    var gradeLetter = letterOf(overall);

    var result = {
      ok: true,
      standard: standard,
      standardName: standard === '29158' ? 'ISO/IEC 29158（AIM-DPM）' : 'ISO/IEC 15415',
      grade: { value: gradeValue, letter: gradeLetter, text: gradeText(gradeValue) },
      metrics: metrics,
      decode: {
        ok: true,
        text: payload,
        dataType: dataType,
        bytes: res.binaryData ? res.binaryData.length : 0,
        version: version,
        size: N,
        ecl: fmt.ecl,
        mask: fmt.mask,
        eccLevel: fmt.ecl,
        blocks: rs ? rs.blockCount : null,
        dataCodewords: rs ? rs.dataCodewords : null,
        ecCodewords: rs ? rs.ecCodewords : null,
        capacity: rs ? rs.capacity : null,
        errorsCorrected: rs ? rs.errorsCorrected : null,
        formatDistance: fmt.dmin,
        chunks: (res.chunks || []).map(function (c) { return { type: c.type, text: c.text }; })
      },
      symbol: {
        version: version,
        size: N,
        modulePx: round2(hPitch),
        modulePxV: round2(vPitch),
        widthPx: round2(Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y)),
        rmax: round1(stats.rmax),
        rmin: round1(stats.rmin),
        gt: round1(stats.gt),
        polarity: fit.polarity,
        sampling: '3×3 子采样 / 模块',
        focus: focus === null ? null : round1(focus),
        quietZone: {
          required: 4,
          measured: qz.minWidth,
          damaged: qz.bad,
          percent: qzPercent === null ? null : round1(qzPercent)
        },
        components: compResults.map(function (c) {
          return { key: c.key, name: c.name, modules: c.modules, damaged: c.damaged, percent: c.percent === null ? null : round1(c.percent), grade: c.grade === null ? null : round1(c.grade), note: c.note || '' };
        }),
        fit: { dx: round2(fit.fit.dx), dy: round2(fit.fit.dy), sx: round2(fit.fit.sx), sy: round2(fit.fit.sy) },
        gnuDetail: gnuDetail,
        uecDetail: uecDetail
      },
      geometry: {
        N: N,
        quad: quad,
        offsets: fit.fit,
        imageWidth: decoded.w,
        imageHeight: decoded.h
      },
      heat: { mods: Array.prototype.slice.call(standard === '29158' ? cmods : mods), N: N },
      modules: { bin: Array.prototype.slice.call(bin), means: Array.prototype.slice.call(sg.means) },
      notes: notes,
      warnings: warnings,
      verdict: buildVerdict(gradeValue, metrics, warnings, standard),
      timingMs: Date.now() - t0
    };
    return result;
  }

  function gradeText(g) {
    if (g >= 3.5) return '优秀';
    if (g >= 2.5) return '良好';
    if (g >= 1.5) return '合格';
    if (g >= 0.5) return '偏低';
    return '不合格';
  }

  var ADVICE = {
    SC: '提高空白色与实地区的反射率差：换用更高黑度的墨/色带，或降低底材明度；避免使用浅灰、浅金色作为模块色。',
    MOD: '提升模块一致性：减少喷墨扩散与墨量不足，避免底材纹理透印；拍摄时避免光照不均与局部反光。',
    CC: '提高标记单元与底材的反射率差：调整打标功率/深度或改用更适合的照明角度（30Q/45Q/Dome）。',
    CM: '改善单元一致性：打标能量不均或表面粗糙会压低单元调制度，建议调整打标参数或改用漫射照明。',
    MR: '绝对反射差不足：需在指定照明与标定条件下重新测量，或提高标记对比（更深/更亮的标记）。',
    FPD: '定位/定时图案受损：检查印刷缺墨、磨损、覆膜气泡或打标偏位；保证 4 个模块静区完整。',
    DDG: '固定图形存在多点分散损伤，整体可靠性下降：逐项检查三个定位图案、定时图案与静区。',
    AN: '轴向非均匀性偏大：多为印刷拉伸、覆膜收缩或拍摄角度过大，建议垂直拍摄并复核印刷等比。',
    GN: '网格非均匀性偏大：常见于曲面贴合、镜头畸变或网格定位漂移，建议改善平整度与拍摄距离。',
    UEC: '纠错余量不足：缩短编码内容、提高纠错等级（建议 M 以上），或改善印刷质量以减少损伤。'
  };

  function buildVerdict(gradeValue, metrics, warnings, standard) {
    var sorted = metrics.filter(function (m) { return m.grade !== null && m.grade !== undefined; })
      .sort(function (a, b) { return a.grade - b.grade; });
    var weak = sorted.slice(0, 2);
    var lines = [];
    var tone;
    if (gradeValue >= 3.5) {
      tone = 'pass';
      lines.push('综合等级 ' + gradeValue.toFixed(1) + '（' + letterOf(gradeValue) + '），符号质量优秀，在常规光照、磨损与低端识读设备条件下仍具备充分裕度。');
    } else if (gradeValue >= 2.5) {
      tone = 'pass';
      lines.push('综合等级 ' + gradeValue.toFixed(1) + '（' + letterOf(gradeValue) + '），质量良好，满足多数工业与商业条码验收要求（B 级）。');
    } else if (gradeValue >= 1.5) {
      tone = 'warn';
      lines.push('综合等级 ' + gradeValue.toFixed(1) + '（' + letterOf(gradeValue) + '），达到多数行业最低验收线（C 级），但在磨损、反光或低分辨率设备下裕度有限。');
    } else if (gradeValue >= 0.5) {
      tone = 'warn';
      lines.push('综合等级 ' + gradeValue.toFixed(1) + '（' + letterOf(gradeValue) + '），质量偏低，存在识读失败风险，建议改善制码与成像条件后复检。');
    } else {
      tone = 'fail';
      lines.push('综合等级 ' + gradeValue.toFixed(1) + '（F），未达到可用质量水平，建议重新制码。');
    }

    var details = [];
    if (weak.length && weak[0].grade < 3.5) {
      details.push('最弱项为「' + weak[0].name + '」' + formatMetric(weak[0]) + '，等级 ' + letterOf(weak[0].grade) + '，构成整体等级的下限。');
      if (weak[1] && weak[1].grade < 3.0) {
        details.push('次弱项「' + weak[1].name + '」' + formatMetric(weak[1]) + '，等级 ' + letterOf(weak[1].grade) + '，进一步压缩了识读裕度。');
      }
    } else {
      details.push('各参数均在 A 级或接近 A 级，未发现明显短板。');
    }
    if (standard === '29158') {
      details.push('按 ISO/IEC 29158 评估：阈值取自反射率分布统计量，等级整体高于同图按 15415 评估的结果，适用于直接零件打标。');
    }

    var advice = [];
    for (var i = 0; i < Math.min(2, weak.length); i++) {
      if (weak[i].grade >= 3.0) continue;
      var a = ADVICE[weak[i].key];
      if (a) advice.push(a);
    }
    if (!advice.length) advice.push('保持现有制码参数，按批次抽检并留存图像记录以便趋势追踪。');
    advice.push('建议在标准照明（45°/0° 或 45Q）与标定白板条件下复测，以获得可溯源的等级值。');

    return {
      tone: tone,
      headline: lines[0],
      details: details,
      advice: advice,
      warnings: warnings
    };
  }

  function formatMetric(m) {
    if (m.value === null || m.value === undefined) return '';
    return ' ' + round1(m.value) + (m.unit || '');
  }

  return {
    analyze: analyze,
    ANCHORS: ANCHORS,
    interp: interp,
    letterOf: letterOf,
    gradeText: gradeText,
    describePayload: describePayload
  };
});
