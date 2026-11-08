/*!
 * QRQ · 盒条二维码合规测评（依据 GB/T 33993-2017 与行业盒条二维码技术要求）
 *   码制 QR（ISO/IEC 18004）、版本 3（29×29）、纠错 M、编码 59 位、字母数字字符集
 *   盒 / 条归属：59 位编码第 29 位（属性码首位），1 = 盒码，2 = 条码
 *   符号质量按 GB/T 33993-2017 分级；印刷尺寸与套印不在本页判定
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

  /* 盒 / 条归属：二维码数据第 29 位（1 起），1 代表盒码，2 代表条码 */
  var KIND = {
    '1': { code: '1', type: 'box', text: '盒码', label: '盒码（第 29 位 = 1）' },
    '2': { code: '2', type: 'bar', text: '条码', label: '条码（第 29 位 = 2）' }
  };

  function kindFromPayload(text) {
    var s = String(text || '');
    if (s.length < 29) return null;
    return KIND[s.charAt(28)] || null;
  }

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
    var quad = input.quad;
    var r0 = input.grade || null;             // QRQ.analyze 结果
    var notes = [];

    var groups = [];
    var qrOk = !!(r0 && r0.ok);
    var text = qrOk ? (r0.decode.text || '') : '';
    var version = qrOk ? r0.decode.version : null;
    var size = qrOk ? r0.decode.size : null;
    var ecl = qrOk ? (r0.decode.ecl || '').toUpperCase() : '';

    /* 盒 / 条：只看 59 位编码第 29 位，1 = 盒码，2 = 条码 */
    var kind = kindFromPayload(text);

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

    /* ================= 组3：数据核验 ================= */
    var g4 = { key: 'data', name: '数据核验', items: [] };
    var PG = opts.pinggui || (root && root.QRQ && root.QRQ.Pinggui);
    var hit = null;
    if (PG && text) {
      try { hit = PG.match(text); } catch (e) { hit = null; }
    }
    var pkg = PG ? PG.count() : null;

    /* 归属只看第 29 位：1 = 盒码，2 = 条码；该位不是 1/2 时才回退到品规库全码命中 */
    var kindText = kind ? kind.text : (hit && hit.type ? hit.typeText : null);

    g4.items.push(item({
      key: 'd_type', name: '盒码 / 条码', std: '第29位 1/2',
      value: !text ? null : (kindText || '无法判定'),
      dev: null,
      status: !text ? 'na' : (kind ? 'ok' : (hit && hit.type ? 'warn' : 'fail')),
      naText: '未识读',
      desc: !text ? '未能识读二维码，无法读取第 29 位。'
        : (kind
          ? ('二维码数据第 29 位为「' + kind.code + '」，' + (kind.code === '1' ? '1 代表盒码' : '2 代表条码') + '。')
          : ('二维码数据第 29 位为「' + (String(text).charAt(28) || '—') + '」，既不是 1（盒码）也不是 2（条码）' +
            (hit && hit.type ? '；按品规库全码命中暂判为' + hit.typeText + '。' : '，无法判定盒 / 条。')))
    }));

    g4.items.push(item({
      key: 'd_name', name: '品规名称', std: '—',
      value: hit ? hit.name : null, dev: null,
      status: hit && hit.name ? 'ok' : 'na',
      desc: hit ? (hit.via === 'spec5'
        ? ('规格代码 ' + (hit.spec || '—') + '，对应盒码 ' + (hit.box || '—') + ' / 条码 ' + (hit.bar || '—') + '。')
        : ('对应' + hit.typeText + ' ' + hit.code + (hit.paired ? '，配对' + hit.pairedTypeText + ' ' + hit.paired : ''))) : ''
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

    var verdict = buildVerdict(status, counts, groups, kind, hit);

    var mirror = (r0 && r0.mirror) ? r0.mirror : null;
    if (mirror && mirror.detected) {
      notes.push('检出镜像码：符号为水平镜像印版，已翻转识读；标准识读设备按正向扫描读不出。');
      verdict.details.unshift('镜像码：是。定位图案呈 TL/TR/BR 布局，符号方向与制版方向相反。');
    }

    return {
      ok: true,
      standard: 'GB/T 33993-2017',
      kind: kind,
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
      mirror: mirror,
      notes: notes,
      verdict: verdict,
      timingMs: 0
    };
  }

  function buildVerdict(status, counts, groups, kind, hit) {
    var lines = [];
    var advice = [];

    if (!counts.fail && !counts.warn) {
      lines.push('受检项全部符合 GB/T 33993-2017 要求，' + (kind ? kind.text : '该') + '二维码可用于在线生产。');
    } else if (!counts.fail) {
      lines.push('受检项无超差，' + counts.warn + ' 项处于临界，建议复核后放行。');
    } else {
      lines.push('检出 ' + counts.fail + ' 项超差' + (counts.warn ? '、' + counts.warn + ' 项临界' : '') + '，不满足 GB/T 33993-2017 要求。');
    }

    if (kind) {
      lines.push('二维码数据第 29 位为「' + kind.code + '」，判定为' + kind.text + '。');
    } else if (counts.total) {
      lines.push('二维码数据第 29 位不是 1 或 2，盒 / 条归属无法判定，需人工确认。');
    }

    if (hit) {
      lines.push('二维码内容命中品规库：' + hit.typeText + ' ' + (hit.code || '—') + (hit.name ? '，品规 ' + hit.name : '') +
        (hit.spec ? '，规格代码 ' + hit.spec : '') + '。');
    } else if (counts.total) {
      lines.push('未能从二维码内容匹配品规库，品规名称需人工核对。');
    }

    var byKey = {};
    groups.forEach(function (g) { g.items.forEach(function (it) { byKey[it.key] = it; }); });

    if (byKey.sym_ecl && byKey.sym_ecl.status === 'fail') advice.push('纠错级别不符：赋码时固定使用 M 级纠错。');
    if (byKey.sym_ver && byKey.sym_ver.status === 'fail') advice.push('版本不符：行业卷烟二维码固定使用版本 3（29×29）。');
    if (byKey.code_len && byKey.code_len.status === 'fail') advice.push('编码长度不符：核对赋码系统的 59 位编码规则。');
    if (byKey.q_grade && (byKey.q_grade.status === 'fail' || byKey.q_grade.status === 'warn')) advice.push('符号质量偏低：提高墨量/对比度、清洁喷头，并避免高反光承印材料。');
    if (!advice.length) advice.push('保持现有喷印参数，按批次抽检并留存图像记录以便趋势追踪。');

    return { headline: lines[0], details: lines, advice: advice };
  }

  return {
    KIND: KIND,
    STRUCT: STRUCT,
    analyze: analyze,
    buildStruct: buildStruct,
    kindFromPayload: kindFromPayload
  };
});
