import { BadRequestException } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import dicomParser from 'dicom-parser';
import type { AnalysisOptions, ImageData } from './analysis.types.js';

import { checkImageDimensions, imagePixelLimit } from './image-limits.js';
export async function decodeImage(
  buffer: Buffer,
  options: AnalysisOptions,
): Promise<ImageData> {
  const dicom =
    buffer.length > 132 && buffer.toString('ascii', 128, 132) === 'DICM';
  if (dicom) return decodeDicom(buffer);
  const limit = imagePixelLimit();
  let metadata: Metadata;
  try {
    // Read dimensions before decoding so an oversized file gets a precise error.
    metadata = await sharp(buffer, {
      limitInputPixels: false,
      animated: false,
    }).metadata();
  } catch {
    throw new BadRequestException(
      'Dosya okunamadı. Geçerli PNG, JPG veya DICOM Part 10 dosyası yükleyin.',
    );
  }
  if (!['png', 'jpeg'].includes(metadata.format ?? '')) {
    throw new BadRequestException(
      'Bu dosya biçimi desteklenmiyor. PNG, JPG veya DICOM Part 10 dosyası yükleyin.',
    );
  }
  checkImageDimensions(metadata.width ?? 0, metadata.height ?? 0, limit);
  let raw;
  try {
    raw = await sharp(buffer, {
      limitInputPixels: limit || false,
      animated: false,
    })
      .autoOrient()
      .flatten({ background: '#000000' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new BadRequestException(
      'Görüntünün piksel verisi okunamadı; dosya eksik veya bozuk olabilir.',
    );
  }
  const estimated = options.windowMin !== undefined;
  const values = Float64Array.from(raw.data, (v) =>
    estimated
      ? options.windowMin! +
        (v / 255) * (options.windowMax! - options.windowMin!)
      : v,
  );
  return {
    width: raw.info.width,
    height: raw.info.height,
    values,
    display: Uint8Array.from(raw.data),
    valid: new Uint8Array(values.length).fill(1),
    unit: estimated ? 'estimated-HU' : 'gray',
    spacing:
      options.spacingX !== undefined
        ? [options.spacingX, options.spacingY!]
        : null,
    metadata: {
      Kaynak: 'PNG/JPG (8 bit gri tonlama)',
      ...(estimated
        ? {
            'Pencere alt sınırı': options.windowMin!,
            'Pencere üst sınırı': options.windowMax!,
          }
        : {}),
    },
    warnings: [
      estimated
        ? 'HU değerleri belirtilen pencere aralığından yaklaşık hesaplandı. Kırpılmış tonlar, çizimler ve görüntü işleme ölçümleri etkiler; özgün DICOM ölçümü değildir.'
        : 'Bu görüntüde HU kalibrasyonu yoktur. Sonuçlar 0–255 gri ton yoğunluğudur.',
      'Görüntü üzerindeki çizgiler ve yazılar da pikseldir. Mümkünse işaretlenmemiş özgün kesiti kullanın.',
      ...(options.spacingX === undefined
        ? ['Piksel boyutu verilmediğinden alan mm² cinsinden hesaplanmadı.']
        : []),
    ],
  };
}

function decodeDicom(buffer: Buffer): ImageData {
  let ds: dicomParser.DataSet;
  try {
    ds = dicomParser.parseDicom(new Uint8Array(buffer));
  } catch {
    throw new BadRequestException('DICOM dosyası okunamadı veya dosya eksik.');
  }
  const syntax = ds.string('x00020010');
  if (
    ![
      '1.2.840.10008.1.2',
      '1.2.840.10008.1.2.1',
      '1.2.840.10008.1.2.2',
    ].includes(syntax ?? '')
  ) {
    throw new BadRequestException(
      'Bu sürüm sıkıştırılmamış DICOM destekler. JPEG/JPEG2000/RLE dosyasını sıkıştırılmamış DICOM olarak dışa aktarın.',
    );
  }
  if (ds.string('x00080060') !== 'CT')
    throw new BadRequestException(
      'HU analizi için CT modalitesinde DICOM gerekir.',
    );
  const width = ds.uint16('x00280011') ?? 0,
    height = ds.uint16('x00280010') ?? 0;
  const bits = ds.uint16('x00280100') ?? 0,
    stored = ds.uint16('x00280101') ?? 0,
    high = ds.uint16('x00280102') ?? -1;
  const representation = ds.uint16('x00280103');
  const photometric = ds.string('x00280004');
  if (
    !width ||
    !height ||
    ![8, 16].includes(bits) ||
    stored < 1 ||
    stored > bits ||
    high !== stored - 1 ||
    ![0, 1].includes(representation ?? -1) ||
    ds.uint16('x00280002') !== 1 ||
    !['MONOCHROME1', 'MONOCHROME2'].includes(photometric ?? '') ||
    Number(ds.string('x00280008') ?? 1) !== 1
  ) {
    throw new BadRequestException(
      'Tek kareli, tek kanallı, 8/16 bit CT DICOM gerekir.',
    );
  }
  checkImageDimensions(width, height, imagePixelLimit());
  if (ds.elements.x00283000 || ds.elements.x00409096)
    throw new BadRequestException(
      'LUT/gerçek değer eşlemesi içeren DICOM bu sürümde desteklenmiyor.',
    );
  const slope = Number(ds.string('x00281053')),
    intercept = Number(ds.string('x00281052'));
  if (
    !ds.string('x00281053') ||
    !ds.string('x00281052') ||
    !Number.isFinite(slope) ||
    !slope ||
    !Number.isFinite(intercept)
  )
    throw new BadRequestException(
      'DICOM RescaleSlope/RescaleIntercept değerleri eksik veya geçersiz.',
    );
  const rescaleType = ds.string('x00281054');
  if (rescaleType && rescaleType !== 'HU')
    throw new BadRequestException('DICOM dönüşüm birimi HU değil.');
  const pixel = ds.elements.x7fe00010,
    byteCount = (width * height * bits) / 8;
  if (
    !pixel ||
    pixel.length < byteCount ||
    pixel.dataOffset + byteCount > ds.byteArray.length
  )
    throw new BadRequestException('DICOM piksel verisi eksik.');
  const raw = Buffer.from(
    ds.byteArray.buffer,
    ds.byteArray.byteOffset,
    ds.byteArray.byteLength,
  );
  const signed = representation === 1;
  const padding = signed ? ds.int16('x00280120') : ds.uint16('x00280120');
  const paddingLimit =
    (signed ? ds.int16('x00280121') : ds.uint16('x00280121')) ?? padding;
  const values = new Float64Array(width * height),
    valid = new Uint8Array(values.length);
  const mask = 2 ** stored - 1;
  let lo = Infinity;
  for (let i = 0; i < values.length; i++) {
    const offset = pixel.dataOffset + (i * bits) / 8;
    let v =
      (bits === 8
        ? raw.readUInt8(offset)
        : syntax === '1.2.840.10008.1.2.2'
          ? raw.readUInt16BE(offset)
          : raw.readUInt16LE(offset)) & mask;
    if (signed && v >= 2 ** (stored - 1)) v -= 2 ** stored;
    const excluded =
      padding !== undefined &&
      v >= Math.min(padding, paddingLimit!) &&
      v <= Math.max(padding, paddingLimit!);
    values[i] = v * slope + intercept;
    if (!Number.isFinite(values[i]))
      throw new BadRequestException(
        'DICOM dönüşümü sonlu bir sayısal değer üretmedi.',
      );
    valid[i] = excluded ? 0 : 1;
    if (!excluded) {
      lo = Math.min(lo, values[i]!);
    }
  }
  if (!Number.isFinite(lo))
    throw new BadRequestException('Geçerli görüntü pikseli bulunamadı.');
  const display = Uint8Array.from(values, (v, i) =>
    !valid[i]
      ? 0
      : Math.round(Math.max(0, Math.min(255, ((v + 1000) / 2000) * 255))),
  );
  const space = (ds.string('x00280030') ?? '').split('\\').map(Number);
  const spacing: ImageData['spacing'] =
    space.length === 2 && space.every((v) => Number.isFinite(v) && v > 0)
      ? [space[1]!, space[0]!]
      : null;
  const metadata: ImageData['metadata'] = {
    Kaynak: 'CT DICOM',
    'Rescale Slope': slope,
    'Rescale Intercept': intercept,
    'Görüntü penceresi': '−1000 … +1000 HU',
  };
  for (const [label, tag] of Object.entries({
    Cihaz: 'x00080070',
    Model: 'x00081090',
    'Seri açıklaması': 'x0008103e',
    'Tüp gerilimi (kV)': 'x00180060',
    'Tüp akımı (mA)': 'x00181151',
    'Kesit kalınlığı (mm)': 'x00180050',
    'Kesit no': 'x00200013',
    'Kesit konumu (mm)': 'x00201041',
    'Rekonstrüksiyon filtresi': 'x00181210',
  })) {
    const value = ds.string(tag);
    if (value) metadata[label] = value;
  }
  return {
    width,
    height,
    values,
    valid,
    display,
    unit: 'HU',
    spacing,
    metadata,
    warnings: [
      ...(spacing ? [] : ['DICOM piksel boyutu eksik; mm² hesaplanmadı.']),
      ...(rescaleType
        ? []
        : [
            'Rescale Type belirtilmemiş; CT modalitesi ve doğrusal rescale bilgisi HU olarak kullanıldı.',
          ]),
      ...(padding === undefined
        ? [
            'Pixel Padding etiketi yok; tarama alanı dışı pikseller otomatik dışlanmadı.',
          ]
        : ['DICOM Pixel Padding aralığı ölçümlerden dışlandı.']),
    ],
  };
}
