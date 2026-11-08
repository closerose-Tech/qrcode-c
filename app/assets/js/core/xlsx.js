/*!
 * QRQ · 最小 XLSX / CSV 读取器
 * 只做一件事：把工作簿的第一个工作表读成二维字符串数组。
 * 不依赖任何第三方库：ZIP 中央目录 + DecompressionStream('deflate-raw')。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.QRQ = root.QRQ || {};
    root.QRQ.Xlsx = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function utf8(b) {
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(b);
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  /* 解析 ZIP 中央目录，返回 name -> {method, start, size} */
  function readZip(buf) {
    var b = new Uint8Array(buf);
    var eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx（未找到 ZIP 目录）');
    var count = u16(b, eocd + 10);
    var off = u32(b, eocd + 16);
    var files = {};
    for (var k = 0; k < count; k++) {
      if (u32(b, off) !== 0x02014b50) break;
      var method = u16(b, off + 10);
      var csize = u32(b, off + 20);
      var nlen = u16(b, off + 28);
      var elen = u16(b, off + 30);
      var clen = u16(b, off + 32);
      var lho = u32(b, off + 42);
      var name = utf8(b.subarray(off + 46, off + 46 + nlen));
      // 本地文件头：固定 30 字节 + 文件名 + 扩展区
      var lname = u16(b, lho + 26);
      var lextra = u16(b, lho + 28);
      var start = lho + 30 + lname + lextra;
      files[name] = { method: method, start: start, size: csize };
      off += 46 + nlen + elen + clen;
    }
    return { bytes: b, files: files };
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持解压 xlsx，请把对应表另存为 CSV 后导入');
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function entryBytes(zip, name) {
    var e = zip.files[name];
    if (!e) return null;
    var slice = zip.bytes.subarray(e.start, e.start + e.size);
    if (e.method === 0) return slice;
    if (e.method === 8) return await inflateRaw(slice);
    throw new Error('不支持的压缩方式：' + e.method);
  }

  function decodeXml(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&amp;/g, '&');
  }

  function textOf(xml) {
    // <t>a</t><t>b</t> → ab，忽略拼音注音 rPh
    var clean = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    var out = '';
    var re = /<t[^>]*>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(clean))) out += decodeXml(m[1]);
    return out;
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    var s = m[1], n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  async function readXlsx(buf) {
    var zip = readZip(buf);

    // 共享字符串
    var shared = [];
    var ssBytes = await entryBytes(zip, 'xl/sharedStrings.xml');
    if (ssBytes) {
      var ssXml = utf8(ssBytes);
      var re = /<si>([\s\S]*?)<\/si>/g, m;
      while ((m = re.exec(ssXml))) shared.push(textOf(m[1]));
    }

    // 工作表：优先 workbook.xml 的第一个 sheet，退回 sheet1.xml
    var sheetName = 'xl/worksheets/sheet1.xml';
    var wbBytes = await entryBytes(zip, 'xl/workbook.xml');
    if (wbBytes) {
      var rels = await entryBytes(zip, 'xl/_rels/workbook.xml.rels');
      var ids = /<sheet[^>]*r:id="([^"]+)"/.exec(utf8(wbBytes));
      if (ids && rels) {
        var relXml = utf8(rels);
        var rre = new RegExp('<Relationship[^>]*Id="' + ids[1] + '"[^>]*Target="([^"]+)"');
        var rm = rre.exec(relXml);
        if (rm) {
          var t = rm[1].replace(/^\/?xl\//, '').replace(/^\.\//, '');
          sheetName = 'xl/' + t;
        }
      }
    }
    var shBytes = await entryBytes(zip, sheetName);
    if (!shBytes) throw new Error('未找到工作表');

    var shXml = utf8(shBytes);
    var rows = [];
    var rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g, rm2;
    while ((rm2 = rowRe.exec(shXml))) {
      var cells = [];
      var cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g, cm;
      while ((cm = cellRe.exec(rm2[1]))) {
        var attrs = cm[1];
        var body = cm[2];
        var tAttr = /t="([^"]+)"/.exec(attrs);
        var rAttr = /r="([^"]+)"/.exec(attrs);
        var ci = rAttr ? colIndex(rAttr[1]) : cells.length;
        var v = '';
        if (tAttr && tAttr[1] === 's') {
          var vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (vm) v = shared[+vm[1]] || '';
        } else if (tAttr && (tAttr[1] === 'inlineStr' || tAttr[1] === 'str')) {
          v = textOf(body);
          if (!v) {
            var vv = /<v>([\s\S]*?)<\/v>/.exec(body);
            if (vv) v = decodeXml(vv[1]);
          }
        } else {
          var v2 = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (v2) v = decodeXml(v2[1]);
        }
        while (cells.length < ci) cells.push('');
        cells[ci] = v;
      }
      rows.push(cells);
    }
    return rows;
  }

  /* CSV / TSV：自动判分隔符，支持双引号包裹 */
  function readDelimited(text) {
    var s = text.replace(/^\uFEFF/, '');
    var head = s.split(/\r?\n/)[0] || '';
    var delim = ',';
    if ((head.match(/\t/g) || []).length > (head.match(/,/g) || []).length) delim = '\t';
    else if ((head.match(/;/g) || []).length > (head.match(/,/g) || []).length) delim = ';';

    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"') {
        q = true;
      } else if (ch === delim) {
        row.push(cur); cur = '';
      } else if (ch === '\n') {
        row.push(cur); rows.push(row); row = []; cur = '';
      } else if (ch !== '\r') {
        cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  return { read: readXlsx, readZip: readZip, readDelimited: readDelimited };
});
