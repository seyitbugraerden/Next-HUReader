import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { decodeImage } from './image-decoder.js';
import { detectCircle, statistics } from './statistics.js';
import { polygonMembership, validatePolygon } from './roi-geometry.js';
import { findDefectCandidates } from './defect-candidates.js';
import type {
  AnalysisOptions,
  AnalysisResult,
  Circle,
} from './analysis.types.js';

export function parseOptions(input: Record<string, unknown>): AnalysisOptions {
  const result: Record<string, number> = {};
  const keys = [
    'centerX',
    'centerY',
    'radius',
    'insetPixels',
    'spacingX',
    'spacingY',
    'windowMin',
    'windowMax',
    'lowDensityThreshold',
  ];
  for (const key of keys) {
    const raw = input[key];
    if (raw === undefined || raw === '') continue;
    if (typeof raw !== 'string' && typeof raw !== 'number')
      throw new BadRequestException(`${key}: geçerli sayı girin.`);
    const value = Number(raw);
    if (!Number.isFinite(value))
      throw new BadRequestException(`${key}: geçerli sayı girin.`);
    result[key] = value;
  }
  const options = result as AnalysisOptions;
  if (input.materialReference !== undefined) {
    if (
      input.materialReference !== 'none' &&
      input.materialReference !== 'marble-excel'
    )
      throw new BadRequestException('Geçersiz materyal referansı.');
    options.materialReference = input.materialReference;
  }
  if (input.roiShape !== undefined) {
    if (
      typeof input.roiShape !== 'string' ||
      !['circle', 'rectangle', 'polygon'].includes(input.roiShape)
    )
      throw new BadRequestException('Geçersiz ölçüm alanı şekli.');
    options.roiShape = input.roiShape as AnalysisOptions['roiShape'];
  }
  if (input.roiPoints !== undefined && input.roiPoints !== '') {
    try {
      const points: unknown =
        typeof input.roiPoints === 'string'
          ? JSON.parse(input.roiPoints)
          : input.roiPoints;
      if (
        !Array.isArray(points) ||
        points.length > 128 ||
        !points.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 2 &&
            p.every((v) => typeof v === 'number' && Number.isFinite(v)),
        )
      )
        throw new Error();
      options.roiPoints = points as [number, number][];
    } catch {
      throw new BadRequestException(
        'Ölçüm köşeleri geçerli koordinatlardan oluşmalıdır.',
      );
    }
  }
  if (options.roiShape && options.roiShape !== 'circle' && !options.roiPoints)
    throw new BadRequestException(
      'Ölçüm alanının köşelerini görüntü üzerinde seçin.',
    );
  if (options.roiPoints && (!options.roiShape || options.roiShape === 'circle'))
    throw new BadRequestException(
      'Köşe seçimi için dikdörtgen veya çokgen kullanın.',
    );
  const supplied = keys
    .slice(0, 3)
    .filter((k) => result[k] !== undefined).length;
  if (supplied !== 0 && supplied !== 3)
    throw new BadRequestException(
      'Merkez X, merkez Y ve yarıçap birlikte verilmelidir.',
    );
  if (
    (options.spacingX === undefined) !== (options.spacingY === undefined) ||
    (options.spacingX ?? 1) <= 0 ||
    (options.spacingY ?? 1) <= 0 ||
    !Number.isFinite((options.spacingX ?? 1) * (options.spacingY ?? 1))
  )
    throw new BadRequestException(
      'Her iki piksel boyutu da pozitif olmalıdır.',
    );
  if (
    (options.windowMin === undefined) !== (options.windowMax === undefined) ||
    (options.windowMin !== undefined &&
      (options.windowMax! <= options.windowMin ||
        !Number.isFinite(options.windowMax! - options.windowMin)))
  )
    throw new BadRequestException(
      'Pencere alt ve üst sınırını birlikte verin; üst sınır daha büyük olmalıdır.',
    );
  if ((options.insetPixels ?? 0) < 0)
    throw new BadRequestException('Kenar payı negatif olamaz.');
  return options;
}

@Injectable()
export class AnalysisService {
  async preview(buffer: Buffer) {
    const image = await decodeImage(buffer, {});
    const png = await sharp(Buffer.from(image.display), {
      raw: { width: image.width, height: image.height, channels: 1 },
    })
      .png()
      .toBuffer();
    return {
      width: image.width,
      height: image.height,
      unit: image.unit,
      spacing: image.spacing,
      preview: `data:image/png;base64,${png.toString('base64')}`,
    };
  }

