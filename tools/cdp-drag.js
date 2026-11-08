/* 端到端拖动验证：用 CDP 真实鼠标事件拖动四角，检查四角坐标是否随动
 * 用法：node tools/cdp-drag.js
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file:///' + (ROOT + '/app/index.html').replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonList() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.waiting.has(msg.id)) {
        const { resolve, reject } = c.waiting.get(msg.id);
        c.waiting.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-drag-'));
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=430,1000', '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await jsonList(); if (targets.length) break; } catch (e) {}
    await sleep(250);
  }
  if (!targets) { console.log('FAIL 无法连接调试端口'); proc.kill(); process.exit(1); }

  const page = targets.find((t) => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const results = [];
  const ok = (name, cond, detail) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' — ' + detail));

  async function runCase(tag, query, canvasSel, quadSel) {
    await cdp.send('Page.navigate', { url: PAGE + query });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      ready = await cdp.eval(`!!(document.querySelector('${quadSel}') && document.querySelector('${quadSel}').__quad)`);
      if (ready) break;
    }
    if (!ready) { ok(tag + ' 校准画布就绪', false, '未出现 __quad'); return; }

    // 等演示流程跑完（它会 smooth-scroll，拖动期间滚动会把指针映射到别的图像位置）
    for (let i = 0; i < 24; i++) {
      const done = await cdp.eval(`(function(){
        var h=document.querySelector('${tag === '盒条' ? '#boxResult' : '#labelResult'}');
        return !!h && !h.hidden;
      })()`);
      if (done) break;
      await sleep(250);
    }
    await sleep(900);
    await cdp.eval(`document.querySelector('${canvasSel}').scrollIntoView({block:'center'})`);
    await sleep(600);

    const info = await cdp.eval(`(function(){
      var cv=document.querySelector('${canvasSel}');
      var r=cv.getBoundingClientRect();
      return {r:{left:r.left,top:r.top,width:r.width,height:r.height},q:cv.__quad,src:cv.__src};
    })()`);

    const before = info.q.map((p) => ({ x: p.x, y: p.y }));
    const kx = info.src.w / info.r.width, ky = info.src.h / info.r.height;
    const cx = before.reduce((s, p) => s + p.x, 0) / 4;
    const cy = before.reduce((s, p) => s + p.y, 0) / 4;
    // 朝质心方向拖 36 显示像素：任何角点都不会立刻撞到图像边界
    const vx = cx - before[0].x, vy = cy - before[0].y;
    const vlen = Math.hypot(vx, vy) || 1;
    const ux = vx / vlen, uy = vy / vlen;
    const step = 36;
    const p0 = { x: info.r.left + before[0].x / kx, y: info.r.top + before[0].y / ky };

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', clickCount: 1 });
    const active = await cdp.eval(`document.querySelector('${canvasSel}').__active`);
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: p0.x + ux * step * i / 6, y: p0.y + uy * step * i / 6, button: 'left', buttons: 1
      });
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: p0.x + ux * step, y: p0.y + uy * step, button: 'left', clickCount: 1
    });
    await sleep(150);

    const after = await cdp.eval(`document.querySelector('${canvasSel}').__quad.map(function(p){return {x:p.x,y:p.y}})`);
    const dx = after[0].x - before[0].x, dy = after[0].y - before[0].y;
    const wantX = ux * step * kx, wantY = uy * step * ky;
    ok(tag + ' 按下命中第 1 个角', active === 0, 'active=' + active);
    ok(tag + ' 拖动位移（真实鼠标事件）', Math.abs(dx - wantX) < 2 && Math.abs(dy - wantY) < 2,
      'got ' + dx.toFixed(1) + ',' + dy.toFixed(1) + ' want ' + wantX.toFixed(1) + ',' + wantY.toFixed(1));
    ok(tag + ' 其余三角不动', after.slice(1).every((p, i) => Math.abs(p.x - before[i + 1].x) < 0.01 && Math.abs(p.y - before[i + 1].y) < 0.01));

    // 拖动后仍能正常测评
    const btn = tag === '盒条' ? '#btnBoxAnalyze' : '#btnCalibOk';
    await cdp.eval(`document.querySelector('${btn}').click()`);
    await sleep(2200);
    const done = await cdp.eval(`(function(){
      var host=document.querySelector('${tag === '盒条' ? '#boxResult' : '#labelResult'}');
      return {hidden: !host || host.hidden, len: host ? host.innerText.length : 0, err: window.__lastErr || null};
    })()`);
    ok(tag + ' 拖动后完成测评', !done.hidden && done.len > 200 && !done.err, JSON.stringify(done));
  }

  try {
    await runCase('盒条', '?view=box&demo=box', '#boxCanvas', '#boxCanvas');
    await runCase('件烟', '?view=label&demo=label', '#calibCanvas', '#calibCanvas');
  } catch (e) {
    ok('执行异常', false, e.message);
  }

  console.log(results.join('\n'));
  const fail = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('RESULT ' + (fail ? 'FAIL' : 'OK') + ' pass=' + (results.length - fail) + ' fail=' + fail);
  cdp.ws.close();
  proc.kill();
  process.exit(fail ? 1 : 0);
})();
