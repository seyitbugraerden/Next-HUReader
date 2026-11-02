const $ = (selector) => document.querySelector(selector);
const form = $('#analysis-form');
const fileInput = $('#file');
const folderInput = $('#folder');
let importing = false;
let file = null;
let result = null;
let analyzedBody = null;
let previewImage = null;
let candidateOverlay = null;
let selectionDrag = null;
let suppressCanvasClickUntil = 0;
let previewRevision = 0;
let currentPreviewUrl = null;
let busy = false;
let currentStep = 1;
let resultDirty = true;
let entries = [];
let activeId = null;
const optionNames = [
  'roiShape',
  'roiPoints',
  'lowDensityThreshold',
  'centerX',
  'centerY',
  'radius',
  'insetPixels',
  'spacingX',
  'spacingY',
  'windowMin',
  'windowMax',
];
const entryLabel = (entry) => entry.relativePath || entry.file.name;
const activeEntry = () => entries.find((entry) => entry.id === activeId);
const readyEntries = () =>
  entries.filter((entry) => entry.result && !entry.dirty);
function captureSettings() {
  return {
    manual: $('#manual').checked,
    estimate: $('#estimate').checked,
    values: Object.fromEntries(
      optionNames.map((key) => [key, form.elements[key].value]),
    ),
  };
}
function saveCurrent() {
  const entry = activeEntry();
  if (entry)
    Object.assign(entry, {
      result,
      dirty: resultDirty,
      body: analyzedBody,
      settings: captureSettings(),
    });
}
function applySettings(settings) {
  $('#manual').checked = settings.manual;
  $('#estimate').checked = settings.estimate;
  for (const key of optionNames)
    form.elements[key].value = settings.values[key] ?? '';
  form.elements.roiShape.value = settings.values.roiShape || 'circle';
  for (const key of ['centerX', 'centerY', 'radius']) {
    form.elements[key].disabled = !settings.manual;
    form.elements[key].required = settings.manual;
  }
  for (const key of ['windowMin', 'windowMax']) {
    form.elements[key].disabled = !settings.estimate;
    form.elements[key].required = settings.estimate;
  }
  $('#canvas-hint').hidden = !settings.manual;
  syncShapeControls();
}
function entryStatus(entry) {
  return entry.processing
    ? 'İşleniyor'
    : entry.needsArea
      ? 'Alan seçimi bekliyor'
      : entry.error
        ? 'Hata'
        : entry.result && !entry.dirty
          ? 'Hesaplandı'
          : entry.result
            ? 'Yeniden hesaplanmalı'
            : 'Bekliyor';
}
function renderQueue() {
  $('#queue-card').hidden = !entries.length;
  $('#queue-count').textContent = `${entries.length} dosya`;
  $('#upload-guidance').textContent = entries.length
    ? 'Dosyalar seçildi. Her dosya için ölçüm ayarlarıyla devam edebilirsiniz.'
    : 'Devam etmek için bir görüntü seçin.';
  $('#file-info').hidden = !entries.length;
  $('#file-type').textContent = `${entries.length} DOSYA`;
  $('#file-size').textContent =
    `${fmt(entries.reduce((total, e) => total + e.file.size, 0) / 1024 / 1024, 2)} MB`;
  $('#file-label').textContent = entries.length
    ? `${entries.length} dosya seçildi · Daha fazla ekleyin`
    : 'Görüntüleri sürükleyip bırakın';
  $('#file-queue').replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement('article');
      row.className = 'queue-row queue-preview-card';
      row.classList.toggle('is-active', entry.id === activeId);
      const preview = document.createElement('div');
      preview.className = 'queue-preview';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'queue-preview-select';
      select.disabled = busy || importing;
      select.setAttribute(
        'aria-label',
        `${entryLabel(entry)} görselini seç`,
      );
      select.addEventListener('click', () => selectEntry(entry.id));
      if (entry.thumbnailUrl) {
        const image = document.createElement('img');
        image.className = 'queue-preview-image';
        image.src = entry.thumbnailUrl;
        image.alt = '';
        image.loading = 'lazy';
        select.append(image);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = `queue-preview-placeholder${entry.thumbnailError ? ' has-error' : ''}`;
        placeholder.textContent = entry.thumbnailError
          ? 'Önizleme açılamadı'
          : 'Önizleme hazırlanıyor';
        select.append(placeholder);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'queue-preview-remove';
      remove.disabled = busy || importing;
      remove.setAttribute(
        'aria-label',
        `${entryLabel(entry)} dosyasını kaldır`,
      );
      remove.title = 'Görseli kaldır';
      remove.innerHTML =
        '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>';
      remove.addEventListener('click', () => removeEntry(entry.id));
      preview.append(remove, select);
      if (entry.thumbnailErrorMessage)
        select.title = entry.thumbnailErrorMessage;
      const name = document.createElement('span');
      name.className = 'queue-name';
      name.textContent = entryLabel(entry);
      const status = document.createElement('span');
      status.className = `queue-state ${entry.error && !entry.needsArea ? 'has-error' : entry.result && !entry.dirty ? 'is-ready' : ''}`;
      status.textContent = entryStatus(entry);
      status.title = entry.error || '';
      row.append(preview, name, status);
      return row;
    }),
  );
  for (const [id, list] of [
    ['#active-file', entries],
    ['#report-active-file', readyEntries()],
  ]) {
    const select = $(id);
    select.replaceChildren(
      ...list.map((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = `${entries.indexOf(entry) + 1}. ${entryLabel(entry)} — ${entryStatus(entry)}`;
        return option;
      }),
    );
    select.value = activeId;
    select.disabled = busy || !list.length;
  }
  const ready = readyEntries().length,
    errors = entries.filter((e) => e.error && !e.needsArea).length,
    review = entries.filter((e) => e.needsArea).length;
  $('#batch-counts').textContent =
    `${ready}/${entries.length} hesaplandı${errors ? ` · ${errors} hata` : ''}${review ? ` · ${review} alan seçimi bekliyor` : ''}`;
  $('#batch-report-note').textContent =
    `${ready} dosyanın güncel ölçümleri rapora dahil edilir. ${entries.length - ready} dosya hatalı, bekliyor veya yeniden hesaplanmalı. Her ölçüm alanını ilgili dosyada kontrol edin.`;
  const compared = readyEntries().map((entry) => entry.result);
  const comparable =
    compared.length > 1 && compared.every((r) => r.unit === compared[0].unit);
  $('#comparison-summary').textContent = comparable
    ? `${compared.length} güncel dosyada seçili alan ortalamaları ${fmt(Math.min(...compared.map((r) => r.measurements[0].mean)))}–${fmt(Math.max(...compared.map((r) => r.measurements[0].mean)))} ${unitLabel(compared[0].unit)} arasında. Bu sayısal aralık bir değişim veya kusur kararı değildir; aynı numune, kalibrasyon ve karşılaştırılabilir ölçüm alanları kullanıldığını doğrulayın.`
    : compared.length > 1
      ? 'Ölçüm birimleri farklı; dosyalar için ortak yoğunluk karşılaştırması yapılmadı.'
      : '';
  $('#batch-measurements').replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement('tr'),
        valid = entry.result && !entry.dirty,
        m = valid ? entry.result.measurements[0] : null;
      for (const value of [
        entryLabel(entry),
        entryStatus(entry),
        valid ? unitLabel(entry.result.unit) : '—',
        fmt(m?.mean),
        fmt(m?.std),
        m ? integer(m.count) : '—',
      ]) {
        const td = document.createElement('td');
        td.textContent = value;
        row.append(td);
      }
      row.title = entry.error || '';
      return row;
    }),
  );
}
function selectEntry(id, save = true) {
  selectionDrag = null;
  suppressCanvasClickUntil = 0;
  if (save) saveCurrent();
  activeId = id;
  const entry = activeEntry();
  file = entry?.file ?? null;
  result = entry?.result ?? null;
  resultDirty = entry?.dirty ?? true;
  analyzedBody = entry?.body ?? null;
  applySettings(
    entry?.settings ?? { manual: false, estimate: false, values: {} },
  );
  $('#error').hidden = true;
  $('#status').hidden = true;
  if (entry?.error) showError(entry.error);
  else if (entry?.result && entry.dirty) {
    $('#status').hidden = false;
    $('#status').textContent =
      'Bu dosyanın ayarları değişti. Güncel sonuçlar için yeniden hesaplayın.';
  }
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }
  previewRevision++;
  previewImage = null;
  candidateOverlay = null;
  $('#image-canvas').hidden = true;
  $('#empty').hidden = false;
  $('#preview-heading').textContent = 'Analiz için bir görüntü yükleyin';
  $('#preview-message').textContent =
    'Dosyanızı yüklediğinizde kesit burada görünür. Numune sınırını kontrol ederek ölçüme başlayın.';
  $('#dimensions').textContent = '— × — px';
  $('#image-title').textContent = entry
    ? entryLabel(entry)
    : 'Görüntü önizlemesi';
  $('#selected-file-name').textContent = entry ? entryLabel(entry) : '—';
  $('#report-file-name').textContent = entry ? entryLabel(entry) : '—';
  $('#image-badge').textContent = result
    ? unitLabel(result.unit)
    : file
      ? 'Analize hazır'
      : 'Görüntü bekleniyor';
  $('#results').hidden = !result;
  if (result) {
    renderResults(false);
  } else if (entry?.preview) {
    $('#image-badge').textContent = unitLabel(entry.preview.unit);
    loadPreview(entry.preview.preview);
  } else if (
    file &&
    (/\.(png|jpe?g)$/i.test(file.name) || /image\/(png|jpeg)/.test(file.type))
  ) {
    currentPreviewUrl = URL.createObjectURL(file);
    loadPreview(currentPreviewUrl);
  } else if (entry) {
    loadDicomPreview(entry);
  }
  syncWorkflow();
}
function removeEntry(id) {
  if (busy || importing) return;
  $('#batch-progress').hidden = true;
  saveCurrent();
  const removed = entries.find((entry) => entry.id === id);
  if (removed) {
    removed.thumbnailController?.abort();
    if (removed.thumbnailUrl?.startsWith('blob:'))
      URL.revokeObjectURL(removed.thumbnailUrl);
  }
  entries = entries.filter((entry) => entry.id !== id);
  if (activeId === id)
    selectEntry(
      (currentStep === 3 ? readyEntries()[0]?.id : null) ??
        entries[0]?.id ??
        null,
      false,
    );
  if (currentStep === 3 && !readyEntries().length)
    currentStep = entries.length ? 2 : 1;
  if (!entries.length) currentStep = 1;
  syncWorkflow();
}
function clearEntries() {
  if (busy || importing || !entries.length) return;
  for (const entry of entries) {
    entry.thumbnailController?.abort();
    if (entry.thumbnailUrl?.startsWith('blob:'))
      URL.revokeObjectURL(entry.thumbnailUrl);
  }
  entries = [];
  currentStep = 1;
  $('#batch-progress').hidden = true;
  $('#import-summary').hidden = true;
  $('#import-summary').textContent = '';
  selectEntry(null, false);
}
$('#clear-files').addEventListener('click', clearEntries);
$('#remove-active-file').addEventListener('click', () => {
  if (activeId) removeEntry(activeId);
});
$('#active-file').addEventListener('change', (event) =>
  selectEntry(event.target.value),
);
$('#report-active-file').addEventListener('change', (event) =>
  selectEntry(event.target.value),
);
const fmt = (value, decimals = 1) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('tr-TR', {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      }).format(value);
const integer = (value) => fmt(value, 0);
const unitLabel = (unit) =>
  unit === 'HU'
    ? 'HU'
    : unit === 'estimated-HU'
      ? 'Yaklaşık HU'
      : 'Gri ton (0–255)';

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = false;
}
function syncWorkflow() {
  saveCurrent();
  $('#draw-area').hidden = currentStep !== 2 || !activeEntry()?.needsArea;
  $('#draw-area').disabled = busy || importing;
  const hasReady = readyEntries().length > 0;
  ['upload', 'analyze', 'report'].forEach((name, index) => {
    const step = index + 1;
    const tab = $(`#step-${name}`);
    const allowed =
      step === 1 || (step === 2 && entries.length) || (step === 3 && hasReady);
    tab.disabled = busy || importing || !allowed;
    tab.classList.toggle('active', currentStep === step);
    tab.classList.toggle(
      'complete',
      step === 1
        ? !!file && currentStep > 1
        : step === 2 && !!result && !resultDirty && currentStep === 3,
    );
    tab.setAttribute('aria-selected', String(currentStep === step));
    tab.tabIndex = currentStep === step ? 0 : -1;
    $(`#panel-${name}`).hidden = currentStep !== step;
  });
  $('#go-analyze').disabled = busy || importing || !entries.length;
  fileInput.disabled = busy || importing;
  folderInput.disabled =
    busy || importing || !('webkitdirectory' in folderInput);
  $('#choose-folder').setAttribute(
    'aria-disabled',
    String(folderInput.disabled),
  );
  $('#go-report').disabled = busy || !hasReady;
  $('#analyze-all').disabled = busy || !entries.length;
  $('#remove-active-file').disabled = busy || importing || !activeEntry();
  $('#export-batch').disabled = busy || !hasReady;
  $('#export').disabled = busy || !result || resultDirty;
  $('#review-ready').hidden = !result || resultDirty;
  for (const button of document.querySelectorAll('[data-step]'))
    button.disabled = busy;
  renderQueue();
}
function setWorkflow(step, focus = false) {
  if (
    busy ||
    importing ||
    (step === 2 && !entries.length) ||
    (step === 3 && !readyEntries().length)
  )
    return;
  if (step === 3 && (!result || resultDirty)) selectEntry(readyEntries()[0].id);
  currentStep = step;
  syncWorkflow();
  if (step === 3) requestAnimationFrame(drawHistogram);
  if (focus) {
    $(`#panel-${['upload', 'analyze', 'report'][step - 1]}`).focus({
      preventScroll: true,
    });
    if ($('.wizard-navigation').getBoundingClientRect().top < 0)
      $('.wizard-navigation').scrollIntoView({ block: 'start' });
  }
}
['upload', 'analyze', 'report'].forEach((name, index) => {
  $(`#step-${name}`).addEventListener('click', () =>
    setWorkflow(index + 1, true),
  );
});
$('.workflow').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('.workflow [role=tab]')].filter(
    (tab) => !tab.disabled,
  );
  if (!tabs.length) return;
  event.preventDefault();
  let index = tabs.indexOf(document.activeElement);
  if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.length - 1;
  else
    index =
      (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
      tabs.length;
  tabs[index].click();
  tabs[index].focus();
});
$('#go-analyze').addEventListener('click', () => setWorkflow(2, true));
$('#go-report').addEventListener('click', () => setWorkflow(3, true));
for (const button of document.querySelectorAll('[data-step]'))
  button.addEventListener('click', () =>
    setWorkflow(Number(button.dataset.step), true),
  );
