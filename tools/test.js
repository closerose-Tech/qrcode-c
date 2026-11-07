/* 本地验证脚本：合成二维码图像 → 走完整测评流程 → 打印指标
 * 用法：node tools/test.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'app/assets/js/core/img.js'));
require(path.join(ROOT, 'app/assets/js/core/rsblocks.js'));
require(path.join(ROOT, 'app/assets/js/core/qrstruct.js'));
require(path.join(ROOT, 'app/assets/js/core/qrgrade.js'));

const jsQRmod = require(path.join(ROOT, 'app/assets/js/vendor/jsQR.js'));
const jsQR = typeof jsQRmod === 'function' ? jsQRmod : jsQRmod.default;
const qrcode = require(path.join(ROOT, 'app/assets/js/vendor/qrcodegen.js'));

/* ---------------- PNG 输出（灰度） ---------------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePNG(file, rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

/* ---------------- 合成二维码图像 ---------------- */
function renderQR(text, opts = {}) {
  const version = opts.version || 0;
  const ecl = opts.ecl || 'M';
  const scale = opts.scale || 8;
  const quiet = opts.quiet === undefined ? 4 : opts.quiet;
  const qr = qrcode(version, ecl);
  qr.addData(text, 'Byte');
  qr.make();
  const N = qr.getModuleCount();
  const size = (N + quiet * 2) * scale;

  const dark = opts.dark === undefined ? 18 : opts.dark;
  const light = opts.light === undefined ? 244 : opts.light;
  let rgba = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mr = Math.floor(y / scale) - quiet;
      const mc = Math.floor(x / scale) - quiet;
      let isDark = false;
      if (mr >= 0 && mc >= 0 && mr < N && mc < N) isDark = qr.isDark(mr, mc);
      let v = isDark ? dark : light;
      if (opts.invert) v = 255 - v;
      // 光照渐变
      if (opts.gradient) {
        const g = 1 - opts.gradient * (x / size);
        v = v * g + 255 * (1 - g) * 0.0 + (opts.gradientBase || 0);
      }
      // 噪声
      if (opts.noise) v += (Math.random() - 0.5) * 2 * opts.noise;
      v = Math.max(0, Math.min(255, v));
      const i = (y * size + x) * 4;
      rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
    }
  }
  // 模糊（盒式近似高斯）
  if (opts.blur) {
    for (let pass = 0; pass < opts.blur; pass++) {
      const out = new Uint8ClampedArray(rgba);
      const r = opts.blurRadius || 1;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let sum = 0, cnt = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const yy = y + dy, xx = x + dx;
              if (yy < 0 || xx < 0 || yy >= size || xx >= size) continue;
              sum += rgba[(yy * size + xx) * 4];
              cnt++;
            }
          }
          const o = (y * size + x) * 4;
          out[o] = out[o + 1] = out[o + 2] = sum / cnt;
        }
      }
      rgba = out;
    }
  }
  return { rgba, width: size, height: size, N, qr };
}

function run(name, image, opts = {}) {
  const result = QRQ.analyze({ data: image.rgba, width: image.width, height: image.height }, {
    jsQR: jsQR,
    standard: opts.standard || '15415'
  });
  console.log('\n=== ' + name + ' (' + image.width + '×' + image.height + ', N=' + image.N + ') ===');
  if (!result.ok) {
    console.log('  FAIL:', result.reason, result.message);
    return result;
  }
  console.log('  综合等级:', result.grade.value, result.grade.letter, result.grade.text,
    '| 版本', result.decode.version, '| ECC', result.decode.ecl, '| 掩模', result.decode.mask);
  result.metrics.forEach(m => {
    const v = m.value === null ? '  —  ' : (Math.round(m.value * 10) / 10).toFixed(1);
    console.log('   ', m.key.padEnd(4), (m.name || '').padEnd(8, '　'), String(v).padStart(6) + m.unit,
      ' grade', m.grade === null ? '—' : (Math.round(m.grade * 10) / 10));
  });
  console.log('  纠错: 已纠正', result.decode.errorsCorrected, '/ 能力', result.decode.capacity,
    '| 静区实测', result.symbol.quietZone.measured, '| 模块', result.symbol.modulePx, 'px');
  if (result.warnings.length) console.log('  警告:', result.warnings.join(' / '));
  return result;
}


/* ---------------- 仿射/透视变换（模拟拍摄角度） ---------------- */
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return null;
  const inv = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det
  ];
  return inv;
}

