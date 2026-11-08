/* 按手机视口宽度截图（CDP 设备模拟），用法：
 * node tools/shot.js "?view=box&demo=box" .shots/out.png 390
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const ROOT = path.resolve(__dirname, '..');
const BASE = 'file:///' + (ROOT + '/app/index.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

(async () => {
  const [query = '', out = '.shots/out.png', width = '390', wait = '2500'] = process.argv.slice(2);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-shot-'));
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`, '--window-size=600,900', 'about:blank'], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (e) {} await sleep(250); }
  const cdp = await CDP.connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  const W = parseInt(width, 10);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Page.navigate', { url: BASE + query });
  await sleep(parseInt(wait, 10));
  const h = await cdp.eval('Math.ceil(document.documentElement.scrollHeight)');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.min(h, 4000), deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved ' + out + ' ' + W + 'x' + h);
  cdp.ws.close(); proc.kill();
})();