function dirty() {
  resultDirty = true;
  $('#batch-progress').hidden = true;
  if (activeEntry()) {
    activeEntry().error = null;
    activeEntry().needsArea = false;
  }
  syncWorkflow();
  if (result) {
    $('#status').textContent =
      'Bu dosyanın ayarları değişti. Güncel rapora dahil etmek için yeniden hesaplayın.';
    $('#status').hidden = false;
    $('#export').disabled = true;
  }
}
function toggleManual() {
  if (
    $('#manual').checked &&
    result?.roi.outlines &&
    form.elements.roiShape.value === 'circle'
  ) {
    form.elements.roiShape.value = 'polygon';
    form.elements.roiPoints.value = '';
    syncShapeControls();
    dirty();
    drawPreview();
    return;
  }
  const enabled =
    $('#manual').checked && form.elements.roiShape.value === 'circle';
  if (enabled) {
    $('#advanced-settings').open = true;
    initializeManualCircle();
  }
  for (const key of ['centerX', 'centerY', 'radius']) {
    form.elements[key].disabled = !enabled;
    form.elements[key].required = enabled;
  }
  $('#canvas-hint').hidden = !enabled;
  syncShapeControls();
  dirty();
  drawPreview();
}
$('#manual').addEventListener('change', toggleManual);
$('#draw-area').addEventListener('click', () => {
  if (busy || !file) return;
  form.elements.roiShape.value = 'polygon';
  form.elements.roiPoints.value = '';
  syncShapeControls();
  dirty();
  $('#error').hidden = true;
  drawPreview();
  $('#preview-panel').scrollIntoView({ block: 'center' });
});

