/*!
 * 二维码质量测评 · 交互层
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function resolveJsQR() {
    var g = window.jsQR;
    if (typeof g === 'function') return g;
    if (g && typeof g.default === 'function') return g.default;
    return null;
  }

  var state = {
    standard: '15415',
    result: null,
    imageCanvas: null,
    previewMode: 'orig',
    sampleIndex: 0
  };

  var MAX_SIDE = 1400;

  /* ------------------------------ 工具 ------------------------------ */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function gradeColor(g) {
    if (g === null || g === undefined) return 'var(--muted)';
    if (g >= 3.5) return 'var(--g4)';
    if (g >= 2.5) return 'var(--g3)';
    if (g >= 1.5) return 'var(--g2)';
    if (g >= 0.5) return 'var(--g1)';
    return 'var(--g0)';
  }

  function gradeClass(g) {
    if (g === null || g === undefined) return 'gn';
    if (g >= 3.5) return 'g4';
    if (g >= 2.5) return 'g3';
    if (g >= 1.5) return 'g2';
    if (g >= 0.5) return 'g1';
    return 'g0';
  }

  function letterOf(g) { return (window.QRQ && QRQ.letterOf) ? QRQ.letterOf(g) : '—'; }

  function fmt(v, digits) {
    if (v === null || v === undefined) return '—';
    var d = digits === undefined ? 1 : digits;
    return Number(v).toFixed(d);
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(34px + env(safe-area-inset-bottom));transform:translateX(-50%);' +
      'background:rgba(18,22,26,.9);color:#fff;font-size:12.5px;padding:9px 15px;border-radius:10px;z-index:99;' +
      'max-width:80vw;text-align:center;line-height:1.5;box-shadow:0 8px 24px -12px rgba(0,0,0,.6);opacity:0;transition:opacity .2s';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 240);
    }, 2100);
  }

  var SCALE = { SC: 100, MOD: 100, FPD: 22, AN: 15, GN: 100, UEC: 100, CC: 100, CM: 100, MR: 32, DDG: 4 };
  var TICKS = {
    SC: [20, 40, 55, 70], MOD: [20, 30, 40, 50], FPD: [9, 13, 17], AN: [6, 8, 10, 12],
    GN: [38, 50, 63, 75], UEC: [25, 37, 50, 62], CC: [10, 15, 20, 25, 30], CM: [20, 30, 40, 50],
    MR: [5, 10, 15, 20], DDG: []
  };

  window.AppToast = toast;

  /* ------------------------------ 相机取景 ------------------------------ */
  var cam = { stream: null, facing: 'environment', onShot: null, kind: 'qr', torchOn: false };

  function camSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function stopCam() {
    if (cam.stream) {
      cam.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      cam.stream = null;
    }
    var v = $('#camVideo');
    if (v) v.srcObject = null;
  }

  function fallbackInput(kind) {
    var el = kind === 'label' ? $('#labelFileCamera') : $('#fileCamera');
    if (el) el.click();
  }

  async function startCam() {
    stopCam();
    // 部分机型对 ideal 分辨率/朝向约束敏感，逐级降级以免直接放弃取景
    var tries = [
      { audio: false, video: { facingMode: { ideal: cam.facing }, width: { ideal: 2560 }, height: { ideal: 1440 } } },
      { audio: false, video: { facingMode: cam.facing } },
      { audio: false, video: true }
    ];
    var stream = null, lastErr = null;
    for (var i = 0; i < tries.length && !stream; i++) {
      try { stream = await navigator.mediaDevices.getUserMedia(tries[i]); }
      catch (e) { lastErr = e; }
    }
    if (!stream) throw (lastErr || new Error('无法访问摄像头'));
    cam.stream = stream;
    var v = $('#camVideo');
    v.srcObject = stream;
    v.muted = true;
    v.setAttribute('playsinline', '');
    try { await v.play(); } catch (e) { /* iOS 需用户手势，忽略 */ }
    var track = stream.getVideoTracks()[0];
    var caps = (track && track.getCapabilities) ? track.getCapabilities() : {};
    var torchBtn = $('#camTorch');
    if (torchBtn) {
      torchBtn.hidden = !caps.torch;
      torchBtn.classList.remove('on');
    }
    cam.torchOn = false;
    return true;
  }

  async function openCam(onShot, kind) {
    cam.onShot = onShot;
    cam.kind = kind || 'qr';
    if (!camSupported()) { fallbackInput(cam.kind); return; }

    var sheet = $('#camSheet');
    var title = $('#camTitle');
    var tip = $('#camTip');
    if (sheet) sheet.dataset.kind = cam.kind;
    if (title) title.textContent = cam.kind === 'label' ? '拍摄标签' : '拍摄二维码';
    if (tip) tip.textContent = cam.kind === 'label'
      ? '标签四角完整入画，尽量正对、避免阴影'
      : '二维码占画面 40% 以上，四周留出静区';
    sheet.hidden = false;

    var ok = false;
    // 安卓 WebView：先确认系统相机权限，拿到授权再取景，避免一次注定失败的 getUserMedia
    if (window.AndroidBridge && window.AndroidBridge.requestCamera) {
      var granted = await ensureNativeCam();
      if (!granted) {
        sheet.hidden = true;
        toast('未获得相机权限，已切换为系统拍照');
        fallbackInput(cam.kind);
        return;
      }
    }
    try { ok = await startCam(); } catch (e) { ok = false; }

    if (!ok) {
      sheet.hidden = true;
      toast('无法启用取景相机，已切换为系统拍照');
      fallbackInput(cam.kind);
    }
  }

  /** 等待原生授权结果（已授权时立即回调） */
  var camPermWaiter = null;
  window.onCameraPermission = function (granted) {
    var w = camPermWaiter;
    camPermWaiter = null;
    if (w) w(!!granted);
  };

  function ensureNativeCam() {
    if (!window.AndroidBridge || !window.AndroidBridge.requestCamera) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true; camPermWaiter = null;
        resolve(true);            // 超时未回执：仍尝试一次取景，失败则由上层回退
      }, 20000);
      camPermWaiter = function (g) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        resolve(g);
      };
      try {
        window.AndroidBridge.requestCamera();
      } catch (e) {
        clearTimeout(timer); settled = true; camPermWaiter = null;
        resolve(true);
      }
    });
  }

  function closeCam() {
    stopCam();
    var sheet = $('#camSheet');
    if (sheet) sheet.hidden = true;
  }

  function shootCam() {
    var v = $('#camVideo');
    if (!v || !v.videoWidth) { toast('相机尚未就绪'); return; }
    // 标签量测依赖像素密度，取景成片保留更高分辨率
    var cap = cam.kind === 'label' ? 2048 : 1600;
    var s = Math.min(1, cap / Math.max(v.videoWidth, v.videoHeight));
    var c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(v, 0, 0, c.width, c.height);
    var cb = cam.onShot;
    cam.onShot = null;
    closeCam();
    if (cb) cb(c);
  }

  async function switchCam() {
    cam.facing = cam.facing === 'environment' ? 'user' : 'environment';
    try { await startCam(); } catch (e) { toast('切换镜头失败'); }
  }

  async function toggleTorch() {
    if (!cam.stream) return;
    var track = cam.stream.getVideoTracks()[0];
    cam.torchOn = !cam.torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: cam.torchOn }] });
      $('#camTorch').classList.toggle('on', cam.torchOn);
    } catch (e) { toast('该设备不支持补光'); }
  }

  function bindCam() {
    var sheet = $('#camSheet');
    if (!sheet) return;
    sheet.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cam]');
      if (!b) return;
      var act = b.dataset.cam;
      if (act === 'close') closeCam();
      else if (act === 'shot') shootCam();
      else if (act === 'switch') switchCam();
      else if (act === 'torch') toggleTorch();
      else if (act === 'gallery') {
        closeCam();
        (cam.kind === 'label' ? $('#labelFileGallery') : $('#fileGallery')).click();
      }
    });
  }

  window.Camera = { open: openCam, close: closeCam };

  /* ------------------------------ 图像载入 ------------------------------ */
  /* 统一用 DataURL 载入：避免 blob/file 源污染画布导致 getImageData 失败 */
  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('请选择图片文件'));
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('图片无法解析（可能为 HEIF 等不支持的格式）')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  function toCanvas(img, maxSide) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var s = Math.min(1, (maxSide || MAX_SIDE) / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  /* ------------------------------ 进度 ------------------------------ */
  var STEP_TEXT = ['定位符号…', '建立采样网格…', '读取模块反射率…', '解析格式信息与纠错…', '计算分级参数…'];

  function setStep(i) {
    $$('#steps li').forEach(function (li, idx) {
      li.classList.toggle('done', idx < i);
      li.classList.toggle('active', idx === i);
    });
    if (STEP_TEXT[i]) $('#progressSub').textContent = STEP_TEXT[i];
  }

  /* ------------------------------ 主流程 ------------------------------ */
  async function analyzeCanvas(canvas) {
    var jsQRFn = resolveJsQR();
    if (!jsQRFn) { toast('解码组件未就绪'); return; }

    state.imageCanvas = canvas;
    $('#progress').hidden = false;
    $('#result').hidden = true;
    $('#emptyState').hidden = true;
    setStep(0);
    $('#progress').scrollIntoView({ behavior: 'smooth', block: 'center' });

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height);

    try {
      await wait(110); setStep(1);
      await wait(120); setStep(2);
      await wait(90);
      var t0 = performance.now();
      var result = QRQ.analyze(data, { jsQR: jsQRFn, standard: state.standard, maxSide: MAX_SIDE });
      var elapsed = performance.now() - t0;
      setStep(3);
      await wait(Math.max(80, Math.min(400, elapsed)));
      setStep(4);
      await wait(150);
      state.result = result;
      $('#progress').hidden = true;
      renderResult(result, canvas, elapsed);
      if (result.ok) saveHistory(result);
    } catch (e) {
      $('#progress').hidden = true;
      $('#emptyState').hidden = false;
      toast('测评失败：' + e.message);
      console.error(e);
    }
  }

  async function handleFile(file) {
    try {
      var img = await loadImageFromFile(file);
      await analyzeCanvas(toCanvas(img, MAX_SIDE));
    } catch (e) {
      toast(e.message || '图片载入失败');
    }
  }

  /* ------------------------------ 结果渲染 ------------------------------ */
  function renderResult(r, canvas, elapsed) {
    var host = $('#result');
    host.hidden = false;

    if (!r.ok) {
      host.innerHTML = failHTML(r);
      bindResultEvents();
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    var g = r.grade;
    var C = 2 * Math.PI * 46;
    var dash = C * (1 - Math.max(0, Math.min(4, g.value)) / 4);
    var color = gradeColor(g.value);

    var facts = [
      ['版本', 'V' + r.decode.version + ' · ' + r.decode.size + '×' + r.decode.size],
      ['纠错等级', r.decode.ecl + '（可纠 ' + (r.decode.capacity || '—') + '）'],
      ['模块尺寸', fmt(r.symbol.modulePx, 1) + ' px'],
      ['已纠正', (r.decode.errorsCorrected === null ? '—' : r.decode.errorsCorrected) + ' / ' + (r.decode.capacity === null ? '—' : r.decode.capacity)]
    ];

    var sampleName = ($('#fldName') ? $('#fldName').value : '').trim();
    var sampleBatch = ($('#fldBatch') ? $('#fldBatch').value : '').trim();
    var stamp = new Date();
    var metaBits = [];
    if (sampleName) metaBits.push('样品 ' + sampleName);
    if (sampleBatch) metaBits.push('批号 ' + sampleBatch);
    metaBits.push(stamp.toLocaleString('zh-CN', { hour12: false }));
    metaBits.push(r.standardName);
    state.reportMeta = { sampleName: sampleName, sampleBatch: sampleBatch, time: stamp };

    var html = '';
    html += '<div class="panel result-head">' +
      '<div class="rh-top">' +
        '<div>' +
          '<div class="rh-label">' + (r.standard === '29158' ? 'OVERALL GRADE · ISO/IEC 29158' : 'OVERALL GRADE · ISO/IEC 15415') + '</div>' +
          '<div class="rh-verdict">二维码质量 <b>' + g.text + '</b> · ' + verdictShort(g.value) + '</div>' +
        '</div>' +
        '<div class="rh-chip">' + (r.standard === '29158' ? 'AIM-DPM' : '印刷 2D') + '</div>' +
      '</div>' +
      '<div class="rh-body">' +
        '<div class="grade-ring">' +
          '<svg viewBox="0 0 108 108">' +
            '<circle class="track" cx="54" cy="54" r="46"></circle>' +
            '<circle class="bar" cx="54" cy="54" r="46" stroke="' + color + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"></circle>' +
          '</svg>' +
          '<div class="inner"><div class="grade-num" style="color:' + color + '">' + g.value.toFixed(1) + '<small>/4</small></div>' +
          '<div class="grade-letter">' + g.letter + ' 级</div></div>' +
        '</div>' +
        '<div class="rh-facts">' +
          facts.map(function (f) {
            return '<div><div class="fact-k">' + f[0] + '</div><div class="fact-v">' + esc(f[1]) + '</div></div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="rh-meta">' + metaBits.map(esc).join('<span class="sep">·</span>') + '</div>' +
      '<div class="rh-actions">' +
        '<button class="btn btn-ghost" id="btnAgain">重新检测</button>' +
        '<button class="btn btn-ghost" id="btnCopy">复制结论</button>' +
        '<button class="btn btn-ghost" id="btnPrint">导出报告</button>' +
      '</div>' +
    '</div>';

    /* 预览 */
    html += '<div class="panel">' +
      '<div class="preview-head">' +
        '<div><div class="section-label">Symbol View</div><div class="section-title">符号与采样网格</div></div>' +
        '<div class="mini-seg" id="previewSeg">' +
          '<button data-mode="orig" class="on">原图</button>' +
          '<button data-mode="grid">网格</button>' +
          '<button data-mode="heat">热图</button>' +
        '</div>' +
      '</div>' +
      '<div class="preview-wrap"><canvas id="previewCanvas"></canvas></div>' +
      '<div class="preview-legend">' +
        '<span>调制度低</span><span class="legend-scale"></span><span>高</span>' +
        '<span style="margin-left:6px">静区 ' + r.symbol.quietZone.measured + '/4</span>' +
      '</div>' +
      (r.notes.length ? '<div class="note-line">' + r.notes.map(esc).join('；') + '</div>' : '') +
    '</div>';

    /* 指标 */
    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">Graded Parameters</div>' +
      '<div class="section-title">分级参数</div></div>' +
      '<span class="rh-chip" style="height:22px;font-size:10px">取最低项</span></div>' +
      '<div class="metric-list">' +
        r.metrics.map(function (m) {
          var max = SCALE[m.key] || 100;
          var pct = m.value === null ? 0 : Math.max(0, Math.min(100, m.value / max * 100));
          var barColor = m.key === 'DDG' ? gradeColor(m.grade) : gradeColor(m.grade);
          var ticks = (TICKS[m.key] || []).map(function (t) {
            return '<i class="tick" style="left:' + (t / max * 100).toFixed(1) + '%"></i>';
          }).join('');
          return '<div class="metric">' +
            '<div class="metric-top">' +
              '<div class="metric-name">' + m.name + '<span class="metric-en">' + m.en + '</span></div>' +
              '<div class="metric-right">' +
                '<span class="metric-val">' + (m.value === null ? '—' : fmt(m.value, 1)) + '<i>' + esc(m.unit) + '</i></span>' +
                '<span class="badge ' + gradeClass(m.grade) + '">' + (m.grade === null ? 'N/A' : letterOf(m.grade) + ' ' + fmt(m.grade, 1)) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="bar">' + ticks +
              '<div class="fill" style="width:0%;background:' + barColor + '" data-w="' + pct.toFixed(1) + '"></div>' +
              '<div class="mark" style="left:' + pct.toFixed(1) + '%"></div>' +
            '</div>' +
            '<div class="metric-desc">' + m.desc + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="sub-h">固定图形分项</div>' +
      '<div class="comp-grid">' +
        r.symbol.components.map(function (c) {
          return '<div class="comp"><div><div class="comp-name">' + c.name + '</div>' +
            '<div class="comp-val">' + (c.percent === null ? '未评估' : c.damaged + '/' + c.modules + ' 模块 · ' + fmt(c.percent, 1) + '%') + '</div></div>' +
            '<span class="badge ' + gradeClass(c.grade) + '">' + (c.grade === null ? '—' : letterOf(c.grade)) + '</span></div>';
        }).join('') +
      '</div>' +
    '</div>';

    /* 识读数据 */
    var meta = [
      ['码制', 'QR Code Model 2'],
      ['版本', 'V' + r.decode.version],
      ['掩模', 'Pattern ' + r.decode.mask],
      ['码字数', (r.decode.dataCodewords === null ? '—' : (r.decode.dataCodewords + r.decode.ecCodewords)) + ' 个'],
      ['数据码字', r.decode.dataCodewords === null ? '—' : r.decode.dataCodewords],
      ['纠错码字', r.decode.ecCodewords === null ? '—' : r.decode.ecCodewords],
      ['纠错已用', (r.decode.errorsCorrected === null ? '—' : r.decode.errorsCorrected) + ' 个'],
      ['格式汉明距', r.decode.formatDistance],
      ['模块总数', r.decode.size * r.decode.size + ' 个']
    ];

    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">Decoded Data</div><div class="section-title">识读数据</div></div>' +
      '<span class="rh-chip" style="height:22px;font-size:10px">' + esc(r.decode.dataType.label) + '</span></div>' +
      '<div class="payload">' + esc(r.decode.text || '（空内容）') + '</div>' +
      '<div class="meta-grid">' +
        meta.map(function (m) {
          return '<div><div class="meta-k">' + m[0] + '</div><div class="meta-v">' + esc(m[1]) + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="note-line">字符数 ' + (r.decode.text || '').length + ' · 字节 ' + r.decode.bytes +
        ' · 数据类型 ' + esc(r.decode.dataType.kind) +
        (r.decode.dataType.detail ? ' · ' + esc(r.decode.dataType.detail) : '') + '</div>' +
    '</div>';

    /* 结论 */
    html += '<div class="panel">' +
      '<div class="preview-head"><div><div class="section-label">Assessment</div><div class="section-title">测评结论</div></div></div>' +
      '<div class="verdict-headline">' + esc(r.verdict.headline) + '</div>' +
      '<ul class="verdict-list">' + r.verdict.details.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<div class="sub-h">改善建议</div>' +
      '<ul class="verdict-list advice">' + r.verdict.advice.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      (r.warnings.length ? '<div class="warn-box"><b>需要注意</b>' + r.warnings.map(esc).join('<br>') + '</div>' : '') +
      '<div class="note-line">采样：' + esc(r.symbol.sampling) + ' · 阈值 ' + fmt(r.symbol.gt, 0) +
        ' · Rmax ' + fmt(r.symbol.rmax, 0) + ' / Rmin ' + fmt(r.symbol.rmin, 0) +
        ' · 网格偏移 (' + fmt(r.symbol.fit.dx, 2) + ', ' + fmt(r.symbol.fit.dy, 2) + ')' +
        ' · 用时 ' + Math.round(elapsed) + ' ms</div>' +
    '</div>';

    host.innerHTML = html;

    // 圆环动画 + 进度条动画
    requestAnimationFrame(function () {
      var bar = $('.grade-ring .bar', host);
      if (bar) bar.style.strokeDashoffset = dash.toFixed(1);
      $$('.bar .fill', host).forEach(function (f) { f.style.width = f.dataset.w + '%'; });
    });

    if (state.previewMode !== 'orig') {
      $$('#previewSeg button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.mode === state.previewMode);
      });
    }
    drawPreview();
    bindResultEvents();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function verdictShort(v) {
    if (v >= 3.5) return '可直接投产使用';
    if (v >= 2.5) return '满足常规验收';
    if (v >= 1.5) return '达最低验收线';
    if (v >= 0.5) return '建议复检';
    return '需重新制码';
  }

  function failHTML(r) {
    return '<div class="panel result-head">' +
      '<div class="rh-top"><div><div class="rh-label">DECODE FAILED</div>' +
      '<div class="rh-verdict">二维码未能识读 · <b>F 级</b></div></div>' +
      '<div class="rh-chip">' + (r.standard === '29158' ? 'AIM-DPM' : '印刷 2D') + '</div></div>' +
      '<div class="rh-body" style="display:block">' +
        '<div class="verdict-headline">未能在图像中解出有效码字：可能为符号缺失、严重模糊、对比度不足，或图像中不存在二维码。质量分级参数无法计算。</div>' +
        '<div class="sub-h">拍摄建议</div>' +
        '<ul class="verdict-list advice">' + (r.hints || []).map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>' +
      '</div>' +
      '<div class="rh-actions"><button class="btn btn-ghost" id="btnAgain" style="grid-column:span 3">重新检测</button></div>' +
    '</div>';
  }

  /* ------------------------------ 预览绘制 ------------------------------ */
  function drawPreview() {
    var r = state.result;
    var src = state.imageCanvas;
    var cv = $('#previewCanvas');
    if (!r || !r.ok || !cv || !src) return;

    var maxW = Math.min(428, cv.parentElement.clientWidth - 2);
    var scaleW = maxW / src.width;
    var upscaled = scaleW > 1.02;
    var cw = Math.round(src.width * scaleW);
    var ch = Math.round(src.height * scaleW);
    cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = !upscaled;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cw, ch);

    var N = r.geometry.N;
    var W = r.geometry.imageWidth;
    var H = r.geometry.imageHeight;
    var kx = cw / W, ky = ch / H;

    var quad = r.geometry.quad;
    var Hm = QRQ.homographyFromUnitSquare(quad);
    function pt(u, v) {
      var p = QRQ.applyH(Hm, u, v);
      return { x: p.x * kx, y: p.y * ky };
    }

    if (state.previewMode === 'heat') {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect(0, 0, cw, ch);
      var mods = r.heat.mods;
      for (var rr = 0; rr < N; rr++) {
        for (var cc = 0; cc < N; cc++) {
          var m = mods[rr * N + cc];
          var col = heatColor(m);
          if (!col) continue;
          var p0 = pt(cc / N, rr / N), p1 = pt((cc + 1) / N, rr / N);
          var p2 = pt((cc + 1) / N, (rr + 1) / N), p3 = pt(cc / N, (rr + 1) / N);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.fill();
        }
      }
    }

    if (state.previewMode === 'grid' || state.previewMode === 'heat') {
      ctx.save();
      ctx.strokeStyle = state.previewMode === 'heat' ? 'rgba(255,255,255,.55)' : 'rgba(18,22,26,.35)';
      ctx.lineWidth = 0.5;
      var step = N > 45 ? 2 : 1;
      for (var i = 0; i <= N; i += step) {
        var a = pt(i / N, 0), b = pt(i / N, 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        var c1 = pt(0, i / N), d1 = pt(1, i / N);
        ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(d1.x, d1.y); ctx.stroke();
      }
      ctx.restore();

      // 符号边框
      var o0 = pt(0, 0), o1 = pt(1, 0), o2 = pt(1, 1), o3 = pt(0, 1);
      ctx.save();
      ctx.strokeStyle = 'rgba(168,121,27,.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(o0.x, o0.y); ctx.lineTo(o1.x, o1.y); ctx.lineTo(o2.x, o2.y); ctx.lineTo(o3.x, o3.y);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
  }

  function heatColor(m) {
    if (m >= 85) return null;
    if (m >= 65) return 'rgba(120,168,92,.28)';
    if (m >= 50) return 'rgba(198,166,58,.36)';
    if (m >= 35) return 'rgba(208,124,40,.44)';
    if (m >= 20) return 'rgba(198,72,32,.52)';
    return 'rgba(178,34,24,.62)';
  }

  /* ------------------------------ 事件绑定 ------------------------------ */
  function bindResultEvents() {
    var again = $('#btnAgain');
    if (again) again.addEventListener('click', function () { $('#capturePanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    var copy = $('#btnCopy');
    if (copy) copy.addEventListener('click', function () { copySummary(); });

    var pr = $('#btnPrint');
    if (pr) pr.addEventListener('click', function () {
      if (window.AndroidBridge && window.AndroidBridge.printPage) { window.AndroidBridge.printPage(); return; }
      window.print();
    });

    var seg = $('#previewSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        state.previewMode = b.dataset.mode;
        $$('button', seg).forEach(function (x) { x.classList.toggle('on', x === b); });
        drawPreview();
      });
    }
  }

  function copySummary() {
    var r = state.result;
    if (!r || !r.ok) return;
    var lines = [];
    lines.push('二维码质量测评报告');
    var m = state.reportMeta || {};
    if (m.sampleName) lines.push('样品：' + m.sampleName);
    if (m.sampleBatch) lines.push('批号：' + m.sampleBatch);
    lines.push('标准：' + r.standardName);
    lines.push('综合等级：' + r.grade.value.toFixed(1) + ' / ' + r.grade.letter + '（' + r.grade.text + '）');
    lines.push('版本：V' + r.decode.version + '　纠错：' + r.decode.ecl + '　掩模：' + r.decode.mask);
    r.metrics.forEach(function (m) {
      lines.push('· ' + m.name + '：' + (m.value === null ? '—' : fmt(m.value, 1)) + m.unit + '　' + (m.grade === null ? 'N/A' : fmt(m.grade, 1) + '/' + letterOf(m.grade)));
    });
    lines.push('纠错：已纠正 ' + r.decode.errorsCorrected + ' / 能力 ' + r.decode.capacity);
    lines.push('内容：' + r.decode.text);
    lines.push('时间：' + (state.reportMeta ? state.reportMeta.time.toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN')));
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('结论已复制'); }, function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('结论已复制'); } catch (e) { toast('复制失败'); }
    ta.remove();
  }

  /* ------------------------------ 历史记录 ------------------------------ */
  var HKEY = 'qrq.history.v1';

  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; }
  }

  function saveHistory(r) {
    if (!r.ok) return;
    var list = readHistory();
    list.unshift({
      t: Date.now(),
      std: r.standard,
      grade: r.grade.value,
      letter: r.grade.letter,
      text: (r.decode.text || '').slice(0, 80),
      version: r.decode.version,
      ecl: r.decode.ecl
    });
    list = list.slice(0, 40);
    try { localStorage.setItem(HKEY, JSON.stringify(list)); } catch (e) { /* 忽略配额错误 */ }
  }

  function renderHistory() {
    var list = readHistory();
    var host = $('#historyList');
    if (!list.length) {
      host.innerHTML = '<div class="hist-empty">暂无记录。完成一次测评后自动保存。</div>';
      return;
    }
    host.innerHTML = list.map(function (h) {
      var c = gradeColor(h.grade);
      return '<div class="hist-item">' +
        '<div class="hist-grade" style="background:' + hexA(c, .1) + ';color:' + c + '">' + h.grade.toFixed(1) + '</div>' +
        '<div class="hist-body"><div class="hist-text">' + esc(h.text || '（空内容）') + '</div>' +
        '<div class="hist-meta">' + new Date(h.t).toLocaleString('zh-CN') + ' · V' + h.version + ' · ' + h.ecl +
        ' · ' + (h.std === '29158' ? '29158' : '15415') + '</div></div>' +
        '<span class="badge ' + gradeClass(h.grade) + '">' + h.letter + '</span>' +
      '</div>';
    }).join('');
  }

  function hexA(color, a) {
    var m = /var\(--g(\d)\)/.exec(color);
    if (!m) return 'rgba(120,130,140,' + a + ')';
    var map = { 4: '18,121,91', 3: '63,122,51', 2: '169,118,26', 1: '194,90,34', 0: '180,35,24' };
    return 'rgba(' + (map[m[1]] || '120,130,140') + ',' + a + ')';
  }

  /* ------------------------------ 示例码 ------------------------------ */
  function buildSample() {
    var mk = window.qrcode;
    if (typeof mk !== 'function') return null;
    var samples = [
      { text: 'https://www.tobacco.gov.cn/qr/6901028075831?batch=20261107', scale: 7, blur: 0, dark: 20 },
      { text: 'https://www.tobacco.gov.cn/qr/6901028075831?batch=20261107', scale: 6, blur: 1.5, dark: 118 },
      { text: '6901028075831|20261107|03|A', scale: 8, blur: 0, dark: 20 }
    ];
    var s = samples[state.sampleIndex % samples.length];
    state.sampleIndex++;

    var qr = mk(0, 'M');
    qr.addData(s.text, 'Byte');
    qr.make();
    var N = qr.getModuleCount();
    var quiet = 4;
    var size = (N + quiet * 2) * s.scale;

    var base = document.createElement('canvas');
    base.width = size; base.height = size;
    var ctx = base.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgb(' + s.dark + ',' + s.dark + ',' + s.dark + ')';
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * s.scale, (r + quiet) * s.scale, s.scale, s.scale);
      }
    }
    if (!s.blur) return base;

    var out = document.createElement('canvas');
    out.width = size; out.height = size;
    var octx = out.getContext('2d');
    octx.filter = 'blur(' + s.blur + 'px)';
    octx.drawImage(base, 0, 0);
    return out;
  }

  /* ------------------------------ 初始化 ------------------------------ */
  function init() {
    bindCam();

    var vMeta = document.querySelector('meta[name="app-version"]');
    if (vMeta && $('#appVer')) $('#appVer').textContent = 'v' + vMeta.getAttribute('content');

    $('#fileCamera').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#fileGallery').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });

    $('#btnCamera').addEventListener('click', function () {
      openCam(function (c) { analyzeCanvas(c); }, 'qr');
    });
    $('#btnGallery').addEventListener('click', function () { $('#fileGallery').click(); });

    // 视图切换
    var tabs = $$('#viewTabs .vtab');
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.toggle('active', x === b); });
        var v = b.dataset.view;
        $('#viewQr').hidden = v !== 'qr';
        $('#viewLabel').hidden = v !== 'label';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    $('#btnSample').addEventListener('click', function () {
      var c = buildSample();
      if (!c) { toast('示例生成失败'); return; }
      analyzeCanvas(c);
    });

    var seg = $('#stdSegment');
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('.seg');
      if (!b) return;
      state.standard = b.dataset.std;
      $$('.seg', seg).forEach(function (x) { x.classList.toggle('active', x === b); });
      $('#optCondition').textContent = state.standard === '29158'
        ? '统计阈值 · 未标定'
        : '自动孔径 · 未标定';
      var note = $('#optNote');
      if (note) note.textContent = state.standard === '29158' ? '直接零件打标' : '印刷 2D 符号';
      if (state.imageCanvas) analyzeCanvas(state.imageCanvas);
    });

    var tgl = $('#btnSampleInfo');
    tgl.addEventListener('click', function () {
      var open = tgl.getAttribute('aria-expanded') === 'true';
      tgl.setAttribute('aria-expanded', String(!open));
      $('#sampleFields').hidden = open;
    });

    // 拖拽 & 粘贴
    var dz = $('#dropZone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    dz.addEventListener('click', function () { $('#fileGallery').click(); });

    window.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          var f = items[i].getAsFile();
          if (f) { handleFile(f); break; }
        }
      }
    });

    // 弹层
    function openSheet(id) {
      var s = $(id);
      s.hidden = false;
      if (id === '#sheetHistory') renderHistory();
    }
    function closeSheet(s) { s.hidden = true; }
    $('#btnHistory').addEventListener('click', function () { openSheet('#sheetHistory'); });
    $('#btnAbout').addEventListener('click', function () { openSheet('#sheetAbout'); });
    $$('.sheet').forEach(function (s) {
      s.addEventListener('click', function (e) {
        if (e.target.hasAttribute('data-close')) closeSheet(s);
      });
    });

    // 演示模式：?demo=1（可加 &std=29158）
    var params = new URLSearchParams(location.search);
    if (params.get('demo')) {
      var demoN = parseInt(params.get('demo'), 10);
      if (demoN > 1) state.sampleIndex = demoN - 1;
      if (params.get('view')) state.previewMode = params.get('view');
      if (params.get('std') === '29158') {
        state.standard = '29158';
        $$('#stdSegment .seg').forEach(function (x) { x.classList.toggle('active', x.dataset.std === '29158'); });
        $('#optCondition').textContent = '统计阈值 · 未标定';
        if ($('#optNote')) $('#optNote').textContent = '直接零件打标';
      }
      setTimeout(function () {
        var c = buildSample();
        if (c) analyzeCanvas(c);
        if (params.get('sheet') === 'about') setTimeout(function () { openSheet('#sheetAbout'); }, 900);
        if (params.get('sheet') === 'history') setTimeout(function () { openSheet('#sheetHistory'); }, 900);
      }, 260);
    }

    // PWA
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存不可用不影响主流程 */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
