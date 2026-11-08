/* 件烟标签合规测评 · 端到端验证
 * 用法：node tools/test-label.js
 * 依赖：tools/fixtures/*.gray（由 tools/make-fixtures.py 生成的灰度栅格）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const IMG = require('../app/assets/js/core/img.js');
const QS = require('../app/assets/js/core/qrstruct.js');
require('../app/assets/js/core/rsblocks.js');
const C128 = require('../app/assets/js/core/code128.js');
const L = require('../app/assets/js/core/label.js');
const jsQRmod = require('../app/assets/js/vendor/jsQR.js');
const jsQR = typeof jsQRmod === 'function' ? jsQRmod : jsQRmod.default;

function loadGray(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = b[8 + i];
  return { gray, w, h };
}

function opts() {
  return { jsQR, IMG, QS, code128: C128 };
}

function statusMark(s) {
  return s === 'ok' ? 'OK  ' : s === 'warn' ? 'WARN' : 'FAIL';
}

function report(name, gray, w, h, quad, expect) {
  console.log('\n' + '='.repeat(74));
  console.log('用例：' + name);
  console.log('='.repeat(74));
  let q = quad;
  if (!q) {
    const t0 = Date.now();
    const det = L.detectQuad(gray, w, h, IMG);
    if (!det) {
      const r = jsQR(new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : gray[(i / 4) | 0])), w, h, { inversionAttempts: 'dontInvert' });
      const qq = r ? L.quadFromQR(r.location, w, h) : null;
      console.log('亮区检测失败，二维码反推：' + (qq ? '成功' : '失败'));
      q = qq && qq.quad;
    } else {
      q = det.quad;
      console.log('亮区检测成功，来源=' + det.source + '，宽高比=' + det.aspect.toFixed(3) + '，耗时 ' + (Date.now() - t0) + 'ms');
    }
  }
  if (!q) { console.log('无法确定标签四角'); return null; }
  console.log('四角：' + q.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));

  const t0 = Date.now();
  const r = L.analyze(gray, w, h, { quad: q, source: quad ? 'manual' : 'auto' }, opts());
  console.log('分析耗时 ' + (Date.now() - t0) + 'ms，方向校正 ' + (r.rotation * 90) + '°，阈值 ' + r.threshold.toFixed(0) +
    '，原始分辨率 ' + r.srcPpm.toFixed(1) + 'px/mm');
  console.log('二维码：' + (r.qr.ok ? `V${r.qr.version} / ECL ${r.qr.ecl || '?'} / ${r.qr.text.length} 位` : '未识读') +
    (r.qr.box ? ` / ${r.qr.box.w.toFixed(1)}×${r.qr.box.h.toFixed(1)}mm @ (${r.qr.box.x0.toFixed(1)},${r.qr.box.y0.toFixed(1)})` : ''));
  console.log('一维码：' + (r.bc.ok ? `${r.bc.symbology} / ${r.bc.text}` : '未识读 ' + (r.bc.reason || '')) +
    (r.bc.box ? ` / ${r.bc.box.w.toFixed(1)}×${r.bc.box.h.toFixed(1)}mm @ (${r.bc.box.x.toFixed(1)},${r.bc.box.y.toFixed(1)})` : ''));
  console.log('判定：符合 ' + r.counts.ok + ' / 临界 ' + r.counts.warn + ' / 超差 ' + r.counts.fail + ' / 受检 ' + r.counts.total);

  r.groups.forEach(g => {
    console.log('\n[' + g.name + ']');
    g.items.forEach(it => {
      const val = it.value === null ? '—' : (typeof it.value === 'number' ? it.value : it.value);
      const dev = it.dev === null || it.dev === undefined ? '' : ` Δ${it.dev > 0 ? '+' : ''}${it.dev}${it.unit || ''}`;
      console.log('  ' + statusMark(it.status) + '  ' + it.name.padEnd(22, ' ') +
        ` 标准 ${String(it.std === null ? '—' : it.std).padEnd(8)} 实测 ${String(val).padEnd(8)}${dev}` +
        (it.desc ? '  · ' + it.desc : ''));
    });
  });
  console.log('\n结论：' + r.verdict.headline);

  if (expect) {
    const bad = [];
    if (expect.fail && r.counts.fail < expect.fail) bad.push(`期望超差 ≥${expect.fail}，实际 ${r.counts.fail}`);
    if (expect.maxFail !== undefined && r.counts.fail > expect.maxFail) bad.push(`期望超差 ≤${expect.maxFail}，实际 ${r.counts.fail}`);
    if (expect.keys) {
      Object.keys(expect.keys).forEach(k => {
        const hit = [].concat(...r.groups.map(g => g.items)).find(i => i.key === k);
        if (!hit) bad.push('缺少指标 ' + k);
        else if (hit.status !== expect.keys[k] && expect.keys[k]) bad.push(`${k} 期望 ${expect.keys[k]}，实际 ${hit.status}`);
      });
    }
    console.log(bad.length ? '✗ 断言失败：' + bad.join('；') : '✓ 断言通过');
    return { r, bad };
  }
  return { r, bad: [] };
}

const dir = path.join(__dirname, 'fixtures');
const results = [];
const only = process.argv[2];

function run(file, title, expect, quad) {
  if (only && file.indexOf(only) < 0) return;
  const p = path.join(dir, file + '.gray');
  if (!fs.existsSync(p)) { console.log('缺少 fixture：' + p); return; }
  const g = loadGray(p);
  results.push(report(title, g.gray, g.w, g.h, quad, expect));
}

run('label-ref', '标准标签（图1 原始矢量）', { maxFail: 0 });
run('label-std', '标准标签（按表2/表3 重新排版）', { maxFail: 0 });
run('label-persp', '标准标签 + 旋转 4° + 透视 9%', { maxFail: 1 });
run('label-bad-qr', '二维码缩至 29mm', { keys: { qr_w: 'fail' } });
run('label-bad-name', '规格名称 18pt / 一维码 44×24', { keys: { name_f1: 'fail', bc_w: 'fail' } });
run('label-lowres', '低分辨率（约 6px/mm）', { maxFail: 2 });

const bad = results.filter(x => x && x.bad.length);
console.log('\n' + (bad.length ? `✗ ${bad.length} 个用例未通过` : '✓ 全部用例通过'));
process.exit(bad.length ? 1 : 0);