$('#show-candidates').addEventListener('change', drawPreview);
function selectedPoints() {
  try {
    return JSON.parse(form.elements.roiPoints.value || '[]');
  } catch {
    return [];
  }
}
function syncShapeControls() {
  const shape = form.elements.roiShape.value;
  const circular = shape === 'circle';
  $('#circle-fields').hidden = !circular;
  $('#polygon-tools').hidden = circular;
  $('#manual').disabled = !circular;
  if (!circular) $('#manual').checked = true;
  form.elements.roiPoints.disabled = circular;
  for (const key of ['centerX', 'centerY', 'radius']) {
    form.elements[key].disabled = !circular || !$('#manual').checked;
    form.elements[key].required = circular && $('#manual').checked;
  }
  $('#canvas-hint').hidden = !circular || !$('#manual').checked;
  $('#selection-guide').textContent = circular
    ? $('#manual').checked
      ? 'Merkezden dışarı sürükleyerek daire çizin.'
      : 'Basılı tutup sürükleyin; seçtiğiniz alan turuncu olarak görünür.'
    : shape === 'rectangle'
      ? 'Basılı tutup sürükleyerek dikdörtgen çizin veya iki köşeye tıklayın.'
      : 'Basılı tutup sınırı çizin veya köşelere tıklayın. Seçili alan turuncu görünür.';
  $('#roi-guidance').textContent =
    (shape === 'rectangle'
      ? 'Dikdörtgeni sürükleyerek çizin veya iki karşı köşeye tıklayın.'
      : 'Sınırı basılı tutup çizin veya köşelere sırayla tıklayın. Son köşe ilkine otomatik bağlanır.') +
    ` ${selectedPoints().length} köşe seçildi. Yeşil iç sınır hesaplamadan sonra gösterilir.`;
}
form.elements.roiShape.addEventListener('change', () => {
  if (busy) return;
  form.elements.roiPoints.value = '';
  syncShapeControls();
  dirty();
  drawPreview();
});
for (const [id, clear] of [
  ['undo-point', false],
  ['clear-points', true],
]) {
  $('#' + id).addEventListener('click', () => {
    if (busy) return;
    const points = selectedPoints();
    points.pop();
    form.elements.roiPoints.value = JSON.stringify(clear ? [] : points);
    syncShapeControls();
    dirty();
    drawPreview();
  });
}

