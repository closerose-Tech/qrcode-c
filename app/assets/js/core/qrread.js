/*!
 * QRQ · 稳健识读（难读码兜底）
 *   1) 整图多预处理：灰度拉伸 / Otsu 二值 / 自适应二值 / 小图放大
 *   2) 定位图案检测（1:1:3:1:1 扫描）：jsQR 定不到位时自行给出四角
 *   3) 透视校正后再识读：把符号拉正、补静区，显著提升斜面 / 反光 / 低对比的读出率
 *   4) 镜像识别：水平翻转后再识读，用于判定镜像码
 * 只在常规识读失败时调用，不影响原有快速路径。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    root.QRQ.QrRead = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function Q() { return (root && root.QRQ) || {}; }

  function resolveJsQR(given) {
    var f = given || (root && root.jsQR);
    if (typeof f === 'function') return f;
    if (f && typeof f.default === 'function') return f.default;
    return null;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------------ 图像基础 ------------------------------ */
  function otsu(arr) {
    var hist = new Float64Array(256), total = arr.length, i;
    for (i = 0; i < total; i++) {
      var v = arr[i] | 0;
      hist[v < 0 ? 0 : (v > 255 ? 255 : v)]++;
    }
    var sumAll = 0;
    for (i = 0; i < 256; i++) sumAll += i * hist[i];
    var wB = 0, sumB = 0, best = 0, bestVar = -1;
    for (var t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var vv = wB * wF * (mB - mF) * (mB - mF);
      if (vv > bestVar) { bestVar = vv; best = t; }
    }
    return best;
  }

  function stretch(gray) {
    var lo = 255, hi = 0, i;
    for (i = 0; i < gray.length; i++) {
      var v = gray[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    var d = hi - lo;
    if (d < 8) return null;
    var out = new Uint8Array(gray.length);
    for (i = 0; i < gray.length; i++) out[i] = clamp(Math.round((gray[i] - lo) * 255 / d), 0, 255);
    return out;
  }

  function binOtsu(gray) {
    var t = otsu(gray);
    var out = new Uint8Array(gray.length);
    for (var i = 0; i < gray.length; i++) out[i] = gray[i] > t ? 255 : 0;
    return out;
  }

  /* 自适应二值（块均值），应对光照不均 / 反光 */
  function binAdaptive(gray, w, h, block, c) {
    var B = block || 16, C = c === undefined ? 8 : c;
    var out = new Uint8Array(gray.length);
    var bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    var means = new Float32Array(bw * bh);
    for (var by = 0; by < bh; by++) {
      for (var bx = 0; bx < bw; bx++) {
        var sum = 0, n = 0;
        var x1 = Math.min(w, (bx + 1) * B), y1 = Math.min(h, (by + 1) * B);
        for (var y = by * B; y < y1; y++) {
          for (var x = bx * B; x < x1; x++) { sum += gray[y * w + x]; n++; }
        }
        means[by * bw + bx] = n ? sum / n : 128;
      }
    }
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var m = means[Math.min(bh - 1, (yy / B) | 0) * bw + Math.min(bw - 1, (xx / B) | 0)];
        out[yy * w + xx] = gray[yy * w + xx] > m - C ? 255 : 0;
      }
    }
    return out;
  }

  function grayToRGBA(g, w, h) {
    var out = new Uint8ClampedArray(w * h * 4);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) {
      var v = g[i];
      out[j] = v; out[j + 1] = v; out[j + 2] = v; out[j + 3] = 255;
    }
    return out;
  }

  function flipH(g, w, h) {
    var out = new Uint8Array(g.length);
    for (var y = 0; y < h; y++) {
      var base = y * w;
      for (var x = 0; x < w; x++) out[base + x] = g[base + (w - 1 - x)];
    }
    return out;
  }

  function upscale(g, w, h, k) {
    var nw = Math.round(w * k), nh = Math.round(h * k);
    var out = new Uint8Array(nw * nh);
    for (var y = 0; y < nh; y++) {
      var sy = Math.min(h - 1, Math.round(y / k));
      for (var x = 0; x < nw; x++) out[y * nw + x] = g[sy * w + Math.min(w - 1, Math.round(x / k))];
    }
    return { gray: out, width: nw, height: nh };
  }

  /* ------------------------------ 透视校正 ------------------------------ */
  /* 把 quad 内的符号拉成正方形，并按 pad 比例补浅色静区 */
  function rectify(gray, w, h, quad, size, pad) {
    var IMG = Q();
    var H = IMG.homographyFromUnitSquare ? IMG.homographyFromUnitSquare(quad) : null;
    if (!H) return null;
    var S = size || 480;
    var P = pad === undefined ? 0.12 : pad;
    var inner = S * (1 - 2 * P);
    var out = new Uint8Array(S * S);
    for (var oy = 0; oy < S; oy++) {
      var v = (oy - S * P) / inner;
      for (var ox = 0; ox < S; ox++) {
        var u = (ox - S * P) / inner;
        if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) { out[oy * S + ox] = 255; continue; }
        var den = H.g * u + H.h * v + 1;
        var sx = (H.a * u + H.b * v + H.c) / den;
        var sy = (H.d * u + H.e * v + H.f) / den;
        if (!isFinite(sx) || !isFinite(sy) || sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) {
          out[oy * S + ox] = 255;
          continue;
        }
        var x0 = Math.floor(sx), y0 = Math.floor(sy);
        var x1 = x0 + 1 < w ? x0 + 1 : x0;
        var y1 = y0 + 1 < h ? y0 + 1 : y0;
        var fx = sx - x0, fy = sy - y0;
        var a = gray[y0 * w + x0], b = gray[y0 * w + x1];
        var c = gray[y1 * w + x0], d = gray[y1 * w + x1];
        out[oy * S + ox] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
      }
    }
    return { gray: out, width: S, height: S };
  }

  /* ------------------------------ 定位图案检测 ------------------------------ */
  function ratioOk(a, b, c, d, e) {
    var m = (a + b + c + d + e) / 7;
    if (m < 0.8) return false;
    function near(v, k, tol) { return v >= k * m - tol * m && v <= k * m + tol * m; }
    return near(a, 1, 0.6) && near(b, 1, 0.6) && near(c, 3, 0.8) && near(d, 1, 0.6) && near(e, 1, 0.6);
  }

  /* 竖向确认：以 (x,y) 为中心取 5 段游程，要求同样是 1:1:3:1:1 */
  function verticalCore(dark, w, h, x, y, m) {
    if (x < 0 || x >= w || y < 0 || y >= h) return null;
    if (!dark[y * w + x]) return null;
    var up = y, down = y;
    while (up - 1 >= 0 && dark[(up - 1) * w + x]) up--;
    while (down + 1 < h && dark[(down + 1) * w + x]) down++;
    var core = down - up + 1;

    var p = up - 1, lu = 0, du = 0;
    while (p >= 0 && !dark[p * w + x]) { lu++; p--; }
    while (p >= 0 && dark[p * w + x]) { du++; p--; }
    var q = down + 1, ld = 0, dd = 0;
    while (q < h && !dark[q * w + x]) { ld++; q++; }
    while (q < h && dark[q * w + x]) { dd++; q++; }

    if (lu < 1 || ld < 1 || du < 1 || dd < 1) return null;
    if (core < 2.2 * m || core > 3.9 * m) return null;
    if (!ratioOk(du, lu, core, ld, dd)) return null;
    return (up + down) / 2;
  }

  function findQuad(gray, w, h) {
    var maxSide = 720;
    var sc = Math.min(1, maxSide / Math.max(w, h));
    var sw = Math.max(40, Math.round(w * sc)), sh = Math.max(40, Math.round(h * sc));
    var small = new Float32Array(sw * sh);
    for (var y = 0; y < sh; y++) {
      var sy = Math.min(h - 1, Math.round(y / sc));
      for (var x = 0; x < sw; x++) small[y * sw + x] = gray[sy * w + Math.min(w - 1, Math.round(x / sc))];
    }
    var t = otsu(small);
    var dark = new Uint8Array(sw * sh);
    for (var i = 0; i < small.length; i++) dark[i] = small[i] <= t ? 1 : 0;

    var cands = [];
    for (var row = 0; row < sh; row++) {
      var runs = [], start = 0, cur = dark[row * sw];
      for (var cx = 1; cx <= sw; cx++) {
        var v = cx < sw ? dark[row * sw + cx] : 255;
        if (cx === sw || v !== cur) {
          runs.push({ s: start, e: cx - 1, len: cx - start, dark: cur });
          start = cx; cur = v;
        }
      }
      for (var k = 0; k + 4 < runs.length; k++) {
        if (!runs[k].dark || runs[k + 1].dark || !runs[k + 2].dark || runs[k + 3].dark || !runs[k + 4].dark) continue;
        var a = runs[k].len, b = runs[k + 1].len, c2 = runs[k + 2].len, d = runs[k + 3].len, e = runs[k + 4].len;
        if (!ratioOk(a, b, c2, d, e)) continue;
        var mx = (runs[k + 2].s + runs[k + 2].e) / 2;
        var m = (a + b + c2 + d + e) / 7;
        var vy = verticalCore(dark, sw, sh, Math.round(mx), row, m);
        if (vy === null) continue;
        cands.push({ x: mx, y: vy, s: m * 7, n: 1 });
      }
    }
    if (cands.length < 3) return null;

    // 聚类
    var clusters = [];
    cands.forEach(function (p) {
      for (var i = 0; i < clusters.length; i++) {
        var c = clusters[i];
        if (Math.abs(c.x - p.x) < c.s * 0.6 && Math.abs(c.y - p.y) < c.s * 0.6 && p.s > c.s * 0.72 && p.s < c.s * 1.4) {
          var n = c.n + 1;
          c.x = (c.x * c.n + p.x) / n;
          c.y = (c.y * c.n + p.y) / n;
          c.s = (c.s * c.n + p.s) / n;
          c.n = n;
          return;
        }
      }
      clusters.push({ x: p.x, y: p.y, s: p.s, n: 1 });
    });
    clusters = clusters.filter(function (c) { return c.n >= 3; });
    if (clusters.length < 3) return null;
    clusters.sort(function (a, b) { return b.n - a.n; });
    // 去掉落在更大簇范围内的重复簇
    clusters = clusters.filter(function (c, i) {
      for (var j = 0; j < i; j++) {
        var o = clusters[j];
        if (Math.hypot(o.x - c.x, o.y - c.y) < o.s * 1.2) return false;
      }
      return true;
    });
    if (clusters.length < 3) return null;
    if (clusters.length > 6) clusters = clusters.slice(0, 6);

    var best = null;
    for (var i1 = 0; i1 < clusters.length; i1++) {
      for (var i2 = i1 + 1; i2 < clusters.length; i2++) {
        for (var i3 = i2 + 1; i3 < clusters.length; i3++) {
          var c1 = clusters[i1], c2 = clusters[i2], c3 = clusters[i3];
          var sz = [c1.s, c2.s, c3.s];
          var szMax = Math.max.apply(null, sz), szMin = Math.min.apply(null, sz);
          if (szMax > szMin * 1.5) continue;
          var pts = [c1, c2, c3];
          var dists = [
            { a: 0, b: 1, d: Math.hypot(c1.x - c2.x, c1.y - c2.y) },
            { a: 1, b: 2, d: Math.hypot(c2.x - c3.x, c2.y - c3.y) },
            { a: 0, b: 2, d: Math.hypot(c1.x - c3.x, c1.y - c3.y) }
          ].sort(function (p, q2) { return p.d - q2.d; });
          var leg1 = dists[0], leg2 = dists[1], hyp = dists[2];
          if (leg1.d < szMax * 1.8) continue;
          if (leg2.d > leg1.d * 1.35) continue;
          var want = Math.sqrt(leg1.d * leg1.d + leg2.d * leg2.d);
          if (Math.abs(hyp.d - want) > want * 0.18) continue;   // 直角三角形
          var score = (c1.n + c2.n + c3.n) * 100 / (1 + Math.abs(hyp.d - want) / want);
          if (!best || score > best.score) {
            var vIdx = 3 - leg1.a - leg1.b - leg2.a - leg2.b;
            // 直角顶点 = 两条直角边的公共端点
            var common = null;
            [0, 1, 2].forEach(function (k2) {
              if ((k2 === leg1.a || k2 === leg1.b) && (k2 === leg2.a || k2 === leg2.b)) common = k2;
            });
            if (common === null) common = vIdx;
            best = { score: score, vertex: common, legs: [leg1, leg2], pts: pts };
          }
        }
      }
    }
    if (!best) return null;

    var V = best.pts[best.vertex];
    var others = [0, 1, 2].filter(function (k) { return k !== best.vertex; }).map(function (k) { return best.pts[k]; });
    var P = others[0], R = others[1];
    var ux = P.x - V.x, uy = P.y - V.y;
    var vx = R.x - V.x, vy = R.y - V.y;
    if (ux * vy - uy * vx < 0) { var tmp = P; P = R; R = tmp; ux = P.x - V.x; uy = P.y - V.y; vx = R.x - V.x; vy = R.y - V.y; }
    var mn = (V.s + P.s + R.s) / 3 / 7;      // 模块尺寸（小图坐标）
    var lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
    var ex = ux / lu, ey = uy / lu, fx = vx / lv, fy = vy / lv;
    var half = 3.5 * mn + mn * 0.35;          // 定位图案中心到符号外沿 + 小幅余量
    var q = [
      { x: V.x - half * ex - half * fx, y: V.y - half * ey - half * fy },
      { x: P.x + half * ex - half * fx, y: P.y + half * ey - half * fy },
      { x: P.x + (R.x - V.x) + half * ex + half * fx, y: P.y + (R.y - V.y) + half * ey + half * fy },
      { x: R.x - half * ex + half * fx, y: R.y - half * ey + half * fy }
    ];
    // 回到原图坐标
    var out = q.map(function (p) { return { x: p.x / sc, y: p.y / sc }; });
    // 轻微外扩，容忍定位误差
    var cxm = out.reduce(function (s2, p) { return s2 + p.x; }, 0) / 4;
    var cym = out.reduce(function (s2, p) { return s2 + p.y; }, 0) / 4;
    out = out.map(function (p) { return { x: cxm + (p.x - cxm) * 1.04, y: cym + (p.y - cym) * 1.04 }; });

    var spanX = Math.max.apply(null, out.map(function (p) { return p.x; })) - Math.min.apply(null, out.map(function (p) { return p.x; }));
    var spanY = Math.max.apply(null, out.map(function (p) { return p.y; })) - Math.min.apply(null, out.map(function (p) { return p.y; }));
    if (spanX < w * 0.12 || spanY < h * 0.12) return null;      // 太小，容易误检
    if (Math.abs(spanX - spanY) > Math.max(spanX, spanY) * 0.55) return null;

    return out;
  }

  /* ------------------------------ 识读 ------------------------------ */
  function tryDecode(jsQR, rgba, w, h) {
    try {
      var r = jsQR(rgba, w, h, { inversionAttempts: 'attemptBoth' });
      return r || null;
    } catch (e) { return null; }
  }

  function quadArea(q) {
    var a = 0;
    for (var i = 0; i < 4; i++) {
      var p = q[i], n = q[(i + 1) % 4];
      a += p.x * n.y - n.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  /**
   * 稳健识读
   * @param {Uint8Array} gray 灰度图
   * @param {number} w
   * @param {number} h
   * @param {object} opts { jsQR, quad, locate, minSide }
   * @returns {null|{res, quad, mirrored, tag, rect:boolean}}
   */
  function decode(gray, w, h, opts) {
    opts = opts || {};
    var jsQR = resolveJsQR(opts.jsQR);
    if (!jsQR) return null;

    /* 1) 整图预处理（成本低，先做） */
    var whole = [
      { g: gray, tag: '原图' },
      { g: stretch(gray), tag: '灰度拉伸' },
      { g: binOtsu(gray), tag: 'Otsu 二值' },
      { g: binAdaptive(gray, w, h, 24, 6), tag: '自适应二值' }
    ];
    if (w * h < 700 * 700) {
      var up = upscale(gray, w, h, 2);
      whole.push({ g: up.gray, width: up.width, height: up.height, tag: '放大 2×' });
      whole.push({ g: binOtsu(up.gray), width: up.width, height: up.height, tag: '放大 + Otsu' });
    }
    for (var i = 0; i < whole.length; i++) {
      var it = whole[i];
      if (!it.g) continue;
      var iw = it.width || w, ih = it.height || h;
      var res = tryDecode(jsQR, grayToRGBA(it.g, iw, ih), iw, ih);
      if (res) return { res: res, quad: null, mirrored: false, tag: it.tag, rect: false };
    }

    /* 2) 四角：用户手动校准优先，其次自行检测定位图案 */
    var quad = opts.quad && opts.quad.length === 4 ? opts.quad : null;
    var quadFrom = quad ? 'manual' : null;
    if (!quad && opts.locate !== false) {
      quad = findQuad(gray, w, h);
      if (quad) quadFrom = 'detect';
    }
    if (!quad) return null;

    /* 3) 透视校正 + 多预处理 + 镜像 */
    var side = Math.max(Math.abs(quad[1].x - quad[0].x), Math.abs(quad[3].y - quad[0].y),
      Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y));
    var outSize = clamp(Math.round(side), 320, 640);
    var rr = rectify(gray, w, h, quad, outSize, 0.12);
    if (!rr) return null;
    var rg = rr.gray, rs = rr.width;

    var vars = [
      { g: rg, tag: '校正后' },
      { g: stretch(rg), tag: '校正 + 拉伸' },
      { g: binOtsu(rg), tag: '校正 + Otsu' },
      { g: binAdaptive(rg, rs, rs, 20, 6), tag: '校正 + 自适应' }
    ];
    var j, vv, hit;
    for (j = 0; j < vars.length; j++) {
      vv = vars[j];
      if (!vv.g) continue;
      hit = tryDecode(jsQR, grayToRGBA(vv.g, rs, rs), rs, rs);
      if (hit) return { res: hit, quad: quad, quadFrom: quadFrom, mirrored: false, tag: vv.tag, rect: true };
    }

    /* 4) 水平翻转（镜像码）：QR 规整后翻转采样即可还原成标准矩阵 */
    var mg = flipH(rg, rs, rs);
    var mvs = [{ g: mg, tag: '镜像 + 校正' }, { g: binOtsu(mg), tag: '镜像 + Otsu' }];
    for (j = 0; j < mvs.length; j++) {
      vv = mvs[j];
      hit = tryDecode(jsQR, grayToRGBA(vv.g, rs, rs), rs, rs);
      if (hit) return { res: hit, quad: quad, quadFrom: quadFrom, mirrored: true, tag: vv.tag, rect: true };
    }
    return null;
  }

  return {
    decode: decode,
    findQuad: findQuad,
    rectify: rectify,
    otsu: otsu,
    flipH: flipH
  };
});
