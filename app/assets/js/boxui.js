/*!
 * 二维码测评 · 盒条二维码合规测评交互层
 * 拍摄/导入 → 四角与尺寸基准校准 → 符号分级与合规量测 → 码属品规 / 指标清单 / 结论
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var MAX_SIDE = 1800;

  var state = {
    src: null,
    rgba: null,
    gray: null,
    quad: null,
    ref: null,          // {p1, p2, mm}
    dragging: -1,       // 0-3 四角, 4/5 基准线端点
    pack: 'box-std',
    result: null
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (!msg) return;
    if (window.AppToast) { window.AppToast(msg); return; }
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(18,22,26,.9);' +
      'color:#fff;font-size:12.5px;padding:9px 15px;border-radius:10px;z-index:99';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2000);
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmt(v, d) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return v.toFixed(d === undefined ? 1 : d);
    return String(v);
  }
  function statusText(s, naText) {
    return s === 'ok' ? '符合' : (s === 'warn' ? '临界' : (s === 'fail' ? '超差' : (naText || '待标定')));
  }

  function resolveJsQR() {
    var g = window.jsQR;
    if (typeof g === 'function') return g;
    if (g && typeof g.default === 'function') return g.default;
    return null;
  }

  /* ------------------------------ 载入 ------------------------------ */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('图片无法解析')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  function toCanvas(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var s = Math.min(1, MAX_SIDE / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function prepare(canvas, source) {
    state.src = canvas;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.rgba = data.data;
    state.gray = QRQ.grayFromRGBA(data.data, canvas.width, canvas.height);
    state.result = null;

    var det = detectQR(canvas);
    if (det) {
      state.quad = det;
    } else {
      state.quad = defaultQuad(canvas);
      toast('未能自动定位二维码，请拖动四角贴合');
    }

    if (!state.ref) state.ref = defaultRef(canvas);

    $('#boxCalibPanel').hidden = false;
    $('#boxResult').hidden = true;
    $('#boxEmpty').hidden = true;
    drawCalib();
    $('#boxCalibPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* 用 jsQR 的定位结果作为二维码四角 */
  function detectQR(canvas) {
    var jsQR = resolveJsQR();
    if (!jsQR) return null;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var data;
    try { data = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (e) { return null; }

    var res = null;
    try { res = jsQR(data.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' }); } catch (e) { res = null; }
    if (!res || !res.location) return null;
    var L = res.location;
    if (!L.topLeftCorner || !L.topRightCorner || !L.bottomRightCorner || !L.bottomLeftCorner) return null;
    var pts = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner].map(function (p) {
      return { x: p.x, y: p.y };
    });
    // jsQR 的角点是模块中心，向外扩半模块更贴合静区外沿；此处保持模块边界
    return pts;
  }

  function defaultQuad(c) {
    var w = Math.min(c.width, c.height) * 0.46;
    var x = (c.width - w) / 2, y = (c.height - w) / 2;
    return [{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + w }, { x: x, y: y + w }];
  }

  function defaultRef(c) {
    var y = Math.max(12, c.height * 0.08);
    var len = c.width * 0.28;
    var x = (c.width - len) / 2;
    return { p1: { x: x, y: y }, p2: { x: x + len, y: y }, mm: null };
  }

  /* jsQR 定位点的顺序可能与图像方向不一致；统一为 TL,TR,BR,BL */
  function orderQuad(q) {
    var cx = q.reduce(function (s, p) { return s + p.x; }, 0) / 4;
    var cy = q.reduce(function (s, p) { return s + p.y; }, 0) / 4;
    var arr = q.slice().sort(function (a, b) {
      var aa = Math.atan2(a.y - cy, a.x - cx), bb = Math.atan2(b.y - cy, b.x - cx);
      return aa - bb;
    });
    // 以左上角为起点：最小 x+y
    var start = 0, best = 1e9;
    arr.forEach(function (p, i) {
      var s = p.x + p.y;
      if (s < best) { best = s; start = i; }
    });
    var out = [];
    for (var k = 0; k < 4; k++) out.push(arr[(start + k) % 4]);
    return out;
  }

  /* ------------------------------ 校准画布 ------------------------------ */
  function drawCalib() {
    var cv = $('#boxCanvas');
    if (!cv || !state.src) return;
    var host = cv.parentElement;
    var maxW = Math.min(430, host.clientWidth - 2);
    var scale = maxW / state.src.width;
    var cw = Math.round(state.src.width * scale);
    var ch = Math.round(state.src.height * scale);
    cv.width = cw; cv.height = ch;
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';

    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.src, 0, 0, cw, ch);
    cv._scale = scale;
    cv.__quad = state.quad;      // 排障：便于自动化核对四角坐标
    cv.__src = { w: state.src.width, h: state.src.height };

    var quad = state.quad;
    var act = cv.__active === undefined ? -1 : cv.__active;
    ctx.save();
    ctx.beginPath();
    quad.forEach(function (p, i) {
      var x = p.x * scale, y = p.y * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(168,121,27,.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168,121,27,.95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    quad.forEach(function (p, i) {
      var x = p.x * scale, y = p.y * scale;
      var on = i === act;
      ctx.beginPath();
      ctx.arc(x, y, on ? 12 : 10, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgba(255,246,224,.98)' : 'rgba(255,255,255,.94)';
      ctx.fill();
      ctx.strokeStyle = '#a8791b';
      ctx.lineWidth = on ? 2.4 : 1.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, on ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#a8791b';
      ctx.fill();
    });
    ctx.restore();

    if (state.ref) {
      var a = state.ref.p1, b = state.ref.p2;
      ctx.save();
      ctx.strokeStyle = 'rgba(198,72,32,.95)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x * scale, a.y * scale);
      ctx.lineTo(b.x * scale, b.y * scale);
      ctx.stroke();
      ctx.setLineDash([]);
      [a, b].forEach(function (p, i) {
        var on = (4 + i) === act;
        ctx.beginPath();
        ctx.arc(p.x * scale, p.y * scale, on ? 10 : 7.5, 0, Math.PI * 2);
        ctx.fillStyle = on ? 'rgba(255,240,232,.98)' : 'rgba(255,255,255,.94)';
        ctx.fill();
        ctx.strokeStyle = '#c64820';
        ctx.lineWidth = on ? 2.4 : 1.8;
        ctx.stroke();
      });
      var mx = (a.x + b.x) / 2 * scale, my = (a.y + b.y) / 2 * scale;
      var label = state.ref.mm ? (state.ref.mm + ' mm') : '基准线';
      ctx.font = '600 11px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(18,22,26,.72)';
      var tw = ctx.measureText(label).width + 10;
      ctx.fillRect(mx - tw / 2, my - 20, tw, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, mx, my - 9);
      ctx.restore();
    }
  }

  function bindCalib() {
    var cv = $('#boxCanvas');
    if (!cv) return;

    // 四角（源图像素坐标）与基准线端点共用一套手柄拖动：
    // 命中判定在显示空间、位移换算回源空间，详见 core/handles.js
    QRQ.Handles.bind(cv, {
      size: function () {
        return { w: state.src ? state.src.width : cv.width, h: state.src ? state.src.height : cv.height };
      },
      points: function () {
        var out = (state.quad || []).slice();
        if (state.ref) out.push(state.ref.p1, state.ref.p2);
        return out;
      },
      polyPoints: function () { return state.quad || []; },
      setPoint: function (i, p) {
        if (i < 4) { if (state.quad) state.quad[i] = p; return; }
        if (!state.ref) return;
        if (i === 4) state.ref.p1 = p; else state.ref.p2 = p;
      },
      onDrag: function () { drawCalib(); }
    });
  }

  /* ------------------------------ 测评 ------------------------------ */
  function step(i) {
    $$('#boxSteps li').forEach(function (li, idx) {
      li.classList.toggle('done', idx < i);
      li.classList.toggle('active', idx === i);
    });
    var txt = ['定位二维码四角…', '计算符号质量分级…', '换算尺寸与套印…', '核验 59 位编码…', '比对技术要求…'][i];
    if (txt) $('#boxProgressSub').textContent = txt;
  }

  function refMmPerPx() {
    if (!state.ref || !state.ref.mm) return null;
    var d = Math.hypot(state.ref.p2.x - state.ref.p1.x, state.ref.p2.y - state.ref.p1.y);
    if (d < 6) return null;
    return d / state.ref.mm;   // px per mm
  }

  async function analyze() {
    if (!state.src || !state.quad) return;
    $('#boxProgress').hidden = false;
    $('#boxResult').hidden = true;
    $('#boxEmpty').hidden = true;
    step(0);
    $('#boxProgress').scrollIntoView({ behavior: 'smooth', block: 'center' });

    await wait(80); step(1);

    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var r0 = null;
    try {
      var jsQR = resolveJsQR();
      r0 = QRQ.analyze(
        { data: state.rgba, width: state.src.width, height: state.src.height },
        { jsQR: jsQR, standard: '15415', maxSide: MAX_SIDE }
      );
    } catch (e) {
      console.error(e);
      window.__lastErr = 'analyze: ' + e.message;
      toast('识读失败：' + e.message);
      $('#boxProgress').hidden = true;
      return;
    }

    await wait(80); step(2);

    var ppm = refMmPerPx();
    var r;
    try {
      r = QRQ.Box.analyze(state.gray, state.src.width, state.src.height, {
        quad: orderQuad(state.quad),
        ppm: ppm,
        pack: state.pack,
        grade: r0
      }, { IMG: QRQ, pinggui: QRQ.Pinggui });
    } catch (e) {
      console.error(e);
      window.__lastErr = 'box: ' + e.message;
      toast('量测失败：' + e.message);
      $('#boxProgress').hidden = true;
      return;
    }
    var elapsed = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    r.timingMs = elapsed;
    state.result = r;
    window.__lastBox = r;          // 排障用：便于在控制台/自动化中查看量测结果

    await wait(70); step(3);
    await wait(90); step(4);
    await wait(110);

    $('#boxProgress').hidden = true;
    render(r, elapsed);
  }

  /* ------------------------------ 渲染 ------------------------------ */
  function badgeLabel(st) {
    return st === 'ok' ? '符合' : (st === 'warn' ? '基本符合' : '不符合');
  }

  function render(r, elapsed) {
    var host = $('#boxResult');
    host.hidden = false;
    var st = r.status;
    var hit = r.hit;

    var chips = [
      ['码属', hit ? hit.typeText : '未匹配'],
      ['品规', hit && hit.name ? hit.name : '—'],
      ['版本', r.qr.ok ? 'V' + r.qr.version + ' · ' + (r.qr.ecl || '?') : '未识读'],
      ['边长', r.geo && r.geo.sideMm ? fmt(r.geo.sideMm, 1) + ' mm' : '待标定'],
      ['用时', Math.round(elapsed) + ' ms']
    ];

    var html = '';
    html += '<div class="panel lab-head st-' + st + '">' +
      '<div class="lh-top">' +
        '<div class="lh-titles">' +
          '<div class="rh-label">PACK QR COMPLIANCE · GB/T 33993-2017</div>' +
          '<div class="lh-title">盒条二维码 <em>' + badgeLabel(st) + '</em> 标准要求</div>' +
        '</div>' +
        '<div class="lh-badge ' + st + '">' + (st === 'ok' ? 'ALL PASS' : (st === 'warn' ? 'CHECK' : 'FAIL')) + '</div>' +
      '</div>' +
      '<div class="lh-bar">' +
        '<div><b>' + r.counts.ok + '</b><span>符合</span></div>' +
        '<div><b>' + r.counts.warn + '</b><span>临界</span></div>' +
        '<div><b>' + r.counts.fail + '</b><span>超差</span></div>' +
        '<div><b>' + r.counts.total + '</b><span>受检项</span></div>' +
      '</div>' +
      '<div class="lh-facts">' +
        chips.map(function (c) {
          return '<div><div class="fact-k">' + c[0] + '</div><div class="fact-v">' + esc(c[1]) + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="rh-actions">' +
        '<button class="btn btn-ghost" id="btnBoxAgain">重新检测</button>' +
        '<button class="btn btn-ghost" id="btnBoxCopy">复制结论</button>' +
        '<button class="btn btn-ghost" id="btnBoxPrint">导出报告</button>' +
      '</div>' +
    '</div>';

    /* 码属与品规：置于指标清单与结论之前 */
    html += '<div class="panel spec-card ' + (hit ? 'hit' : 'miss') + '">' +
      '<div class="preview-head">' +
        '<div><div class="section-label">Package Type &amp; Specification</div>' +
        '<div class="section-title">码属与品规</div></div>' +
        '<span class="rh-chip" style="height:22px;font-size:10px">' +
          (r.pinggui ? (r.pinggui.source === 'imported' ? '品规库 ' + r.pinggui.total + ' 条' : '演示库 ' + r.pinggui.total + ' 条') : '未载入') +
        '</span>' +
      '</div>' +
      '<div class="spec-main">' +
        '<span class="spec-type ' + (hit ? (hit.type === 'box' ? 'box' : 'bar') : 'none') + '">' +
          esc(hit ? hit.typeText : '未匹配') + '</span>' +
        '<span class="spec-name">' + esc(hit && hit.name ? hit.name : '未在品规对应表中找到该码') + '</span>' +
      '</div>' +
      '<div class="seg-table">' +
        '<div class="seg-row"><span class="seg-name">' + esc(hit ? hit.typeText : '盒码 / 条码') + '</span>' +
          '<span class="seg-val mono">' + esc(hit ? hit.code : '—') + '</span></div>' +
        '<div class="seg-row"><span class="seg-name">' + esc(hit ? hit.pairedTypeText : '配对码') + '</span>' +
          '<span class="seg-val mono">' + esc(hit && hit.paired ? hit.paired : '—') + '</span></div>' +
        '<div class="seg-row"><span class="seg-name">包装类型</span>' +
          '<span class="seg-val">' + esc(r.pack.label) + '</span></div>' +
      '</div>' +
      (hit ? '' : '<div class="note-line">在下方「品规对应表」导入正式表格后，可直接判定盒码 / 条码并显示品规名称；也可用盒码手动查询。</div>') +
    '</div>';

    /* 叠加预览 */
    html += '<div class="panel">' +
      '<div class="preview-head">' +
        '<div><div class="section-label">Measured Overlay</div><div class="section-title">实测标记</div></div>' +
        '<span class="rh-chip" style="height:22px;font-size:10px">' + (r.calibrated ? '已标定 ' + fmt(r.ppm, 1) + ' px/mm' : '未标定') + '</span>' +
      '</div>' +
      '<div class="calib-wrap"><canvas id="boxOverlay"></canvas></div>' +
      '<div class="ov-legend">' +
        '<span><i class="ln-quad"></i>二维码四角</span>' +
        '<span><i class="ln-std"></i>底框（下沿空白）</span>' +
        '<span><i class="ln-ref"></i>尺寸基准</span>' +
      '</div>' +
      (r.geo && r.geo.frame && r.calibrated
        ? '<div class="note-line">底框 ' + fmt(r.geo.frame.bottom, 2) + ' mm · 位置偏差 ' +
          fmt(maxOffset(r), 2) + ' mm · 基准 ' + fmt(r.ppm, 1) + ' px/mm</div>'
        : '') +
      (r.notes.length ? '<div class="note-line">' + r.notes.map(esc).join('；') + '</div>' : '') +
    '</div>';

    /* 指标清单 */
    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">Checklist</div>' +
      '<div class="section-title">指标清单</div></div>' +
      '<span class="rh-chip" style="height:22px;font-size:10px">标准值 − 实测 = 偏差</span></div>';
    r.groups.forEach(function (g) {
      var fails = g.items.filter(function (i) { return i.status === 'fail'; }).length;
      var warns = g.items.filter(function (i) { return i.status === 'warn'; }).length;
      var nas = g.items.filter(function (i) { return i.status === 'na'; }).length;
      var summary = fails || warns
        ? (fails ? fails + ' 超差' : '') + (fails && warns ? ' · ' : '') + (warns ? warns + ' 临界' : '')
        : (nas === g.items.length ? '待标定' : '全部符合');
      html += '<div class="lgroup">' +
        '<div class="lgroup-head"><span>' + esc(g.name) + '</span>' +
        '<em class="' + (fails ? '' : (warns ? 'warn' : 'ok')) + '">' + summary + '</em>' +
        '</div>';
      g.items.forEach(function (it) {
        var dev = '';
        if (it.dev !== null && it.dev !== undefined && it.std !== null) {
          var d = it.dev;
          dev = (typeof d === 'number' ? (d > 0 ? '+' : '') + d.toFixed(Math.abs(d) < 1 ? 2 : 1) : d) + (it.unit || '');
        }
        html += '<div class="lrow ' + it.status + '">' +
          '<div class="lrow-top">' +
            '<span class="lname">' + esc(it.name) + '</span>' +
            '<span class="lbadge ' + it.status + '">' + statusText(it.status, it.naText) + '</span>' +
          '</div>' +
          '<div class="lrow-data">' +
            '<span>标准 <b>' + (it.std === null ? '—' : esc(it.std)) + '</b></span>' +
            '<span>实测 <b>' + (it.value === null ? '—' : esc(it.value)) + '</b></span>' +
            '<span class="ldev">偏差 <b>' + (dev || '—') + '</b></span>' +
          '</div>' +
          (it.desc ? '<div class="lrow-desc">' + esc(it.desc) + '</div>' : '') +
        '</div>';
      });
      html += '</div>';
    });
    html += '</div>';

    /* 二维码数据 */
    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">QR Data</div><div class="section-title">二维码数据</div></div>' +
      '<span class="rh-chip" style="height:22px;font-size:10px">' +
        (r.qr.ok ? 'V' + r.qr.version + ' · ' + (r.qr.ecl || '?') + ' · ' + r.qr.text.length + ' 位' : '未识读') + '</span></div>';
    if (r.qr.ok) {
      html += '<div class="payload">' + esc(r.qr.text) + '</div>';
      if (r.struct && r.struct.length) {
        html += '<div class="sub-h">59 位编码结构</div><div class="seg-table">' +
          r.struct.map(function (row) {
            return '<div class="seg-row' + (row.sep ? ' is-sep' : '') + '">' +
              '<span class="seg-name">' + esc(row.name) + '</span>' +
              '<span class="seg-pos">' + row.from + '–' + row.to + '</span>' +
              '<span class="seg-val mono">' + esc(row.value || '—') + '</span></div>';
          }).join('') + '</div>' +
          '<div class="note-line">分段依据行业规定的 59 位编码结构；属性码与流水码的位段边界以行业下发的编码规则为准。</div>';
      }
    } else {
      html += '<div class="note-line">未能识读二维码：可能为图像模糊、对比度不足，或画面内不存在二维码。</div>';
    }
    html += '</div>';

    /* 结论 */
    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">Conclusion</div><div class="section-title">测评结论</div></div></div>' +
      '<div class="verdict-headline">' + esc(r.verdict.headline) + '</div>' +
      '<ul class="verdict-list">' + r.verdict.details.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<div class="sub-h">整改建议</div>' +
      '<ul class="verdict-list advice">' + r.verdict.advice.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<div class="note-line">' + esc(r.pack.label) + ' · ' +
        (r.calibrated ? '尺寸基准 ' + fmt(r.ppm, 1) + ' px/mm' : '未标定尺寸') +
        (r.geo && r.geo.frame ? ' · 下白区 ' + fmt(r.geo.frame.bottom, 2) + ' mm' : '') +
      '</div>' +
    '</div>';

    host.innerHTML = html;
    drawOverlay(r);
    bindResult();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function maxOffset(r) {
    var fr = r.geo && r.geo.frame;
    if (!fr || !r.ppm) return null;
    var h = (fr.leftEdge || fr.rightEdge) ? null : Math.abs(fr.left - fr.right) / 2;
    var v = (fr.topEdge || fr.bottomEdge) ? null : Math.abs(fr.top - fr.bottom) / 2;
    if (h === null && v === null) return null;
    return Math.max(h || 0, v || 0);
  }

  function drawOverlay(r) {
    var cv = $('#boxOverlay');
    if (!cv || !state.src) return;
    var host = cv.parentElement;
    var maxW = Math.min(430, host.clientWidth - 2);
    var scale = maxW / state.src.width;
    cv.width = Math.round(state.src.width * scale);
    cv.height = Math.round(state.src.height * scale);
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(state.src, 0, 0, cv.width, cv.height);
    var k = cv.width / state.src.width;

    var q = r.qr.quad || state.quad;
    if (q) {
      ctx.save();
      ctx.strokeStyle = 'rgba(168,121,27,.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      q.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x * k, p.y * k); else ctx.lineTo(p.x * k, p.y * k);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // 底框：只在符号下沿标注一段，避免四条线交叉干扰判读
    var fr = r.geo && r.geo.frame;
    if (fr && q && r.ppm && fr.bottom) {
      var b0 = q[2], b1 = q[3];             // 底边 BR → BL
      var mx = (b0.x + b1.x) / 2, my = (b0.y + b1.y) / 2;
      var ux = (b1.x - b0.x) || 1, uy = (b1.y - b0.y) || 0;
      var ul = Math.hypot(ux, uy) || 1;
      var nx = uy / ul, ny = -ux / ul;      // 指向符号外侧（y 轴向下，底边外法线为 +y）
      if (ny < 0) { nx = -nx; ny = -ny; }
      var lenPx = fr.bottom * r.ppm;
      var ex = mx + nx * lenPx, ey = my + ny * lenPx;

      ctx.save();
      ctx.strokeStyle = 'rgba(120,168,92,.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(mx * k, my * k);
      ctx.lineTo(ex * k, ey * k);
      ctx.stroke();
      // 端点横杠
      var hx = -ny * 7, hy = nx * 7;
      ctx.beginPath();
      ctx.moveTo(ex * k - hx, ey * k - hy);
      ctx.lineTo(ex * k + hx, ey * k + hy);
      ctx.stroke();
      ctx.restore();
    }

    if (state.ref) {
      ctx.save();
      ctx.strokeStyle = 'rgba(198,72,32,.95)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(state.ref.p1.x * k, state.ref.p1.y * k);
      ctx.lineTo(state.ref.p2.x * k, state.ref.p2.y * k);
      ctx.stroke();
      ctx.restore();
    }
  }

  function bindResult() {
    var again = $('#btnBoxAgain');
    if (again) again.addEventListener('click', function () {
      $('#boxCalibPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    var cp = $('#btnBoxCopy');
    if (cp) cp.addEventListener('click', copyReport);
    var pr = $('#btnBoxPrint');
    if (pr) pr.addEventListener('click', function () {
      if (window.AndroidBridge && window.AndroidBridge.printPage) { window.AndroidBridge.printPage(); return; }
      window.print();
    });
  }

  function copyReport() {
    var r = state.result;
    if (!r) return;
    var lines = ['盒条二维码合规测评报告', '标准：GB/T 33993-2017', '包装类型：' + r.pack.label];
    if (r.hit) lines.push('码属：' + r.hit.typeText + ' ' + r.hit.code + (r.hit.name ? '，品规 ' + r.hit.name : ''));
    lines.push('结论：' + badgeLabel(r.status) +
      '（符合 ' + r.counts.ok + ' / 临界 ' + r.counts.warn + ' / 超差 ' + r.counts.fail + '）');
    r.groups.forEach(function (g) {
      lines.push('【' + g.name + '】');
      g.items.forEach(function (i) {
        var dev = (i.dev === null || i.dev === undefined) ? '' : '，偏差 ' + (i.dev > 0 ? '+' : '') + i.dev + (i.unit || '');
        lines.push('· ' + i.name + '：标准 ' + (i.std === null ? '—' : i.std) + '，实测 ' + (i.value === null ? '—' : i.value) + dev + '，' + statusText(i.status, i.naText));
      });
    });
    if (r.qr.ok) lines.push('二维码：' + r.qr.text);
    lines.push('时间：' + new Date().toLocaleString('zh-CN'));
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('结论已复制'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('结论已复制'); } catch (e) { toast('复制失败'); }
    ta.remove();
  }

  /* ------------------------------ 品规库 ------------------------------ */
  function refreshLib() {
    var PG = QRQ.Pinggui;
    var c = PG.count();
    var el = $('#libCount');
    if (el) el.textContent = (c.source === 'imported' ? '已导入 ' : '演示 ') + c.total + ' 条';
  }

  async function importLib(file) {
    var name = (file.name || '').toLowerCase();
    try {
      var rows;
      if (/\.xlsx?$/.test(name)) {
        var buf = await file.arrayBuffer();
        rows = await QRQ.Xlsx.read(buf);
      } else {
        var text = await file.text();
        rows = QRQ.Xlsx.readDelimited(text);
      }
      var n = QRQ.Pinggui.ingest(rows);
      refreshLib();
      toast('已导入 ' + n + ' 条品规');
      showLibResult(null);
    } catch (e) {
      console.error(e);
      toast('导入失败：' + e.message);
    }
  }

  function showLibResult(hit) {
    var box = $('#libResult');
    if (!box) return;
    if (!hit) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="spec-main small">' +
      '<span class="spec-type ' + (hit.type === 'box' ? 'box' : 'bar') + '">' + esc(hit.typeText) + '</span>' +
      '<span class="spec-name">' + esc(hit.name || '（无名称）') + '</span></div>' +
      '<div class="note-line">' + esc(hit.code) + (hit.paired ? ' · 配对' + esc(hit.pairedTypeText) + ' ' + esc(hit.paired) : '') + '</div>';
  }

  /* ------------------------------ 示例 ------------------------------ */
  function buildSample() {
    var mk = window.qrcode;
    if (typeof mk !== 'function') return null;

    // 59 位：地址 15 + '/' + 前缀 9 + '/' + 实体分类 2 + 属性码 13 + 流水码 18
    // 版本 3 / M 级的数据容量为 44 字节，59 位只能走字母数字模式（容量 61 字符）
    var payload = 'YZWM.TOBACCO.CN' + '/' + '690102801' + '/' + '01' + '6900000000017' + '000000000000000001';
    var PX = 40;                       // 40 px/mm
    var cv = document.createElement('canvas');
    cv.width = 34 * PX; cv.height = 28 * PX;
    var ctx = cv.getContext('2d', { willReadFrequently: true });

    // 深色盒面
    ctx.fillStyle = '#2f353c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, 22 * PX, cv.width, 0.3 * PX);

    var sideMm = 8;                    // 盒烟 · 标准支/中支：8~10mm
    var frameMm = 1.2;                 // 底框（≤2mm）
    var whiteMm = sideMm + frameMm * 2;
    var wx = (cv.width - whiteMm * PX) / 2;
    var wy = (cv.height - whiteMm * PX) / 2 - 0.6 * PX;
    ctx.fillStyle = '#fff';
    ctx.fillRect(wx, wy, whiteMm * PX, whiteMm * PX);

    var qr = mk(3, 'M');
    qr.addData(payload, 'Alphanumeric');
    qr.make();
    var N = qr.getModuleCount();
    var cell = sideMm * PX / N;
    var ox = wx + frameMm * PX, oy = wy + frameMm * PX;
    ctx.fillStyle = '#12161a';
    for (var rr = 0; rr < N; rr++) {
      for (var cc = 0; cc < N; cc++) {
        if (qr.isDark(rr, cc)) ctx.fillRect(ox + cc * cell, oy + rr * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    // 盒面装饰字样
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '600 ' + (1.6 * PX) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('示例盒面 · 演示用', 1.6 * PX, 24.6 * PX);

    cv._sample = { whiteBox: { x: wx, y: wy, w: whiteMm * PX }, whiteMm: whiteMm };
    return cv;
  }

  /* ------------------------------ 初始化 ------------------------------ */
  function init() {
    var cam = $('#btnBoxCamera');
    var gal = $('#btnBoxGallery');
    var fc = $('#boxFileCamera');
    var fg = $('#boxFileGallery');

    if (cam) cam.addEventListener('click', function () {
      if (window.Camera && window.Camera.open) {
        window.Camera.open(function (c) { prepare(c, 'photo'); }, 'box');
      } else if (fc) fc.click();
    });
    if (gal && fg) gal.addEventListener('click', function () { fg.click(); });
    if (fg) fg.addEventListener('change', async function () {
      var f = fg.files && fg.files[0];
      if (!f) return;
      try { prepare(toCanvas(await loadImage(f)), 'gallery'); } catch (e) { toast(e.message); }
      fg.value = '';
    });
    if (fc) fc.addEventListener('change', async function () {
      var f = fc.files && fc.files[0];
      if (!f) return;
      try { prepare(toCanvas(await loadImage(f)), 'photo'); } catch (e) { toast(e.message); }
      fc.value = '';
    });

    var dz = $('#boxDropZone');
    if (dz) dz.addEventListener('click', function () { if (fg) fg.click(); });

    var smp = $('#btnBoxSample');
    if (smp) smp.addEventListener('click', function () {
      var c = buildSample();
      if (!c) { toast('示例生成失败'); return; }
      prepare(c, 'sample');
      // 示例：基准线对准白色底框宽度
      var s = c._sample;
      state.ref = {
        p1: { x: s.whiteBox.x, y: s.whiteBox.y * 0.35 },
        p2: { x: s.whiteBox.x + s.whiteBox.w, y: s.whiteBox.y * 0.35 },
        mm: s.whiteMm
      };
      var inp = $('#boxRefMm');
      if (inp) inp.value = s.whiteMm;
      drawCalib();
    });

    var pack = $('#boxPack');
    if (pack) pack.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.pack = b.dataset.pack;
      $$('button', pack).forEach(function (x) { x.classList.toggle('on', x === b); });
    });

    var refInput = $('#boxRefMm');
    if (refInput) refInput.addEventListener('input', function () {
      var v = parseFloat(refInput.value);
      if (state.ref) state.ref.mm = isFinite(v) && v > 0 ? v : null;
      if (state.src) drawCalib();
    });

    var auto = $('#btnBoxAuto');
    if (auto) auto.addEventListener('click', function () {
      if (!state.src) return;
      var det = detectQR(state.src);
      if (det) { state.quad = det; drawCalib(); toast('已重新定位'); }
      else toast('仍未识别到二维码，请手动拖动');
    });

    var ok = $('#btnBoxAnalyze');
    if (ok) ok.addEventListener('click', analyze);

    var cancel = $('#btnBoxCancel');
    if (cancel) cancel.addEventListener('click', function () {
      state.src = null; state.quad = null; state.ref = null;
      $('#boxCalibPanel').hidden = true;
      $('#boxEmpty').hidden = false;
      $('#boxResult').hidden = true;
    });

    bindCalib();

    // 品规库
    refreshLib();
    var imp = $('#btnLibImport');
    var lf = $('#libFile');
    if (imp && lf) {
      imp.addEventListener('click', function () { lf.click(); });
      lf.addEventListener('change', async function () {
        var f = lf.files && lf.files[0];
        if (f) await importLib(f);
        lf.value = '';
      });
    }
    var lr = $('#btnLibReset');
    if (lr) lr.addEventListener('click', function () {
      QRQ.Pinggui.reset();
      refreshLib();
      showLibResult(null);
      toast('已恢复演示库');
    });
    var lq = $('#btnLibQuery');
    var lqi = $('#libQuery');
    function doQuery() {
      var v = lqi ? lqi.value.trim() : '';
      if (!v) { showLibResult(null); return; }
      var hit = QRQ.Pinggui.query(v);
      if (hit) showLibResult(hit);
      else { showLibResult(null); toast('未查到该码'); }
    }
    if (lq) lq.addEventListener('click', doQuery);
    if (lqi) lqi.addEventListener('keydown', function (e) { if (e.key === 'Enter') doQuery(); });

    // 截图/演示：?view=box&demo=box
    // 延后一拍：app.js 在最后一个脚本里绑定页签切换，此处不能抢先点击
    setTimeout(function () {
      var params = new URLSearchParams(location.search);
      if (params.get('view') !== 'box') return;
      var tab = $('.vtab[data-view="box"]');
      if (tab) tab.click();
      if (!params.get('demo')) return;
      setTimeout(function () {
        var s = $('#btnBoxSample');
        if (s) s.click();
        if (params.get('noscale')) {
          // 演示“未标定”分支
          state.ref.mm = null;
          var inp = $('#boxRefMm');
          if (inp) inp.value = '';
          drawCalib();
        }
        setTimeout(function () { analyze(); }, 220);
      }, 340);
    }, 90);
  }

  window.BoxUI = { init: init, analyze: analyze };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