$('#estimate').addEventListener('change', () => {
  for (const key of ['windowMin', 'windowMax']) {
    form.elements[key].disabled = !$('#estimate').checked;
    form.elements[key].required = $('#estimate').checked;
  }
  dirty();
});
form.addEventListener('input', (event) => {
  if (event.target.matches('input:not([type=file]):not([data-view-only])')) {
    dirty();
    drawPreview();
  }
});
async function supportedFile(file) {
  if (
    /\.(png|jpe?g|dcm|dicom|ima)$/i.test(file.name) ||
    ['image/png', 'image/jpeg', 'application/dicom'].includes(file.type)
  )
    return true;
  // Many scanner exports have no extension, or a numeric extension.
  const bytes = new Uint8Array(await file.slice(0, 132).arrayBuffer());
  return (
    (bytes.length >= 132 &&
      String.fromCharCode(...bytes.slice(128, 132)) === 'DICM') ||
    (bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) ||
    (bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255)
  );
}
async function contentFingerprint(file) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
async function chooseFiles(selection, fromFolder = false) {
  if (busy || importing) return;
  importing = true;
  const files = [...selection].sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(
      b.webkitRelativePath || b.name,
      'tr',
      { numeric: true },
    ),
  );
  $('#batch-progress').hidden = true;
  $('#error').hidden = true;
  $('#import-summary').hidden = false;
  $('#import-summary').textContent = `${files.length} dosya inceleniyor…`;
  saveCurrent();
  syncWorkflow();
  let added = 0,
    skipped = 0,
    duplicates = 0,
    firstAdded = null;
  const addedEntries = [];
  const rejected = [],
    unreadable = [];
  const known = new Map();
  for (const entry of entries) {
    const candidates = known.get(entry.sourceKey) || [];
    candidates.push(entry);
    known.set(entry.sourceKey, candidates);
  }
  try {
    for (const selected of files) {
      const relativePath = selected.webkitRelativePath || selected.name;
      try {
        if (relativePath.split('/').some((part) => part.startsWith('.'))) {
          skipped++;
          continue;
        }
        if (!(await supportedFile(selected))) {
          skipped++;
          continue;
        }
        if (selected.size > 20 * 1024 * 1024) {
          rejected.push(relativePath);
          continue;
        }
        const sourceKey = `${fromFolder ? 'folder' : 'file'}:${relativePath}:${selected.size}:${selected.lastModified}`;
        const candidates = known.get(sourceKey) || [];
        let fingerprint = null,
          duplicate = false;
        if (candidates.length) {
          fingerprint = await contentFingerprint(selected);
          for (const candidate of candidates) {
            try {
              candidate.contentHash ??= await contentFingerprint(
                candidate.file,
              );
            } catch {
              continue;
            }
            if (candidate.contentHash === fingerprint) {
              duplicate = true;
              break;
            }
          }
        }
        if (duplicate) {
          duplicates++;
          continue;
        }
        const entry = {
          id: crypto.randomUUID(),
          file: selected,
          relativePath,
          sourceKey,
          contentHash: fingerprint,
          result: null,
          dirty: true,
          body: null,
          error: null,
          processing: false,
          settings: { manual: false, estimate: false, values: {} },
        };
        entries.push(entry);
        addedEntries.push(entry);
        candidates.push(entry);
        known.set(sourceKey, candidates);
        firstAdded ??= entry.id;
        added++;
      } catch {
        unreadable.push(relativePath);
      }
    }
    if (!activeEntry() && firstAdded) selectEntry(firstAdded, false);
    const folderName = fromFolder
      ? files[0]?.webkitRelativePath.split('/')[0]
      : null;
    $('#import-summary').textContent =
      `${folderName ? folderName + ' · ' : ''}${added} dosya eklendi${skipped ? ` · ${skipped} desteklenmeyen/gizli dosya atlandı` : ''}${duplicates ? ` · ${duplicates} dosya zaten listede` : ''}${rejected.length ? ` · ${rejected.length} dosya boyut sınırını aşıyor` : ''}${unreadable.length ? ` · ${unreadable.length} dosya okunamadı` : ''}.`;
    if (!files.length)
      $('#import-summary').textContent =
        'Klasörde okunabilir dosya bulunamadı.';
    const problems = [];
    if (rejected.length)
      problems.push(
        `Dosya başına 20 MB sınırını aşan dosyalar eklenmedi: ${rejected.join(', ')}`,
      );
    if (unreadable.length)
      problems.push(
        `Okunamayan dosyalar atlandı, diğer dosyalar eklendi: ${unreadable.join(', ')}`,
      );
    if (problems.length) showError(problems.join(' '));
  } finally {
    importing = false;
    fileInput.value = '';
    folderInput.value = '';
    syncWorkflow();
  }
  for (const entry of addedEntries) void prepareEntryThumbnail(entry);
}
folderInput.addEventListener('change', () =>
  chooseFiles(folderInput.files, true),
);
if (!('webkitdirectory' in folderInput)) {
  folderInput.disabled = true;
  $('#choose-folder').setAttribute('aria-disabled', 'true');
  $('#folder-support').hidden = false;
}
fileInput.addEventListener('change', () => chooseFiles(fileInput.files));
for (const name of ['dragenter', 'dragover'])
  $('#dropzone').addEventListener(name, (event) => {
    event.preventDefault();
    if (!busy) $('#dropzone').classList.add('drag');
  });
for (const name of ['dragleave', 'drop'])
  $('#dropzone').addEventListener(name, (event) => {
    event.preventDefault();
    $('#dropzone').classList.remove('drag');
    if (name === 'drop' && !busy) chooseFiles(event.dataTransfer.files);
  });
