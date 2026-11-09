/*!
 * QRQ · 盒条品规库
 * 参照《盒条品规对应表》：盒码（13 位） / 品规名称 / 条码（13 位） / 规格代码（13 位，可选）
 * 匹配口径：
 *   1) 全码命中：13 位盒码、13 位条码（滑动窗口扫描，盒码优先）
 *   2) 规格代码命中：二维码数据第 31–35 位（5 位）＝ 13 位规格代码第 8–12 位
 * 数据只保存在本机（localStorage），不上传、不写入代码仓库。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    root.QRQ.Pinggui = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KEY = 'qrq.pinggui.v1';

  /* 演示用样本：仅用于展示界面，不是真实品规数据
   * 盒码第 1 位刻意取 1，与「二维码数据第 29 位 = 1 判盒码」的规则一致 */
  var SAMPLE = [
    ['1900000000017', '示例·硬盒（演示）', '2900000000024', '6900000000000'],
    ['1900000000031', '示例·软盒（演示）', '2900000000048', '6900000000100'],
    ['1900000000055', '示例·细支（演示）', '2900000000062', '6900000000200'],
    ['1900000000079', '示例·中支（演示）', '2900000000086', '6900000000300'],
    ['1900000000093', '示例·条盒（演示）', '2900000000104', '6900000000400']
  ];

  var db = {
    rows: [],          // [[box, name, bar, spec]]
    byBox: null,       // Map 13 位
    byBox12: null,     // Map 去前导 0
    byBar: null,       // Map 13 位（兼容历史 12 位）
    bySpec5: null,     // Map 规格代码第 8–12 位 → [{row, src}]
    barLen: 13,        // 表内条码位数（默认 13）
    loaded: false,
    source: 'sample'
  };

  function norm(v) {
    return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '').trim();
  }

  function digits(s) {
    return String(s || '').replace(/[^0-9]/g, '');
  }

  function key5(code) {
    var c = norm(code);
    return c.length === 13 ? c.slice(7, 12) : '';
  }

  function build(rows) {
    db.rows = rows;
    db.byBox = new Map();
    db.byBox12 = new Map();
    db.byBar = new Map();
    db.bySpec5 = new Map();
    var barLens = {};
    rows.forEach(function (r) {
      var bl = norm(r[2]).length;
      if (bl >= 11) barLens[bl] = (barLens[bl] || 0) + 1;
    });
    var best = 13, bestN = 0;
    Object.keys(barLens).forEach(function (k) {
      if (barLens[k] > bestN || (barLens[k] === bestN && Number(k) === 13)) { best = Number(k); bestN = barLens[k]; }
    });
    db.barLen = best;
    rows.forEach(function (r) {
      var box = norm(r[0]), name = String(r[1] || '').trim(), bar = norm(r[2]), spec = norm(r[3]);
      if (box) {
        db.byBox.set(box, r);
        var t = box.replace(/^0+/, '');
        if (t && !db.byBox12.has(t)) db.byBox12.set(t, r);
      }
      if (bar && !db.byBar.has(bar)) db.byBar.set(bar, r);

      // 5 位键：规格代码优先，其次 13 位盒码 / 13 位条码
      var cands = [];
      if (spec) cands.push({ code: spec, src: 'spec' });
      if (box) cands.push({ code: box, src: 'box' });
      if (bar && bar.length === 13) cands.push({ code: bar, src: 'bar' });
      cands.forEach(function (c) {
        var k = key5(c.code);
        if (!k) return;
        if (!db.bySpec5.has(k)) db.bySpec5.set(k, []);
        var list = db.bySpec5.get(k);
        for (var i = 0; i < list.length; i++) if (list[i].row === r) return;
        list.push({ row: r, src: c.src, code: c.code });
      });
    });
    db.loaded = true;
  }

  /* 表头映射：容忍列顺序变化与常见别名 */
  function mapColumns(rows) {
    if (!rows || !rows.length) return null;
    var head = rows[0].map(function (s) { return String(s || '').replace(/\s+/g, ''); });
    function find(list) {
      for (var i = 0; i < head.length; i++) {
        for (var j = 0; j < list.length; j++) {
          if (head[i].indexOf(list[j]) >= 0) return i;
        }
      }
      return -1;
    }
    var cBox = find(['盒码', '盒码(13)', '小盒码']);
    var cName = find(['品规名称', '品规', '名称', '牌号']);
    var cBar = find(['条码', '条码(13)', '条盒码']);
    // 规格代码：优先“含规格且含代码/编码/码号”的列，避免误取“品规名称”
    var cSpec = -1;
    for (var i = 0; i < head.length; i++) {
      var h = head[i];
      if (h.indexOf('规格') < 0) continue;
      if (h.indexOf('名称') >= 0) continue;
      if (i === cBox || i === cBar) continue;
      if (/代码|编码|码号|号码|码/.test(h)) { cSpec = i; break; }
    }
    if (cSpec < 0) cSpec = find(['规格代码', '规格码', '规格编号']);
    if (cBox < 0 && cBar < 0) {
      // 无表头：按 13 位 / 名称 / 13 位 / 13 位的位置猜
      return { box: 0, name: 1, bar: 2, spec: 3, hasHead: false };
    }
    return { box: cBox, name: cName, bar: cBar, spec: cSpec, hasHead: true };
  }

  function ingest(rows) {
    var map = mapColumns(rows);
    if (!map) throw new Error('表格为空');
    var body = map.hasHead ? rows.slice(1) : rows;
    var out = [];
    body.forEach(function (r) {
      var box = map.box >= 0 ? norm(r[map.box]) : '';
      var name = map.name >= 0 ? String(r[map.name] || '').trim() : '';
      var bar = map.bar >= 0 ? norm(r[map.bar]) : '';
      var spec = map.spec >= 0 ? norm(r[map.spec]) : '';
      if (!box && !bar && !spec) return;
      if (!/\d{8,}/.test(box + bar + spec)) return;
      out.push([box, name, bar, spec]);
    });
    if (!out.length) throw new Error('没有解析到有效数据行');
    build(out);
    db.source = 'imported';
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* 超限则仅本次有效 */ }
    return out.length;
  }

  function restore() {
    if (db.loaded) return;
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var rows = JSON.parse(raw);
        if (Array.isArray(rows) && rows.length) {
          build(rows);
          db.source = 'imported';
          return;
        }
      } catch (e) { /* 损坏则回退样本 */ }
    }
    build(SAMPLE);
    db.source = 'sample';
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    build(SAMPLE);
    db.source = 'sample';
  }

  /* 在任意文本里找盒码 / 条码：同为 13 位，滑动窗口内盒码优先 */
  function match(text) {
    restore();
    var d = digits(text);
    if (!d) return null;

    var ks = keyCandidates(text);
    var codeHit = matchCode(d);
    var specHit = matchSpec(text, d);
    var pick;
    if (codeHit && specHit) {
      // 全码与规格代码指向同一行：保留全码结论（可判盒码 / 条码）；指向不同行：以规格代码为准
      pick = codeHit._row === specHit._row ? codeHit : specHit;
    } else {
      pick = codeHit || specHit;
    }
    if (pick && ks.length) pick.payloadKey = ks[0];
    return pick;
  }

  function matchCode(d) {
    if (db.byBox.has(d)) return hit(db.byBox.get(d), 'box');
    if (db.byBar.has(d)) return hit(db.byBar.get(d), 'bar');
    if (d.length === 13 && db.byBox12.has(d.replace(/^0+/, ''))) return hit(db.byBox12.get(d.replace(/^0+/, '')), 'box');

    // 13 位滑动窗口：盒码优先，其次条码
    for (var i = 0; i + 13 <= d.length; i++) {
      var w13 = d.slice(i, i + 13);
      if (db.byBox.has(w13)) return hit(db.byBox.get(w13), 'box');
      var t = w13.replace(/^0+/, '');
      if (t.length >= 12 && db.byBox12.has(t)) return hit(db.byBox12.get(t), 'box');
      if (db.byBar.has(w13)) return hit(db.byBar.get(w13), 'bar');
    }
    // 历史 12 位条码表格：按 12 位窗口兜底
    if (db.barLen === 12) {
      for (var j = 0; j + 12 <= d.length; j++) {
        var w12 = d.slice(j, j + 12);
        if (db.byBar.has(w12)) return hit(db.byBar.get(w12), 'bar');
      }
    }
    return null;
  }

  /* 二维码第 31–35 位 → 13 位规格代码第 8–12 位 */
  function keyCandidates(text) {
    var out = [];
    function push(k) {
      if (k && /^\d{5}$/.test(k) && out.indexOf(k) < 0) out.push(k);
    }
    var s = String(text || '');
    push(s.slice(30, 35));      // 按原始字符串（含分隔符）第 31–35 位
    var d = digits(s);
    push(d.slice(30, 35));      // 去掉分隔符后
    push(d.slice(28, 33));      // 分隔符占 2 位时的等价窗口
    return out;
  }

  function matchSpec(text, d) {
    if (!db.bySpec5 || !db.bySpec5.size) return null;
    var keys = keyCandidates(text);
    for (var i = 0; i < keys.length; i++) {
      var list = db.bySpec5.get(keys[i]);
      if (!list || !list.length) continue;
      var pick = list[0];
      var type = typeFromPayload(pick.row, d);
      return hitSpec(pick.row, keys[i], type, list.length);
    }
    return null;
  }

  function typeFromPayload(row, d) {
    var box = norm(row[0]), bar = norm(row[2]);
    if (bar && d.indexOf(bar) >= 0) return 'bar';
    if (box && d.indexOf(box) >= 0) return 'box';
    return '';
  }

  function withRow(obj, row) {
    Object.defineProperty(obj, '_row', { value: row, enumerable: false });
    return obj;
  }

  function hit(row, type) {
    return withRow({
      type: type,                 // 'box' 盒码 / 'bar' 条码
      typeText: type === 'box' ? '盒码' : '条码',
      code: type === 'box' ? norm(row[0]) : norm(row[2]),
      paired: type === 'box' ? norm(row[2]) : norm(row[0]),
      pairedTypeText: type === 'box' ? '条码' : '盒码',
      box: norm(row[0]),
      bar: norm(row[2]),
      name: String(row[1] || '').trim(),
      spec: norm(row[3]),
      key5: '',
      via: 'code',
      candidates: 1
    }, row);
  }

  function hitSpec(row, k5, type, count) {
    var code = type === 'box' ? norm(row[0]) : (type === 'bar' ? norm(row[2]) : '');
    var paired = type === 'box' ? norm(row[2]) : (type === 'bar' ? norm(row[0]) : '');
    return withRow({
      type: type,
      typeText: type === 'box' ? '盒码' : (type === 'bar' ? '条码' : '盒码 / 条码'),
      code: code,
      paired: paired,
      pairedTypeText: type === 'box' ? '条码' : '盒码',
      box: norm(row[0]),
      bar: norm(row[2]),
      name: String(row[1] || '').trim(),
      spec: norm(row[3]) || norm(row[0]),
      key5: k5,
      via: 'spec5',
      candidates: count || 1
    }, row);
  }

  function query(code) {
    restore();
    var d = digits(code);
    if (!d) return null;
    if (d.length === 5) {
      if (!db.bySpec5) return null;
      var list = db.bySpec5.get(d);
      if (!list || !list.length) return null;
      return hitSpec(list[0].row, d, '', list.length);
    }
    if (db.byBox.has(d)) return hit(db.byBox.get(d), 'box');
    if (db.byBar.has(d)) return hit(db.byBar.get(d), 'bar');
    if (db.byBox12.has(d.replace(/^0+/, ''))) return hit(db.byBox12.get(d.replace(/^0+/, '')), 'box');
    return null;
  }

  function count() {
    restore();
    return { total: db.rows.length, source: db.source };
  }

  return {
    ingest: ingest, restore: restore, reset: reset, match: match, query: query, count: count,
    keyCandidates: keyCandidates, key5: key5, SAMPLE: SAMPLE
  };
});
