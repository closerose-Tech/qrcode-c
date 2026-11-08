/*!
 * 二维码测评 · 件烟标签合规测评交互层
 * 拍摄/导入 → 四角校准 → 透视校正与量测 → 指标清单与结论
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var MAX_SIDE = 1800;

  var state = {
    src: null,          // 源图 canvas
    gray: null,
    quad: null,         // 图像坐标
    src2: '',           // 来源标记
    dragging: -1,
    result: null,
    overlay: true
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
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

  function statusText(s) { return s === 'ok' ? '符合' : (s === 'warn' ? '临界' : '超差'); }

  /* ------------------------------ 载入与校准 ------------------------------ */
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
    state.src2 = source || 'photo';
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.gray = QRQ.grayFromRGBA(data.data, canvas.width, canvas.height);

    var det = QRQ.detectQuad(state.gray, canvas.width, canvas.height, QRQ);
    if (det) {
      state.quad = det.quad;
    } else {
      var jsQR = resolveJsQR();
      var fb = null;
      if (jsQR) {
        try { fb = jsQR(data.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' }); } catch (e) { fb = null; }
      }
      var qq = fb ? QRQ.quadFromQR(fb.location, canvas.width, canvas.height) : null;
      state.quad = qq ? qq.quad : defaultQuad(canvas);
      toast(det ? '' : '未能自动识别标签边缘，已给出估算四角，请手动校准');
    }
    $('#calibPanel').hidden = false;
    $('#labelResult').hidden = true;
    $('#labelEmpty').hidden = true;
    drawCalib();
    $('#calibPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function defaultQuad(c) {
    var mx = c.width * 0.06, my = c.height * 0.06;
    var w = c.width - mx * 2, h = w / 1.4;
    if (h > c.height - my * 2) { h = c.height - my * 2; w = h * 1.4; }
    var x = (c.width - w) / 2, y = (c.height - h) / 2;
    return [{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }];
  }

  function resolveJsQR() {
    var g = window.jsQR;
    if (typeof g === 'function') return g;
    if (g && typeof g.default === 'function') return g.default;
    return null;
  }

  /* 校准画布：图像 + 标准区域指引 + 四角 */
  function drawCalib() {
    var cv = $('#calibCanvas');
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

    var quad = state.quad;
    var Hm = QRQ.homography(quad);

    // 标准区域指引（把 mm 坐标投到照片上）
    ctx.save();
    ctx.strokeStyle = 'rgba(168,121,27,.5)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 0.9;
    Object.keys(QRQ.REGIONS).forEach(function (k) {
      var r = QRQ.REGIONS[k];
      var pts = [
        QRQ.applyH(Hm, r.x / QRQ.W, r.y / QRQ.H),
        QRQ.applyH(Hm, (r.x + r.w) / QRQ.W, r.y / QRQ.H),
        QRQ.applyH(Hm, (r.x + r.w) / QRQ.W, (r.y + r.h) / QRQ.H),
        QRQ.applyH(Hm, r.x / QRQ.W, (r.y + r.h) / QRQ.H)
      ];
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var x = p.x * scale, y = p.y * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    });
    ctx.restore();

    // 四边形与角点
    ctx.save();
    ctx.strokeStyle = 'rgba(201,162,39,.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    quad.forEach(function (p, i) {
      var x = p.x * scale, y = p.y * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    quad.forEach(function (p, i) {
      var x = p.x * scale, y = p.y * scale;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fill();
      ctx.strokeStyle = '#a8791b';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#a8791b';
      ctx.fill();
    });
    ctx.restore();
  }

  function bindCalib() {
    var cv = $('#calibCanvas');
    var active = -1;

    function pos(e) {
      var r = cv.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) };
    }

    function onDown(e) {
      if (!state.quad) return;
      var p = pos(e);
      var best = -1, bd = 1e9;
      state.quad.forEach(function (q, i) {
        var d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) { bd = d; best = i; }
      });
      if (bd < 34) {
        active = best;
        cv.setPointerCapture && e.pointerId !== undefined && cv.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    }

    function onMove(e) {
      if (active < 0) return;
      var p = pos(e);
      state.quad[active] = { x: Math.max(0, Math.min(state.src.width, p.x)), y: Math.max(0, Math.min(state.src.height, p.y)) };
      drawCalib();
      e.preventDefault();
    }

    function onUp() { active = -1; }

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cv.addEventListener('touchstart', function (e) { onDown(e); }, { passive: false });
    cv.addEventListener('touchmove', function (e) { onMove(e); }, { passive: false });
    cv.addEventListener('touchend', onUp);
  }

  /* ------------------------------ 测评 ------------------------------ */
  function step(i) {
    $$('#labelSteps li').forEach(function (li, idx) {
      li.classList.toggle('done', idx < i);
      li.classList.toggle('active', idx === i);
    });
    var txt = ['定位标签四角…', '透视校正到 105×75…', '量测各区域位置与尺寸…', '估算字号与排版…', '逐项比对标准…'][i];
    if (txt) $('#labelProgressSub').textContent = txt;
  }

  async function analyze() {
    if (!state.src || !state.quad) return;
    $('#labelProgress').hidden = false;
    $('#labelResult').hidden = true;
    $('#labelEmpty').hidden = true;
    step(0);
    $('#labelProgress').scrollIntoView({ behavior: 'smooth', block: 'center' });

    await wait(90); step(1);
    await wait(90); step(2);

    var t0 = performance.now();
    var r;
    try {
      r = QRQ.analyze(state.gray, state.src.width, state.src.height,
        { quad: state.quad, source: state.src2 },
        { jsQR: resolveJsQR(), IMG: QRQ, QS: QRQ, code128: QRQ, ppm: 10 });
    } catch (e) {
      toast('量测失败：' + e.message);
      console.error(e);
      $('#labelProgress').hidden = true;
      return;
    }
    var elapsed = performance.now() - t0;
    step(3); await wait(90); step(4); await wait(140);

    state.result = r;
    $('#labelProgress').hidden = true;
    render(r, elapsed);
  }

  /* ------------------------------ 渲染 ------------------------------ */
  function groupStatus(r, key) {
    var g = r.groups.filter(function (x) { return x.key === key; })[0];
    if (!g) return 'ok';
    var bad = g.items.some(function (i) { return i.status === 'fail'; });
    if (bad) return 'fail';
    return g.items.some(function (i) { return i.status === 'warn'; }) ? 'warn' : 'ok';
  }

  function render(r, elapsed) {
    var host = $('#labelResult');
    host.hidden = false;
    var st = r.status;
    var label = st === 'ok' ? '符合' : (st === 'warn' ? '基本符合' : '不符合');

    var chips = [
      ['二维码', r.qr.ok ? ('V' + r.qr.version + ' · ' + (r.qr.ecl || '?') + ' · ' + (r.qr.box ? fmt(r.qr.box.w, 1) + '×' + fmt(r.qr.box.h, 1) + 'mm' : '—')) : '未识读'],
      ['一维码', r.bc.ok ? (r.bc.symbology + ' · ' + fmt(r.bc.box ? r.bc.box.w : null, 1) + '×' + fmt(r.bc.box ? r.bc.box.h : null, 1) + 'mm') : '未识读'],
      ['成像', fmt(r.srcPpm, 1) + ' px/mm'],
      ['用时', Math.round(elapsed) + ' ms']
    ];

    var html = '';
    html += '<div class="panel lab-head st-' + st + '">' +
      '<div class="lh-top">' +
        '<div class="lh-titles">' +
          '<div class="rh-label">LABEL COMPLIANCE · 卷烟件烟标签技术规范</div>' +
          '<div class="lh-title">件烟标签 <em>' + label + '</em> 标准要求</div>' +
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
        '<button class="btn btn-ghost" id="btnLabAgain">重新检测</button>' +
        '<button class="btn btn-ghost" id="btnLabCopy">复制结论</button>' +
        '<button class="btn btn-ghost" id="btnLabPrint">导出报告</button>' +
      '</div>' +
    '</div>';

    html += '<div class="panel">' +
      '<div class="preview-head">' +
        '<div><div class="section-label">Layout Overlay</div><div class="section-title">版面与实测区域</div></div>' +
        '<div class="mini-seg" id="labelSeg">' +
          '<button data-mode="overlay" class="on">叠加</button>' +
          '<button data-mode="plain">校正图</button>' +
        '</div>' +
      '</div>' +
      '<div class="calib-wrap"><canvas id="labelCanvas"></canvas></div>' +
      '<div class="ov-legend">' +
        '<span><i class="ln-std"></i>标准区域</span>' +
        '<span><i class="ln-ok"></i>实测（符合）</span>' +
        '<span><i class="ln-bad"></i>实测（超差/临界）</span>' +
      '</div>' +
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
      html += '<div class="lgroup">' +
        '<div class="lgroup-head"><span>' + esc(g.name) + '</span>' +
        (fails || warns
          ? '<em>' + (fails ? fails + ' 超差' : '') + (fails && warns ? ' · ' : '') + (warns ? warns + ' 临界' : '') + '</em>'
          : '<em class="ok">全部符合</em>') +
        '</div>';
      g.items.forEach(function (it) {
        var dev = '';
        if (it.dev !== null && it.dev !== undefined && it.std !== null) {
          var d = it.dev;
          var num = typeof d === 'number' ? (d > 0 ? '+' : '') + d.toFixed(Math.abs(d) < 1 ? 2 : 1) : d;
          dev = num + (it.unit || '');
        }
        html += '<div class="lrow ' + it.status + '">' +
          '<div class="lrow-top">' +
            '<span class="lname">' + esc(it.name) + '</span>' +
            '<span class="lbadge ' + it.status + '">' + statusText(it.status) + '</span>' +
          '</div>' +
          '<div class="lrow-data">' +
            '<span>标准 <b>' + (it.std === null ? '—' : esc(it.std)) + '</b></span>' +
            '<span>实测 <b>' + (it.value === null ? '—' : esc(typeof it.value === 'number' ? it.value : it.value)) + '</b></span>' +
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
      '<span class="rh-chip" style="height:22px;font-size:10px">' + (r.qr.ok ? 'V' + r.qr.version + ' · ' + (r.qr.ecl || '?') : '未识读') + '</span></div>';
    if (r.qr.ok) {
      html += '<div class="payload">' + esc(r.qr.text) + '</div>';
      if (r.qr.segments && r.qr.segments.rows && r.qr.segments.rows.length) {
        html += '<div class="sub-h">编码结构（共 ' + r.qr.text.length + ' 位）</div>' +
          '<div class="seg-table">' +
          r.qr.segments.rows.map(function (row) {
            return '<div class="seg-row"><span class="seg-name">' + esc(row.name) + '</span>' +
              '<span class="seg-pos">' + row.from + '–' + row.to + '</span>' +
              '<span class="seg-val">' + esc(row.value) + '</span></div>';
          }).join('') +
          '</div>';
      }
    } else {
      html += '<div class="note-line">未能识读二维码。可能原因：图像模糊、对比度不足、或标签内二维码缺失。</div>';
    }
    html += '</div>';

    /* 一维码数据 */
    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">Linear Data</div><div class="section-title">一维码数据</div></div>' +
      '<span class="rh-chip" style="height:22px;font-size:10px">' + (r.bc.ok ? esc(r.bc.symbology) : '未识读') + '</span></div>';
    if (r.bc.ok) {
      html += '<div class="payload">' + esc(r.bc.text) + '</div>';
      var ais = (r.bc.ai || []).filter(function (a) { return a.ai; });
      if (ais.length) {
        html += '<div class="sub-h">GS1 应用标识符</div><div class="seg-table">' +
          ais.map(function (a) {
            return '<div class="seg-row"><span class="seg-name">(' + esc(a.ai) + ') ' + esc(a.name || '') + '</span>' +
              '<span class="seg-val">' + esc(a.value) + '</span></div>';
          }).join('') + '</div>';
      }
      html += '<div class="note-line">模块宽 ' + fmt(r.bc.moduleWidth, 2) + ' mm（校正后） · 符号数 ' + r.bc.symbolCount +
        ' · 校验符通过</div>';
    } else {
      html += '<div class="note-line">' + esc(r.bc.reason || '未能识读一维码') + '</div>';
    }
    html += '</div>';

    /* 结论 */
    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">Conclusion</div><div class="section-title">测评结论</div></div></div>' +
      '<div class="verdict-headline">' + esc(r.verdict.headline) + '</div>' +
      '<ul class="verdict-list">' + r.verdict.details.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<div class="sub-h">整改建议</div>' +
      '<ul class="verdict-list advice">' + r.verdict.advice.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<div class="note-line">四角来源 ' + (r.quadSource === 'manual' ? '手动/自动检出' : esc(r.quadSource)) +
        ' · 校正后 ' + r.rectW + '×' + r.rectH + ' px（' + r.ppm + ' px/mm） · 阈值 ' + Math.round(r.threshold) + '</div>' +
      '</div>';

    host.innerHTML = html;
    drawOverlay(r);
    bindResult();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawOverlay(r) {
    var cv = $('#labelCanvas');
    if (!cv) return;
    var host = cv.parentElement;
    var maxW = Math.min(430, host.clientWidth - 2);
    var scale = maxW / r.rectW;
    cv.width = r.rectW; cv.height = r.rectH;
    cv.style.width = Math.round(r.rectW * scale) + 'px';
    cv.style.height = Math.round(r.rectH * scale) + 'px';
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.putImageData(new ImageData(r.rect.rgba, r.rectW, r.rectH), 0, 0);

    if (!state.overlay) return;

    var k = r.ppm; // px per mm
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(168,121,27,.55)';
    Object.keys(QRQ.REGIONS).forEach(function (key) {
      var g = QRQ.REGIONS[key];
      ctx.strokeRect(g.x * k, g.y * k, g.w * k, g.h * k);
    });
    ctx.restore();

    var colorOf = function (t) {
      var gk = t === 'qr' ? 'qr' : (t === 'bc' ? 'bc' : (t === 'logo' ? 'mark' : (t === 'info' ? 'num' : 'name')));
      var s = groupStatus(r, gk);
      return s === 'ok' ? 'rgba(18,121,91,.95)' : (s === 'warn' ? 'rgba(169,118,26,.95)' : 'rgba(180,35,24,.95)');
    };

    r.overlay.forEach(function (o) {
      var b = o.box;
      if (!b) return;
      var x = (b.x0 !== undefined ? b.x0 : b.x) * k;
      var y = (b.y0 !== undefined ? b.y0 : b.y) * k;
      var w = (b.w !== undefined ? b.w : (b.x1 - b.x0)) * k;
      var h = (b.h !== undefined ? b.h : (b.y1 - b.y0)) * k;
      ctx.strokeStyle = colorOf(o.type);
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x, y, w, h);
    });
  }

  function bindResult() {
    var again = $('#btnLabAgain');
    if (again) again.addEventListener('click', function () {
      $('#calibPanel').hidden = false;
      $('#calibPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    var cp = $('#btnLabCopy');
    if (cp) cp.addEventListener('click', copyReport);
    var pr = $('#btnLabPrint');
    if (pr) pr.addEventListener('click', function () {
      if (window.AndroidBridge && window.AndroidBridge.printPage) { window.AndroidBridge.printPage(); return; }
      window.print();
    });
    var seg = $('#labelSeg');
    if (seg) seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.overlay = b.dataset.mode === 'overlay';
      $$('button', seg).forEach(function (x) { x.classList.toggle('on', x === b); });
      drawOverlay(state.result);
    });
  }

  function copyReport() {
    var r = state.result;
    if (!r) return;
    var lines = ['件烟标签合规测评报告', '标准：卷烟件烟标签技术规范（105×75mm）',
      '结论：' + (r.status === 'ok' ? '符合' : (r.status === 'warn' ? '基本符合' : '不符合')) +
      '（符合 ' + r.counts.ok + ' / 临界 ' + r.counts.warn + ' / 超差 ' + r.counts.fail + '）'];
    r.groups.forEach(function (g) {
      lines.push('【' + g.name + '】');
      g.items.forEach(function (i) {
        var dev = (i.dev === null || i.dev === undefined) ? '' : '，偏差 ' + (i.dev > 0 ? '+' : '') + i.dev + (i.unit || '');
        lines.push('· ' + i.name + '：标准 ' + (i.std === null ? '—' : i.std) + '，实测 ' + (i.value === null ? '—' : i.value) + dev + '，' + statusText(i.status));
      });
    });
    if (r.qr.ok) lines.push('二维码：' + r.qr.text);
    if (r.bc.ok) lines.push('一维码：' + r.bc.text);
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

  /* ------------------------------ 示例标签 ------------------------------ */
  function buildSample() {
    var mk = window.qrcode;
    if (typeof mk !== 'function' || !QRQ.encode) return null;
    var payload = 'https://yzwm.cn' + '/' + '991000123' + '/' + 'AC' + '3' + '1' + '12345' +
      '88888888' + '6901028018739' + '1' + '20260312091955' + '01' + '01' + 'A' + 'XX' +
      '000000000' + '000QG6IAIUJ0KKUW8D';

    var PX = 10;
    var cv = document.createElement('canvas');
    cv.width = 105 * PX; cv.height = 75 * PX;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#12161a';

    // 二维码
    var qr = mk(6, 'M');
    qr.addData(payload, 'Byte');
    qr.make();
    var N = qr.getModuleCount();
    var cell = 35 * PX / N;
    for (var r0 = 0; r0 < N; r0++) {
      for (var c0 = 0; c0 < N; c0++) {
        if (qr.isDark(r0, c0)) {
          ctx.fillRect(62 * PX + c0 * cell, 6 * PX + r0 * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
    }

    // 一维码（GS1-128：FNC1 + AI(01) + 13 位商品编码）
    var enc = QRQ.encode('016901028018739');
    var mw = 50 * PX / enc.modules;
    enc.bars.forEach(function (b) {
      ctx.fillRect(6 * PX + b.x * mw, 41 * PX, b.w * mw + 0.3, 28 * PX);
    });

    // 标志区（6,6 → 50×12）
    ctx.fillRect(6.2 * PX, 6.4 * PX, 6.2 * PX, 6.2 * PX);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(7.9 * PX, 7.6 * PX); ctx.lineTo(10.6 * PX, 9.4 * PX); ctx.lineTo(7.9 * PX, 11.4 * PX);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#12161a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 ' + (22 * 0.3528 * PX) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('中国烟草', 13.4 * PX, 12.5 * PX);
    ctx.font = '700 ' + (9 * 0.3528 * PX) + 'px Arial';
    ctx.fillText('CHINA TOBACCO', 13.6 * PX, 16.6 * PX);
    ctx.strokeRect(6.5 * PX, 15.2 * PX, 5.6 * PX, 2.0 * PX);

    // 间隔线（0.2mm）
    ctx.fillRect(6 * PX, 18.4 * PX, 50 * PX, Math.max(2, 0.2 * PX));

    // 规格名称（24pt 居中）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + (24 * 0.3528 * PX) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('中华(双中支)', 31 * PX, 29 * PX);

    // 数字编码区
    ctx.font = '700 ' + (11 * 0.3528 * PX) + 'px Arial';
    ctx.fillText('000QG6IAIUJ0KKUW8D', 80 * PX, 45.6 * PX);
    ctx.font = '700 ' + (14 * 0.3528 * PX) + 'px Arial';
    ctx.fillText('6901028018739', 80 * PX, 53.1 * PX);
    ctx.font = '700 ' + (11 * 0.3528 * PX) + 'px Arial';
    ctx.fillText('260312091955 0123', 80 * PX, 61.4 * PX);
    ctx.fillText('11310001 101 01 B', 80 * PX, 67.2 * PX);

    // 外围背景，便于自动检出
    var out = document.createElement('canvas');
    out.width = cv.width + 80; out.height = cv.height + 80;
    var octx = out.getContext('2d', { willReadFrequently: true });
    octx.fillStyle = '#6f7478';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(cv, 40, 40);
    return out;
  }

  /* ------------------------------ 初始化 ------------------------------ */
  function init() {
    var inpCam = $('#labelFileCamera');
    var inpGal = $('#labelFileGallery');

    $('#btnLabelCamera').addEventListener('click', function () {
      if (window.Camera && window.Camera.open) {
        window.Camera.open(function (c) { prepare(c, 'camera'); }, 'label');
        return;
      }
      inpCam.click();
    });
    $('#btnLabelGallery').addEventListener('click', function () { inpGal.click(); });

    [inpCam, inpGal].forEach(function (inp) {
      inp.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        loadImage(f).then(function (img) { prepare(toCanvas(img), 'gallery'); })
          .catch(function (err) { toast(err.message || '图片载入失败'); });
      });
    });

    var dz = $('#labelDropZone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImage(f).then(function (img) { prepare(toCanvas(img), 'gallery'); });
    });
    dz.addEventListener('click', function () { inpGal.click(); });

    $('#btnAutoQuad').addEventListener('click', function () {
      if (!state.src) return;
      var det = QRQ.detectQuad(state.gray, state.src.width, state.src.height, QRQ);
      if (!det) { toast('未能自动识别，请手动拖动四角'); return; }
      state.quad = det.quad;
      drawCalib();
      toast('已重新识别');
    });

    $('#btnCalibOk').addEventListener('click', function () { analyze(); });
    $('#btnCalibCancel').addEventListener('click', function () {
      $('#calibPanel').hidden = true;
      $('#labelCapturePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    $('#btnLabelSample').addEventListener('click', function () {
      var c = buildSample();
      if (!c) { toast('示例生成失败'); return; }
      prepare(c, 'manual');
    });

    bindCalib();

    // 截图/演示入口：?view=label&demo=label
    // 延迟到 app.js 绑定完视图切换后执行，避免直接触发无效 click
    setTimeout(function () {
      var params = new URLSearchParams(location.search);
      if (params.get('view') !== 'label') return;
      var tab = $('.vtab[data-view="label"]');
      if (tab) tab.click();
      if (params.get('demo')) {
        var c = buildSample();
        if (c) { prepare(c, 'manual'); analyze(); }
      }
    }, 120);
  }

  window.LabelUI = { init: init, startFromCanvas: function (c) { prepare(c, 'camera'); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
