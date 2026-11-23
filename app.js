/* YAMA VISION COUNTER AI VIP PRO - app.js */
(() => {
  'use strict';

  // ---------- Tìm phần tử (nhiều ID dự phòng) ----------
  const pick = (...ids) => {
    for (const id of ids) {
      const e = document.getElementById(id);
      if (e) return e;
    }
    return null;
  };

  const video = pick('video', 'camera', 'webcam');
  const canvas = pick('canvas', 'overlay', 'output');
  const ctx = canvas.getContext('2d');
  const statusEl = pick('status');
  const totalEl = pick('count', 'counter', 'total');
  const listEl = pick('list', 'stats', 'results', 'classList');
  const btnStart = pick('btnStart', 'startBtn', 'start');
  const btnStop = pick('btnStop', 'stopBtn', 'stop');
  const btnSwitch = pick('btnSwitch', 'switchBtn', 'switchCamera', 'switch');
  const btnReset = pick('btnReset', 'resetBtn', 'reset');
  const btnExport = pick('btnExport', 'exportBtn', 'export', 'csvBtn');
  const fileInput = pick('upload', 'fileInput', 'imageUpload', 'file');
  const confInput = pick('confidence', 'conf', 'threshold');

  // ---------- Trạng thái ----------
  let model = null;
  let stream = null;
  let facing = 'environment';
  let running = false;
  let lastRun = 0;
  const INTERVAL = 100; // ms giữa 2 lần nhận diện
  let minScore = 0.5;
  const maxSeen = {};   // số lượng tối đa mỗi loại
  const log = [];       // nhật ký cho CSV

  const VI = {
    person: 'Người', bicycle: 'Xe đạp', car: 'Ô tô', motorcycle: 'Xe máy',
    bus: 'Xe buýt', truck: 'Xe tải', bottle: 'Chai', cup: 'Cốc',
    chair: 'Ghế', couch: 'Sofa', 'cell phone': 'Điện thoại',
    laptop: 'Laptop', book: 'Sách', dog: 'Chó', cat: 'Mèo',
    bird: 'Chim', backpack: 'Ba lô', handbag: 'Túi xách',
    tv: 'TV', keyboard: 'Bàn phím', mouse: 'Chuột', clock: 'Đồng hồ'
  };
  const COLORS = ['#00f0ff', '#ff2bd6', '#ffe600', '#39ff14', '#ff8a00', '#9b5cff'];
  const colorOf = (name) => {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  };

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

  // ---------- Tải thư viện nếu index.html chưa có ----------
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  async function loadModel() {
    try {
      setStatus('⏳ ĐANG TẢI MÔ HÌNH AI...');
      if (!window.tf) {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
      }
      if (!window.cocoSsd) {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
      }
      model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      setStatus('✅ AI SẴN SÀNG - NHẤN BẮT ĐẦU');
    } catch (e) {
      console.error(e);
      setStatus('❌ LỖI TẢI AI - KIỂM TRA MẠNG');
    }
  }

  // ---------- Camera ----------
  async function startCamera() {
    if (!model) { setStatus('⏳ AI CHƯA TẢI XONG...'); return; }
    stopCamera(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      video.setAttribute('playsinline', '');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      running = true;
      setStatus('🟢 ĐANG QUÉT - ' + (facing === 'user' ? 'CAMERA TRƯỚC' : 'CAMERA SAU'));
      requestAnimationFrame(loop);
    } catch (e) {
      console.error(e);
      setStatus('❌ KHÔNG MỞ ĐƯỢC CAMERA (CẦN HTTPS + CẤP QUYỀN)');
    }
  }

  function stopCamera(silent) {
    running = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
    if (!silent) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setStatus('⏹ ĐÃ DỪNG');
    }
  }

  async function switchCamera() {
    facing = facing === 'environment' ? 'user' : 'environment';
    if (running) await startCamera();
    else setStatus('🔄 ĐÃ CHỌN ' + (facing === 'user' ? 'CAMERA TRƯỚC' : 'CAMERA SAU'));
  }

  // ---------- Vòng lặp nhận diện ----------
  async function loop(ts) {
    if (!running) return;
    if (ts - lastRun >= INTERVAL && video.readyState >= 2) {
      lastRun = ts;
      try {
        const preds = await model.detect(video);
        render(preds, false);
      } catch (e) { console.error(e); }
    }
    requestAnimationFrame(loop);
  }

  // ---------- Vẽ + đếm ----------
  function render(preds, isImage, img) {
    if (isImage && img) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const counts = {};
    const lw = Math.max(2, canvas.width / 320);
    const fs = Math.max(14, Math.round(canvas.width / 38));
    ctx.lineWidth = lw;
    ctx.font = `700 ${fs}px Orbitron, sans-serif`;
    ctx.textBaseline = 'top';

    preds.filter((p) => p.score >= minScore).forEach((p) => {
      const [x, y, w, h] = p.bbox;
      const name = VI[p.class] || p.class;
      const col = colorOf(p.class);
      counts[name] = (counts[name] || 0) + 1;

      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;

      const label = `${name} ${Math.round(p.score * 100)}%`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = col;
      ctx.fillRect(x, Math.max(0, y - fs - 6), tw, fs + 6);
      ctx.fillStyle = '#000';
      ctx.fillText(label, x + 5, Math.max(0, y - fs - 3));
    });

    updatePanel(counts);
  }

  function updatePanel(counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalEl) totalEl.textContent = total;

    for (const [k, v] of Object.entries(counts)) {
      if (!maxSeen[k] || v > maxSeen[k]) maxSeen[k] = v;
    }
    if (total > 0) {
      log.push({ time: new Date().toLocaleString('vi-VN'), total, ...counts });
      if (log.length > 5000) log.shift();
    }

    if (listEl) {
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      listEl.innerHTML = rows.length
        ? rows.map(([k, v]) =>
            `<div class="stat"><span>${v}</span>${k} <small>(max ${maxSeen[k]})</small></div>`
          ).join('')
        : '<div class="stat"><span>0</span>Chưa phát hiện</div>';
    }
  }

  // ---------- Phân tích ảnh tải lên ----------
  async function analyzeImage(file) {
    if (!file) return;
    if (!model) { setStatus('⏳ AI CHƯA TẢI XONG...'); return; }
    stopCamera(true);
    setStatus('🖼 ĐANG PHÂN TÍCH ẢNH...');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const preds = await model.detect(img);
      render(preds, true, img);
      setStatus(`✅ XONG - ${preds.filter(p => p.score >= minScore).length} ĐỐI TƯỢNG`);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => setStatus('❌ ẢNH LỖI');
    img.src = url;
  }

  // ---------- Xuất CSV ----------
  function exportCSV() {
    const classes = Object.keys(maxSeen);
    const lines = [];
    lines.push('YAMA VISION COUNTER AI - THONG KE');
    lines.push('Thoi gian xuat,' + new Date().toLocaleString('vi-VN'));
    lines.push('');
    lines.push('Loai doi tuong,So luong toi da');
    classes.forEach((k) => lines.push(`"${k}",${maxSeen[k]}`));
    lines.push('');
    lines.push(['Thoi gian', 'Tong', ...classes].map((s) => `"${s}"`).join(','));
    // lấy mẫu để file gọn
    const step = Math.max(1, Math.floor(log.length / 500));
    log.filter((_, i) => i % step === 0).forEach((r) => {
      lines.push([`"${r.time}"`, r.total, ...classes.map((k) => r[k] || 0)].join(','));
    });

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yama-vision-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus('📄 ĐÃ XUẤT CSV');
  }

  function resetAll() {
    Object.keys(maxSeen).forEach((k) => delete maxSeen[k]);
    log.length = 0;
    if (totalEl) totalEl.textContent = '0';
    if (listEl) listEl.innerHTML = '';
    if (!running) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setStatus('♻ ĐÃ RESET');
  }

  // ---------- Gắn sự kiện ----------
  if (btnStart) btnStart.addEventListener('click', startCamera);
  if (btnStop) btnStop.addEventListener('click', () => stopCamera(false));
  if (btnSwitch) btnSwitch.addEventListener('click', switchCamera);
  if (btnReset) btnReset.addEventListener('click', resetAll);
  if (btnExport) btnExport.addEventListener('click', exportCSV);
  if (fileInput) fileInput.addEventListener('change', (e) => analyzeImage(e.target.files[0]));
  if (confInput) {
    confInput.addEventListener('input', () => {
      const v = parseFloat(confInput.value);
      minScore = v > 1 ? v / 100 : v;
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) stopCamera(false);
  });

  loadModel();
})();