function loadPreview(url) {
  const revision = ++previewRevision;
  const entryId = activeId;
  const image = new Image();
  image.onload = () => {
    if (revision !== previewRevision || entryId !== activeId) return;
    previewImage = image;
    $('#image-canvas').hidden = false;
    $('#empty').hidden = true;
    $('#dimensions').textContent = `${image.width} × ${image.height} px`;
    initializeManualCircle();
    drawPreview();
  };
  image.src = url;
}
async function prepareEntryThumbnail(entry) {
  if (
    /\.(png|jpe?g)$/i.test(entry.file.name) ||
    /image\/(png|jpeg)/.test(entry.file.type)
  ) {
    entry.thumbnailUrl = URL.createObjectURL(entry.file);
    renderQueue();
    return;
  }
  entry.thumbnailError = false;
  renderQueue();
  try {
    const preview = await fetchEntryPreview(entry);
    if (!entries.includes(entry)) return;
    entry.thumbnailUrl = preview.preview;
    entry.thumbnailError = false;
  } catch (error) {
    if (!entries.includes(entry)) return;
    entry.thumbnailError = true;
    entry.thumbnailErrorMessage =
      error instanceof Error ? error.message : 'Önizleme yüklenemedi.';
  } finally {
    if (entries.includes(entry)) {
      entry.thumbnailController = null;
      renderQueue();
    }
  }
}
function fetchEntryPreview(entry) {
  if (entry.preview) return Promise.resolve(entry.preview);
  if (entry.previewPromise) return entry.previewPromise;
  const controller = new AbortController();
  entry.thumbnailController = controller;
  entry.previewPromise = (async () => {
    const body = new FormData();
    body.set('file', entry.file);
    const response = await fetch('/api/preview', {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw await readError(response);
    entry.preview = await response.json();
    return entry.preview;
  })().finally(() => {
    entry.thumbnailController = null;
    entry.previewPromise = null;
  });
  return entry.previewPromise;
}
async function loadDicomPreview(entry) {
  const revision = previewRevision;
  $('#preview-heading').textContent = 'Önizleme hazırlanıyor…';
  $('#preview-message').textContent =
    'Görüntü, ölçüm alanı seçilmeden de görüntülenebilir.';
  try {
    const preview = await fetchEntryPreview(entry);
    if (activeId !== entry.id || previewRevision !== revision) return;
    $('#image-badge').textContent = unitLabel(preview.unit);
    loadPreview(preview.preview);
  } catch (error) {
    if (activeId !== entry.id || previewRevision !== revision) return;
    $('#preview-heading').textContent = 'Önizleme açılamadı';
    $('#preview-message').textContent = error.message;
  }
}
function drawPreview() {
  if (!previewImage) return;
  const canvas = $('#image-canvas');
  canvas.width = previewImage.width;
  canvas.height = previewImage.height;
  const ctx = canvas.getContext('2d');
  const screen = canvas.getBoundingClientRect();
  const scale =
    Math.min(screen.width / canvas.width, screen.height / canvas.height) || 1;
  ctx.drawImage(previewImage, 0, 0);
  if (candidateOverlay && !resultDirty && $('#show-candidates').checked)
    ctx.drawImage(candidateOverlay, 0, 0);
  if (result?.roi.outlines && !resultDirty && !$('#manual').checked) {
    ctx.lineWidth = Math.max(1, canvas.width / 350);
    ctx.strokeStyle = '#ffb454';
    for (const polygon of result.roi.outlines) {
      ctx.beginPath();
      ctx.moveTo(...polygon[0]);
      for (const point of polygon.slice(1)) ctx.lineTo(...point);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = '#50fa90';
    for (const [x, y] of result.roi.innerBoundary || [])
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    return;
  }
  if (form.elements.roiShape.value !== 'circle') {
    let points = selectedPoints();
    if (form.elements.roiShape.value === 'rectangle' && points.length === 2) {
      const [a, b] = points;
      points = [
        [a[0], a[1]],
        [b[0], a[1]],
        [b[0], b[1]],
        [a[0], b[1]],
      ];
    }
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = '#ffb454';
    ctx.fillStyle = '#ffb454';
    if (points.length) {
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      for (const point of points.slice(1)) ctx.lineTo(...point);
      if (points.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 180, 84, .18)';
        ctx.fill();
      }
      ctx.strokeStyle = '#17212b';
      ctx.lineWidth = 5 / scale;
      ctx.stroke();
      ctx.strokeStyle = '#ffb454';
      ctx.lineWidth = 3 / scale;
      ctx.stroke();
      for (const [x, y] of points) {
        ctx.beginPath();
        ctx.arc(x, y, 5 / scale, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb454';
        ctx.fill();
        ctx.strokeStyle = '#17212b';
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      }
    }
    if (result && !resultDirty) {
      ctx.fillStyle = '#50fa90';
      for (const [x, y] of result.roi.innerBoundary || [])
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
    return;
  }
  const manual = $('#manual').checked;
  const roi = manual
    ? {
        x: Number(form.elements.centerX.value),
        y: Number(form.elements.centerY.value),
        radius: Number(form.elements.radius.value),
      }
    : result?.roi;
  if (
    !roi ||
    !Number.isFinite(roi.radius) ||
    roi.radius <= 0 ||
    !Number.isFinite(roi.x) ||
    !Number.isFinite(roi.y)
  )
    return;
  const inset =
    form.elements.insetPixels.value !== ''
      ? Number(form.elements.insetPixels.value)
      : (result?.roi.insetPixels ?? 10);
  ctx.lineWidth = Math.max(1, canvas.width / 350);
  ctx.strokeStyle = '#ffb454';
  ctx.setLineDash([canvas.width / 70, canvas.width / 100]);
  ctx.beginPath();
  ctx.arc(roi.x, roi.y, roi.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#50fa90';
  if (roi.radius > inset) {
    ctx.beginPath();
    ctx.arc(roi.x, roi.y, roi.radius - inset, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#50fa90';
  ctx.fillRect(roi.x - 1, roi.y - 4, 2, 8);
  ctx.fillRect(roi.x - 4, roi.y - 1, 8, 2);
}
function initializeManualCircle() {
  if (
    !previewImage ||
    !$('#manual').checked ||
    form.elements.roiShape.value !== 'circle'
  )
    return;
  if (
    form.elements.radius.value !== '' &&
    Number(form.elements.radius.value) > 0
  )
    return;
  form.elements.centerX.value = (previewImage.width / 2).toFixed(1);
  form.elements.centerY.value = (previewImage.height / 2).toFixed(1);
  form.elements.radius.value = (
    Math.min(previewImage.width, previewImage.height) / 4
  ).toFixed(1);
}
function canvasPoint(event, clamp = false) {
  const canvas = $('#image-canvas'),
    rect = canvas.getBoundingClientRect();
  const scale = Math.min(
    rect.width / canvas.width,
    rect.height / canvas.height,
  );
  if (!scale) return null;
  let x =
    (event.clientX - rect.left - (rect.width - canvas.width * scale) / 2) /
    scale;
  let y =
    (event.clientY - rect.top - (rect.height - canvas.height * scale) / 2) /
    scale;
  if (clamp) {
    x = Math.max(0, Math.min(canvas.width - 1, x));
    y = Math.max(0, Math.min(canvas.height - 1, y));
  }
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x: Math.round(x), y: Math.round(y), scale };
}
function cancelSelectionDrag() {
  const drag = selectionDrag;
  selectionDrag = null;
  if (!drag || drag.entryId !== activeId) return;
  if (drag.moved) {
    applySettings(drag.original);
    resultDirty = drag.originalDirty;
    activeEntry().error = drag.originalError;
    activeEntry().needsArea = drag.originalNeedsArea;
    syncWorkflow();
    drawPreview();
    suppressCanvasClickUntil = performance.now() + 250;
  }
  try {
    $('#image-canvas').releasePointerCapture(drag.pointerId);
  } catch {}
}
$('#image-canvas').addEventListener('pointerdown', (event) => {
  if (busy || !previewImage || event.button !== 0) return;
  const point = canvasPoint(event);
  if (!point) return;
  const shape = form.elements.roiShape.value;
  selectionDrag = {
    start: point,
    points: [[point.x, point.y]],
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    entryId: activeId,
    moved: false,
    shape: shape === 'circle' && !$('#manual').checked ? 'rectangle' : shape,
    original: captureSettings(),
    originalDirty: resultDirty,
    originalError: activeEntry().error,
    originalNeedsArea: activeEntry().needsArea,
  };
  $('#image-canvas').setPointerCapture(event.pointerId);
});
$('#image-canvas').addEventListener('pointermove', (event) => {
  const drag = selectionDrag;
  if (
    !drag ||
    drag.pointerId !== event.pointerId ||
    drag.entryId !== activeId ||
    busy
  )
    return;
  if (
    !drag.moved &&
    Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4
  )
    return;
  const point = canvasPoint(event, true);
  if (!point) return;
  event.preventDefault();
  if (!drag.moved) {
    drag.moved = true;
    form.elements.roiShape.value = drag.shape;
    if (drag.shape === 'polygon') form.elements.roiPoints.value = '';
    if (drag.shape !== 'circle') $('#manual').checked = true;
    form.elements.roiPoints.disabled = drag.shape === 'circle';
    // Keep the layout fixed until release so the canvas stays under the pointer.
    resultDirty = true;
    activeEntry().dirty = true;
    activeEntry().error = null;
    activeEntry().needsArea = false;
  }
  if (drag.shape === 'rectangle') {
    form.elements.roiPoints.value = JSON.stringify([
      [drag.start.x, drag.start.y],
      [point.x, point.y],
    ]);
  } else if (drag.shape === 'circle') {
    form.elements.centerX.value = String(drag.start.x);
    form.elements.centerY.value = String(drag.start.y);
    const limit = Math.min(
      drag.start.x,
      drag.start.y,
      previewImage.width - drag.start.x,
      previewImage.height - drag.start.y,
    );
    form.elements.radius.value = Math.min(
      limit,
      Math.hypot(point.x - drag.start.x, point.y - drag.start.y),
    ).toFixed(1);
  } else {
    const last = drag.points.at(-1);
    if (
      Math.hypot(point.x - last[0], point.y - last[1]) >=
      Math.max(1, 2 / point.scale)
    )
      drag.points.push([point.x, point.y]);
    if (drag.points.length > 512)
      drag.points = drag.points.filter(
        (_, i) => i % 2 === 0 || i === drag.points.length - 1,
      );
    form.elements.roiPoints.value = JSON.stringify(drag.points);
  }
  drawPreview();
});
$('#image-canvas').addEventListener('pointerup', (event) => {
  const drag = selectionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  selectionDrag = null;
  try {
    $('#image-canvas').releasePointerCapture(event.pointerId);
  } catch {}
  if (!drag.moved || drag.entryId !== activeId) return;
  event.preventDefault();
  suppressCanvasClickUntil = performance.now() + 250;
  if (drag.shape === 'polygon') {
    let points = selectedPoints();
    if (
      points.length > 3 &&
      Math.hypot(
        points.at(-1)[0] - points[0][0],
        points.at(-1)[1] - points[0][1],
      ) <= Math.max(1, 6 / drag.start.scale)
    )
      points.pop();
    if (points.length > 128)
      points = Array.from(
        { length: 128 },
        (_, i) => points[Math.round((i * (points.length - 1)) / 127)],
      );
    form.elements.roiPoints.value = JSON.stringify(points);
  }
  const top = $('#image-canvas').getBoundingClientRect().top;
  syncShapeControls();
  dirty();
  drawPreview();
  const shift = $('#image-canvas').getBoundingClientRect().top - top;
  if (shift) window.scrollBy(0, shift);
  $('#selection-guide').textContent =
    'Seçtiğiniz alan turuncu gösteriliyor. Sonuçları güncellemek için ölçümü hesaplayın.';
});
$('#image-canvas').addEventListener('pointercancel', cancelSelectionDrag);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selectionDrag) {
    event.preventDefault();
    cancelSelectionDrag();
  }
});
$('#image-canvas').addEventListener('click', (event) => {
  if (performance.now() < suppressCanvasClickUntil) {
    suppressCanvasClickUntil = 0;
    return;
  }
  if (
    (!$('#manual').checked && form.elements.roiShape.value === 'circle') ||
    busy
  )
    return;
  const canvas = event.currentTarget,
    rect = canvas.getBoundingClientRect();
  const scale = Math.min(
    rect.width / canvas.width,
    rect.height / canvas.height,
  );
  const x =
    (event.clientX - rect.left - (rect.width - canvas.width * scale) / 2) /
    scale;
  const y =
    (event.clientY - rect.top - (rect.height - canvas.height * scale) / 2) /
    scale;
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const shape = form.elements.roiShape.value;
  if (shape !== 'circle') {
    let points = selectedPoints();
    if (shape === 'rectangle' && points.length >= 2) points = [];
    if (points.length >= 128) {
      showError('En fazla 128 köşe seçebilirsiniz.');
      return;
    }
    points.push([Math.round(x), Math.round(y)]);
    form.elements.roiPoints.value = JSON.stringify(points);
    syncShapeControls();
    dirty();
    drawPreview();
    return;
  }
  form.elements.centerX.value = x.toFixed(1);
  form.elements.centerY.value = y.toFixed(1);
  dirty();
  drawPreview();
});
function requestBody() {
  saveCurrent();
  return bodyForEntry(activeEntry());
}
function setBusy(value) {
  busy = value;
  $('#analyze').disabled = value;
  $('#undo-point').disabled = value;
  $('#clear-points').disabled = value;
  $('#export').disabled = value;
  fileInput.disabled = value;
  $('#analyze span:first-child').textContent = value
    ? 'Kesit inceleniyor…'
    : 'Ölçümü hesapla';
  form.setAttribute('aria-busy', String(value));
  syncWorkflow();
  // Preserve the current field disabled state while a request is in progress.
  for (const input of form.querySelectorAll(
    'input:not([type=file]), select[name=roiShape]',
  )) {
    if (value) {
      input.dataset.wasDisabled = String(input.disabled);
      input.disabled = true;
    } else input.disabled = input.dataset.wasDisabled === 'true';
  }
}
async function readError(response) {
  const json = await response.json().catch(() => null);
  const error = new Error(
    typeof json?.message === 'string'
      ? json.message
      : 'İşlem tamamlanamadı. Dosyayı ve ölçüm ayarlarını kontrol edin.',
  );
  error.code = json?.code;
  return error;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || selectionDrag?.moved) return;
  if (currentStep === 1 && file) {
    setWorkflow(2, true);
    return;
  }
  if (!file) {
    showError('Önce bir kesit dosyası seçin.');
    return;
  }
  let body;
  try {
    body = requestBody();
  } catch (error) {
    showError(error.message);
    return;
  }
  resultDirty = true;
  activeEntry().error = null;
  activeEntry().needsArea = false;
  activeEntry().processing = true;
  setBusy(true);
  $('#error').hidden = true;
  $('#status').hidden = false;
  $('#status').textContent =
    'Görüntü okunuyor, ölçüm alanı ve dağılım hesaplanıyor…';
  try {
    const response = await fetch('/api/analyze', { method: 'POST', body });
    if (!response.ok) throw await readError(response);
    result = await response.json();
    analyzedBody = body;
    resultDirty = false;
    activeEntry().error = null;
    renderResults();
    $('#status').hidden = true;
  } catch (error) {
    activeEntry().error = error.message;
    activeEntry().needsArea = error.code === 'ROI_REQUIRED';
    showError(error.message);
    $('#status').hidden = true;
    if (result) {
      $('#status').textContent =
        'Bu dosyanın ölçümü tamamlanamadı ve eski sonucu rapora alınmayacak. Diğer dosyaların güncel sonuçları korunur; ayarları düzeltip tekrar hesaplayın.';
      $('#status').hidden = false;
    }
  } finally {
    activeEntry().processing = false;
    setBusy(false);
    if (!analyzedBody || !$('#error').hidden) $('#export').disabled = true;
  }
});
function renderResults(updateCoordinates = true) {
  syncWorkflow();
  $('#warning-count').textContent = result.warnings.length;
  $('#results').hidden = false;
  $('#image-badge').textContent = unitLabel(result.unit);
  $('#image-title').textContent = result.filename;
  if (updateCoordinates)
    for (const [name, value] of Object.entries({
      centerX: result.roi.x,
      centerY: result.roi.y,
      radius: result.roi.radius,
    }))
      form.elements[name].value = value.toFixed(3);
  candidateOverlay = null;
  if (result.defects) {
    const renderedResult = result,
      overlay = new Image();
    overlay.onload = () => {
      if (result === renderedResult) {
        candidateOverlay = overlay;
        drawPreview();
      }
    };
    overlay.src = result.defects.overlay;
  }
  loadPreview(result.preview);
  $('#part-results').hidden = !result.parts;
  $('#part-measurements').replaceChildren(
    ...(result.parts || []).map((part) => {
      const row = document.createElement('tr'),
        m = part.measurements;
      for (const value of [
        part.index,
        integer(m?.count ?? 0),
        fmt(m?.area),
        fmt(m?.mean),
        fmt(m?.std),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
  const defects = result.defects;
  $('#defect-summary').textContent = defects
    ? `${defects.count} aday bölge; ${defects.elongatedCount} ince/uzamış aday. İşaretli alan oranı %${fmt(defects.percent, 2)}.${defects.truncated ? ' En büyük 50 bölge listeleniyor; toplamlar tüm adayları kapsar.' : ''}`
    : 'Bu sonuç için aday bölge taraması bulunmuyor.';
  $('#defect-settings').textContent = defects
    ? `Tarama eşiği: ${fmt(defects.threshold, 2)} ${unitLabel(result.unit)} (${defects.thresholdSource === 'user' ? 'elle seçilmiş' : 'otomatik'}).`
    : '';
  $('#technical-notes').replaceChildren(
    ...(result.technicalNotes || []).map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }),
  );
  $('#defect-regions').replaceChildren(
    ...(defects?.regions || []).map((region, index) => {
      const row = document.createElement('tr');
      for (const value of [
        index + 1,
        region.elongated ? 'İnce/uzamış aday' : 'Düşük yoğunluk adayı',
        integer(region.pixels),
        fmt(region.area, 2),
        fmt(region.mean),
        `${region.bounds.width} × ${region.bounds.height}`,
        region.widthMm === null
          ? '—'
          : `${fmt(region.widthMm, 2)} × ${fmt(region.heightMm, 2)}`,
        region.touchesBoundary ? 'Evet; sınırı kontrol edin' : 'Hayır',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
  $('#interpretation').replaceChildren(
    ...(result.interpretation || []).map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }),
  );
  const m = result.measurements[0];
  $('#metric-mean').textContent = fmt(m.mean);
  $('#metric-std').textContent = fmt(m.std);
  $('#metric-area').textContent = fmt(m.area);
  $('#metric-count').textContent = integer(m.count);
  $('#metric-unit').textContent = unitLabel(result.unit);
  $('#area-unit').textContent = result.spacing
    ? 'mm²'
    : 'Piksel boyutu gerekli';
  $('#table-unit').textContent = unitLabel(result.unit);
  $('#warnings').replaceChildren(
    ...result.warnings.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }),
  );
  $('#measurements').replaceChildren(
    ...result.measurements.map((m) => {
      const row = document.createElement('tr');
      for (const value of [
        m.label,
        integer(m.count),
        fmt(m.area),
        ...['mean', 'std', 'median', 'min', 'max', 'p5', 'p95'].map((key) =>
          fmt(m[key]),
        ),
      ]) {
        const td = document.createElement('td');
        td.textContent = value;
        row.append(td);
      }
      return row;
    }),
  );
  $('#regions').replaceChildren(
    ...result.regions.map((r) => {
      const div = document.createElement('div');
      div.className = 'region-row';
      const label = document.createElement('span'),
        value = document.createElement('b');
      label.textContent = r.label;
      value.textContent = fmt(r.mean);
      div.append(label, value);
      return div;
    }),
  );
  const info = {
    ...result.metadata,
    Matris: `${result.width} × ${result.height}`,
    'Piksel boyutu (X × Y)': result.spacing
      ? `${fmt(result.spacing[0], 4)} × ${fmt(result.spacing[1], 4)} mm`
      : 'Belirtilmedi',
    'Ölçüm birimi': unitLabel(result.unit),
    'Dış sınırdan içeri alınan mesafe': `${fmt(result.roi.insetPixels, 2)} piksel`,
    Seçim: result.roi.automatic ? 'Otomatik öneri' : 'Elle belirlenmiş',
  };
  $('#metadata').replaceChildren(
    ...Object.entries(info).flatMap(([key, value]) => {
      const dt = document.createElement('dt'),
        dd = document.createElement('dd');
      dt.textContent = key;
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  drawHistogram();
}
function drawHistogram() {
  if (!result || $('#panel-report').hidden) return;
  const canvas = $('#histogram'),
    ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth,
    h = 200;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const left = 38,
    right = 12,
    top = 15,
    bottom = 30;
  const max = Math.max(...result.histogram.map((b) => b.count), 1);
  ctx.font = '9px system-ui';
  ctx.fillStyle = '#7c90a4';
  for (let i = 0; i <= 4; i++) {
    const y = top + ((h - top - bottom) * i) / 4;
    ctx.strokeStyle = '#e8eef4';
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(integer(max * (1 - i / 4)), left - 6, y + 3);
  }
  const bw = (w - left - right) / result.histogram.length;
  for (const [i, bin] of result.histogram.entries()) {
    const bh = (bin.count / max) * (h - top - bottom);
    ctx.fillStyle = '#228c84';
    ctx.fillRect(left + i * bw, h - bottom - bh, Math.max(0.5, bw - 1), bh);
  }
  ctx.fillStyle = '#7c90a4';
  ctx.textAlign = 'left';
  ctx.fillText(integer(result.histogram[0].lower), left, h - 10);
  ctx.textAlign = 'right';
  ctx.fillText(integer(result.histogram.at(-1).upper), w - right, h - 10);
}
$('#histogram').addEventListener('mousemove', (event) => {
  if (!result) return;
  const canvas = event.currentTarget,
    x = event.clientX - canvas.getBoundingClientRect().left;
  const index = Math.floor(
    ((x - 38) / (canvas.clientWidth - 50)) * result.histogram.length,
  );
  const bin = result.histogram[index];
  $('#histogram-detail').textContent = bin
    ? `${fmt(bin.lower, 0)} … ${fmt(bin.upper, 0)} · ${integer(bin.count)} piksel · %${fmt(bin.percent, 2)}`
    : '—';
});
window.addEventListener('resize', drawHistogram);
$('#export').addEventListener('click', async () => {
  if (!analyzedBody || busy || resultDirty) return;
  setBusy(true);
  $('#export').textContent = 'Rapor hazırlanıyor…';
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      body: analyzedBody,
    });
    if (!response.ok) throw await readError(response);
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'HUReader-rapor.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
    $('#export').textContent = '↓ Excel raporunu indir';
  }
});

const helpDialog = $('#help-dialog');
$('#help-open').addEventListener('click', () => helpDialog.showModal());
for (const id of ['#help-close', '#help-done'])
  $(id).addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (event) => {
  if (event.target === helpDialog) {
    const rect = helpDialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      helpDialog.close();
  }
});
$('#expand-preview').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('#preview-panel').requestFullscreen();
  } catch {
    showError(
      'Tam ekran açılamadı. Tarayıcınızın tam ekran iznini kontrol edin.',
    );
  }
});
document.addEventListener('fullscreenchange', () => {
  const label = document.fullscreenElement
    ? 'Tam ekrandan çık'
    : 'Önizlemeyi tam ekranda aç';
  $('#expand-preview').setAttribute('aria-label', label);
  $('#expand-preview').title = label;
});

function bodyForEntry(entry) {
  const missing = (keys) =>
    keys.some(
      (key) =>
        entry.settings.values[key] === undefined ||
        entry.settings.values[key] === '' ||
        !Number.isFinite(Number(entry.settings.values[key])),
    );
  const shape = entry.settings.values.roiShape || 'circle';
  if (shape !== 'circle') {
    let points;
    try {
      points = JSON.parse(entry.settings.values.roiPoints || '[]');
    } catch {
      points = [];
    }
    if (
      shape === 'rectangle'
        ? points.length !== 2
        : points.length < 3 || points.length > 128
    )
      throw new Error(
        shape === 'rectangle'
          ? 'Dikdörtgenin iki karşı köşesini seçin.'
          : 'Serbest alan için en az üç köşe seçin.',
      );
  }
  if (
    shape === 'circle' &&
    entry.settings.manual &&
    missing(['centerX', 'centerY', 'radius'])
  )
    throw new Error(
      'Elle ölçüm için merkez X, merkez Y ve yarıçapı birlikte girin.',
    );
  if (entry.settings.estimate && missing(['windowMin', 'windowMax']))
    throw new Error(
      'Yaklaşık HU için pencere alt ve üst sınırını birlikte girin.',
    );
  const body = new FormData();
  body.set('file', entry.file);
  body.set('sourcePath', entryLabel(entry));
  for (const key of optionNames) {
    if (key === 'roiPoints' && shape === 'circle') continue;
    if (
      ['centerX', 'centerY', 'radius'].includes(key) &&
      (!entry.settings.manual || shape !== 'circle')
    )
      continue;
    if (['windowMin', 'windowMax'].includes(key) && !entry.settings.estimate)
      continue;
    if (
      entry.settings.values[key] !== undefined &&
      entry.settings.values[key] !== ''
    )
      body.set(key, entry.settings.values[key]);
  }
  return body;
}
$('#analyze-all').addEventListener('click', async () => {
  if (busy || !entries.length) return;
  saveCurrent();
  const pending = entries.filter((entry) => !entry.result || entry.dirty);
  if (!pending.length) {
    $('#batch-progress').hidden = false;
    $('#batch-progress').textContent =
      'Tüm dosyaların güncel ölçümleri zaten hazır.';
    return;
  }
  const selected = activeId;
  setBusy(true);
  $('#error').hidden = true;
  $('#status').hidden = true;
  $('#batch-progress').hidden = false;
  try {
    for (const [index, entry] of pending.entries()) {
      entry.processing = true;
      entry.error = null;
      entry.needsArea = false;
      $('#batch-progress').textContent =
        `${index + 1}/${pending.length} işleniyor · ${entryLabel(entry)}`;
      renderQueue();
      try {
        const body = bodyForEntry(entry);
        const response = await fetch('/api/analyze', { method: 'POST', body });
        if (!response.ok) throw await readError(response);
        entry.result = await response.json();
        entry.body = body;
        entry.dirty = false;
        for (const [key, value] of Object.entries({
          centerX: entry.result.roi.x,
          centerY: entry.result.roi.y,
          radius: entry.result.roi.radius,
        }))
          entry.settings.values[key] = value.toFixed(3);
      } catch (error) {
        entry.error = error.message;
        entry.needsArea = error.code === 'ROI_REQUIRED';
        entry.dirty = true;
      }
      entry.processing = false;
    }
  } finally {
    // Loading the selected entry must not overwrite it with the old view aliases.
    selectEntry(selected, false);
    setBusy(false);
    $('#batch-progress').textContent =
      `İşlem tamamlandı: ${readyEntries().length}/${entries.length} hesaplandı · ${entries.filter((e) => e.error && !e.needsArea).length} hata · ${entries.filter((e) => e.needsArea).length} alan seçimi bekliyor. Dosyalar arasında geçerek ölçüm alanlarını kontrol edin.`;
  }
});
$('#export-batch').addEventListener('click', async () => {
  if (busy || !readyEntries().length) return;
  saveCurrent();
  setBusy(true);
  $('#export-batch').textContent = 'Toplu rapor hazırlanıyor…';
  try {
    const buffer = await createBatchWorkbook(entries);
    const url = URL.createObjectURL(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'HUReader-toplu-rapor.xlsx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
    $('#export-batch').textContent = '↓ Toplu Excel indir';
  }
});
syncWorkflow();
