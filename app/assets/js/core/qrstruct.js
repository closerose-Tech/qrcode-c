/*!
 * QRQ · QR Code 符号结构解析（ISO/IEC 18004）
 * 格式信息 BCH(15,5) 解析、功能图形掩模、码字读取、Reed-Solomon 纠错计数
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

  /* ---------- GF(256) 域运算（本原多项式 0x11D，生成元 α^0 起） ---------- */
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (!a || !b) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }
  function gfDiv(a, b) {
    if (!a) return 0;
    if (!b) return 0;
    return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
  }

  function syndromes(cw, nsym) {
    var s = new Uint8Array(nsym);
    for (var j = 0; j < nsym; j++) {
      var x = GF_EXP[j];
      var acc = 0;
      for (var i = 0; i < cw.length; i++) acc = gfMul(acc, x) ^ cw[i];
      s[j] = acc;
    }
    return s;
  }

  /* Berlekamp-Massey：由伴随式求错误定位多项式 Λ(x)，其次数即错误码字数 */
  function berlekampMassey(synd) {
    var n = synd.length;
    var C = [1], B = [1], L = 0, m = 1, b = 1;
    for (var k = 0; k < n; k++) {
      var d = synd[k];
      for (var i = 1; i <= L; i++) d ^= gfMul(C[i] || 0, synd[k - i]);
      if (d === 0) { m++; continue; }
      var T = C.slice();
      var coef = gfDiv(d, b);
      for (var i2 = 0; i2 < B.length; i2++) {
        var idx = i2 + m;
        C[idx] = (C[idx] || 0) ^ gfMul(coef, B[i2]);
      }
      if (2 * L <= k) {
        L = k + 1 - L;
        B = T;
        b = d;
        m = 1;
      } else {
        m++;
      }
    }
    return { C: C, L: L };
  }

  /* Chien 搜索：验证定位多项式根的数量，判断是否可纠 */
  function countRoots(coef, L, n) {
    if (L === 0) return 0;
    var cnt = 0;
    for (var i = 0; i < n; i++) {
      var x = GF_EXP[(255 - i) % 255];
      var lx = GF_LOG[x];
      var v = 1;
      for (var j = 1; j <= L; j++) {
        if (coef[j]) v ^= gfMul(coef[j], GF_EXP[(lx * j) % 255]);
      }
      if (v === 0) cnt++;
    }
    return cnt;
  }

  /* ---------- 对齐图案坐标（ISO/IEC 18004 附录 E） ---------- */
  function alignmentPositions(v) {
    if (v === 1) return [];
    var numAlign = Math.floor(v / 7) + 2;
    var step = (v === 32) ? 26 : Math.ceil((v * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var pos = new Array(numAlign);
    pos[0] = 6;
    var last = v * 4 + 10;
    for (var i = numAlign - 1; i >= 1; i--) {
      pos[i] = last;
      last -= step;
    }
    return pos;
  }

  /* ---------- 掩模（8 种） ---------- */
  var MASK_FUNCS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];

  /* ---------- 功能图形映射表 + 固定图形期望值 ---------- */
  function buildMap(N, v) {
    var fn = new Uint8Array(N * N);
    var exp = new Int8Array(N * N);
    exp.fill(-1);
    var comps = [];

    function idx(r, c) { return r * N + c; }
    function setFn(r, c) {
      if (r >= 0 && c >= 0 && r < N && c < N) fn[idx(r, c)] = 1;
    }

    function probe(row, col, key, name) {
      var cells = [];
      for (var r = -1; r <= 7; r++) {
        for (var c = -1; c <= 7; c++) {
          var rr = row + r, cc = col + c;
          if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
          fn[idx(rr, cc)] = 1;
          var dark = ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          exp[idx(rr, cc)] = dark ? 1 : 0;
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) cells.push([rr, cc]);
        }
      }
      comps.push({ key: key, name: name, cells: cells, kind: 'finder' });
    }

    probe(0, 0, 'finderTL', '左上定位图案');
    probe(0, N - 7, 'finderTR', '右上定位图案');
    probe(N - 7, 0, 'finderBL', '左下定位图案');

    // 定时图案
    var timingCells = [];
    for (var r2 = 8; r2 < N - 8; r2++) {
      if (fn[idx(r2, 6)]) continue;
      fn[idx(r2, 6)] = 1;
      exp[idx(r2, 6)] = (r2 % 2 === 0) ? 1 : 0;
      timingCells.push([r2, 6]);
    }
    for (var c2 = 8; c2 < N - 8; c2++) {
      if (fn[idx(6, c2)]) continue;
      fn[idx(6, c2)] = 1;
      exp[idx(6, c2)] = (c2 % 2 === 0) ? 1 : 0;
      timingCells.push([6, c2]);
    }
    comps.push({ key: 'timing', name: '定时图案', cells: timingCells, kind: 'timing' });

    // 校正图案
    var pos = alignmentPositions(v);
    var alignCells = [];
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var row = pos[i], col = pos[j];
        if (fn[idx(row, col)]) continue;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var rr2 = row + dr, cc2 = col + dc;
            fn[idx(rr2, cc2)] = 1;
            exp[idx(rr2, cc2)] = (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) ? 1 : 0;
            alignCells.push([rr2, cc2]);
          }
        }
      }
    }
    if (alignCells.length) {
      comps.push({ key: 'alignment', name: '校正图案', cells: alignCells, kind: 'alignment' });
    }

    // 格式信息区 + 暗模块
    for (var k = 0; k < 15; k++) {
      if (k < 6) setFn(k, 8);
      else if (k < 8) setFn(k + 1, 8);
      else setFn(N - 15 + k, 8);
      if (k < 8) setFn(8, N - k - 1);
      else if (k < 9) setFn(8, 7);
      else setFn(8, 14 - k);
    }
    setFn(N - 8, 8);

    // 版本信息区
    if (v >= 7) {
      for (var m = 0; m < 18; m++) {
        setFn(Math.floor(m / 3), m % 3 + N - 11);
        setFn(m % 3 + N - 11, Math.floor(m / 3));
      }
    }

    return { fn: fn, exp: exp, comps: comps, alignPositions: pos };
  }

  /* ---------- 格式信息 ---------- */
  function bchTypeInfo(data) {
    var d = data << 10;
    for (var i = 14; i >= 10; i--) {
      if ((d >> i) & 1) d ^= 0x537 << (i - 10);
    }
    return ((data << 10) | (d & 0x3ff)) ^ 0x5412;
  }

  function popcount(x) {
    var n = 0;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  }

  var ECL_BY_BITS = ['M', 'L', 'H', 'Q'];

  function readFormat(bin, N) {
    var a = 0, b = 0;
    for (var i = 0; i < 15; i++) {
      var r, c;
      if (i < 6) { r = i; c = 8; } else if (i < 8) { r = i + 1; c = 8; } else { r = N - 15 + i; c = 8; }
      if (bin[r * N + c]) a |= (1 << i);
      if (i < 8) { r = 8; c = N - i - 1; } else if (i < 9) { r = 8; c = 7; } else { r = 8; c = 14 - i; }
      if (bin[r * N + c]) b |= (1 << i);
    }
    var best = null;
    for (var ec = 0; ec < 4; ec++) {
      for (var mask = 0; mask < 8; mask++) {
        var code = bchTypeInfo((ec << 3) | mask);
        var d1 = popcount(a ^ code);
        var d2 = popcount(b ^ code);
        var dmin = Math.min(d1, d2);
        if (!best || dmin < best.dmin) best = { dmin: dmin, ecBits: ec, mask: mask, dCopy1: d1, dCopy2: d2 };
      }
    }
    best.ecl = ECL_BY_BITS[best.ecBits];
    best.valid = best.dmin <= 3;
    return best;
  }

  /* ---------- 码字读取（含去掩模） ---------- */
  function readCodewords(bin, N, mask, fn) {
    var maskFn = MASK_FUNCS[mask];
    var cw = [];
    var bitIndex = 7, current = 0;
    var row = N - 1, inc = -1;
    for (var col = N - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (!fn[row * N + cc]) {
            var bit = bin[row * N + cc] ? 1 : 0;
            if (maskFn(row, cc)) bit ^= 1;
            if (bit) current |= (1 << bitIndex);
            bitIndex--;
            if (bitIndex === -1) {
              cw.push(current);
              current = 0;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || row >= N) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
    return Uint8Array.from(cw);
  }

  /* ---------- 纠错块结构 ---------- */
  function rawTable() {
    if (root && root.QRQ && root.QRQ.RS_BLOCK_RAW) return root.QRQ.RS_BLOCK_RAW;
    if (typeof module === 'object' && module.exports) {
      try { return require('./rsblocks.js').RS_BLOCK_RAW; } catch (e) { return null; }
    }
    return null;
  }

  function blocksFor(version, ecl) {
    var raw = rawTable();
    if (!raw) return null;
    var row = raw[version - 1];
    if (!row) return null;
    var order = ['L', 'M', 'Q', 'H'];
    var seg = row.split('/')[order.indexOf(ecl)];
    if (!seg) return null;
    return seg.split(',').map(function (s) {
      var p = s.split('.');
      return { count: +p[0], total: +p[1], data: +p[2] };
    });
  }

  function expandBlocks(spec) {
    var out = [];
    for (var i = 0; i < spec.length; i++) {
      for (var k = 0; k < spec[i].count; k++) out.push({ total: spec[i].total, data: spec[i].data });
    }
    return out;
  }

  function deinterleave(cw, blocks) {
    var maxData = 0, maxEc = 0;
    for (var i = 0; i < blocks.length; i++) {
      maxData = Math.max(maxData, blocks[i].data);
      maxEc = Math.max(maxEc, blocks[i].total - blocks[i].data);
    }
    var dataArrs = blocks.map(function () { return []; });
    var ecArrs = blocks.map(function () { return []; });
    var off = 0;
    for (var d = 0; d < maxData; d++) {
      for (var b = 0; b < blocks.length; b++) {
        if (d < blocks[b].data) dataArrs[b].push(cw[off++]);
      }
    }
    for (var e = 0; e < maxEc; e++) {
      for (var b2 = 0; b2 < blocks.length; b2++) {
        if (e < blocks[b2].total - blocks[b2].data) ecArrs[b2].push(cw[off++]);
      }
    }
    return blocks.map(function (blk, i2) {
      return { total: blk.total, data: blk.data, cw: Uint8Array.from(dataArrs[i2].concat(ecArrs[i2])) };
    });
  }

  /* 逐块计算 Reed-Solomon 实际纠正的码字数与纠错能力 */
  function rsAnalyze(cw, version, ecl) {
    var spec = blocksFor(version, ecl);
    if (!spec) return null;
    var blocks = expandBlocks(spec);
    var totalCw = 0;
    for (var i = 0; i < blocks.length; i++) totalCw += blocks[i].total;
    if (cw.length < totalCw) return null;
    var built = deinterleave(cw.subarray(0, totalCw), blocks);

    var errors = 0, capacity = 0, dataCw = 0, ecCw = 0, uncorrectable = 0;
    var detail = [];
    for (var b = 0; b < built.length; b++) {
      var blk = built[b];
      var ec = blk.total - blk.data;
      var cap = ec >> 1;
      var syn = syndromes(blk.cw, ec);
      var any = false;
      for (var s = 0; s < syn.length; s++) if (syn[s]) { any = true; break; }
      var err = 0, ok = true;
      if (any) {
        var bm = berlekampMassey(syn);
        err = bm.L;
        var roots = countRoots(bm.C, bm.L, blk.total);
        ok = (roots === bm.L) && (bm.L <= cap);
      }
      errors += err;
      capacity += cap;
      dataCw += blk.data;
      ecCw += ec;
      if (!ok) uncorrectable++;
      detail.push({ index: b + 1, total: blk.total, data: blk.data, ec: ec, errors: err, capacity: cap, ok: ok });
    }
    return {
      blockCount: built.length,
      dataCodewords: dataCw,
      ecCodewords: ecCw,
      errorsCorrected: errors,
      capacity: capacity,
      uncorrectableBlocks: uncorrectable,
      blocks: detail,
      ok: uncorrectable === 0
    };
  }

  return {
    gfMul: gfMul,
    syndromes: syndromes,
    berlekampMassey: berlekampMassey,
    alignmentPositions: alignmentPositions,
    buildMap: buildMap,
    readFormat: readFormat,
    readCodewords: readCodewords,
    blocksFor: blocksFor,
    expandBlocks: expandBlocks,
    deinterleave: deinterleave,
    rsAnalyze: rsAnalyze,
    bchTypeInfo: bchTypeInfo,
    MASK_FUNCS: MASK_FUNCS
  };
});