  async analyze(
    buffer: Buffer,
    filename: string,
    options: AnalysisOptions,
  ): Promise<AnalysisResult> {
    const image = await decodeImage(buffer, options);
    const { width, height, values, valid } = image;
    const shape = options.roiShape ?? 'circle';
    let points = options.roiPoints;
    if (shape !== 'circle') {
      if (
        options.radius !== undefined ||
        options.centerX !== undefined ||
        options.centerY !== undefined
      )
        throw new BadRequestException(
          'Çokgen ve dikdörtgen için çember koordinatlarını göndermeyin.',
        );
      if (shape === 'rectangle') {
        if (points?.length !== 2)
          throw new BadRequestException(
            'Dikdörtgen için iki karşı köşe seçin.',
          );
        const [a, b] = points as [[number, number], [number, number]];
        const left = Math.min(a[0], b[0]),
          right = Math.max(a[0], b[0]);
        const top = Math.min(a[1], b[1]),
          bottom = Math.max(a[1], b[1]);
        points = [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ];
      }
      validatePolygon(points ?? [], width, height);
    }
    let circle: Circle;
    if (shape !== 'circle') {
      const xs = points!.map((p) => p[0]),
        ys = points!.map((p) => p[1]);
      circle = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        radius: 0,
      };
    } else if (options.radius !== undefined)
      circle = {
        x: options.centerX!,
        y: options.centerY!,
        radius: options.radius,
      };
    else {
      const detected = detectCircle(image);
      if (!detected)
        throw new BadRequestException(
          'Dairesel numune güvenilir biçimde bulunamadı. Merkez X/Y ve yarıçapı elle girerek tekrar deneyin.',
        );
      circle = detected;
      image.warnings.push(
        'Otomatik çember bir öneridir. Ölçüm alanını görüntü üzerinde kontrol edin; gerekiyorsa düzeltin.',
      );
    }
    const { x: cx, y: cy, radius: r } = circle;
    if (
      shape === 'circle' &&
      (r < 2 || cx - r < 0 || cy - r < 0 || cx + r > width || cy + r > height)
    )
      throw new BadRequestException(
        'Ölçüm çemberi görüntü sınırları içinde ve yarıçapı en az 2 piksel olmalıdır.',
      );
    // 2.1 mm physical inset where spacing exists; otherwise 10 pixels as in workbook.
    const inset =
      options.insetPixels ??
      (image.spacing ? 2.1 / Math.min(...image.spacing) : 10);
    if (shape === 'circle' && inset >= r)
      throw new BadRequestException('Kenar payı yarıçaptan küçük olmalıdır.');
    const inner = shape === 'circle' ? r - inset : 0;
    const innerMask = new Uint8Array(width * height);
    const all: number[] = [],
      full: number[] = [],
      sample: number[] = [];
    const regionValues: number[][] = Array.from({ length: 6 }, () => []);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!valid[i]) continue;
        const v = values[i]!;
        all.push(v);
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        const selected =
          shape === 'circle'
            ? { full: d2 <= r * r, inner: d2 <= inner * inner }
            : polygonMembership(points!, x, y, inset);
        if (selected.full) full.push(v);
        if (selected.inner) {
          if (innerMask) innerMask[i] = 1;
          sample.push(v);
          regionValues[y < cy ? 0 : 1]!.push(v);
          regionValues[x < cx ? 2 : 3]!.push(v);
          if (shape === 'circle' && d2 <= (inner / 4) ** 2)
            regionValues[4]!.push(v);
          if (shape === 'circle' && d2 <= (inner / 2) ** 2)
            regionValues[5]!.push(v);
        }
      }
    const pixelArea = image.spacing
      ? image.spacing[0] * image.spacing[1]
      : null;
    const measurements = [
      {
        label:
          shape === 'circle'
            ? 'Numune (kenar payı uygulanmış)'
            : 'Seçili alan (kenar payı uygulanmış)',
        ...statistics(sample, pixelArea),
      },
      {
        label:
          shape === 'circle'
            ? 'Numune (tam kesit)'
            : 'Seçili alan (kenar payı yok)',
        ...statistics(full, pixelArea),
      },
      {
        label: 'Tüm görüntü (geçerli pikseller)',
        ...statistics(all, pixelArea),
      },
    ];
    const labels = [
      'Üst yarı',
      'Alt yarı',
      'Sol yarı',
      'Sağ yarı',
      shape === 'circle' ? 'Merkez (r/4)' : 'Merkez (r/4; yalnızca daire)',
      shape === 'circle' ? 'Merkez (r/2)' : 'Merkez (r/2; yalnızca daire)',
    ];
    const regions = regionValues.map((v, i) => ({
      label: labels[i]!,
      mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
      count: v.length,
    }));
    const min = measurements[0]!.min,
      max = measurements[0]!.max;
    const binSize =
      image.unit === 'gray'
        ? 8
        : Math.max(50, Math.ceil((max - min) / 100 / 50) * 50);
    const lower = Math.floor(min / binSize) * binSize;
    const histogram = Array.from(
      { length: Math.floor((max - lower) / binSize) + 1 },
      (_, i) => ({
        lower: lower + i * binSize,
        upper: lower + (i + 1) * binSize,
        count: 0,
        percent: 0,
      }),
    );
    for (const v of sample)
      histogram[Math.floor((v - lower) / binSize)]!.count++;
    for (const bin of histogram)
      bin.percent = (bin.count / sample.length) * 100;
    const png = await sharp(Buffer.from(image.display), {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    if (image.spacing && Math.abs(image.spacing[0] - image.spacing[1]) > 1e-6)
      image.warnings.push(
        'Piksel boyutları farklı: ölçüm alanı piksel koordinatlarında tanımlıdır; fiziksel kenar payı küçük piksel boyutuna göre uygulanır.',
      );
    if (shape !== 'circle')
      image.warnings.push(
        'Elle seçilen alanın yalnızca hedef numuneyi kapsadığını doğrulayın. Daireye özgü merkez bölgeleri bu şekil için hesaplanmadı.',
      );
    const innerBoundary: [number, number][] = [];
    if (shape !== 'circle')
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (
            innerMask[i] &&
            (x === 0 ||
              y === 0 ||
              x === width - 1 ||
              y === height - 1 ||
              !innerMask[i - 1] ||
              !innerMask[i + 1] ||
              !innerMask[i - width] ||
              !innerMask[i + width])
          )
            innerBoundary.push([x, y]);
        }
    const measured = measurements[0]!;
    const format = (v: number) =>
      v.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    const unit =
      image.unit === 'HU'
        ? 'HU'
        : image.unit === 'gray'
          ? 'gri ton'
          : 'yaklaşık HU';
    const interpretation = [
      `Seçilen iç alanda ortalama ${format(measured.mean)} ${unit}, standart sapma ${format(measured.std)} ${unit}.`,
      `%5 ve %95 yüzdelikleri ${format(measured.p5)} ve ${format(measured.p95)} ${unit}. Homojenlik kararı için malzemeye ait kabul sınırı gerekir.`,
    ];
    for (const [a, b, label] of [
      [0, 1, 'Üst ve alt'],
      [2, 3, 'Sol ve sağ'],
    ] as const) {
      const first = regions[a]!.mean,
        second = regions[b]!.mean;
      if (first !== null && second !== null)
        interpretation.push(
          `${label} yarıların ortalamaları arasındaki fark ${format(Math.abs(first - second))} ${unit}.`,
        );
    }
    const lowDensity =
      options.lowDensityThreshold === undefined
        ? undefined
        : {
            threshold: options.lowDensityThreshold,
            count: sample.filter((v) => v <= options.lowDensityThreshold!)
              .length,
            percent: 0,
          };
    if (lowDensity) {
      lowDensity.percent = (100 * lowDensity.count) / sample.length;
      interpretation.push(
        `${format(lowDensity.threshold)} ${unit} ve altındaki pikseller seçili alanın %${format(lowDensity.percent)}'i. Bu oran boşluk/porozite ölçümü olarak doğrulanmamıştır.`,
      );
    }
    const { mask: defectMask, ...candidateData } = findDefectCandidates(
      image,
      innerMask,
      sample,
      options.lowDensityThreshold,
    );
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < defectMask.length; i++)
      if (defectMask[i]) {
        rgba[i * 4] = 255;
        rgba[i * 4 + 1] = 50;
        rgba[i * 4 + 2] = 200;
        rgba[i * 4 + 3] = 150;
      }
    const defectPng = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const defects = {
      ...candidateData,
      overlay: `data:image/png;base64,${defectPng.toString('base64')}`,
    };
    interpretation.push(
      `${defects.count} düşük yoğunluklu aday bölge bulundu; ${defects.elongatedCount} tanesi ince/uzamış geometri ölçütünü karşılıyor. Bu bölgeler yarık, boşluk, malzeme dokusu veya görüntüleme etkisi olabilir; doğrulanmış yarık sayısı değildir.`,
    );
    interpretation.push(
      `Aday bölgelerin piksel alanı oranı %${format(defects.percent)}. ${defects.boundaryCount} bölge ölçüm sınırına temas ediyor; numune dışı alan veya kırpılmış yapı etkisi kontrol edilmelidir.`,
    );
    interpretation.push(
      defects.thresholdSource === 'user'
        ? `Aday tarama eşiği kullanıcı tarafından ${format(defects.threshold)} ${unit} olarak seçildi.`
        : `Aday tarama eşiği bu görüntünün medyan ve mutlak sapmasından ${format(defects.threshold)} ${unit} olarak otomatik önerildi; malzeme için kalibre edilmiş kabul eşiği değildir.`,
    );
    let materialReference: AnalysisResult['materialReference'];
    if (options.materialReference === 'marble-excel') {
      if (image.unit === 'HU') {
        materialReference = {
          name: 'Mermer — paylaşılan Excel',
          source: 'Z01_CT_Sayilari.xlsx / kenar paylı numune',
          meanDifferenceHU: measured.mean - -238.5,
          derivedImage: /DERIVED|REFORMATTED|AVERAGE|LOCALIZER|PROJECTION/.test(
            String(image.metadata['Görüntü türü'] ?? ''),
          ),
        };
        interpretation.push(
          `Seçilen mermer referansında örnek ortalama −238,5 HU ve standart sapma 400 HU. Bu görüntünün ortalama farkı ${format(materialReference.meanDifferenceHU)} HU; bu fark tek başına malzeme kusuru veya kalite kararı değildir.`,
        );
        if (materialReference.derivedImage)
          interpretation.push(
            'Bu görüntü türetilmiş/ortalamalı/izdüşüm etiketli; Excel’deki özgün eksenel kesitle doğrudan eşdeğer değerlendirilmemelidir.',
          );
      } else
        image.warnings.push(
          'Mermer Excel referansı gerçek HU değerlerine aittir; gri ton ve yaklaşık HU sonuçlarıyla doğrudan karşılaştırılmadı.',
        );
    }
    return {
      filename,
      width,
      height,
      unit: image.unit,
      spacing: image.spacing,
      metadata: image.metadata,
      warnings: image.warnings,
      roi: {
        ...circle,
        shape,
        ...(shape !== 'circle' ? { points, innerBoundary } : {}),
        insetPixels: inset,
        innerRadius: inner,
        automatic: shape === 'circle' && options.radius === undefined,
      },
      measurements,
      interpretation,
      defects,
      ...(materialReference ? { materialReference } : {}),
      ...(lowDensity ? { lowDensity } : {}),
      regions,
      histogram,
      preview: `data:image/png;base64,${png.toString('base64')}`,
    };
  }

  async exportExcel(result: AnalysisResult): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    book.creator = 'HUReader';
    const unit =
      result.unit === 'HU'
        ? 'HU'
        : result.unit === 'estimated-HU'
          ? 'Yaklaşık HU'
          : 'Gri ton (0–255)';
    const sheet = book.addWorksheet('CT Sayıları');
    sheet.addRow([
      'Dosya',
      'Ölçüm alanı',
      'Piksel sayısı',
      'Alan (mm²)',
      `Ortalama (${unit})`,
      `Std. sapma (${unit})`,
      `Medyan (${unit})`,
      `Min (${unit})`,
      `Maks (${unit})`,
      `%5 (${unit})`,
      `%95 (${unit})`,
    ]);
    for (const m of result.measurements)
      sheet.addRow([
        result.filename,
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
      ]);
    sheet.addRow([]);
    sheet.addRow(['Bölge', `Ortalama (${unit})`, 'Piksel sayısı']);
    for (const r of result.regions) sheet.addRow([r.label, r.mean, r.count]);
    sheet.addRow([]);
    sheet.addRow(['Ölçüm birimi', unit]);
    for (const warning of result.warnings) sheet.addRow(['Not', warning]);
    for (const text of result.interpretation ?? [])
      sheet.addRow(['Sayısal değerlendirme', text]);
    sheet.addRow([]);
    sheet.addRow([
      'Aday bölge',
      'Piksel sayısı',
      'Alan (mm²)',
      'Ortalama',
      'Kutu genişliği (px)',
      'Kutu yüksekliği (px)',
      'Kutu genişliği (mm)',
      'Kutu yüksekliği (mm)',
      'İnce/uzamış aday',
      'Sınıra temas',
    ]);
    for (const [i, region] of (result.defects?.regions ?? []).entries())
      sheet.addRow([
        i + 1,
        region.pixels,
        region.area,
        region.mean,
        region.bounds.width,
        region.bounds.height,
        region.widthMm,
        region.heightMm,
        region.elongated ? 'Evet' : 'Hayır',
        region.touchesBoundary ? 'Evet' : 'Hayır',
      ]);
    if (result.defects?.truncated)
      sheet.addRow([
        'Not',
        'En büyük 50 aday listelendi; toplamlar bütün adayları kapsar.',
      ]);
    const metadata = book.addWorksheet('DICOM Bilgileri');
    metadata.addRow(['Parametre', 'Değer']);
    for (const [key, value] of Object.entries(result.metadata))
      metadata.addRow([key, value]);
    metadata.addRow(['Matris', `${result.width} × ${result.height}`]);
    metadata.addRow([
      'Piksel boyutu X (mm)',
      result.spacing?.[0] ?? 'Belirtilmedi',
    ]);
    metadata.addRow([
      'Piksel boyutu Y (mm)',
      result.spacing?.[1] ?? 'Belirtilmedi',
    ]);
    const hist = book.addWorksheet('Histogram (Numune)');
    hist.addRow([
      `Alt sınır (${unit})`,
      `Üst sınır (${unit})`,
      'Piksel sayısı',
      'Oran (%)',
    ]);
    result.histogram.forEach((b) =>
      hist.addRow([b.lower, b.upper, b.count, b.percent]),
    );
    const roi = book.addWorksheet('Ölçüm Alanı');
    roi.addRow(['Parametre', 'Değer']);
    for (const [key, value] of Object.entries(result.roi)) {
      if (
        key === 'innerBoundary' ||
        (result.roi.points && ['radius', 'innerRadius'].includes(key))
      )
        continue;
      roi.addRow([
        key,
        typeof value === 'object' ? JSON.stringify(value) : value,
      ]);
    }
    roi.addRow([
      'Not',
      'Yeşil: ölçüm alanı; turuncu: numune sınırı; pembe: doğrulanmamış düşük yoğunluk adayları.',
    ]);
    const overlay = Buffer.from(
      `<svg width="${result.width}" height="${result.height}">${result.roi.points ? `<polygon points="${result.roi.points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#ffb454" stroke-width="1.5"/><path d="${(result.roi.innerBoundary ?? []).map(([x, y]) => `M${x - 0.5} ${y - 0.5}h1v1h-1z`).join('')}" fill="#50fa90"/>` : `<circle cx="${result.roi.x}" cy="${result.roi.y}" r="${result.roi.radius}" fill="none" stroke="#ffb454" stroke-width="1.5" stroke-dasharray="5 4"/><circle cx="${result.roi.x}" cy="${result.roi.y}" r="${result.roi.innerRadius}" fill="none" stroke="#50fa90" stroke-width="1.5"/>`}</svg>`,
    );
    const png = await sharp(
      Buffer.from(result.preview.split(',')[1]!, 'base64'),
    )
      .composite([
        ...(result.defects
          ? [
              {
                input: Buffer.from(
                  result.defects.overlay.split(',')[1]!,
                  'base64',
                ),
              },
            ]
          : []),
        { input: overlay },
      ])
      .png()
      .toBuffer();
    const imageId = book.addImage({
      base64: `data:image/png;base64,${png.toString('base64')}`,
      extension: 'png',
    });
    roi.addImage(imageId, {
      tl: { col: 0, row: roi.rowCount + 2 },
      ext: { width: 512, height: (512 * result.height) / result.width },
    });
    for (const s of book.worksheets) {
      s.views = [{ state: 'frozen', ySplit: 1 }];
      s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      s.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF176A60' },
      };
      s.columns.forEach((c, i) => {
        c.width = i === 1 ? 40 : 24;
      });
      s.eachRow((row, index) => {
        if (index > 1)
          row.eachCell((cell) => {
            if (typeof cell.value === 'number') cell.numFmt = '0.00';
          });
      });
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
}
