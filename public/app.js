const $ = (selector) => document.querySelector(selector);
const form = $('#analysis-form');
const fileInput = $('#file');
let file = null;
let result = null;
let analyzedBody = null;
let previewImage = null;
let currentPreviewUrl = null;
let busy = false;
const fmt = (value, decimals = 1) => value === null || value === undefined ? '—' : new Intl.NumberFormat('tr-TR', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value);
const integer = value => fmt(value, 0);
const unitLabel = unit => unit === 'HU' ? 'HU' : unit === 'estimated-HU' ? 'Yaklaşık HU' : 'Gri ton (0–255)';

function showError(message) { $('#error').textContent = message; $('#error').hidden = false; }
function dirty() {
  if (result) {
    $('#status').textContent = 'Ayarlar değişti. Görünen sonuçlar önceki analize aittir; yeni ölçüm için tekrar analiz edin.';
    $('#status').hidden = false;
    $('#export').disabled = true;
  }
}
function toggleManual() {
  const enabled = $('#manual').checked;
  for (const key of ['centerX', 'centerY', 'radius']) {
    form.elements[key].disabled = !enabled;
    form.elements[key].required = enabled;
  }
  $('#canvas-hint').hidden = !enabled;
  dirty();
  drawPreview();
}
$('#manual').addEventListener('change', toggleManual);
$('#estimate').addEventListener('change', () => {
  for (const key of ['windowMin', 'windowMax']) {
    form.elements[key].disabled = !$('#estimate').checked;
    form.elements[key].required = $('#estimate').checked;
  }
  dirty();
});
form.addEventListener('input', event => { if (event.target !== fileInput) { dirty(); drawPreview(); } });
function chooseFile(selected) {
  if (!selected) return;
  $('#error').hidden = true;
  if (selected.size > 20 * 1024 * 1024) { showError('Dosya 20 MB sınırını aşıyor.'); fileInput.value = ''; return; }
  file = selected; result = null; analyzedBody = null;
  $('#file-label').textContent = selected.name;
  $('#image-title').textContent = selected.name;
  $('#image-badge').textContent = 'ANALİZE HAZIR';
  $('#results').hidden = true; $('#intro').hidden = false; $('#status').hidden = true;
  if (currentPreviewUrl) { URL.revokeObjectURL(currentPreviewUrl); currentPreviewUrl = null; }
  previewImage = null;
  $('#image-canvas').hidden = true; $('#empty').hidden = false;
  if (/\.(png|jpe?g)$/i.test(selected.name) || /image\/(png|jpeg)/.test(selected.type)) {
    currentPreviewUrl = URL.createObjectURL(selected);
    loadPreview(currentPreviewUrl);
  }
}
fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
for (const name of ['dragenter', 'dragover']) $('#dropzone').addEventListener(name, event => {
  event.preventDefault(); if (!busy) $('#dropzone').classList.add('drag');
});
for (const name of ['dragleave', 'drop']) $('#dropzone').addEventListener(name, event => {
  event.preventDefault(); $('#dropzone').classList.remove('drag');
  if (name === 'drop' && !busy) {
    const files = event.dataTransfer.files;
    if (files.length !== 1) { showError('Bir seferde tek bir kesit yükleyin.'); return; }
    fileInput.files = files;
    chooseFile(files[0]);
  }
});
function loadPreview(url) {
  const image = new Image();
  image.onload = () => {
    if (url !== currentPreviewUrl && url !== result?.preview) return;
    previewImage = image;
    $('#image-canvas').hidden = false; $('#empty').hidden = true;
    $('#dimensions').textContent = `${image.width} × ${image.height} px`;
    drawPreview();
  };
  image.src = url;
}
function drawPreview() {
  if (!previewImage) return;
  const canvas = $('#image-canvas');
  canvas.width = previewImage.width; canvas.height = previewImage.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(previewImage, 0, 0);
  const manual = $('#manual').checked;
  const roi = manual ? { x: Number(form.elements.centerX.value), y: Number(form.elements.centerY.value), radius: Number(form.elements.radius.value) } : result?.roi;
  if (!roi || !roi.radius) return;
  const inset = form.elements.insetPixels.value !== '' ? Number(form.elements.insetPixels.value) : result?.roi.insetPixels ?? 10;
  ctx.lineWidth = Math.max(1, canvas.width / 350);
  ctx.strokeStyle = '#ffb454'; ctx.setLineDash([canvas.width / 70, canvas.width / 100]);
  ctx.beginPath(); ctx.arc(roi.x, roi.y, roi.radius, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle = '#50fa90';
  if (roi.radius > inset) { ctx.beginPath(); ctx.arc(roi.x, roi.y, roi.radius - inset, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#50fa90'; ctx.fillRect(roi.x - 1, roi.y - 4, 2, 8); ctx.fillRect(roi.x - 4, roi.y - 1, 8, 2);
}
$('#image-canvas').addEventListener('click', event => {
  if (!$('#manual').checked || busy) return;
  const canvas = event.currentTarget, rect = canvas.getBoundingClientRect();
  form.elements.centerX.value = ((event.clientX - rect.left) / rect.width * canvas.width).toFixed(1);
  form.elements.centerY.value = ((event.clientY - rect.top) / rect.height * canvas.height).toFixed(1);
  dirty(); drawPreview();
});
function requestBody() {
  const body = new FormData(form);
  body.set('file', file);
  return body;
}
function setBusy(value) {
  busy = value;
  $('#analyze').disabled = value;
  $('#export').disabled = value;
  fileInput.disabled = value;
  $('#analyze span:first-child').textContent = value ? 'Kesit inceleniyor…' : 'Kesiti analiz et';
  form.setAttribute('aria-busy', String(value));
  // Preserve the current field disabled state while a request is in progress.
  for (const input of form.querySelectorAll('input:not([type=file])')) {
    if (value) { input.dataset.wasDisabled = String(input.disabled); input.disabled = true; }
    else input.disabled = input.dataset.wasDisabled === 'true';
  }
}
async function readError(response) {
  const json = await response.json().catch(() => null);
  return typeof json?.message === 'string' ? json.message : 'İşlem tamamlanamadı. Dosyayı ve ölçüm ayarlarını kontrol edin.';
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!file) { showError('Önce bir kesit dosyası seçin.'); return; }
  const body = requestBody();
  setBusy(true); $('#error').hidden = true; $('#status').hidden = false; $('#status').textContent = 'Görüntü okunuyor, ölçüm alanı ve dağılım hesaplanıyor…';
  try {
    const response = await fetch('/api/analyze', { method: 'POST', body });
    if (!response.ok) throw new Error(await readError(response));
    result = await response.json(); analyzedBody = body;
    renderResults();
    $('#status').hidden = true;
  } catch (error) {
    showError(error.message); $('#status').hidden = true;
    if (result) { $('#status').textContent = 'Analiz başarısız oldu. Önceki sonuçlar gösteriliyor.'; $('#status').hidden = false; }
  } finally {
    setBusy(false);
    if (!analyzedBody || !$('#error').hidden) $('#export').disabled = true;
  }
});
function renderResults() {
  $('#results').hidden = false; $('#intro').hidden = true;
  $('#image-badge').textContent = unitLabel(result.unit);
  $('#image-title').textContent = result.filename;
  for (const [name, value] of Object.entries({ centerX: result.roi.x, centerY: result.roi.y, radius: result.roi.radius })) form.elements[name].value = value.toFixed(3);
  loadPreview(result.preview);
  const m = result.measurements[0];
  $('#metric-mean').textContent = fmt(m.mean);
  $('#metric-std').textContent = fmt(m.std);
  $('#metric-area').textContent = fmt(m.area);
  $('#metric-count').textContent = integer(m.count);
  $('#metric-unit').textContent = unitLabel(result.unit);
  $('#area-unit').textContent = result.spacing ? 'mm²' : 'Piksel boyutu gerekli';
  $('#table-unit').textContent = unitLabel(result.unit);
  $('#warnings').replaceChildren(...result.warnings.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
  $('#measurements').replaceChildren(...result.measurements.map(m => {
    const row = document.createElement('tr');
    for (const value of [m.label, integer(m.count), fmt(m.area), ...['mean','std','median','min','max','p5','p95'].map(key => fmt(m[key]))]) {
      const td = document.createElement('td'); td.textContent = value; row.append(td);
    }
    return row;
  }));
  $('#regions').replaceChildren(...result.regions.map(r => {
    const div = document.createElement('div'); div.className = 'region-row';
    const label = document.createElement('span'), value = document.createElement('b');
    label.textContent = r.label; value.textContent = fmt(r.mean); div.append(label, value); return div;
  }));
  const info = { ...result.metadata, 'Matris': `${result.width} × ${result.height}`, 'Piksel boyutu (X × Y)': result.spacing ? `${fmt(result.spacing[0], 4)} × ${fmt(result.spacing[1], 4)} mm` : 'Belirtilmedi', 'Ölçüm birimi': unitLabel(result.unit), 'Kenar payı': `${fmt(result.roi.insetPixels, 2)} px`, 'Seçim': result.roi.automatic ? 'Otomatik öneri' : 'Elle belirlenmiş' };
  $('#metadata').replaceChildren(...Object.entries(info).flatMap(([key, value]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; return [dt, dd];
  }));
  drawHistogram();
}
function drawHistogram() {
  if (!result) return;
  const canvas = $('#histogram'), ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = 200;
  canvas.width = w * ratio; canvas.height = h * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const left = 38, right = 12, top = 15, bottom = 30;
  const max = Math.max(...result.histogram.map(b => b.count), 1);
  ctx.font = '9px system-ui'; ctx.fillStyle = '#94a08a';
  for (let i = 0; i <= 4; i++) {
    const y = top + (h - top - bottom) * i / 4;
    ctx.strokeStyle = '#e8eee0'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(integer(max * (1 - i / 4)), left - 6, y + 3);
  }
  const bw = (w - left - right) / result.histogram.length;
  for (const [i, bin] of result.histogram.entries()) {
    const bh = bin.count / max * (h - top - bottom);
    ctx.fillStyle = '#789763'; ctx.fillRect(left + i * bw, h - bottom - bh, Math.max(.5, bw - 1), bh);
  }
  ctx.fillStyle = '#94a08a'; ctx.textAlign = 'left'; ctx.fillText(integer(result.histogram[0].lower), left, h - 10);
  ctx.textAlign = 'right'; ctx.fillText(integer(result.histogram.at(-1).upper), w - right, h - 10);
}
$('#histogram').addEventListener('mousemove', event => {
  if (!result) return;
  const canvas = event.currentTarget, x = event.clientX - canvas.getBoundingClientRect().left;
  const index = Math.floor((x - 38) / (canvas.clientWidth - 50) * result.histogram.length);
  const bin = result.histogram[index];
  $('#histogram-detail').textContent = bin ? `${fmt(bin.lower, 0)} … ${fmt(bin.upper, 0)} · ${integer(bin.count)} piksel · %${fmt(bin.percent, 2)}` : '—';
});
window.addEventListener('resize', drawHistogram);
$('#export').addEventListener('click', async () => {
  if (!analyzedBody || busy) return;
  setBusy(true); $('#export').textContent = 'Rapor hazırlanıyor…';
  try {
    const response = await fetch('/api/export', { method: 'POST', body: analyzedBody });
    if (!response.ok) throw new Error(await readError(response));
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = 'HUReader-rapor.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { showError(error.message); }
  finally { setBusy(false); $('#export').textContent = '↓ Excel raporunu indir'; }
});
