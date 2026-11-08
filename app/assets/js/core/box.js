/*!
 * QRQ · 盒条二维码合规测评（依据 GB/T 33993-2017 与行业盒条二维码技术要求）
 *   码制 QR（ISO/IEC 18004）、版本 3（29×29）、纠错 M、编码 59 位、字母数字字符集
 *   喷印尺寸：盒-细支 ≥7×7；盒-标准/中支 8×8~10×10；条 10×10~12×12；打印质量 ≥500DPI
 *   底框宽度 ≤2mm；套印位置偏差 ≤0.8mm；符号质量按 GB/T 33993-2017
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    root.QRQ.Box = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 包装类型 × 支型 */
  var PACK = {
    'box-fine': { key: 'box-fine', type: 'box', typeText: '盒烟', spec: '细支', min: 7, max: null, label: '盒烟 · 细支' },
    'box-std': { key: 'box-std', type: 'box', typeText: '盒烟', spec: '标准支/中支', min: 8, max: 10, label: '盒烟 · 标准支 / 中支' },
    'case-fine': { key: 'case-fine', type: 'case', typeText: '条烟', spec: '细支', min: 10, max: 12, label: '条烟 · 细支' },
    'case-std': { key: 'case-std', type: 'case', typeText: '条烟', spec: '标准支/中支', min: 10, max: 12, label: '条烟 · 标准支 / 中支' }
  };

  /* 59 位编码结构：网络服务地址(15) + 分隔符 + 标识解析前缀(9) + 分隔符 + 实体分类码(2) + 属性码 + 流水码 */
  var STRUCT = [
    { key: 'addr', name: '网络服务地址', from: 1, to: 15 },
    { key: 'sep1', name: '分隔符', from: 16, to: 16, sep: true },
    { key: 'prefix', name: '标识解析前缀', from: 17, to: 25 },
    { key: 'sep2', name: '分隔符', from: 26, to: 26, sep: true },
    { key: 'entity', name: '实体分类码', from: 27, to: 28 },
    { key: 'attr', name: '属性码', from: 29, to: 41 },
    { key: 'serial', name: '流水码', from: 42, to: 59 }
  ];

  var CHARSET = /^[0-9A-Za-z./:]+$/;

  function judge(dev, okTol, warnTol) {
    if (dev === null || dev === undefined) return 'na';
    var a = Math.abs(dev);
    if (a <= okTol) return 'ok';
    if (a <= (warnTol === undefined ? okTol * 1.6 : warnTol)) return 'warn';
    return 'fail';
  }

  /* 上限型判据：实测低于上限永远合格，偏差为负只代表余量 */
  function judgeMax(dev, warnTol) {
    if (dev === null || dev === undefined) return 'na';
    if (dev <= 0) return 'ok';
    if (dev <= warnTol) return 'warn';
    return 'fail';
  }

  function item(o) {
    return {
      key: o.key, name: o.name,
      std: o.std === undefined ? null : o.std,
      value: o.value === undefined ? null : o.value,
      dev: o.dev === undefined ? null : o.dev,
      unit: o.unit || '',
      status: o.status || 'na',
      naText: o.naText || '',
      desc: o.desc || ''
    };
  }

  /* 区间判据：落在区间内偏差 0；越界给出到最近边界的差 */
  function rangeDev(v, min, max) {
    if (v === null || v === undefined) return null;
    if (max === null || max === undefined) return v - min;
    if (v < min) return v - min;
    if (v > max) return v - max;
    return 0;
  }

  function rangeStatus(v, min, max, tol) {
    if (v === null) return 'na';
    var d = rangeDev(v, min, max);
    return judge(d, tol === undefined ? 0 : tol);
  }

  function rangeText(min, max, unit) {
    if (max === null || max === undefined) return '≥' + min + (unit || '');
    if (min === max) return min + (unit || '');
    return min + '~' + max + (unit || '');
  }

  /* --------- 沿四边形各边向外探测亮区（用于底框与居中） --------- */
  function edgeProbe(gray, W, H, quad, edge, maxPx, thr, bandFrac) {
    var A = quad[edge], B = quad[(edge + 1) % 4];
    var ex = B.x - A.x, ey = B.y - A.y;
    var el = Math.hypot(ex, ey) || 1;
    // 外法线：对 TL→TR（上边）外法线朝上，即 (-ey, ex) 旋转方向与顶点顺序相关
    var nx = -ey / el, ny = ex / el;
    var cx = (A.x + B.x) / 2, cy = (A.y + B.y) / 2;
    var half = el * (bandFrac || 0.3);

    function brightAt(t) {
      var px = cx + nx * t, py = cy + ny * t;
      var ux = ex / el, uy = ey / el;
      var sum = 0, n = 0;
      for (var s = -half; s <= half; s += Math.max(1, el / 60)) {
        var x = Math.round(px + ux * s), y = Math.round(py + uy * s);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        sum += gray[y * W + x]; n++;
      }
      if (!n) return null;
      return sum / n;
    }

    var run = 0, t = 1;
    while (t <= maxPx) {
      var b = brightAt(t);
      if (b === null) return { px: run, edge: true };
      if (b < thr) return { px: run, edge: false };
      run = t;
      t += 1;
    }
    return { px: run, edge: true };
  }

  function buildStruct(text) {
    var s = String(text || '');
    return STRUCT.map(function (d) {
      var seg = s.slice(d.from - 1, d.to);
      return { key: d.key, name: d.name, from: d.from, to: d.to, value: seg, sep: !!d.sep, missing: !seg };
    });
  }

  /* ---------------- 主流程 ---------------- */
  function analyze(gray, width, height, input, opts) {
    opts = opts || {};
    var IMG = opts.IMG || (root && root.QRQ) || {};
    var pack = PACK[input.pack] || PACK['box-std'];
    var ppm = input.ppm || null;              // px / mm
    var quad = input.quad;
    var r0 = input.grade || null;             // QRQ.analyze 结果
    var notes = [];

    var groups = [];
    var qrOk = !!(r0 && r0.ok);
    var text = qrOk ? (r0.decode.text || '') : '';
    var version = qrOk ? r0.decode.version : null;
    var size = qrOk ? r0.decode.size : null;
    var ecl = qrOk ? (r0.decode.ecl || '').toUpperCase() : '';

    /* ---- 几何：四边、边长、底框 ---- */
    var geo = null;
    if (quad && quad.length === 4) {
      var sides = [0, 1, 2, 3].map(function (i) {
        var a = quad[i], b = quad[(i + 1) % 4];
        return Math.hypot(b.x - a.x, b.y - a.y);
      });
      var sidePx = sides.reduce(function (s, v) { return s + v; }, 0) / 4;
      var sideMm = ppm ? sidePx / ppm : null;
      var sqDev = ppm ? Math.abs(sides[0] - sides[2]) / ppm : null;

      var frame = null;
      if (ppm && gray) {
        var thr = 128;
        try {
          var sx0 = clamp(Math.round(Math.min.apply(null, quad.map(function (p) { return p.x; }))), 0, width - 1);
          var sx1 = clamp(Math.round(Math.max.apply(null, quad.map(function (p) { return p.x; }))), 0, width - 1);
          var sy0 = clamp(Math.round(Math.min.apply(null, quad.map(function (p) { return p.y; }))), 0, height - 1);
          var sy1 = clamp(Math.round(Math.max.apply(null, quad.map(function (p) { return p.y; }))), 0, height - 1);
          var hist = new Float64Array(256), total = 0;
          for (var y = sy0; y <= sy1; y += 2) {
            for (var x = sx0; x <= sx1; x += 2) { hist[gray[y * width + x] | 0]++; total++; }
          }
          // Otsu：区分符号内部的黑白，用于判断“白区”与承印底色的边界
          var sumAll = 0, nAll = 0;
          for (var v = 0; v < 256; v++) { sumAll += v * hist[v]; nAll += hist[v]; }
          var wB = 0, sumB = 0, bestThr = 0, bestVar = -1;
          for (var th = 0; th < 256; th++) {
            wB += hist[th];
            if (!wB) continue;
            var wF = nAll - wB;
            if (!wF) break;
            sumB += th * hist[th];
            var mB = sumB / wB, mF = (sumAll - sumB) / wF;
            var vb = wB * wF * (mB - mF) * (mB - mF);
            if (vb > bestVar) { bestVar = vb; bestThr = th; }
          }
          thr = nAll ? bestThr : 128;
        } catch (e) { thr = 128; }

        // 上边外法线朝上/下取决于顶点序；统一取“远离符号中心”的方向
        var cxm = quad.reduce(function (s, p) { return s + p.x; }, 0) / 4;
        var cym = quad.reduce(function (s, p) { return s + p.y; }, 0) / 4;
        var maxPx = Math.min(width, height) * 0.35;
        var runs = [0, 1, 2, 3].map(function (e) {
          var A = quad[e], B = quad[(e + 1) % 4];
          var ex = B.x - A.x, ey = B.y - A.y;
          var midx = (A.x + B.x) / 2, midy = (A.y + B.y) / 2;
          // 若法线与“中心→边中点”同向则翻转
          var dot = (-ey) * (midx - cxm) + ex * (midy - cym);
          // dot > 0 表示未翻转的法线已指向符号外侧；否则交换两端以反转法线
          var q = dot > 0 ? [A, B] : [B, A];
          return edgeProbe(gray, width, height, q, 0, maxPx, thr, 0.32);
        });
        // runs 顺序与 q 的顶点顺序相关，重新按方向命名：top/right/bottom/left
        frame = {
          top: runs[0].px / ppm,
          bottom: runs[2].px / ppm,
          left: runs[3].px / ppm,
          right: runs[1].px / ppm,
          topEdge: runs[0].edge, bottomEdge: runs[2].edge,
          leftEdge: runs[3].edge, rightEdge: runs[1].edge
        };
      }

      geo = { sides: sides.map(function (s) { return ppm ? s / ppm : null; }), sidePx: sidePx, sideMm: sideMm, squareDev: sqDev, frame: frame };
    }

    var moduleMm = (geo && geo.sideMm && size) ? geo.sideMm / size : null;

    /* ================= 组1：符号与编码 ================= */
    var g1 = { key: 'symbol', name: '符号与编码', items: [] };

    g1.items.push(item({
      key: 'sym_qr', name: '码制', std: 'QR Code', value: qrOk ? 'QR Code' : '未识读',
      dev: null, status: qrOk ? 'ok' : 'fail',
      desc: 'QR 码制遵循 ISO/IEC 18004。'
    }));

    g1.items.push(item({
      key: 'sym_ver', name: '二维码版本', std: 3, value: version, dev: version === null ? null : version - 3,
      status: version === null ? 'na' : (version === 3 ? 'ok' : 'fail'),
      desc: '行业卷烟二维码使用版本 3。'
    }));

    g1.items.push(item({
      key: 'sym_size', name: '模块数', std: '29×29', value: size ? size + '×' + size : null,
      dev: size === null ? null : size - 29,
      status: size === null ? 'na' : (size === 29 ? 'ok' : 'fail'),
      desc: '版本 3 对应 29×29 模块。'
    }));

    g1.items.push(item({
      key: 'sym_ecl', name: '纠错级别', std: 'M', value: ecl || null, dev: null,
      status: !ecl ? 'na' : (ecl === 'M' ? 'ok' : 'fail'),
      desc: '纠错级别 M，可恢复约 15% 的受损码字。'
    }));

    var txtLen = text.length;
    g1.items.push(item({
      key: 'code_len', name: '编码长度', std: 59, value: txtLen || null, unit: '位',
      dev: txtLen ? txtLen - 59 : null,
      status: !txtLen ? 'na' : judge(txtLen - 59, 0),
      desc: '编码总长度为 59 位（不含协议头）。'
    }));

    var badChars = '';
    if (txtLen) {
      var seen = {};
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (!/[0-9A-Za-z./:]/.test(ch)) seen[ch] = 1;
      }
      badChars = Object.keys(seen).join(' ');
    }
    g1.items.push(item({
      key: 'code_charset', name: '字符集', std: '0-9 A-Z a-z . / :', value: txtLen ? (badChars ? '含非法字符 ' + badChars : '合规') : null,
      dev: null, status: !txtLen ? 'na' : (badChars ? 'fail' : 'ok'),
      desc: '字母数字型编码，仅允许数字、大小写字母与 . / : 三个字符。'
    }));

    var struct = txtLen ? buildStruct(text) : null;
    var structOk = struct && !struct.some(function (s) { return s.missing; });
    g1.items.push(item({
      key: 'code_struct', name: '编码结构', std: '地址+前缀+实体分类+属性码+流水码',
      value: !struct ? null : (structOk ? '完整' : '缺段'),
      dev: null, status: !struct ? 'na' : (structOk ? 'ok' : 'fail'),
      desc: structOk ? '各段均可定位。' : '按 59 位定长分段存在缺段，需核对赋码规则。'
    }));

    groups.push(g1);

    /* ================= 组2：符号质量（GB/T 33993-2017） ================= */
    var g2 = { key: 'quality', name: '符号质量（GB/T 33993-2017）', items: [] };
    var gv = qrOk && r0.grade ? r0.grade.value : null;
    g2.items.push(item({
      key: 'q_grade', name: '综合符号等级', std: '≥1.5', value: gv === null ? null : r2(gv),
      dev: gv === null ? null : r2(gv - 1.5), unit: '',
      status: gv === null ? 'na' : (gv >= 2.5 ? 'ok' : (gv >= 1.5 ? 'ok' : (gv >= 1.2 ? 'warn' : 'fail'))),
      desc: '按 ISO/IEC 15415 方法分级，GB/T 33993-2017 商品二维码要求符号质量不低于 1.5。'
    }));

    var METRIC_NAME = { SC: '符号对比度', MOD: '调制度', FPD: '固定图形损伤', ANU: '轴向非均匀', GNU: '网格非均匀', UEC: '未用纠错' };
    // 各参数的 A 级门槛（15415 锚点），标准列给出门槛，状态按等级判（GB/T 33993 以综合等级为准）
    var QSTD = {
      SC: { std: 70, unit: '%', max: false },
      MOD: { std: 50, unit: '%', max: false },
      FPD: { std: 9, unit: '%', max: true },
      ANU: { std: 6, unit: '%', max: true },
      GNU: { std: 38, unit: '%', max: true },
      UEC: { std: 62, unit: '%', max: false }
    };
    if (qrOk && r0.metrics) {
      r0.metrics.forEach(function (m) {
        var q = QSTD[m.key] || null;
        var dev = null;
        if (q && m.value !== null && m.value !== undefined) dev = r2(m.value - q.std);
        g2.items.push(item({
          key: 'q_' + String(m.key).toLowerCase(), name: METRIC_NAME[m.key] || m.name,
          std: q ? (q.max ? '≤' + q.std : '≥' + q.std) : null,
          value: m.value === null ? null : r2(m.value), unit: (m.unit || (q && q.unit) || ''),
          dev: dev,
          status: m.grade === null || m.grade === undefined ? 'na' : (m.grade >= 1.5 ? 'ok' : (m.grade >= 1.2 ? 'warn' : 'fail')),
          desc: (m.grade === null ? '无法计算' : '等级 ' + r1(m.grade) + ' / 4') +
            (q ? '（A 级门槛 ' + (q.max ? '≤' : '≥') + q.std + q.unit + '）' : '') +
            (m.note ? ' · ' + m.note : '')
        }));
      });
    } else {
      g2.items.push(item({ key: 'q_none', name: '分级参数', std: '—', value: '未识读', status: 'fail', desc: '未能识读符号，无法计算分级参数。' }));
    }
    groups.push(g2);

    /* ================= 组3：喷印尺寸 ================= */
    var g3 = { key: 'size', name: '喷印尺寸与套印', items: [] };
    var sideMm = geo ? geo.sideMm : null;

    if (!ppm) {
      notes.push('未设置尺寸基准，尺寸与套印类指标暂不判定；在图上标注一段已知长度即可启用。');
    }

    g3.items.push(item({
      key: 's_size', name: '二维码边长', std: rangeText(pack.min, pack.max, 'mm'),
      value: sideMm === null ? null : r1(sideMm), unit: 'mm',
      dev: sideMm === null ? null : r1(rangeDev(sideMm, pack.min, pack.max)),
      status: sideMm === null ? 'na' : rangeStatus(sideMm, pack.min, pack.max, 0.15),
      desc: pack.label + '：要求 ' + rangeText(pack.min, pack.max, 'mm') + '。'
    }));

    // ≥500DPI 是喷印点密度，成品上无法直接还原喷头点数；
    // 折算为可量测的模块宽：500DPI 点距 0.0508mm，模块至少占 2 点 ≈ 0.10mm。
    var dots = moduleMm ? moduleMm / 0.0508 : null;
    g3.items.push(item({
      key: 's_dpi', name: '模块宽（打印精度）', std: '≥0.10', value: moduleMm === null ? null : r2(moduleMm), unit: 'mm',
      dev: moduleMm === null ? null : r2(moduleMm - 0.10),
      status: moduleMm === null ? 'na' : (moduleMm >= 0.10 ? 'ok' : (moduleMm >= 0.09 ? 'warn' : 'fail')),
      desc: '要求打印质量 ≥500DPI（点距 0.0508mm），模块宽由边长 ÷ 29 反算' +
        (dots ? '，约合 ' + r1(dots) + ' 点。' : '。')
    }));

    var sq = geo ? geo.squareDev : null;
    g3.items.push(item({
      key: 's_square', name: '正方形度', std: '≤0.3', value: sq === null ? null : r2(sq), unit: 'mm',
      dev: sq === null ? null : r2(sq - 0.3),
      status: sq === null ? 'na' : judgeMax(sq - 0.3, 0.2),
      desc: '对边长度差，反映喷印拉伸或透视残留。'
    }));

    var fr = geo && geo.frame ? geo.frame : null;
    var frameMm = null, frameMeasurable = false;
    if (fr && moduleMm) {
      var below = fr.bottom;
      if (!fr.bottomEdge) {
        frameMm = below;
        frameMeasurable = true;
      }
    }
    g3.items.push(item({
      key: 's_frame', name: '底框宽度', std: '≤2', value: frameMm === null ? null : r2(frameMm), unit: 'mm',
      dev: frameMm === null ? null : r2(frameMm - 2),
      status: frameMm === null ? 'na' : judgeMax(frameMm - 2, 0.5),
      desc: frameMeasurable
        ? '取符号下沿向下的连续空白高度（含 4 模块静区，按标准原文口径）。'
        : '底框与承印底色对比不足或延伸至画面外，无法量测。'
    }));

    var hOff = null, vOff = null;
    if (fr) {
      if (!fr.leftEdge && !fr.rightEdge) hOff = Math.abs(fr.left - fr.right) / 2;
      if (!fr.topEdge && !fr.bottomEdge) vOff = Math.abs(fr.top - fr.bottom) / 2;
    }
    var posOff = (hOff === null && vOff === null) ? null : Math.max(hOff || 0, vOff || 0);
    g3.items.push(item({
      key: 's_offset', name: '位置偏差', std: '≤0.8', value: posOff === null ? null : r2(posOff), unit: 'mm',
      dev: posOff === null ? null : r2(posOff - 0.8),
      status: posOff === null ? 'na' : judgeMax(posOff - 0.8, 0.4),
      desc: posOff === null ? '底框四边未全部落在画面内，无法计算居中偏差。'
        : '二维码中心相对底框中心的偏移（水平 ' + (hOff === null ? '—' : r2(hOff)) + ' / 垂直 ' + (vOff === null ? '—' : r2(vOff)) + ' mm）。'
    }));

    if (pack.type === 'case') {
      g3.items.push(item({
        key: 's_vcenter', name: '端面垂直居中（C 面）', std: '≤0.8', value: vOff === null ? null : r2(vOff), unit: 'mm',
        dev: vOff === null ? null : r2(vOff - 0.8),
        status: vOff === null ? 'na' : judgeMax(vOff - 0.8, 0.4),
        desc: '条烟二维码喷印于端面（C 面），垂直方向应严格居中。'
      }));
    }
    groups.push(g3);

    /* ================= 组4：数据核验 ================= */
    var g4 = { key: 'data', name: '数据核验', items: [] };
    var PG = opts.pinggui || (root && root.QRQ && root.QRQ.Pinggui);
    var hit = null;
    if (PG && text) {
      try { hit = PG.match(text); } catch (e) { hit = null; }
    }
    var pkg = PG ? PG.count() : null;

    g4.items.push(item({
      key: 'd_type', name: '盒码 / 条码', std: '—',
      value: hit ? hit.typeText : (text ? '未匹配' : null),
      dev: null,
      status: !text ? 'na' : (hit ? 'ok' : 'warn'),
      desc: hit ? ('二维码内容命中对应表中的' + hit.typeText + '记录。')
        : (pkg && pkg.source === 'sample' ? '当前为演示品规库，导入《盒条品规对应表》后可自动判别。' : '未在品规库中匹配到盒码或条码。')
    }));

    g4.items.push(item({
      key: 'd_name', name: '品规名称', std: '—',
      value: hit ? hit.name : null, dev: null,
      status: hit && hit.name ? 'ok' : 'na',
      desc: hit ? ('对应' + hit.typeText + ' ' + hit.code + (hit.paired ? '，配对' + hit.pairedTypeText + ' ' + hit.paired : '')) : ''
    }));

    var pairOk = null;
    if (hit && hit.paired) {
      var dg = String(text).replace(/[^0-9]/g, '');
      // 只有明文中确实出现配对码时才判定；盒码二维码通常不含条码，此时不适用
      if (dg.indexOf(hit.paired) >= 0) pairOk = true;
    }
    g4.items.push(item({
      key: 'd_pair', name: '盒条配对一致性', std: '—',
      value: pairOk === null ? null : '一致',
      dev: null, status: pairOk === null ? 'na' : 'ok', naText: '不适用',
      desc: pairOk === null ? '二维码内容未包含配对码（盒码二维码通常只承载盒码），此项不适用。' : '明文中同时出现盒码与条码且与品规库一致。'
    }));
    groups.push(g4);

    /* ---- 统计与结论 ---- */
    var counts = { ok: 0, warn: 0, fail: 0, na: 0, total: 0 };
    groups.forEach(function (g) {
      g.items.forEach(function (it) {
        counts.total++;
        if (it.status === 'ok') counts.ok++;
        else if (it.status === 'warn') counts.warn++;
        else if (it.status === 'fail') counts.fail++;
        else counts.na++;
      });
    });
    var status = counts.fail ? 'fail' : (counts.warn ? 'warn' : 'ok');

    var verdict = buildVerdict(status, counts, groups, pack, hit, sideMm, moduleMm, ppm);

    return {
      ok: true,
      standard: 'GB/T 33993-2017',
      pack: pack,
      ppm: ppm || null,
      calibrated: !!ppm,
      counts: counts,
      status: status,
      groups: groups,
      struct: struct,
      qr: {
        ok: qrOk, text: text, version: version, size: size, ecl: ecl,
        grade: gv, quad: quad
      },
      hit: hit,
      pinggui: pkg,
      geo: geo,
      notes: notes,
      verdict: verdict,
      timingMs: 0
    };
  }

  function buildVerdict(status, counts, groups, pack, hit, sideMm, moduleMm, ppm) {
    var lines = [];
    var advice = [];

    if (!counts.fail && !counts.warn) {
      lines.push('受检项全部符合 GB/T 33993-2017 要求，' + pack.label + '二维码可用于在线生产。');
    } else if (!counts.fail) {
      lines.push('受检项无超差，' + counts.warn + ' 项处于临界，建议复核后放行。');
    } else {
      lines.push('检出 ' + counts.fail + ' 项超差' + (counts.warn ? '、' + counts.warn + ' 项临界' : '') + '，不满足 GB/T 33993-2017 要求。');
    }

    if (hit) {
      lines.push('二维码内容命中品规库：' + hit.typeText + ' ' + hit.code + (hit.name ? '，品规 ' + hit.name : '') + '。');
    } else if (counts.total) {
      lines.push('未能从二维码内容匹配品规库，盒/条归属需人工确认。');
    }

    if (sideMm !== null && sideMm !== undefined) {
      lines.push('实测二维码边长 ' + r1(sideMm) + 'mm（' + pack.label + ' 要求 ' + rangeText(pack.min, pack.max, 'mm') + '）' +
        (moduleMm ? '，模块宽 ' + r2(moduleMm) + 'mm（约 ' + r1(moduleMm / 0.0508) + ' 点 @500DPI）。' : '。'));
    } else if (!ppm) {
      lines.push('本次未设置尺寸基准，仅完成符号质量与编码合规判定。');
    }

    var byKey = {};
    groups.forEach(function (g) { g.items.forEach(function (it) { byKey[it.key] = it; }); });

    if (byKey.s_dpi && byKey.s_dpi.status === 'fail') advice.push('模块宽不足：提高喷印 DPI 或增大二维码尺寸，使模块边宽不小于 0.10mm（约 2 点 @500DPI）。');
    if (byKey.s_frame && byKey.s_frame.status === 'fail') advice.push('底框宽度超限：核对底框模板，控制在 2mm 以内，避免占用相邻版面。');
    if (byKey.s_offset && byKey.s_offset.status === 'fail') advice.push('套印偏移超限：调整喷头对位与走纸稳定性，使二维码居于底框正中（≤0.8mm）。');
    if (byKey.s_size && byKey.s_size.status === 'fail') advice.push('喷印尺寸不在规定范围内：按' + pack.label + ' 的 ' + rangeText(pack.min, pack.max, 'mm') + ' 调整版面。');
    if (byKey.sym_ecl && byKey.sym_ecl.status === 'fail') advice.push('纠错级别不符：赋码时固定使用 M 级纠错。');
    if (byKey.sym_ver && byKey.sym_ver.status === 'fail') advice.push('版本不符：行业卷烟二维码固定使用版本 3（29×29）。');
    if (byKey.code_len && byKey.code_len.status === 'fail') advice.push('编码长度不符：核对赋码系统的 59 位编码规则。');
    if (byKey.q_grade && (byKey.q_grade.status === 'fail' || byKey.q_grade.status === 'warn')) advice.push('符号质量偏低：提高墨量/对比度、清洁喷头，并避免高反光承印材料。');
    if (!advice.length) advice.push('保持现有喷印参数，按批次抽检并留存图像记录以便趋势追踪。');
    if (!ppm) advice.push('需要判定尺寸与套印精度时，在画面上标注一段已知长度（如钢尺 10mm）后重新测评。');

    return { headline: lines[0], details: lines, advice: advice };
  }

  return {
    PACK: PACK,
    STRUCT: STRUCT,
    analyze: analyze,
    buildStruct: buildStruct,
    rangeText: rangeText
  };
});