function warpImage(img, opts) {
  const w = Math.round(img.width * 1.15), h = Math.round(img.height * 1.15);
  const ang = (opts.rotate || 0) * Math.PI / 180;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const cx = img.width / 2, cy = img.height / 2;
  const per = opts.perspective || 0;
  // 目标四边形：旋转 + 透视收缩
  const corners = [[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]].map(([x, y]) => {
    let dx = x - cx, dy = y - cy;
    let sx = dx * cos - dy * sin + cx;
    let sy = dx * sin + dy * cos + cy;
    // 透视：上方收缩
    const k = 1 - per * (sy / img.height);
    sx = (sx - w / 2) * k + w / 2;
    return [sx + (w - img.width) / 2, sy + (h - img.height) / 2];
  });
  const quad = corners.map(([x, y]) => ({ x, y }));
  const M = QRQ.homographyFromUnitSquare(quad);
  const inv = invert3([M.a, M.b, M.c, M.d, M.e, M.f, M.g, M.h, 1]);
  const out = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const den = inv[6] * x + inv[7] * y + inv[8];
      const u = (inv[0] * x + inv[1] * y + inv[2]) / den;
      const v = (inv[3] * x + inv[4] * y + inv[5]) / den;
      const sxp = u * img.width, syp = v * img.height;
      if (sxp < 0 || syp < 0 || sxp >= img.width - 1 || syp >= img.height - 1) continue;
      const x0 = Math.floor(sxp), y0 = Math.floor(syp);
      const fx = sxp - x0, fy = syp - y0;
      const idx = (yy, xx) => (yy * img.width + xx) * 4;
      const i00 = idx(y0, x0), i10 = idx(y0, x0 + 1), i01 = idx(y0 + 1, x0), i11 = idx(y0 + 1, x0 + 1);
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = img.rgba[i00 + ch] * (1 - fx) + img.rgba[i10 + ch] * fx;
        const bot = img.rgba[i01 + ch] * (1 - fx) + img.rgba[i11 + ch] * fx;
        out[o + ch] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { rgba: out, width: w, height: h, N: img.N };
}

/* ---------------- 场景 ---------------- */
const outDir = path.join(__dirname, 'out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const TEXT = 'https://www.tobacco.gov.cn/qr/6901028075831?batch=20261107&line=03';

const scenarios = [
  ['理想印刷 8px/模块', renderQR(TEXT), 'clean'],
  ['低对比度 (暗=150)', renderQR(TEXT, { dark: 150 }), 'lowcontrast'],
  ['轻微模糊 r1', renderQR(TEXT, { blur: 1 }), 'blur1'],
  ['中等模糊 r2', renderQR(TEXT, { blur: 1, blurRadius: 2 }), 'blur2'],
  ['强模糊 r3', renderQR(TEXT, { blur: 1, blurRadius: 3 }), 'blur3'],
  ['噪声', renderQR(TEXT, { noise: 22 }), 'noise'],
  ['光照渐变', renderQR(TEXT, { gradient: 0.35 }), 'gradient'],
  ['小尺寸 3px/模块', renderQR(TEXT, { scale: 3 }), 'small'],
  ['反相（浅码深底）', renderQR(TEXT, { invert: true }), 'inverted'],
  ['静区不足 1 模块', renderQR(TEXT, { quiet: 1 }), 'tightquiet'],
  ['DPM 模式评估', renderQR(TEXT), 'dpm'],
  ['旋转 7°', warpImage(renderQR(TEXT), { rotate: 7 }), 'rot7'],
  ['透视 12%（俯拍）', warpImage(renderQR(TEXT), { perspective: 0.12 }), 'persp'],
  ['旋转 5° + 透视 8%', warpImage(renderQR(TEXT), { rotate: 5, perspective: 0.08 }), 'rotpersp']
];

const results = {};
scenarios.forEach(([name, img, tag]) => {
  const std = tag === 'dpm' ? '29158' : '15415';
  const r = run(name, img, { standard: std });
  results[tag] = r;
  writePNG(path.join(outDir, tag + '.png'), img.rgba, img.width, img.height);
});

/* ---------------- RS 纠错计数自检 ---------------- */
console.log('\n=== Reed-Solomon 纠错计数自检（版本2-H，单块） ===');
(function () {
  const img = renderQR('CIG-QR-TEST', { version: 2, ecl: 'H', scale: 10 });
  writePNG(path.join(outDir, 'rs-base.png'), img.rgba, img.width, img.height);
  const r = QRQ.analyze({ data: img.rgba, width: img.width, height: img.height }, { jsQR: jsQR });
  if (!r.ok) { console.log('  基础图识读失败'); return; }
  const N = r.symbol.size;
  const map = QRQ.buildMap(N, r.decode.version);
  const bin = Uint8Array.from(r.modules.bin);
  const cw = QRQ.readCodewords(bin, N, r.decode.mask, map.fn);
  const base = QRQ.rsAnalyze(cw, r.decode.version, r.decode.ecl);
  console.log('  干净图像: 错误码字数', base.errorsCorrected, '(应为 0) | 块数', base.blockCount,
    '| 数据码字', base.dataCodewords, '| 纠错码字', base.ecCodewords, '| 纠错能力', base.capacity);
  for (const k of [1, 2, 3, 4, 6]) {
    const corrupted = Uint8Array.from(cw);
    for (let i = 0; i < k; i++) corrupted[i] ^= 0xff;
    const rr = QRQ.rsAnalyze(corrupted, r.decode.version, r.decode.ecl);
    console.log('  损坏 ' + k + ' 个码字 → 检出 ' + rr.errorsCorrected + ' 个错误, 可纠:', rr.ok);
  }
})();
