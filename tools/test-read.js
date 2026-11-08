/*!
 * 难读码识读 + 镜像判定 · 端到端断言
 * 合成二维码后施加透视 / 低对比 / 反光 / 模糊 / 镜像 / 噪声，验证稳健识读与镜像判断。
 *   node tools/test-read.js
 */
const QRQ = {};
globalThis.QRQ = QRQ;

require('../app/assets/js/core/img.js');
require('../app/assets/js/core/rsblocks.js');
require('../app/assets/js/core/qrstruct.js');
require('../app/assets/js/core/qrread.js');
require('../app/assets/js/core/qrgrade.js');

const jsQRMod = require('../app/assets/js/vendor/jsQR.js');
const jsQR = typeof jsQRMod === 'function' ? jsQRMod : jsQRMod.default;
const qrcode = require('../app/assets/js/vendor/qrcodegen.js');

const TEXT = 'YZWM.TOBACCO.CN/690102801/01008030077510500000000000000001';

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  OK   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg + (extra ? '  → ' + extra : '')); }
}

/* ---------------- 合成 ---------------- */
function makeQR(text, ecl) {
  const qr = qrcode(0, ecl || 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return qr;
}

function render(qr, scale, quiet) {
  const n = qr.getModuleCount();
  const q = quiet === undefined ? 4 : quiet;
  const size = (n + q * 2) * scale;
  const gray = new Uint8Array(size * size).fill(238);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const x0 = (c + q) * scale, y0 = (r + q) * scale;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) gray[(y0 + y) * size + x0 + x] = 24;
      }
    }
  }
  return { gray, w: size, h: size };
}

function toRGBA(g, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    out[j] = g[i]; out[j + 1] = g[i]; out[j + 2] = g[i]; out[j + 3] = 255;
  }
  return out;
}

function lowContrast(g, k) {
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(160 + (g[i] - 160) * k)));
  return out;
}

function blur(g, w, h, rad) {
  const tmp = new Float32Array(g.length), out = new Uint8Array(g.length);
  const win = rad * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -rad; x <= rad; x++) sum += g[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win;
      sum -= g[y * w + Math.min(w - 1, Math.max(0, x - rad))];
      sum += g[y * w + Math.min(w - 1, Math.max(0, x + rad + 1))];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -rad; y <= rad; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / win);
      sum -= tmp[Math.min(h - 1, Math.max(0, y - rad)) * w + x];
      sum += tmp[Math.min(h - 1, Math.max(0, y + rad + 1)) * w + x];
    }
  }
  return out;
}

function glare(g, w, h, strength) {
  const out = new Uint8Array(g.length);
  const cx = w * 0.42, cy = h * 0.36, R = Math.max(w, h) * 0.55;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const k = Math.max(0, 1 - d / R);
      const add = strength * k * k * 210;
      out[y * w + x] = Math.min(255, Math.round(g[y * w + x] * (1 - 0.55 * k) + add));
    }
  }
  return out;
}

function noise(g, amp) {
  const out = new Uint8Array(g.length);
  let s = 20261108;
  for (let i = 0; i < g.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 8) % (amp * 2 + 1)) - amp;
    out[i] = Math.max(0, Math.min(255, g[i] + n));
  }
  return out;
}

function flipH(g, w, h) { return QRQ.QrRead.flipH(g, w, h); }

/* 3×3 矩阵求逆 */
function inv3(m) {
  const [a, b, c, d, e, f, gg, hh, i] = m;
  const det = a * (e * i - f * hh) - b * (d * i - f * gg) + c * (d * hh - e * gg);
  const k = 1 / det;
  return [
    (e * i - f * hh) * k, (c * hh - b * i) * k, (b * f - c * e) * k,
    (f * gg - d * i) * k, (a * i - c * gg) * k, (c * d - a * f) * k,
    (d * hh - e * gg) * k, (b * gg - a * hh) * k, (a * e - b * d) * k
  ];
}

/* 透视：把源图四角映射到 dst 四角 */
function perspective(g, w, h, quad) {
  const A = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const src = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  // 单应矩阵：单位方形 → quad（与 img.js 同算法）
  const x0 = quad[0].x, y0 = quad[0].y, x1 = quad[1].x, y1 = quad[1].y;
  const x2 = quad[2].x, y2 = quad[2].y, x3 = quad[3].x, y3 = quad[3].y;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let gg = 0, hh = 0;
  if (dx3 || dy3) {
    const det = dx1 * dy2 - dx2 * dy1 || 1e-12;
    gg = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const H = [x1 - x0 + gg * x1, x3 - x0 + hh * x3, x0, y1 - y0 + gg * y1, y3 - y0 + hh * y3, y0, gg, hh, 1];
  const Hi = inv3(H);
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const den = Hi[6] * x + Hi[7] * y + Hi[8];
      const u = (Hi[0] * x + Hi[1] * y + Hi[2]) / den;
      const v = (Hi[3] * x + Hi[4] * y + Hi[5]) / den;
      const sx = u * (w - 1), sy = v * (h - 1);
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
      const xa = Math.floor(sx), ya = Math.floor(sy);
      const xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1);
      const fx = sx - xa, fy = sy - ya;
      const p = g[ya * w + xa] * (1 - fx) + g[ya * w + xb] * fx;
      const q = g[yb * w + xa] * (1 - fx) + g[yb * w + xb] * fx;
      out[y * w + x] = Math.round(p * (1 - fy) + q * fy);
    }
  }
  // 统一尺寸：取包围盒
  const minX = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y))));
  const maxX = Math.min(w, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const maxY = Math.min(h, Math.ceil(Math.max(...quad.map((p) => p.y))));
  const cw = maxX - minX, ch = maxY - minY;
  const crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = out[(y + minY) * w + x + minX];
  return { gray: crop, w: cw, h: ch };
}

