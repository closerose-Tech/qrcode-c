/*!
 * QRQ · Code 128 / GS1-128 解码
 * 用于件烟标签一维码区数据读取：剖面取样 → 二值化 → 游程 → 模式匹配 → 校验 → 组集解码
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

  /* ISO/IEC 15417 Code 128 符号表：值 0–105 每符号 6 个元素共 11 模块，106 为终止符 13 模块 */
  var PATTERN_TEXT =
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
    '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112';

  var PAT = PATTERN_TEXT.split(' ').map(function (s) {
    return s.split('').map(function (c) { return +c; });
  });

  var STOP = 106;

  /* 某个 6 元组与符号 k 的归一化误差（按总宽缩放后逐元素平方差） */
  function matchSymbol(group) {
    var total = 0, i;
    for (i = 0; i < group.length; i++) total += group[i];
    if (!total) return null;
    var bestErr = Infinity, best = -1, bestScale = 0;
    for (var k = 0; k < STOP; k++) {
      var p = PAT[k], ps = 0;
      for (i = 0; i < 6; i++) ps += p[i];
      var sc = total / ps;
      var err = 0;
      for (i = 0; i < 6; i++) {
        var d = group[i] / sc - p[i];
        err += d * d;
      }
      err /= 6;
      if (err < bestErr) { bestErr = err; best = k; bestScale = sc; }
    }
    return { value: best, err: Math.sqrt(bestErr), scale: bestScale };
  }

  function matchStop(group) {
    var total = 0, i;
    for (i = 0; i < group.length; i++) total += group[i];
    var p = PAT[STOP], ps = 0;
    for (i = 0; i < 7; i++) ps += p[i];
    var sc = total / ps, err = 0;
    for (i = 0; i < 7; i++) {
      var d = group[i] / sc - p[i];
      err += d * d;
    }
    return { err: Math.sqrt(err / 7), scale: sc };
  }

  function runLengths(bits, from, to) {
    var runs = [], cur = bits[from], n = 1;
    for (var i = from + 1; i < to; i++) {
      if (bits[i] === cur) n++;
      else { runs.push(n); cur = bits[i]; n = 1; }
    }
    runs.push(n);
    return runs;
  }

  /* 从游程序列解出符号值序列；终止符允许 7 个元素，或被图像边缘截断为 6 个元素 */
  function decodeRuns(runs) {
    if (runs.length < 13) return null;
    var stopLen = 0, stopErr = 0, lens = runs.length;
    if ((lens - 7) % 6 === 0 && lens >= 19) {
      var st7 = matchStop(runs.slice(lens - 7));
      if (st7.err <= 0.6) { stopLen = 7; stopErr = st7.err; }
    }
    if (!stopLen && (lens - 6) % 6 === 0 && lens >= 18) {
      var g6 = runs.slice(lens - 6);
      var p = PAT[STOP].slice(0, 6);
      var tot = 0, i;
      for (i = 0; i < 6; i++) tot += g6[i];
      var sc = tot / 11, e6 = 0;
      for (i = 0; i < 6; i++) { var d = g6[i] / sc - p[i]; e6 += d * d; }
      e6 = Math.sqrt(e6 / 6);
      if (e6 <= 0.6) { stopLen = 6; stopErr = e6; }
    }
    if (!stopLen) return null;
    var n = (lens - stopLen) / 6;
    if (n < 3) return null;
    var codes = [], scales = [], maxErr = 0;
    for (var g = 0; g < n; g++) {
      var m = matchSymbol(runs.slice(g * 6, g * 6 + 6));
      if (!m || m.err > 0.75) return null;
      codes.push(m.value);
      scales.push(m.scale);
      maxErr = Math.max(maxErr, m.err);
    }
    return { codes: codes, scales: scales, err: Math.max(maxErr, stopErr), stopLen: stopLen };
  }

  function pad2(v) { return (v < 10 ? '0' : '') + v; }

  /* 组织集解码：支持 A/B/C 及切换、FNC1 */
  function decodeSymbols(codes, gs1Hint) {
    if (!codes.length) return null;
    var start = codes[0];
    if (start < 103 || start > 105) return null;
    var set = start === 103 ? 'A' : (start === 104 ? 'B' : 'C');
    var out = '';
    var gs1 = !!gs1Hint;
    var fnc1At = -1;
    var i = 1;
    var end = codes.length - 1; // 末位为校验符
    var shift = null;
    while (i < end) {
      var t = codes[i];
      var eff = shift || set;
      shift = null;
      if (t === 102) {              // FNC1
        if (fnc1At < 0) fnc1At = i;
        gs1 = true;
        out += '\u001d';
        i++; continue;
      }
      if (t === 99 && eff !== 'C') { set = 'C'; i++; continue; }
      if (t === 100 && eff !== 'B') { set = 'B'; i++; continue; }
      if (t === 101 && eff !== 'A') { set = 'A'; i++; continue; }
      if (t === 98) { shift = eff === 'A' ? 'B' : 'A'; i++; continue; }
      if (t === 96 || t === 97) { i++; continue; }  // FNC3 / FNC2
      if (eff === 'C') {
        if (t > 99) return null;
        out += pad2(t);
      } else if (eff === 'A') {
        if (t < 64) out += String.fromCharCode(t + 32);
        else if (t < 96) out += String.fromCharCode(t - 64);
        else return null;
      } else {
        if (t < 96) out += String.fromCharCode(t + 32);
        else return null;
      }
      i++;
    }
    // 校验：start + Σ i·ci ≡ check (mod 103)
    var check = codes[codes.length - 1];
    var sum = start;
    for (var j = 1; j < codes.length - 1; j++) sum += j * codes[j];
    var ok = (sum % 103) === check;
    return {
      text: out.split('\u001d').join(''),
      raw: out,
      gs1: gs1,
      checkOk: ok,
      startCode: start,
      symbolCount: codes.length,
      fnc1: fnc1At >= 0 ? fnc1At : (gs1Hint ? 0 : -1)
    };
  }

  /* 常见 GS1 AI 解析（只覆盖标签上会出现的应用标识符） */
  var AI_FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };

  function parseGS1(digits) {
    var res = [], i = 0;
    while (i < digits.length) {
      var ai = null, len = 0;
      for (var k = 4; k >= 2; k--) {
        var cand = digits.substr(i, k);
        if (AI_FIXED[cand] !== undefined) { ai = cand; len = AI_FIXED[cand]; break; }
        if (/^(10|21|22|30|37|90|91|92|93|94|95|240|241|250|251|400|401|402|403|410|411|412|413|414|415|420|421|422|423|7001|8003|8004|8005|8006|8008)$/.test(cand) && i + k < digits.length) {
          ai = cand; len = -1; break;
        }
      }
      if (!ai) { res.push({ ai: '', name: '未标注应用标识符', value: digits.slice(i) }); break; }
      i += ai.length;
      if (len > 0) { res.push({ ai: ai, name: AI_NAME[ai] || '', value: digits.substr(i, len) }); i += len; }
      else {
        var rest = digits.slice(i);
        var cut = rest.indexOf('\u001d');
        var val = cut >= 0 ? rest.slice(0, cut) : rest;
        res.push({ ai: ai, name: AI_NAME[ai] || '', value: val });
        i += val.length + (cut >= 0 ? 1 : 0);
      }
    }
    return res;
  }

  var AI_NAME = {
    '00': 'SSCC 系列货运包装箱代码', '01': 'GTIN 商品编码', '02': '物流单元内商品',
    '10': '批号', '11': '生产日期', '13': '包装日期', '15': '最佳食用日期', '17': '有效期',
    '21': '序列号', '30': '数量', '37': '数量', '400': '订单号', '410': '收货方 GLN'
  };

  /* 在给定矩形内按多条剖面扫描并尝试解码 */
  function decode(gray, width, height, rect) {
    var x0 = Math.max(0, Math.round(rect.x));
    var y0 = Math.max(0, Math.round(rect.y));
    var x1 = Math.min(width, Math.round(rect.x + rect.w));
    var y1 = Math.min(height, Math.round(rect.y + rect.h));
    if (x1 - x0 < 30 || y1 - y0 < 8) return { ok: false, reason: '一维码区域过小' };

    var bands = [0.5, 0.35, 0.65, 0.25, 0.75, 0.45];
    var lastFail = '未找到有效的 Code 128 符号';

    for (var bi = 0; bi < bands.length; bi++) {
      var cy = Math.round(y0 + (y1 - y0) * bands[bi]);
      var half = Math.max(1, Math.round((y1 - y0) * 0.05));
      var prof = new Float32Array(x1 - x0);
      var nRows = 0;
      for (var y = Math.max(y0, cy - half); y <= Math.min(y1 - 1, cy + half); y++) {
        var base = y * width;
        for (var x = x0; x < x1; x++) prof[x - x0] += gray[base + x];
        nRows++;
      }
      for (var p = 0; p < prof.length; p++) prof[p] /= nRows;

      var lo = Infinity, hi = -Infinity;
      for (var q = 0; q < prof.length; q++) {
        if (prof[q] < lo) lo = prof[q];
        if (prof[q] > hi) hi = prof[q];
      }
      if (hi - lo < 40) { lastFail = '一维码对比度不足'; continue; }
      var thr = (lo + hi) / 2;

      var bits = new Uint8Array(prof.length);
      for (var b = 0; b < prof.length; b++) bits[b] = prof[b] < thr ? 1 : 0;

      var s = 0, e = prof.length - 1;
      while (s < e && !bits[s]) s++;
      while (e > s && !bits[e]) e--;
      if (e - s < 40) { lastFail = '未检测到条空序列'; continue; }

      var runs = runLengths(bits, s, e + 1);
      var hit = tryRuns(runs);
      if (!hit) { lastFail = '条空比例不符合 Code 128'; continue; }

      var dec = hit.dec;
      var digits = dec.text.replace(/[^0-9]/g, '');
      var ai = dec.gs1 ? parseGS1(dec.raw.replace(/^\u001d+/, '')) : [];
      // 商品编码取 AI(01) 的值；未带 AI 时按裸数字取 13/14 位段
      var gtin = '';
      for (var q = 0; q < ai.length; q++) {
        if (ai[q].ai === '01' && ai[q].value) { gtin = ai[q].value; break; }
      }
      if (!gtin) gtin = digits.length >= 13 ? digits.slice(0, 14) : digits;
      return {
        ok: true,
        text: dec.text,
        raw: dec.raw,
        gs1: dec.gs1,
        checkOk: true,
        symbology: dec.gs1 ? 'GS1-128' : 'Code 128',
        startSet: dec.startCode === 103 ? 'A' : (dec.startCode === 104 ? 'B' : 'C'),
        symbolCount: dec.symbolCount,
        moduleCount: hit.modules,
        moduleWidthMm: hit.moduleWidth,
        barStart: x0 + s + hit.trimStart,
        barEnd: x0 + e - hit.trimEnd,
        ai: ai,
        gtin: gtin,
        quality: hit.err,
        seed: bi
      };
    }
    return { ok: false, reason: lastFail };
  }

  /* 依次尝试条目边沿修剪（消除抗锯齿产生的单像素游程），以校验符通过为准 */
  function tryRuns(runs) {
    var total = 0, i;
    for (i = 0; i < runs.length; i++) total += runs[i];
    var trims = [[0, 0], [0, 1], [1, 0], [0, 2], [2, 0], [1, 1], [1, 2], [2, 1], [2, 2]];
    for (var t = 0; t < trims.length; t++) {
      var ts = trims[t][0], te = trims[t][1];
      if (runs.length - ts - te < 13) continue;
      var sub = runs.slice(ts, runs.length - te);
      var dr = decodeRuns(sub);
      if (!dr) continue;
      var dec = decodeSymbols(dr.codes);
      if (!dec || !dec.checkOk) continue;
      var mods = 0;
      for (var m = 0; m < sub.length; m++) mods += sub[m];
      var avgScale = 0;
      for (var k = 0; k < dr.scales.length; k++) avgScale += dr.scales[k];
      avgScale /= dr.scales.length;
      return {
        dec: dec,
        err: dr.err,
        modules: mods,
        moduleWidth: avgScale,
        trimStart: ts,
        trimEnd: te
      };
    }
    return null;
  }


  /* 编码（供示例标签与自检使用）：GS1-128，数字优先使用 C 集 */
  function encode(data, gs1) {
    var codes = [];
    var digits = String(data || '').replace(/[^0-9]/g, '');
    if (gs1 !== false && digits.length >= 4) {
      codes.push(105);
      codes.push(102);
      var i = 0;
      while (i + 1 < digits.length) { codes.push(+digits.substr(i, 2)); i += 2; }
      if (i < digits.length) {
        codes.push(100);
        codes.push(digits.charCodeAt(i) - 32);
      }
    } else {
      codes.push(104);
      for (var k = 0; k < String(data).length; k++) codes.push(String(data).charCodeAt(k) - 32);
    }
    var sum = codes[0];
    for (var j = 1; j < codes.length; j++) sum += j * codes[j];
    codes.push(sum % 103);
    codes.push(STOP);

    var bars = [], x = 0;
    for (var c = 0; c < codes.length; c++) {
      var pat = PAT[codes[c]];
      for (var e = 0; e < pat.length; e++) {
        if (e % 2 === 0) bars.push({ x: x, w: pat[e] });
        x += pat[e];
      }
    }
    return { modules: x, bars: bars, codes: codes };
  }

  return {
    decode: decode,
    parseGS1: parseGS1,
    encode: encode,
    PATTERN_TEXT: PATTERN_TEXT,
    AI_NAME: AI_NAME
  };
});
