/*!
 * 端到端：把一张“镜像二维码”PNG 送进二维码页的相册导入，验证
 *   1) 难读/镜像符号仍能识读（稳健识读链路）
 *   2) 结论区出现“镜像码：是”
 *   node tools/test-ui-mirror.js
 */
const { spawn } = require('child_process');
const path = require('path'); const os = require('os'); const fs = require('fs'); const zlib = require('zlib');

const QRQ = {};
globalThis.QRQ = QRQ;
require('../app/assets/js/core/img.js');
require('../app/assets/js/core/qrread.js');
const qrcode = require('../app/assets/js/vendor/qrcodegen.js');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9351;
const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file:///' + (ROOT + '/app/index.html').replace(/\\/g, '/') + '?view=qr';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- PNG（8 位灰度） ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function grayPng(gray, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = gray[y * w + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 生成镜像符号 ---------------- */
function buildMirrorPng(out) {
  const qr = qrcode(0, 'M');
  qr.addData('6901028075831|20261107|03|A', 'Byte');
  qr.make();
  const n = qr.getModuleCount(), scale = 8, quiet = 4;
  const size = (n + quiet * 2) * scale;
  const g = new Uint8Array(size * size).fill(236);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const x0 = (c + quiet) * scale, y0 = (r + quiet) * scale;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) g[(y0 + y) * size + x0 + x] = 26;
    }
  }
  const flip = QRQ.QrRead.flipH(g, size, size);
  fs.writeFileSync(out, grayPng(flip, size, size));
  return { size };
}

/* ---------------- CDP ---------------- */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.q = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.q.has(m.id)) {
        const h = c.q.get(m.id); c.q.delete(m.id);
        m.error ? h.reject(new Error(m.error.message)) : h.resolve(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.q.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.q.has(id)) { this.q.delete(id); reject(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  OK   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg + (extra ? '  → ' + extra : '')); }
}

(async () => {
  const png = path.join(ROOT, '.shots', 'mirror-e2e.png');
  fs.mkdirSync(path.dirname(png), { recursive: true });
  buildMirrorPng(png);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-mir-'));
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`, '--window-size=420,900', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (e) { }
    await sleep(250);
  }
  const cdp = await CDP.connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(2500);

  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileGallery' });
  ok(node.nodeId > 0, '找到相册导入输入框');
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [png] });

  let done = false;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    done = await cdp.eval(`!!document.querySelector('#result .check-row')`);
    if (done) break;
  }
  ok(done, '分析完成并渲染结论');

  const info = await cdp.eval(`(function(){
    var row=document.querySelector('#result .check-row');
    var v=row?row.querySelector('.check-v'):null;
    var d=document.querySelector('#result .check-desc');
    return {
      value: v?v.innerText:null, cls: row?row.className:null,
      desc: d?d.innerText:null,
      grade: (document.querySelector('.grade-num')||{}).innerText||null,
      payload: (document.querySelector('#result .payload')||{}).innerText||null,
      err: window.__lastErr||null
    };
  })()`);

  ok(info.value === '是', '镜像码判断项显示“是”', JSON.stringify(info.value));
  ok(/bad/.test(info.cls || ''), '判断项使用异常样式');
  ok(/镜像/.test(info.desc || ''), '说明文字点明镜像印版', (info.desc || '').slice(0, 20));
  ok(!!info.grade && !/^0/.test(info.grade), '仍给出印刷质量等级', info.grade);
  ok(/6901028075831/.test(info.payload || ''), '识读内容正确', (info.payload || '').slice(0, 20));
  ok(!info.err, '无脚本错误', info.err);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(ROOT, '.shots', 'mirror-result.png'), Buffer.from(shot.data, 'base64'));

  cdp.ws.close(); proc.kill();
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
