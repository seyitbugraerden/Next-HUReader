/* Batch workbook uses the already calculated results; uploaded files stay local to this session. */
async function createBatchWorkbook(entries) {
  if (!window.ExcelJS)
    throw new Error(
      'Excel bileşeni yüklenemedi. Sayfayı yenileyip tekrar deneyin.',
    );
  const book = new ExcelJS.Workbook();
  book.creator = 'HUReader';
  const sheets = {
    measurements: book.addWorksheet('CT Sayıları'),
    regions: book.addWorksheet('Bölgesel Ortalamalar'),
    metadata: book.addWorksheet('Kaynak Bilgileri'),
    histogram: book.addWorksheet('Histogram (Numune)'),
    roi: book.addWorksheet('Ölçüm Alanı'),
    status: book.addWorksheet('İşlem Durumu'),
  };
  sheets.measurements.addRow([
    'Sıra',
    'Dosya',
    'Birim',
    'Ölçüm alanı',
    'Piksel sayısı',
    'Alan (mm²)',
    'Ortalama',
    'Std. sapma',
    'Medyan',
    'Min',
    'Maks',
    '%5',
    '%95',
  ]);
  sheets.regions.addRow([
    'Sıra',
    'Dosya',
    'Birim',
    'Bölge',
    'Ortalama',
    'Piksel sayısı',
  ]);
  sheets.metadata.addRow(['Sıra', 'Dosya', 'Parametre', 'Değer']);
  sheets.histogram.addRow([
    'Sıra',
    'Dosya',
    'Birim',
    'Alt sınır',
    'Üst sınır',
    'Piksel sayısı',
    'Oran (%)',
  ]);
  sheets.roi.addRow([
    'Sıra',
    'Dosya',
    'Merkez X (px)',
    'Merkez Y (px)',
    'Yarıçap (px)',
    'Kenar payı (px)',
    'İç yarıçap (px)',
    'Otomatik',
    'Şekil',
    'Köşeler',
  ]);
  sheets.status.addRow(['Sıra', 'Dosya', 'Durum', 'Açıklama']);
  const unit = (value) =>
    value === 'HU'
      ? 'HU'
      : value === 'estimated-HU'
        ? 'Yaklaşık HU'
        : 'Gri ton (0–255)';
  const valid = entries.filter((e) => e.result && !e.dirty);
  for (const [index, entry] of entries.entries()) {
    const ready = entry.result && !entry.dirty;
    sheets.status.addRow([
      index + 1,
      entry.relativePath || entry.file.name,
      ready
        ? 'Hesaplandı'
        : entry.needsArea
          ? 'Alan seçimi bekliyor'
          : entry.error
            ? 'Hata'
            : entry.result
              ? 'Yeniden hesaplanmalı'
              : 'Bekliyor',
      entry.error ||
        (ready
          ? 'Ölçüm alanı kullanıcı tarafından kontrol edilmelidir.'
          : 'Ölçüm tablolarına dahil edilmedi.'),
    ]);
    if (!ready) continue;
    const r = entry.result,
      identity = [index + 1, r.filename],
      units = unit(r.unit);
    r.measurements.forEach((m) =>
      sheets.measurements.addRow([
        ...identity,
        units,
        m.label,
        m.count,
        m.area,
        m.mean,
        m.std,
        m.median,
        m.min,
        m.max,
        m.p5,
        m.p95,
      ]),
    );
    for (const part of r.parts || []) {
      const m = part.measurements;
      sheets.measurements.addRow([
        ...identity,
        units,
        `Otomatik parça ${part.index}`,
        m?.count ?? 0,
        m?.area ?? null,
        m?.mean ?? null,
        m?.std ?? null,
        m?.median ?? null,
        m?.min ?? null,
        m?.max ?? null,
        m?.p5 ?? null,
        m?.p95 ?? null,
      ]);
    }
    for (const b of r.toneSegmentation?.bands || []) {
      sheets.regions.addRow([
        ...identity,
        units,
        `Ton ${b.id} (${b.lower}–${b.upper})`,
        b.mean,
        b.pixels,
      ]);
    }
    r.regions.forEach((region) =>
      sheets.regions.addRow([
        ...identity,
        units,
        region.label,
        region.mean,
        region.count,
      ]),
    );
    Object.entries({
      ...r.metadata,
      Matris: `${r.width} × ${r.height}`,
      'Sayısal değerlendirme': (r.interpretation || []).join(' '),
      'Teknik açıklama': (r.technicalNotes || []).join(' '),
      ...(r.toneSegmentation
        ? {
            'Ton bölgeleme yöntemi': r.toneSegmentation.method,
            'Ton sınıfları': JSON.stringify(r.toneSegmentation.bands),
            'Bağlı ton bölgesi sayısı': r.toneSegmentation.count,
            'Ton bölgeleri (en büyük 200)': JSON.stringify(
              r.toneSegmentation.regions,
            ),
            'Ton bölge listesi sınırlı': r.toneSegmentation.truncated
              ? 'Evet; sınıf toplamları tüm alanı kapsar'
              : 'Hayır',
          }
        : {}),
      ...(r.defects
        ? {
            'Aday bölge sayısı': r.defects.count,
            'İnce/uzamış aday sayısı': r.defects.elongatedCount,
            'Aday alan oranı (%)': r.defects.percent,
            'Aday tarama eşiği': r.defects.threshold,
            'Eşik kaynağı':
              r.defects.thresholdSource === 'user'
                ? 'Kullanıcı'
                : 'Otomatik öneri',
            'Aday bölgeler (en büyük 50)': JSON.stringify(r.defects.regions),
            ...(r.defects.appearance
              ? {
                  'Görsel tarama referansı': JSON.stringify(
                    r.defects.appearance,
                  ),
                }
              : {}),
          }
        : {}),
      'Piksel boyutu X (mm)': r.spacing?.[0] ?? 'Belirtilmedi',
      'Piksel boyutu Y (mm)': r.spacing?.[1] ?? 'Belirtilmedi',
    }).forEach(([key, value]) =>
      sheets.metadata.addRow([...identity, key, value]),
    );
    r.warnings.forEach((warning) =>
      sheets.metadata.addRow([...identity, 'Not', warning]),
    );
    r.histogram.forEach((bin) =>
      sheets.histogram.addRow([
        ...identity,
        units,
        bin.lower,
        bin.upper,
        bin.count,
        bin.percent,
      ]),
    );
    sheets.roi.addRow([
      ...identity,
      r.roi.x,
      r.roi.y,
      r.roi.points || r.roi.outlines ? null : r.roi.radius,
      r.roi.insetPixels,
      r.roi.points || r.roi.outlines ? null : r.roi.innerRadius,
      r.roi.automatic ? 'Evet' : 'Hayır',
      r.roi.shape || 'circle',
      r.roi.outlines || r.roi.points
        ? JSON.stringify(r.roi.outlines || r.roi.points)
        : '',
    ]);
  }
  // One annotated preview per successful file, below the coordinate table.
  let row = valid.length + 4;
  for (const entry of valid) {
    const r = entry.result;
    sheets.roi.getCell(row, 1).value = r.filename;
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(new Error(`${r.filename}: rapor önizlemesi oluşturulamadı.`));
      image.src = r.preview;
    });
    const canvas = document.createElement('canvas');
    canvas.width = r.width;
    canvas.height = r.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const visualOverlay = r.toneSegmentation?.overlay || r.defects?.overlay;
    if (visualOverlay) {
      const overlay = new Image();
      await new Promise((resolve, reject) => {
        overlay.onload = resolve;
        overlay.onerror = () =>
          reject(new Error('Aday bölge önizlemesi okunamadı.'));
        overlay.src = visualOverlay;
      });
      ctx.drawImage(overlay, 0, 0);
    }
    ctx.lineWidth = Math.max(1, r.width / 350);
    ctx.strokeStyle = '#ffb454';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const polygons = r.roi.outlines || (r.roi.points ? [r.roi.points] : null);
    if (polygons) {
      for (const polygon of polygons) {
        ctx.moveTo(...polygon[0]);
        for (const point of polygon.slice(1)) ctx.lineTo(...point);
        ctx.closePath();
      }
    } else ctx.arc(r.roi.x, r.roi.y, r.roi.radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#50fa90';
    ctx.beginPath();
    if (polygons) {
      ctx.fillStyle = '#50fa90';
      for (const [x, y] of r.roi.innerBoundary || [])
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    } else {
      ctx.arc(r.roi.x, r.roi.y, r.roi.innerRadius, 0, 2 * Math.PI);
      ctx.stroke();
    }
    const id = book.addImage({
      base64: canvas.toDataURL('image/png'),
      extension: 'png',
    });
    const height = Math.min(400, (400 * r.height) / r.width),
      width = (height * r.width) / r.height;
    sheets.roi.addImage(id, { tl: { col: 0, row }, ext: { width, height } });
    row += Math.ceil(height / 20) + 4;
  }
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF176A60' },
    };
    sheet.columns.forEach((column, index) => {
      column.width = index === 1 ? 36 : 24;
    });
    sheet.eachRow((r, index) => {
      if (index > 1)
        r.eachCell((cell) => {
          if (typeof cell.value === 'number') cell.numFmt = '0.00';
        });
    });
  }
  return book.xlsx.writeBuffer();
}
