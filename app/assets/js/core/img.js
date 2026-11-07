/*!
 * QRQ · 图像基础工具
 * 灰度化、缩放、双线性采样、直方图统计、阈值
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    for (var k in api) root.QRQ[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 将 RGBA 图像按最大边长等比缩小（面积平均，避免摩尔纹影响采样） */
  function downscaleRGBA(rgba, width, height, maxSide) {
    var scale = Math.min(1, maxSide / Math.max(width, height));
    if (scale >= 0.999) {
      return { data: rgba, width: width, height: height, scale: 1 };
    }
    var nw = Math.max(1, Math.round(width * scale));
    var nh = Math.max(1, Math.round(height * scale));
    var out = new Uint8ClampedArray(nw * nh * 4);
    var xRatio = width / nw, yRatio = height / nh;
    for (var y = 0; y < nh; y++) {
      var sy0 = Math.floor(y * yRatio), sy1 = Math.min(height, Math.max(sy0 + 1, Math.ceil((y + 1) * yRatio)));
      for (var x = 0; x < nw; x++) {
        var sx0 = Math.floor(x * xRatio), sx1 = Math.min(width, Math.max(sx0 + 1, Math.ceil((x + 1) * xRatio)));
        var r = 0, g = 0, b = 0, a = 0, n = 0;
        for (var yy = sy0; yy < sy1; yy++) {
          var base = (yy * width) * 4;
          for (var xx = sx0; xx < sx1; xx++) {
            var i = base + xx * 4;
            r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; n++;
          }
        }
        var o = (y * nw + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
      }
    }
    return { data: out, width: nw, height: nh, scale: scale };
  }

  /* sRGB 亮度（0-255） */
  function grayFromRGBA(rgba, width, height) {
    var n = width * height;
    var gray = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    }
    return gray;
  }

  /* 双线性插值采样 */
  function bilinear(gray, width, height, x, y) {
    if (x < 0) x = 0; else if (x > width - 1) x = width - 1;
    if (y < 0) y = 0; else if (y > height - 1) y = height - 1;
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = x0 + 1 < width ? x0 + 1 : x0;
    var y1 = y0 + 1 < height ? y0 + 1 : y0;
    var fx = x - x0, fy = y - y0;
    var a = gray[y0 * width + x0], b = gray[y0 * width + x1];
    var c = gray[y1 * width + x0], d = gray[y1 * width + x1];
    var top = a + (b - a) * fx;
    var bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }

  function meanOfTop(arr, ratio) {
    var n = arr.length;
    if (!n) return 0;
    var copy = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; });
    var k = Math.max(3, Math.round(n * (ratio || 0.1)));
    var sum = 0;
    for (var i = n - k; i < n; i++) sum += copy[i];
    return sum / k;
  }

  function meanOfBottom(arr, ratio) {
    var n = arr.length;
    if (!n) return 0;
    var copy = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; });
    var k = Math.max(3, Math.round(n * (ratio || 0.1)));
    var sum = 0;
    for (var i = 0; i < k; i++) sum += copy[i];
    return sum / k;
  }

  /* Otsu 全局阈值（用于 DPM 统计阈值） */
  function otsu(gray) {
    var hist = new Float64Array(256);
    for (var i = 0; i < gray.length; i++) {
      var v = gray[i] | 0;
      hist[v < 0 ? 0 : (v > 255 ? 255 : v)]++;
    }
    var total = gray.length;
    var sumAll = 0;
    for (var t = 0; t < 256; t++) sumAll += t * hist[t];
    var wB = 0, sumB = 0, best = 0, bestVar = -1;
    for (var th = 0; th < 256; th++) {
      wB += hist[th];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += th * hist[th];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > bestVar) { bestVar = varBetween; best = th; }
    }
    return best;
  }

  /* 4 点透视变换：单位方形 (0,0)(1,0)(1,1)(0,1) → 四边形 */
  function homographyFromUnitSquare(quad) {
    // quad: [{x,y} p00, {x,y} p10, {x,y} p11, {x,y} p01]
    var x0 = quad[0].x, y0 = quad[0].y;
    var x1 = quad[1].x, y1 = quad[1].y;
    var x2 = quad[2].x, y2 = quad[2].y;
    var x3 = quad[3].x, y3 = quad[3].y;
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var g = 0, h = 0;
    if (dx3 !== 0 || dy3 !== 0) {
      var det = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(det) < 1e-12) det = 1e-12;
      g = (dx3 * dy2 - dx2 * dy3) / det;
      h = (dx1 * dy3 - dx3 * dy1) / det;
    }
    // 变换 (u,v) -> (x,y)
    return {
      a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0,
      d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0,
      g: g, h: h
    };
  }

  function applyH(H, u, v) {
    var den = H.g * u + H.h * v + 1;
    return {
      x: (H.a * u + H.b * v + H.c) / den,
      y: (H.d * u + H.e * v + H.f) / den
    };
  }

  function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }

  /* 对比度拉伸（百分位裁剪），用于提升低对比度图像的识读成功率 */
  function stretchRGBA(gray, width, height, lowPct, highPct) {
    var hist = new Float64Array(256);
    for (var i = 0; i < gray.length; i++) {
      var v = gray[i] | 0;
      hist[v < 0 ? 0 : (v > 255 ? 255 : v)]++;
    }
    var total = gray.length;
    var lo = 0, hi = 255, acc = 0;
    var loTarget = total * (lowPct === undefined ? 0.01 : lowPct);
    var hiTarget = total * (highPct === undefined ? 0.01 : highPct);
    for (var a = 0; a < 256; a++) { acc += hist[a]; if (acc >= loTarget) { lo = a; break; } }
    acc = 0;
    for (var b = 255; b >= 0; b--) { acc += hist[b]; if (acc >= hiTarget) { hi = b; break; } }
    if (hi - lo < 8) { hi = Math.min(255, lo + 8); }
    var span = hi - lo;
    var out = new Uint8ClampedArray(width * height * 4);
    for (var p = 0, j = 0; p < gray.length; p++, j += 4) {
      var nv = (gray[p] - lo) / span * 255;
      out[j] = out[j + 1] = out[j + 2] = nv;
      out[j + 3] = 255;
    }
    return out;
  }

  return {
    clamp: clamp,
    downscaleRGBA: downscaleRGBA,
    grayFromRGBA: grayFromRGBA,
    bilinear: bilinear,
    meanOfTop: meanOfTop,
    meanOfBottom: meanOfBottom,
    otsu: otsu,
    stretchRGBA: stretchRGBA,
    homographyFromUnitSquare: homographyFromUnitSquare,
    applyH: applyH,
    dist: dist
  };
});
