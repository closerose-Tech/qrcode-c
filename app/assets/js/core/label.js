/*!
 * QRQ · 件烟标签合规测评
 * 依据《卷烟件烟标签技术规范》：表1 规格名称排版、表2 各区域尺寸、表3 字体规格及排布
 * 以 105mm×75mm 标签为基准，通过透视校正后的比例换算量测各区域位置、尺寸与字号
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    root.QRQ.Label = api;
    for (var k in api) {
      // analyze 与二维码分级引擎（qrgrade.js）同名，平铺会覆盖 QRQ.analyze，
      // 导致二维码页拿到标签量测结果、读 geometry 时报错。此处必须跳过。
      if (k === 'analyze') continue;
      root.QRQ[k] = api[k];
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PT = 0.3528;                 // 1pt = 0.3528mm
  var W = 105, H = 75;             // 标签基准尺寸（表2 前置条件）
  var PPM = 10;                    // 校正后每毫米像素数

  /* 表2 + 图4 推导的区域模型（mm），原点为标签左上角 */
  var REGIONS = {
    logo:   { key: 'logo',   name: '标志区域',   x: 6,    y: 6,    w: 50, h: 12 },
    sep:    { key: 'sep',    name: '间隔线',     x: 6,    y: 18.4, w: 50, h: 0.2 },
    name:   { key: 'name',   name: '规格名称区', x: 6,    y: 20.4, w: 50, h: 17 },
    bc:     { key: 'bc',     name: '一维码区域', x: 6,    y: 41,   w: 50, h: 28 },
    qr:     { key: 'qr',     name: '二维码区域', x: 62,   y: 6,    w: 35, h: 35 },
    serial: { key: 'serial', name: '流水码',     x: 61,   y: 44,   w: 38, h: 3 },
    gtin:   { key: 'gtin',   name: '商品编码',   x: 61,   y: 51,   w: 38, h: 4 },
    info:   { key: 'info',   name: '生产信息',   x: 61,   y: 59,   w: 38, h: 10 }
  };

  /* 表3 字体规格 */
  var FONTS = {
    name1: { label: '规格名称 首行', pt: 24, kind: 'cjk' },
    name2: { label: '规格名称 次行', pt: 20, alt: 14, kind: 'cjk' },
    serial: { label: '18 位流水码', pt: 11, kind: 'digit' },
    gtin: { label: '件规格商品编码', pt: 14, kind: 'digit' },
    info: { label: '生产信息（双行）', pt: 11, kind: 'digit' }
  };

  var FONT_FACTOR = {
    cjkInk: 0.95, digitInk: 0.72, cjkAdvance: 1.0, digitAdvance: 0.55
  };

  /* 表1 规格名称排版：≤6 汉字单行；>6 汉字双行（品牌首行，括号及规格次行） */
  var TABLE1 = [
    { chars: '≤6 个汉字', layout: '单行居中', note: '品牌与规格同行' },
    { chars: '＞6 个汉字', layout: '双行居中', note: '品牌首行，括号及规格次行' }
  ];

  var TABLE2 = [
    { no: 1, region: '标志区域', size: '50 × 12' },
    { no: 2, region: '间隔线', size: '50 × 0.2' },
    { no: 3, region: '规格名称区域', size: '50 × 17' },
    { no: 4, region: '一维码区域', size: '50 × 28' },
    { no: 5, region: '二维码区域', size: '35 × 35（不含底框）' },
    { no: 6, region: '数字编码区域 · 18 位唯一流水码', size: '38 × 3' },
    { no: 7, region: '数字编码区域 · 件规格商品编码', size: '38 × 4' },
    { no: 8, region: '数字编码区域 · 生产信息', size: '38 × 10' }
  ];

  var TABLE3 = [
    { region: '规格名称区域', text: '商品规格名称', layout: '单行居中', font: 'Heavy 24pt', note: '总字数 ≤ 6 个汉字' },
    { region: '', text: '', layout: '双行居中', font: '首行 24pt / 次行 20pt', note: '总字数 ＞ 6 个汉字，次行 ≤ 7 个汉字' },
    { region: '', text: '', layout: '', font: '首行 24pt / 次行 14pt', note: '总字数 ＞ 6 个汉字，次行 ＞ 7 个汉字' },
    { region: '数字编码区域', text: '18 位唯一流水码', layout: '单行居中', font: 'Heavy 11pt', note: '' },
    { region: '', text: '件规格商品编码', layout: '单行居中', font: 'Heavy 14pt', note: '' },
    { region: '', text: '生产信息', layout: '双行居中', font: 'Heavy 11pt', note: '' }
  ];

  /* 二维码 105 位编码结构（图5） */
  var QR_STRUCT = [
    { name: '网络服务地址', from: 1, to: 15 },
    { name: '分隔符', from: 16, to: 16 },
    { name: '标识解析前缀', from: 17, to: 25 },
    { name: '分隔符', from: 26, to: 26 },
    { name: '实体分类', from: 27, to: 28 },
    { name: '包装方式', from: 29, to: 29 },
    { name: '经营类型', from: 30, to: 30 },
    { name: '规格码', from: 31, to: 35 },
    { name: '组织机构', from: 36, to: 43 },
    { name: '品牌规格代码', from: 44, to: 56 },
    { name: '生产类型', from: 57, to: 57 },
    { name: '生产时间', from: 58, to: 71 },
    { name: '生产车间', from: 72, to: 73 },
    { name: '打码机编号', from: 74, to: 75 },
    { name: '班次', from: 76, to: 76 },
    { name: '自定义', from: 77, to: 78 },
    { name: '一维码', from: 79, to: 87 },
    { name: '二维码（18 位流水码）', from: 88, to: 105 }
  ];

  /* ------------------------------ 基础工具 ------------------------------ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function r1(v) { return Math.round(v * 10) / 10; }

  function invert3(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    var det = a * A + b * B + c * C;
    if (!det) return null;
    return [
      A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det
    ];
  }

  function homography(quad) {
    // quad 顺序：左上、右上、右下、左下
    var x0 = quad[0].x, y0 = quad[0].y, x1 = quad[1].x, y1 = quad[1].y;
    var x2 = quad[2].x, y2 = quad[2].y, x3 = quad[3].x, y3 = quad[3].y;
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var g = 0, h = 0;
    if (dx3 !== 0 || dy3 !== 0) {
      var det = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(det) < 1e-12) det = 1e-12;
      g = (dx3 * dy2 - dx2 * dy3) / det;
      h = (dx1 * dy3 - dx3 * dy1) / det;
    }
    return [
      x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
      y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
      g, h, 1
    ];
  }

  function apply(m, u, v) {
    var den = m[6] * u + m[7] * v + m[8];
    return { x: (m[0] * u + m[1] * v + m[2]) / den, y: (m[3] * u + m[4] * v + m[5]) / den };
  }

  function quadArea(q) {
    var s = 0;
    for (var i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  }

  function sideLens(q) {
    return [
      Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y),
      Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y),
      Math.hypot(q[3].x - q[2].x, q[3].y - q[2].y),
      Math.hypot(q[0].x - q[3].x, q[0].y - q[3].y)
    ];
  }

  function rotateQuad(q, k) {
    if (k === 1) return [q[3], q[0], q[1], q[2]];
    if (k === 2) return [q[2], q[3], q[0], q[1]];
    if (k === 3) return [q[1], q[2], q[3], q[0]];
    return q;
  }

  function percentile(arr, p) {
    var n = arr.length;
    if (!n) return 0;
    var copy = Array.prototype.slice.call(arr);
    copy.sort(function (a, b) { return a - b; });
    return copy[clamp(Math.round((n - 1) * p), 0, n - 1)];
  }

  /* ------------------------------ 标签检出 ------------------------------ */
  /* 在缩略图上取最亮连通域，用四方向极值点估计标签四角 */
  function detectQuad(gray, width, height, IMG) {
    var maxSide = 300;
    var sc = Math.min(1, maxSide / Math.max(width, height));
    var sw = Math.max(24, Math.round(width * sc));
    var sh = Math.max(24, Math.round(height * sc));
    var small = new Float32Array(sw * sh);
    for (var y = 0; y < sh; y++) {
      var sy = Math.min(height - 1, Math.round(y / sc));
      for (var x = 0; x < sw; x++) {
        var sx = Math.min(width - 1, Math.round(x / sc));
        small[y * sw + x] = gray[sy * width + sx];
      }
    }
    var t = IMG.otsu(small);
    var area = sw * sh;

    var visited = new Uint8Array(area);
    var stack = new Int32Array(area);
    var best = null;
    for (var i0 = 0; i0 < area; i0++) {
      if (visited[i0] || small[i0] <= t) continue;
      var sp = 0;
      stack[sp++] = i0;
      visited[i0] = 1;
      var count = 0;
      var minSum = 1e9, maxSum = -1e9, minDiff = 1e9, maxDiff = -1e9;
      var bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
      var pTL = null, pTR = null, pBR = null, pBL = null;
      while (sp > 0) {
        var p = stack[--sp];
        var px = p % sw, py = (p - px) / sw;
        count++;
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
        if (py < by0) by0 = py; if (py > by1) by1 = py;
        var s = px + py, d = px - py;
        if (s < minSum) { minSum = s; pTL = { x: px, y: py }; }
        if (s > maxSum) { maxSum = s; pBR = { x: px, y: py }; }
        if (d > maxDiff) { maxDiff = d; pTR = { x: px, y: py }; }
        if (d < minDiff) { minDiff = d; pBL = { x: px, y: py }; }
        var nb = [p - 1, p + 1, p - sw, p + sw];
        for (var k = 0; k < 4; k++) {
          var q = nb[k];
          if (q < 0 || q >= area) continue;
          if (k < 2 && Math.floor(q / sw) !== py) continue;
          if (visited[q] || small[q] <= t) continue;
          visited[q] = 1;
          stack[sp++] = q;
        }
      }
      if (count > area * 0.06 && (!best || count > best.count)) {
        best = { count: count, quad: [pTL, pTR, pBR, pBL], box: [bx0, by0, bx1, by1] };
      }
    }
    if (!best || !best.quad[0] || !best.quad[2] || !best.quad[1] || !best.quad[3]) return null;

    var q4 = best.quad.map(function (p) { return { x: p.x / sc, y: p.y / sc }; });
    var lens = sideLens(q4);
    var wAvg = (lens[0] + lens[2]) / 2, hAvg = (lens[1] + lens[3]) / 2;
    var aspect = wAvg / Math.max(1, hAvg);
    if (aspect < 1.08 || aspect > 1.95) return null;
    if (quadArea(q4) < width * height * 0.06) return null;
    return {
      quad: q4,
      aspect: aspect,
      source: 'bright-blob',
      coverage: (quadArea(q4) / (width * height))
    };
  }

  /* 以二维码位置反推标签四角（标签边缘不可见时作为兜底） */
  function quadFromQR(qrLoc, width, height) {
    if (!qrLoc || !qrLoc.topLeftCorner || !qrLoc.topRightCorner || !qrLoc.bottomRightCorner || !qrLoc.bottomLeftCorner) return null;
    var q = [qrLoc.topLeftCorner, qrLoc.topRightCorner, qrLoc.bottomRightCorner, qrLoc.bottomLeftCorner]
      .map(function (p) { return { x: p.x, y: p.y }; });
    var Hm = homography(q);
    // 标签坐标 → 二维码矩形内的归一化坐标 → 图像坐标
    function project(x, y) {
      var s = (x - REGIONS.qr.x) / REGIONS.qr.w;
      var t = (y - REGIONS.qr.y) / REGIONS.qr.h;
      return apply(Hm, s, t);
    }
    var quad = [project(0, 0), project(W, 0), project(W, H), project(0, H)];
    for (var i = 0; i < 4; i++) {
      if (!isFinite(quad[i].x) || !isFinite(quad[i].y)) return null;
    }
    var inside = quad.every(function (p) {
      return p.x > -width * 0.4 && p.x < width * 1.4 && p.y > -height * 0.4 && p.y < height * 1.4;
    });
    if (!inside) return null;
    return { quad: quad, aspect: 0, source: 'qr-projected' };
  }

  /* ------------------------------ 透视校正 ------------------------------ */
  function rectify(gray, width, height, quad, scale) {
    var sc = scale || 1;
    var RW = Math.max(8, Math.round(W * PPM * sc)), RH = Math.max(8, Math.round(H * PPM * sc));
    var M = homography(quad);
    var out = new Float32Array(RW * RH);
    var rgba = new Uint8ClampedArray(RW * RH * 4);
    var k = 0;
    for (var oy = 0; oy < RH; oy++) {
      var v = oy / RH;
      for (var ox = 0; ox < RW; ox++) {
        var u = ox / RW;
        var den = M[6] * u + M[7] * v + M[8];
        var sx = (M[0] * u + M[1] * v + M[2]) / den;
        var sy = (M[3] * u + M[4] * v + M[5]) / den;
        var val;
        if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) {
          val = 255;
        } else {
          var x0 = Math.floor(sx), y0 = Math.floor(sy);
          var x1 = x0 + 1 < width ? x0 + 1 : x0;
          var y1 = y0 + 1 < height ? y0 + 1 : y0;
          var fx = sx - x0, fy = sy - y0;
          var a = gray[y0 * width + x0], b = gray[y0 * width + x1];
          var c = gray[y1 * width + x0], d = gray[y1 * width + x1];
          val = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
        }
        out[k] = val;
        rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = val;
        rgba[k * 4 + 3] = 255;
        k++;
      }
    }
    return { gray: out, rgba: rgba, w: RW, h: RH, ok: true, scale: sc };
  }

  /* ------------------------------ 量测 ------------------------------ */
  function makeMeasure(rect, thr) {
    var RW = rect.w, RH = rect.h, G = rect.gray;

    function inkAt(x, y) {
      var px = Math.round(x), py = Math.round(y);
      if (px < 0 || py < 0 || px >= RW || py >= RH) return 0;
      return G[py * RW + px] < thr ? 1 : 0;
    }

    function box(x0, y0, x1, y1) {
      var px0 = clamp(Math.round(x0 * PPM), 0, RW - 1);
      var px1 = clamp(Math.round(x1 * PPM), 0, RW);
      var py0 = clamp(Math.round(y0 * PPM), 0, RH - 1);
      var py1 = clamp(Math.round(y1 * PPM), 0, RH);
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, n = 0;
      for (var y = py0; y < py1; y++) {
        var base = y * RW;
        for (var x = px0; x < px1; x++) {
          if (G[base + x] < thr) {
            n++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      if (!n) return null;
      return {
        x0: minX / PPM, y0: minY / PPM,
        x1: (maxX + 1) / PPM, y1: (maxY + 1) / PPM,
        w: (maxX + 1 - minX) / PPM, h: (maxY + 1 - minY) / PPM,
        ink: n
      };
    }

    /* 行投影分段，返回文字/图形行带 */
    function bands(x0, y0, x1, y1, gapMm, minInk) {
      var px0 = clamp(Math.round(x0 * PPM), 0, RW);
      var px1 = clamp(Math.round(x1 * PPM), 0, RW);
      var py0 = clamp(Math.round(y0 * PPM), 0, RH);
      var py1 = clamp(Math.round(y1 * PPM), 0, RH);
      var rows = [];
      var maxCount = 1;
      for (var y = py0; y < py1; y++) {
        var c = 0, base = y * RW;
        for (var x = px0; x < px1; x++) if (G[base + x] < thr) c++;
        rows.push(c);
        if (c > maxCount) maxCount = c;
      }
      var gate = Math.max(minInk || 1, maxCount * 0.02);
      var out = [], cur = null, gap = 0;
      var gapPx = Math.max(1, Math.round(gapMm * PPM));
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] > gate) {
          if (!cur) cur = { y0: i, y1: i };
          else cur.y1 = i;
          gap = 0;
        } else if (cur) {
          gap++;
          if (gap >= gapPx) { out.push(cur); cur = null; gap = 0; }
        }
      }
      if (cur) out.push(cur);
      return out.map(function (b) {
        var bb = box(x0, py0 / PPM + b.y0 / PPM, x1, py0 / PPM + (b.y1 + 1) / PPM);
        return {
          y0: (py0 + b.y0) / PPM,
          y1: (py0 + b.y1 + 1) / PPM,
          h: (b.y1 + 1 - b.y0) / PPM,
          x0: bb ? bb.x0 : null,
          x1: bb ? bb.x1 : null,
          w: bb ? bb.w : 0
        };
      });
    }

    return { box: box, bands: bands, inkAt: inkAt };
  }

  /* 一维码条块：行向取最长连续条带，列向取贯通列 */
  function findBars(rect, thr) {
    var RW = rect.w, RH = rect.h, G = rect.gray;
    var x0 = Math.round(4 * PPM), x1 = Math.round(58 * PPM);
    var y0 = Math.round(36.5 * PPM), y1 = Math.round(73 * PPM);
    var rows = [];
    for (var y = y0; y < y1; y++) {
      var c = 0, base = y * RW;
      for (var x = x0; x < x1; x++) if (G[base + x] < thr) c++;
      rows.push(c);
    }
    var maxC = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i] > maxC) maxC = rows[i];
    if (maxC < (x1 - x0) * 0.1) return null;
    var gate = maxC * 0.55;
    var best = null, cur = null;
    for (var r = 0; r < rows.length; r++) {
      if (rows[r] > gate) {
        if (!cur) cur = { a: r, b: r };
        else cur.b = r;
      } else if (cur) {
        if (!best || (cur.b - cur.a) > (best.b - best.a)) best = cur;
        cur = null;
      }
    }
    if (cur && (!best || (cur.b - cur.a) > (best.b - best.a))) best = cur;
    if (!best || best.b - best.a < 10 * PPM * 0.5) return null;
    var yTop = y0 + best.a, yBot = y0 + best.b;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var yy = yTop; yy <= yBot; yy++) {
      var b2 = yy * RW;
      for (var xx = x0; xx < x1; xx++) {
        if (G[b2 + xx] < thr) {
          if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
          if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
        }
      }
    }
    if (minX > maxX) return null;
    return {
      x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
      mm: { x: minX / PPM, y: minY / PPM, w: (maxX - minX + 1) / PPM, h: (maxY - minY + 1) / PPM }
    };
  }

  /* ------------------------------ 字号估算 ------------------------------ */
  function ptFromInk(inkMm, kind) {
    var f = kind === 'cjk' ? FONT_FACTOR.cjkInk : FONT_FACTOR.digitInk;
    return inkMm / (f * PT);
  }

  function ptFromWidth(widthMm, chars, kind) {
    var adv = kind === 'cjk' ? FONT_FACTOR.cjkAdvance : FONT_FACTOR.digitAdvance;
    if (!chars) return null;
    return widthMm / (chars * adv * PT);
  }

  /* ------------------------------ 指标判定 ------------------------------ */
  function judge(dev, okTol, warnTol) {
    var a = Math.abs(dev);
    if (a <= okTol) return 'ok';
    if (a <= warnTol) return 'warn';
    return 'fail';
  }

  function item(o) {
    o.abs = o.value === null || o.std === null ? null : r1(o.value - o.std);
    return o;
  }

  function sizeItem(key, name, value, std, unit, tol, warn) {
    var dev = value === null ? null : value - std;
    return item({
      key: key, name: name, std: std, value: value === null ? null : r1(value),
      unit: unit || 'mm', dev: dev === null ? null : r1(dev),
      status: dev === null ? 'fail' : judge(dev, tol, warn)
    });
  }

  /* 数字区文本行分配：流水码 / 商品编码 / 生产信息（两行） */
  function assignNumericRows(rows) {
    if (!rows.length) return null;
    var out = { serial: null, gtin: null, info: [] };
    var rest = rows.slice();
    // 最高一行按位置判断：件码行更高（14pt），流水码行较矮（11pt）
    if (rest.length >= 2) {
      var a = rest[0], b = rest[1];
      if (b.h > a.h * 1.12) { out.serial = a; out.gtin = b; }
      else { out.serial = a; out.gtin = b; }
      out.info = rest.slice(2);
    } else {
      out.serial = rest[0];
    }
    return out;
  }

  /* ------------------------------ 主分析 ------------------------------ */
  function analyze(gray, width, height, quadInfo, opts) {
    opts = opts || {};
    var IMG = opts.IMG;
    var jsQR = opts.jsQR;
    var quad = quadInfo.quad;
    var lens = sideLens(quad);
    var srcPpm = Math.min((lens[0] + lens[2]) / 2 / W, (lens[1] + lens[3]) / 2 / H);

    /* 方向选择：把标签转正，使二维码位于右上区域 */
    var bestK = 0, bestScore = 1e9, bestRect = null;
    for (var k = 0; k < 4; k++) {
      var q = rotateQuad(quad, k);
      var small = rectify(gray, width, height, q, 0.34);
      var probe = null;
      if (jsQR) {
        var pw = small.w, ph = small.h;
        var buf = new Uint8ClampedArray(pw * ph * 4);
        for (var pp = 0; pp < pw * ph; pp++) {
          var v = small.gray[pp];
          buf[pp * 4] = buf[pp * 4 + 1] = buf[pp * 4 + 2] = v; buf[pp * 4 + 3] = 255;
        }
        try { probe = jsQR(buf, pw, ph, { inversionAttempts: 'dontInvert' }); } catch (e) { probe = null; }
      }
      var score;
      if (probe && probe.location) {
        var cx = (probe.location.topLeftCorner.x + probe.location.bottomRightCorner.x) / 2 / pw * W;
        var cy = (probe.location.topLeftCorner.y + probe.location.bottomRightCorner.y) / 2 / ph * H;
        score = Math.hypot(cx - (REGIONS.qr.x + REGIONS.qr.w / 2), cy - (REGIONS.qr.y + REGIONS.qr.h / 2));
      } else {
        score = 40 + k * 3;
      }
      if (score < bestScore) { bestScore = score; bestK = k; bestRect = small; }
      if (score < 6) break;
    }

    quad = rotateQuad(quad, bestK);
    var rect = rectify(gray, width, height, quad);

    /* 墨色阈值：亮部与暗部中点 */
    var hist = new Uint32Array(256);
    for (var i = 0; i < rect.gray.length; i++) {
      var gv = rect.gray[i] | 0;
      hist[gv < 0 ? 0 : (gv > 255 ? 255 : gv)]++;
    }
    var total = rect.gray.length, acc = 0, lo = 0, hi = 255;
    for (var a = 0; a < 256; a++) { acc += hist[a]; if (acc >= total * 0.02) { lo = a; break; } }
    acc = 0;
    for (var b = 255; b >= 0; b--) { acc += hist[b]; if (acc >= total * 0.02) { hi = b; break; } }
    if (hi - lo < 30) { hi = Math.min(255, lo + 30); }
    var thr = (lo + hi) / 2;

    var M = makeMeasure(rect, thr);
    var groups = [];
    var overlay = [];
    var notes = [];

    /* ---------------- 整体 ---------------- */
    var g0 = { key: 'overall', name: '整体与成像', items: [] };
    var aspect = bestK % 2 === 0
      ? (lens[0] + lens[2]) / (lens[1] + lens[3])
      : (lens[1] + lens[3]) / (lens[0] + lens[2]);
    var aspectItem = item({
      key: 'aspect', name: '标签宽高比（105 : 75）',
      std: 1.4, value: Math.round(aspect * 100) / 100, unit: '', dev: Math.round((aspect - 1.4) * 100) / 100,
      status: judge(aspect - 1.4, 0.03, 0.06),
      desc: '实测 ' + (Math.round(aspect * 100) / 100).toFixed(2) + ' : 1，标准 1.40 : 1'
    });
    g0.items.push(aspectItem);
    g0.items.push(item({
      key: 'res', name: '成像分辨率',
      std: null, value: r1(srcPpm), unit: 'px/mm', dev: null,
      status: srcPpm >= 8 ? 'ok' : (srcPpm >= 5 ? 'warn' : 'fail'),
      desc: '校正前原始像素密度；低于 8px/mm 时字号与 0.2mm 线宽测量误差增大'
    }));
    groups.push(g0);

    /* ---------------- 二维码 ---------------- */
    var qrRes = null;
    if (jsQR) {
      try { qrRes = jsQR(rect.rgba, rect.w, rect.h, { inversionAttempts: 'attemptBoth' }); } catch (e) { qrRes = null; }
    }
    var qr = { ok: !!qrRes, box: null, version: null, ecl: null, text: '', segments: [] };
    if (qrRes) {
      qr.text = qrRes.data || '';
      qr.version = qrRes.version || null;
      qr.binaryData = qrRes.binaryData || null;
      qr.chunks = qrRes.chunks || null;
      if (qrRes.location) {
        var L = qrRes.location;
        var pts = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner];
        var xs = pts.map(function (p) { return p.x / PPM; });
        var ys = pts.map(function (p) { return p.y / PPM; });
        qr.box = {
          x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
          y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys)
        };
        qr.box.w = qr.box.x1 - qr.box.x0;
        qr.box.h = qr.box.y1 - qr.box.y0;
      }
      qr.ecl = eclFromLocation(qrRes, rect, thr, opts.QS);
      qr.segments = parseQRPayload(qr.text);
    }

    var g1 = { key: 'qr', name: '二维码', items: [] };
    if (qr.box) {
      g1.items.push(sizeItem('qr_w', '二维码宽度', qr.box.w, 35, 'mm', 1.5, 3));
      g1.items.push(sizeItem('qr_h', '二维码高度', qr.box.h, 35, 'mm', 1.5, 3));
      g1.items.push(sizeItem('qr_x', '二维码左边距', qr.box.x0, 62, 'mm', 2, 3.5));
      g1.items.push(sizeItem('qr_y', '二维码上边距', qr.box.y0, 6, 'mm', 2, 3.5));
      g1.items.push(sizeItem('qr_right', '二维码右边距', W - qr.box.x1, 8, 'mm', 2, 3.5));
      overlay.push({ type: 'qr', box: qr.box });
    } else {
      g1.items.push(item({ key: 'qr_box', name: '二维码定位', std: null, value: null, unit: '', dev: null, status: 'fail', desc: '未能在标签内定位二维码' }));
    }
    if (qr.box && qr.box.w > 5 && qr.box.h > 5) {
      var q = qr.box.h / qr.box.w;
      if (q > 0.75 && q < 1.33) {
        var corrected = aspect * q;
        aspectItem.value = Math.round(corrected * 100) / 100;
        aspectItem.dev = Math.round((corrected - 1.4) * 100) / 100;
        aspectItem.status = judge(corrected - 1.4, 0.03, 0.06);
        aspectItem.desc = '实测 ' + corrected.toFixed(2) + ' : 1（以二维码正方形为基准校正透视）';
        if (Math.abs(q - 1) > 0.06) {
          notes.push('标签存在 ' + ((q - 1) * 100).toFixed(0) + '% 的纵向透视压缩，宽高比已按二维码边长校正');
        }
      }
    }
    if (qr.version !== null) {
      g1.items.push(item({
        key: 'qr_ver', name: '二维码版本', std: 6, value: qr.version, unit: '版', dev: qr.version - 6,
        status: qr.version === 6 ? 'ok' : 'fail',
        desc: '规范要求 QR 码制、版本 6、纠错级别 M'
      }));
    }
    if (qr.ecl) {
      g1.items.push(item({
        key: 'qr_ecl', name: '纠错级别', std: 'M', value: qr.ecl, unit: '', dev: null,
        status: qr.ecl === 'M' ? 'ok' : 'fail', desc: '规范要求纠错级别 M'
      }));
    }
    if (qr.text) {
      var len = qr.text.length;
      g1.items.push(item({
        key: 'qr_len', name: '二维码编码长度', std: 105, value: len, unit: '位', dev: len - 105,
        status: len === 105 ? 'ok' : (Math.abs(len - 105) <= 4 ? 'warn' : 'fail'),
        desc: '件包装二维码编码总长度固定 105 位'
      }));
    }
    groups.push(g1);

    /* ---------------- 一维码 ---------------- */
    var bars = findBars(rect, thr);
    var bc = { ok: false, box: null, text: '', symbology: '', ai: [], gtin: '' };
    var g2 = { key: 'bc', name: '一维码', items: [] };
    if (bars) {
      bc.box = bars.mm;
      overlay.push({ type: 'bc', box: bars.mm });
      g2.items.push(sizeItem('bc_w', '一维码宽度', bars.mm.w, 50, 'mm', 1.5, 3));
      g2.items.push(sizeItem('bc_h', '一维码高度', bars.mm.h, 28, 'mm', 1.5, 3));
      g2.items.push(sizeItem('bc_x', '一维码左边距', bars.mm.x, 6, 'mm', 2, 3.5));
      g2.items.push(sizeItem('bc_top', '一维码上边距', bars.mm.y, 41, 'mm', 2.5, 4));
      g2.items.push(sizeItem('bc_bottom', '一维码下边距', H - (bars.mm.y + bars.mm.h), 6, 'mm', 2.5, 4));
      var C = opts.code128;
      if (C) {
        var dec = C.decode(rect.gray, rect.w, rect.h, {
          x: (bars.mm.x - 1.2) * PPM, y: (bars.mm.y - 0.8) * PPM,
          w: (bars.mm.w + 2.4) * PPM, h: (bars.mm.h + 1.6) * PPM
        });
        if (dec.ok) {
          bc.ok = true;
          bc.text = dec.text;
          bc.symbology = dec.symbology;
          bc.ai = dec.ai;
          bc.gtin = dec.gtin;
          bc.moduleWidth = dec.moduleWidthMm;
          bc.moduleCount = dec.moduleCount;
          bc.symbolCount = dec.symbolCount;
        } else {
          bc.reason = dec.reason;
        }
      }
      if (bc.ok) {
        g2.items.push(item({
          key: 'bc_sym', name: '码制', std: 'GS1-128', value: bc.symbology, unit: '', dev: null,
          status: bc.symbology === 'GS1-128' ? 'ok' : 'warn',
          desc: '延续“一号工程”GS1-128（原 UCC/EAN-128）'
        }));
        var okLen = bc.gtin.length === 13 || bc.gtin.length === 14;
        g2.items.push(item({
          key: 'bc_len', name: '商品编码位数', std: 13, value: bc.gtin.length, unit: '位',
          dev: bc.gtin.length - 13,
          status: okLen ? 'ok' : 'fail', desc: '件规格商品 13 位编码'
        }));
      } else {
        g2.items.push(item({
          key: 'bc_dec', name: '一维码识读', std: null, value: null, unit: '', dev: null,
          status: 'fail', desc: bc.reason || '未能识读一维码'
        }));
      }
    } else {
      g2.items.push(item({ key: 'bc_box', name: '一维码定位', std: null, value: null, unit: '', dev: null, status: 'fail', desc: '未能在标签内定位一维码' }));
    }
    groups.push(g2);

    /* ---------------- 标志与间隔线 ---------------- */
    var g3 = { key: 'mark', name: '标志与间隔线', items: [] };
    var logoBox = M.box(5, 5, 57, 19);
    if (logoBox) {
      g3.items.push(sizeItem('logo_w', '标志区宽度', logoBox.w, 50, 'mm', 2, 4));
      g3.items.push(sizeItem('logo_h', '标志区高度', logoBox.h, 12, 'mm', 1.5, 3));
      g3.items.push(sizeItem('logo_x', '标志区左边距', logoBox.x0, 6, 'mm', 2, 3.5));
      g3.items.push(sizeItem('logo_y', '标志区上边距', logoBox.y0, 6, 'mm', 2, 3.5));
      overlay.push({ type: 'logo', box: logoBox });
    } else {
      g3.items.push(item({ key: 'logo', name: '标志区内容', std: null, value: null, unit: '', dev: null, status: 'fail', desc: '标志区未见印刷内容' }));
    }
    var sepThick = measureSep(rect, thr);
    if (sepThick !== null) {
      g3.items.push(item({
        key: 'sep', name: '间隔线线宽', std: 0.2, value: r1(sepThick),
        unit: 'mm', dev: r1(sepThick - 0.2),
        status: sepThick <= 0.6 ? 'ok' : judge(sepThick - 0.2, 0.3, 0.6),
        desc: sepThick <= 0.6 ? '分辨率受限，实测 ' + r1(sepThick) + 'mm 属正常范围' : '间隔线偏粗'
      }));
    } else {
      g3.items.push(item({ key: 'sep', name: '间隔线', std: 0.2, value: null, unit: 'mm', dev: null, status: 'warn', desc: '未检出贯通的黑色间隔线' }));
    }
    groups.push(g3);

    /* ---------------- 规格名称排版与字号 ---------------- */
    var g4 = { key: 'name', name: '规格名称（表1 / 表3）', items: [] };
    // 表3 最小字号 14pt（字面高 ≈4.9mm），低于 2.4mm 的行带属间隔线/边框残留，剔除以免污染首行读数
    var nameBands = M.bands(5, 19.6, 57, 36.6, 1.4, 3).filter(function (b) { return b.h >= 2.4; });
    if (nameBands.length) {
      var lines = nameBands.length;
      var lineInfo = nameBands.map(function (b, i) {
        var pt = ptFromInk(Math.min(b.h, 12), 'cjk');
        return {
          i: i, h: b.h, w: b.w, x0: b.x0, x1: b.x1, pt: pt,
          center: b.x0 !== null ? ((b.x0 - REGIONS.name.x) - (REGIONS.name.x + REGIONS.name.w - b.x1)) / 2 : null
        };
      });
      var first = lineInfo[0];
      g4.items.push(item({
        key: 'name_lines', name: '排版方式', std: '单行或双行居中', value: lines + ' 行', unit: '',
        dev: null, status: lines <= 2 ? 'ok' : 'fail',
        desc: lines === 1 ? '单行居中（适用于 ≤6 个汉字）' : (lines === 2 ? '双行居中（适用于 ＞6 个汉字）' : '检测到 ' + lines + ' 行，超出表1 规定')
      }));
      g4.items.push(item({
        key: 'name_f1', name: '首行字号', std: 24, value: r1(first.pt), unit: 'pt',
        dev: r1(first.pt - 24), status: judge(first.pt - 24, 2.5, 4),
        desc: '按字高反算（CJK 字面高 ≈ 0.88em）'
      }));
      if (lines >= 2) {
        var second = lineInfo[1];
        var dev20 = second.pt - 20, dev14 = second.pt - 14;
        var pick = Math.abs(dev20) <= Math.abs(dev14) ? 20 : 14;
        var dev = second.pt - pick;
        g4.items.push(item({
          key: 'name_f2', name: '次行字号', std: pick, value: r1(second.pt), unit: 'pt',
          dev: r1(dev),
          status: judge(dev, 2.5, 4),
          desc: '表3 允许 20pt（次行 ≤7 汉字）或 14pt（次行 ＞7 汉字）'
        }));
      }
      var centerDev = first.center;
      if (centerDev !== null) {
        g4.items.push(item({
          key: 'name_center', name: '水平居中偏差', std: 0, value: r1(centerDev), unit: 'mm',
          dev: r1(centerDev), status: judge(centerDev, 1, 2),
          desc: '左留白与右留白之差的一半'
        }));
      }
      var overflow = first.w - REGIONS.name.w;
      g4.items.push(item({
        key: 'name_w', name: '文字宽度（区宽 50mm）', std: 50, value: r1(first.w), unit: 'mm',
        dev: r1(overflow),
        status: overflow <= 1 ? (first.w >= 20 ? 'ok' : 'warn') : (overflow <= 2.5 ? 'warn' : 'fail'),
        desc: overflow > 1 ? '文字超出规格名称区宽度' : '未超出区域宽度'
      }));
      nameBands.forEach(function (b, i) {
        overlay.push({ type: 'name' + i, box: { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, w: b.w, h: b.h } });
      });
    } else {
      g4.items.push(item({ key: 'name', name: '规格名称', std: null, value: null, unit: '', dev: null, status: 'fail', desc: '规格名称区域未见文字' }));
    }
    groups.push(g4);

    /* ---------------- 数字编码区 ---------------- */
    var g5 = { key: 'num', name: '数字编码区（表3）', items: [] };
    var numTop = qr.box ? Math.max(43, qr.box.y1 + 1.2) : 43.5;
    var numBands = M.bands(60, numTop, 99.5, 71, 2.2, 3);
    var rows = assignNumericRows(numBands);
    if (rows && rows.serial) {
      var serial = rows.serial;
      var serialChars = qr.segments.serial ? qr.segments.serial.length : 18;
      var ptSerial = ptFromWidth(serial.w, serialChars, 'digit');
      g5.items.push(sizeItem('num_w', '流水码宽度（区宽 38mm）', serial.w, 38, 'mm', 2.5, 5));
      g5.items.push(item({
        key: 'serial_pt', name: '流水码字号', std: 11, value: r1(ptSerial), unit: 'pt',
        dev: r1(ptSerial - 11), status: judge(ptSerial - 11, 2.5, 4),
        desc: '按 ' + serialChars + ' 字符宽度反算（数字步进 ≈0.55em）'
      }));
      g5.items.push(item({
        key: 'serial_lines', name: '流水码排版', std: '单行居中', value: '单行', unit: '', dev: null,
        status: 'ok', desc: '18 位唯一流水码单行居中显示'
      }));
      if (rows.gtin) {
        var gtinRow = rows.gtin;
        var ptGtin = ptFromWidth(gtinRow.w, bc.gtin ? bc.gtin.length : 13, 'digit');
        g5.items.push(item({
          key: 'gtin_pt', name: '商品编码字号', std: 14, value: r1(ptGtin), unit: 'pt',
          dev: r1(ptGtin - 14), status: judge(ptGtin - 14, 2.5, 4),
          desc: '件规格商品编码单行居中，Heavy 14pt'
        }));
        g5.items.push(item({
          key: 'gtin_center', name: '商品编码居中偏差', std: 0,
          value: r1(gtinRow.x0 === null ? 0 : ((gtinRow.x0 - REGIONS.gtin.x) - (REGIONS.gtin.x + REGIONS.gtin.w - gtinRow.x1)) / 2),
          unit: 'mm',
          dev: r1(gtinRow.x0 === null ? 0 : ((gtinRow.x0 - REGIONS.gtin.x) - (REGIONS.gtin.x + REGIONS.gtin.w - gtinRow.x1)) / 2),
          status: judge(gtinRow.x0 === null ? 0 : ((gtinRow.x0 - REGIONS.gtin.x) - (REGIONS.gtin.x + REGIONS.gtin.w - gtinRow.x1)) / 2, 1, 2),
          desc: '数字编码区整体水平居中'
        }));
      }
      var infoLines = rows.info.length ? rows.info : [];
      var infoH = infoLines.reduce(function (a, b) { return a + b.h; }, 0);
      var infoTop = infoLines.length ? infoLines[0].y0 : null;
      var infoBot = infoLines.length ? infoLines[infoLines.length - 1].y1 : null;
      var ptInfo = infoLines.length ? ptFromInk(infoH / infoLines.length, 'digit') : null;
      g5.items.push(item({
        key: 'info_lines', name: '生产信息排版', std: '双行居中', value: infoLines.length + ' 行', unit: '',
        dev: null, status: infoLines.length === 2 ? 'ok' : (infoLines.length === 1 ? 'warn' : 'fail'),
        desc: '生产信息双行居中显示'
      }));
      if (ptInfo !== null) {
        g5.items.push(item({
          key: 'info_pt', name: '生产信息字号', std: 11, value: r1(ptInfo), unit: 'pt',
          dev: r1(ptInfo - 11), status: judge(ptInfo - 11, 2.5, 4),
          desc: '按字高反算（数字字面高 ≈ 0.72em）'
        }));
      }
      if (infoTop !== null) {
        g5.items.push(sizeItem('info_h', '生产信息块高度', infoBot - infoTop, 10, 'mm', 2.5, 4.5));
        overlay.push({ type: 'info', box: { x0: REGIONS.info.x, x1: REGIONS.info.x + REGIONS.info.w, y0: infoTop, y1: infoBot, w: REGIONS.info.w, h: infoBot - infoTop } });
      }
    } else {
      g5.items.push(item({ key: 'num', name: '数字编码区内容', std: null, value: null, unit: '', dev: null, status: 'fail', desc: '数字编码区未见文字' }));
    }
    groups.push(g5);

    /* ---------------- 数据一致性 ---------------- */
    var g6 = { key: 'data', name: '数据一致性', items: [] };
    if (qr.segments && qr.segments.fields) {
      var fields = qr.segments.fields;
      var brand = (fields['品牌规格代码'] || '').trim();
      var serial18 = (fields['二维码（18 位流水码）'] || '').trim();
      if (bc.ok && brand) {
        var same = bc.gtin.indexOf(brand) >= 0 || brand.indexOf(bc.gtin) >= 0;
        g6.items.push(item({
          key: 'consist', name: '一维码与二维码规格代码', std: '一致', value: same ? '一致' : '不一致',
          unit: '', dev: null, status: same ? 'ok' : 'fail',
          desc: '一维码 ' + bc.gtin + ' / 二维码 ' + brand
        }));
      }
      if (serial18) {
        g6.items.push(item({
          key: 'serial18', name: '18 位唯一流水码', std: '18 位', value: serial18.length + ' 位', unit: '',
          dev: serial18.length - 18, status: serial18.length === 18 ? 'ok' : 'fail',
          desc: serial18
        }));
        var t = fields['生产时间'] || '';
        if (t.length === 14) {
          // yyyymmddhhmmss
          var ts = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8) + ' ' +
            t.slice(8, 10) + ':' + t.slice(10, 12) + ':' + t.slice(12, 14);
          g6.items.push(item({
            key: 'time', name: '生产时间', std: null, value: ts, unit: '', dev: null, status: 'ok',
            desc: '年-月-日 时:分:秒'
          }));
        }
      }
    }
    if (g6.items.length) groups.push(g6);

    /* ---------------- 汇总 ---------------- */
    var counts = { ok: 0, warn: 0, fail: 0, total: 0, skipped: 0 };
    groups.forEach(function (g) {
      g.items.forEach(function (it) {
        if (it.std === null) { counts.skipped++; return; }
        counts.total++;
        counts[it.status]++;
      });
    });
    var status = counts.fail > 0 ? 'fail' : (counts.warn > 0 ? 'warn' : 'ok');

    var verdict = buildVerdict(status, counts, groups, qr, bc);

    return {
      ok: true,
      W: W, H: H, ppm: PPM, rectW: rect.w, rectH: rect.h,
      quad: quad, quadSource: quadInfo.source, srcPpm: srcPpm, rotation: bestK,
      threshold: thr,
      counts: counts, status: status,
      groups: groups, overlay: overlay,
      qr: qr, bc: bc,
      notes: notes,
      verdict: verdict,
      rect: rect
    };
  }

  function measureSep(rect, thr) {
    var RW = rect.w, G = rect.gray;
    var x0 = Math.round(6 * PPM), x1 = Math.round(56 * PPM);
    var y0 = Math.round(16 * PPM), y1 = Math.round(23 * PPM);
    var best = null;
    for (var y = y0; y < y1; y++) {
      var c = 0, base = y * RW;
      for (var x = x0; x < x1; x++) if (G[base + x] < thr) c++;
      var cov = c / (x1 - x0);
      if (!best || cov > best.cov) best = { y: y, cov: cov };
    }
    if (!best || best.cov < 0.55) return null;
    // 向上下扩展统计厚度（覆盖率仍 > 40%）
    var up = best.y, down = best.y;
    while (up - 1 >= y0 && coverage(up - 1) > 0.4) up--;
    while (down + 1 < y1 && coverage(down + 1) > 0.4) down++;
    function coverage(y) {
      var c = 0, base = y * RW;
      for (var x = x0; x < x1; x++) if (G[base + x] < thr) c++;
      return c / (x1 - x0);
    }
    return (down - up + 1) / PPM;
  }

  /* 从定位角点重采样模块矩阵，读格式信息得到纠错级别与掩模 */
  function eclFromLocation(res, rect, thr, QS) {
    if (!QS || !res.location || !res.version) return null;
    var N = 17 + 4 * res.version;
    var L = res.location;
    var q = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner];
    var Hm = homography(q);
    var bin = new Uint8Array(N * N);
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var pt = apply(Hm, (c + 0.5) / N, (r + 0.5) / N);
        var px = Math.round(pt.x), py = Math.round(pt.y);
        if (px < 0 || py < 0 || px >= rect.w || py >= rect.h) { bin[r * N + c] = 0; continue; }
        bin[r * N + c] = rect.gray[py * rect.w + px] < thr ? 1 : 0;
      }
    }
    var f = QS.readFormat(bin, N);
    return f && f.valid ? f.ecl : null;
  }

  /* 105 位编码结构解析 */
  function parseQRPayload(text) {
    var out = { fields: null, rows: [], length: text ? text.length : 0 };
    if (!text) return out;
    var s = text;
    // 兼容 URL 形式：整串 105 位时首位即网络服务地址，直接按位取；
    // 带额外前缀（如含协议后的查询串）时退化为取末段，按最接近 105 位者解析。
    var cands = [s];
    var m = s.match(/\/([^\/]+)$/);
    if (m) cands.push(m[1]);
    cands.sort(function (a, b) { return Math.abs(a.length - 105) - Math.abs(b.length - 105); });
    for (var ci = 0; ci < cands.length; ci++) {
      if (cands[ci].length >= 105) { s = cands[ci]; break; }
    }
    if (/^https?:\/\//i.test(s)) out.url = s;
    var fields = {};
    var rows = [];
    if (s.length >= 105) {
      QR_STRUCT.forEach(function (seg) {
        var v = s.slice(seg.from - 1, seg.to);
        fields[seg.name] = v;
        rows.push({ name: seg.name, from: seg.from, to: seg.to, value: v });
      });
      out.fields = fields;
      out.rows = rows;
      out.serial = fields['二维码（18 位流水码）'];
      out.gtin = fields['品牌规格代码'];
    } else {
      // 非 105 位：尽力按可识别片段解析
      var digits = s.replace(/\D/g, '');
      if (digits.length >= 18) out.serial = digits.slice(-18);
      var m2 = s.match(/1\d{13}|69\d{11}/);
      if (m2) out.gtin = m2[0];
      out.fields = {};
    }
    return out;
  }

  function buildVerdict(status, counts, groups, qr, bc) {
    var failItems = [], warnItems = [];
    groups.forEach(function (g) {
      g.items.forEach(function (it) {
        if (it.status === 'fail') failItems.push(it);
        else if (it.status === 'warn') warnItems.push(it);
      });
    });
    var headline;
    if (status === 'ok') {
      headline = '标签符合《卷烟件烟标签技术规范》要求：' + counts.total + ' 项受检指标全部在允许偏差内。';
    } else if (status === 'warn') {
      headline = '标签基本符合规范：' + counts.total + ' 项中 ' + counts.warn + ' 项接近允许偏差边界，建议复核印刷与打码设备。';
    } else {
      headline = '标签不符合规范：' + counts.total + ' 项受检指标中 ' + counts.fail + ' 项超差、' + counts.warn + ' 项临界。';
    }
    var details = [];
    if (failItems.length) {
      details.push('超差项：' + failItems.map(function (it) {
        var d = it.dev === null ? '' : '（偏差 ' + (it.dev > 0 ? '+' : '') + it.dev + (it.unit || '') + '）';
        return it.name + d;
      }).join('；'));
    }
    if (warnItems.length) {
      details.push('临界项：' + warnItems.map(function (it) {
        var d = it.dev === null ? '' : '（偏差 ' + (it.dev > 0 ? '+' : '') + it.dev + (it.unit || '') + '）';
        return it.name + d;
      }).join('；'));
    }
    if (qr.ok) {
      details.push('二维码可识读：' + (qr.version ? '版本 ' + qr.version : '版本未知') +
        (qr.ecl ? '、纠错 ' + qr.ecl : '') + '，共 ' + qr.text.length + ' 位。');
    } else {
      details.push('二维码未能识读，无法核对编码内容是否满足 105 位结构要求。');
    }
    if (bc.ok) {
      details.push('一维码可识读：' + bc.symbology + '，数据 ' + bc.text + '。');
    } else {
      details.push('一维码未能识读' + (bc.reason ? '（' + bc.reason + '）' : '') + '，请检查打印密度与条宽。');
    }

    var advice = [];
    failItems.slice(0, 6).forEach(function (it) {
      advice.push(adviceOf(it));
    });
    if (!advice.length) {
      advice.push('保持当前打码模板与打印浓度，按批次抽检即可。');
      advice.push('建议每班次抽检 3–5 张，重点复核二维码尺寸与一维码条宽。');
    }
    return { status: status, headline: headline, details: details, advice: advice, failItems: failItems, warnItems: warnItems };
  }

  function adviceOf(it) {
    var map = {
      aspect: '标签宽高比偏离 105:75，检查模板页面设置与打印缩放（勿用“适合纸张”缩放）。',
      qr_w: '二维码尺寸不符，调整打码软件中的二维码模块尺寸，使成品为 35mm×35mm。',
      qr_h: '二维码高度不符，检查是否存在纵向拉伸或打印走纸误差。',
      qr_x: '二维码水平位置偏移，核对模板中二维码区域起点（距左边 62mm）。',
      qr_y: '二维码上边距不符，核对模板垂直定位。',
      qr_right: '二维码右侧留白不符，右侧应留 8mm。',
      qr_ver: '二维码版本应为 6，检查打码软件码制设置。',
      qr_ecl: '纠错级别应为 M，检查打码软件纠错设置。',
      qr_len: '编码长度应为 105 位，核对赋码系统字段拼接。',
      bc_w: '一维码宽度不符，调整条码模块宽度或 X 尺寸。',
      bc_h: '一维码高度不符，条高应打印为 28mm。',
      bc_x: '一维码左边距不符，起点应为 6mm。',
      bc_top: '一维码垂直位置不符，核对模板位置。',
      bc_bottom: '一维码下边距不符，底部应留 6mm。',
      bc_dec: '一维码无法识读，检查打印浓度、条宽比与是否断线。',
      bc_sym: '码制不符，应为 GS1-128。',
      logo_w: '标志区宽度不符，检查标志图片是否被缩放。',
      logo_h: '标志区高度不符，中国烟草标志与中英文字样高度应为 12mm 内。',
      logo_x: '标志区位置偏移，左边距应为 6mm。',
      logo_y: '标志区上边距不符，应为 6mm。',
      sep: '间隔线偏粗或缺失，应为 50mm×0.2mm 黑色实线。',
      name_lines: '规格名称行数不符：≤6 个汉字用单行，＞6 个汉字用双行（品牌首行）。',
      name_f1: '规格名称首行字号应为首行 24pt（Heavy）。',
      name_f2: '规格名称次行字号应为 20pt（次行 ≤7 汉字）或 14pt（次行 ＞7 汉字）。',
      name_center: '规格名称未居中，检查模板文本对齐方式。',
      name_w: '规格名称文字宽度与区域不符，核对字号与字距。',
      num_w: '数字编码区宽度不符，区域宽应为 38mm。',
      serial_pt: '18 位流水码字号应为 11pt。',
      gtin_pt: '件规格商品编码字号应为 14pt。',
      info_pt: '生产信息字号应为 11pt。',
      info_h: '生产信息块高度不符，双行 11pt 应约 10mm。',
      info_lines: '生产信息应为双行居中。',
      consist: '一维码与二维码中的规格代码不一致，核对赋码数据源。',
      serial18: '18 位唯一流水码位数不符。'
    };
    return map[it.key] || (it.name + '不符合标准，请对照表2 / 表3 复核。');
  }

  return {
    W: W, H: H, PPM: PPM, PT: PT,
    REGIONS: REGIONS, FONTS: FONTS, FONT_FACTOR: FONT_FACTOR,
    TABLE1: TABLE1, TABLE2: TABLE2, TABLE3: TABLE3, QR_STRUCT: QR_STRUCT,
    detectQuad: detectQuad, quadFromQR: quadFromQR, rectify: rectify,
    analyze: analyze, parseQRPayload: parseQRPayload,
    homography: homography, quadArea: quadArea, rotateQuad: rotateQuad,
    ptFromInk: ptFromInk, ptFromWidth: ptFromWidth
  };
});
