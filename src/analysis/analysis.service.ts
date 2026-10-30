import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { decodeImage } from './image-decoder.js';
import { detectCircle, statistics } from './statistics.js';
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
  async analyze(
    buffer: Buffer,
    filename: string,
    options: AnalysisOptions,
  ): Promise<AnalysisResult> {
    const image = await decodeImage(buffer, options);
    const { width, height, values, valid } = image;
    let circle: Circle;
    if (options.radius !== undefined)
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
    if (r < 2 || cx - r < 0 || cy - r < 0 || cx + r > width || cy + r > height)
      throw new BadRequestException(
        'Ölçüm çemberi görüntü sınırları içinde ve yarıçapı en az 2 piksel olmalıdır.',
      );
    // 2.1 mm physical inset where spacing exists; otherwise 10 pixels as in workbook.
    const inset =
      options.insetPixels ??
      (image.spacing ? 2.1 / Math.min(...image.spacing) : 10);
    if (inset >= r)
      throw new BadRequestException('Kenar payı yarıçaptan küçük olmalıdır.');
    const inner = r - inset;
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
        if (d2 <= r * r) full.push(v);
        if (d2 <= inner * inner) {
          sample.push(v);
          regionValues[y < cy ? 0 : 1]!.push(v);
          regionValues[x < cx ? 2 : 3]!.push(v);
          if (d2 <= (inner / 4) ** 2) regionValues[4]!.push(v);
          if (d2 <= (inner / 2) ** 2) regionValues[5]!.push(v);
        }
      }
    const pixelArea = image.spacing
      ? image.spacing[0] * image.spacing[1]
      : null;
    const measurements = [
      {
        label: 'Numune (kenar payı uygulanmış)',
        ...statistics(sample, pixelArea),
      },
      { label: 'Numune (tam kesit)', ...statistics(full, pixelArea) },
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
      'Merkez (r/4)',
      'Merkez (r/2)',
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
        'Piksel boyutları farklı: çember piksel koordinatlarında tanımlıdır; fiziksel kenar payı küçük piksel boyutuna göre uygulanır.',
      );
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
        insetPixels: inset,
        innerRadius: inner,
        automatic: options.radius === undefined,
      },
      measurements,
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
    for (const [key, value] of Object.entries(result.roi))
      roi.addRow([key, value]);
    roi.addRow([
      'Not',
      'Yeşil: ölçüm alanı; kesikli turuncu: numune dış sınırı.',
    ]);
    const overlay = Buffer.from(
      `<svg width="${result.width}" height="${result.height}"><circle cx="${result.roi.x}" cy="${result.roi.y}" r="${result.roi.radius}" fill="none" stroke="#ffb454" stroke-width="1.5" stroke-dasharray="5 4"/><circle cx="${result.roi.x}" cy="${result.roi.y}" r="${result.roi.innerRadius}" fill="none" stroke="#50fa90" stroke-width="1.5"/></svg>`,
    );
    const png = await sharp(
      Buffer.from(result.preview.split(',')[1]!, 'base64'),
    )
      .composite([{ input: overlay }])
      .png()
      .toBuffer();
    const imageId = book.addImage({
      base64: `data:image/png;base64,${png.toString('base64')}`,
      extension: 'png',
    });
    roi.addImage(imageId, {
      tl: { col: 0, row: 11 },
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
