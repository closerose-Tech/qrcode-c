/*!
 * QRQ · 盒条品规库
 * 参照《盒条品规对应表》：盒码（13 位） / 品规名称 / 条码（12 位）
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

  /* 演示用样本：仅用于展示界面，不是真实品规数据 */
  var SAMPLE = [
    ['6900000000017', '示例·硬盒（演示）', '6900000000024'],
    ['6900000000024', '示例·软盒（演示）', '6900000000031'],
    ['6900000000031', '示例·细支（演示）', '6900000000048'],
    ['6900000000048', '示例·中支（演示）', '6900000000055'],
    ['6900000000055', '示例·条盒（演示）', '6900000000062']
  ];

  var db = {
    rows: [],          // [[box, name, bar]]
    byBox: null,       // Map 13 位
    byBox12: null,     // Map 去前导 0
    byBar: null,       // Map 12 位
    loaded: false,
    source: 'sample'
  };

  function norm(v) {
    return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '').trim();
  }

  function build(rows) {
    db.rows = rows;
    db.byBox = new Map();
    db.byBox12 = new Map();
    db.byBar = new Map();
    rows.forEach(function (r) {
      var box = norm(r[0]), name = String(r[1] || '').trim(), bar = norm(r[2]);
      if (box) {
        db.byBox.set(box, r);
        var t = box.replace(/^0+/, '');
        if (t && !db.byBox12.has(t)) db.byBox12.set(t, r);
      }
      if (bar && !db.byBar.has(bar)) db.byBar.set(bar, r);
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
    var cBar = find(['条码', '条码(12)', '条盒码']);
    if (cBox < 0 && cBar < 0) {
      // 无表头：按 13 位 / 名称 / 12 位的位置猜
      return { box: 0, name: 1, bar: 2, hasHead: false };
    }
    return { box: cBox, name: cName, bar: cBar, hasHead: true };
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
      if (!box && !bar) return;
      if (!/\d{8,}/.test(box + bar)) return;
      out.push([box, name, bar]);
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

  function digits(s) {
    return String(s || '').replace(/[^0-9]/g, '');
  }

  /* 在任意文本里找盒码 / 条码：优先 13 位盒码，其次 12 位条码 */
  function match(text) {
    restore();
    var d = digits(text);
    if (!d) return null;

    if (db.byBox.has(d)) return hit(db.byBox.get(d), 'box');
    if (d.length === 13 && db.byBox12.has(d.replace(/^0+/, ''))) return hit(db.byBox12.get(d.replace(/^0+/, '')), 'box');

    // 13 位滑动窗口
    for (var i = 0; i + 13 <= d.length; i++) {
      var w13 = d.slice(i, i + 13);
      if (db.byBox.has(w13)) return hit(db.byBox.get(w13), 'box');
      var t = w13.replace(/^0+/, '');
      if (t.length >= 12 && db.byBox12.has(t)) return hit(db.byBox12.get(t), 'box');
    }
    // 12 位滑动窗口
    for (var j = 0; j + 12 <= d.length; j++) {
      var w12 = d.slice(j, j + 12);
      if (db.byBar.has(w12)) return hit(db.byBar.get(w12), 'bar');
    }
    return null;
  }

  function hit(row, type) {
    return {
      type: type,                 // 'box' 盒码 / 'bar' 条码
      typeText: type === 'box' ? '盒码' : '条码',
      code: type === 'box' ? norm(row[0]) : norm(row[2]),
      paired: type === 'box' ? norm(row[2]) : norm(row[0]),
      pairedTypeText: type === 'box' ? '条码' : '盒码',
      name: String(row[1] || '').trim()
    };
  }

  function query(code) {
    restore();
    var d = digits(code);
    if (!d) return null;
    if (db.byBox.has(d)) return hit(db.byBox.get(d), 'box');
    if (db.byBar.has(d)) return hit(db.byBar.get(d), 'bar');
    if (db.byBox12.has(d.replace(/^0+/, ''))) return hit(db.byBox12.get(d.replace(/^0+/, '')), 'box');
    return null;
  }

  function count() {
    restore();
    return { total: db.rows.length, source: db.source };
  }

  return { ingest: ingest, restore: restore, reset: reset, match: match, query: query, count: count, SAMPLE: SAMPLE };
});