/* ---------------- 测评 ---------------- */
function analyze(g, w, h, opts) {
  return QRQ.analyze({ data: toRGBA(g, w, h), width: w, height: h },
    Object.assign({ jsQR, standard: '15415', maxSide: 1400 }, opts || {}));
}

function baseline(g, w, h) {
  try { return !!jsQR(toRGBA(g, w, h), w, h, { inversionAttempts: 'attemptBoth' }); } catch (e) { return false; }
}

/* ---------------- 用例 ---------------- */
const qr = makeQR(TEXT, 'M');
const base = render(qr, 8);
console.log('符号：V' + (qr.getModuleCount() - 17) / 4 + ' · ' + base.w + 'px · 模块 8px');

const cases = [];
{
  const c = { name: '清晰原图', g: base.gray, w: base.w, h: base.h, want: true };
  cases.push(c);
}
{
  const sz = base.w;
  const quad = [
    { x: sz * 0.05, y: sz * 0.11 }, { x: sz * 0.93, y: sz * 0.02 },
    { x: sz * 0.97, y: sz * 0.90 }, { x: sz * 0.08, y: sz * 0.95 }
  ];
  const r = perspective(base.gray, base.w, base.h, quad);
  cases.push({ name: '强透视（斜面 20%）', g: r.gray, w: r.w, h: r.h, want: true });
}
{
  let g = lowContrast(base.gray, 0.26);
  g = blur(g, base.w, base.h, 1);
  cases.push({ name: '低对比 + 轻微模糊', g, w: base.w, h: base.h, want: true });
}
{
  let g = glare(base.gray, base.w, base.h, 0.75);
  g = blur(g, base.w, base.h, 1);
  cases.push({ name: '强反光', g, w: base.w, h: base.h, want: true });
}
{
  const small = render(qr, 4);
  const g = blur(small.gray, small.w, small.h, 1);
  cases.push({ name: '小尺寸（模块 4px）+ 模糊', g, w: small.w, h: small.h, want: true });
}
{
  const small = render(qr, 3);
  const g = noise(flipH(small.gray, small.w, small.h), 6);
  cases.push({ name: '镜像 + 小尺寸 + 噪声', g, w: small.w, h: small.h, want: true, mirror: true });
}
{
  const g = flipH(base.gray, base.w, base.h);
  cases.push({ name: '镜像（原尺寸）', g, w: base.w, h: base.h, want: true, mirror: true });
}

let basePass = 0;
cases.forEach((c) => {
  const bl = baseline(c.g, c.w, c.h);
  if (bl) basePass++;
  const t0 = Date.now();
  const r = analyze(c.g, c.w, c.h);
  const ms = Date.now() - t0;
  const textOk = r.ok && (r.decode.text || '').indexOf('690102801') >= 0;
  ok(r.ok === c.want, c.name + '：识读成功（基线 jsQR ' + (bl ? '能读' : '读不出') + '，' + ms + ' ms）',
    r.ok ? '' : ('reason=' + r.reason));
  ok(textOk, c.name + '：内容正确', r.ok ? ('got ' + (r.decode.text || '').slice(0, 24)) : '');
  if (r.ok) console.log('       grade=' + r.grade.value + ' text=' + (r.decode.text || '').length + ' mirror=' + (r.mirror.state) + ' note=' + r.notes.join('|'));
  const m = r.mirror || {};
  if (c.mirror) ok(m.detected === true, c.name + '：判定为镜像码', 'state=' + m.state + ' layout=' + (m.layout || '?'));
  else ok(m.detected !== true, c.name + '：未误判镜像', 'state=' + m.state);
});

console.log('\n基线 jsQR 单独可读：' + basePass + '/' + cases.length + '　稳健识读后：' + cases.filter((c, i) => true).length + ' 项用例');

/* 定位图案自检 + 透视校正：在基线读不出的图上验证 */
{
  const hard = lowContrast(blur(base.gray, base.w, base.h, 1), 0.26);
  ok(!baseline(hard, base.w, base.h), '校正链路：该图基线 jsQR 读不出');
  const q = QRQ.QrRead.findQuad(hard, base.w, base.h);
  ok(!!(q && q.length === 4), '定位图案自检：给出四角');
  if (q) {
    const conv = q.reduce((s2, p) => s2 + (p.x > 0 && p.x < base.w && p.y > 0 && p.y < base.h ? 1 : 0), 0);
    ok(conv === 4, '定位图案自检：四角落在图内');
    const mod = 8, quiet = 4, sym = (qr.getModuleCount() + quiet * 2) * mod;
    const exact = [{ x: quiet * mod, y: quiet * mod }, { x: sym - quiet * mod, y: quiet * mod },
      { x: sym - quiet * mod, y: sym - quiet * mod }, { x: quiet * mod, y: sym - quiet * mod }];
    const rr = QRQ.QrRead.rectify(hard, base.w, base.h, exact, 420, 0.12);
    const rgba = toRGBA(rr.gray, rr.width, rr.height);
    const dec = QRQ.QrRead.decode(rr.gray, rr.width, rr.height, { jsQR, locate: false });
    ok(!!(dec && dec.res), '校正后的图像可识读（预处理链路）');
  }
  const mir = flipH(base.gray, base.w, base.h);
  const sz = base.w;
  const qm = [{ x: 2, y: 2 }, { x: sz - 3, y: 2 }, { x: sz - 3, y: sz - 3 }, { x: 2, y: sz - 3 }];
  const dr = QRQ.QrRead.decode(mir, base.w, base.h, { jsQR, quad: qm, locate: false });
  ok(!!(dr && dr.res && (dr.res.data || '').indexOf('690102801') >= 0), '手动四角：镜像图也能读出内容');
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
