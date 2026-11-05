import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { decodeImage } from './image-decoder.js';
import { AnalysisService } from './analysis.service.js';
import { findDefectCandidates } from './defect-candidates.js';
import type { ImageData } from './analysis.types.js';

const service = new AnalysisService();
const options = { centerX: 32, centerY: 32, radius: 25, insetPixels: 0 };
async function png(pixels: Buffer, width = 64, height = 64) {
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
function solid(alpha = 255) {
  return Buffer.from(
    Array.from({ length: 64 * 64 }, () => [170, 170, 170, alpha]).flat(),
  );
}
function patch(pixels: Buffer, color: number[]) {
  for (let y = 28; y < 34; y++)
    for (let x = 28; x < 34; x++)
      color.forEach((value, c) => {
        pixels[(y * 64 + x) * 4 + c] = value;
      });
}

it('keeps partial alpha separate from tone rather than darkening RGB measurements', async () => {
  const opaque = await service.analyze(
    await png(solid()),
    'opaque.png',
    options,
  );
  const partial = await service.analyze(
    await png(solid(100)),
    'partial.png',
    options,
  );
  expect(partial.measurements).toEqual(opaque.measurements);
  expect(partial.measurements[0]!.mean).toBe(170);
  expect(partial.defects!.count).toBe(0);
  expect(partial.defects!.appearance!.alpha).toBe(100);
});

it('detects an alpha-only patch without classifying it as darker material', async () => {
  const pixels = solid();
  patch(pixels, [170, 170, 170, 100]);
  const result = await service.analyze(await png(pixels), 'alpha.png', options);
  expect(result.measurements[0]!.std).toBe(0);
  expect(result.defects!.count).toBe(1);
  expect(result.defects!.pixels).toBe(36);
  expect(result.defects!.regions[0]!.signals).toEqual(['alpha']);
  expect(result.defects!.regions[0]!.mean).toBe(170);
});

it('excludes fully transparent RGB from measurements, thresholds and candidates', async () => {
  const a = solid(),
    b = solid();
  patch(a, [0, 0, 0, 0]);
  patch(b, [255, 50, 220, 0]);
  const first = await service.analyze(await png(a), 'hidden-a.png', options);
  const second = await service.analyze(await png(b), 'hidden-b.png', options);
  expect(first.measurements).toEqual(second.measurements);
  expect(first.measurements[0]!.count).toBe(1961 - 36);
  expect(first.defects!.count).toBe(0);
  expect(first.defects!.appearance).toEqual(second.defects!.appearance);
  expect(first.metadata['Şeffaf piksel (ölçüm dışı)']).toBe(36);
  expect(first.metadata['Otomatik sınır referansı']).toBeUndefined();
  expect(second.defects!.count).toBe(0);
});

it('rejects a fully transparent image explicitly', async () => {
  await expect(decodeImage(await png(solid(0)), {})).rejects.toThrow(
    'tamamen şeffaf',
  );
});

it('detects a brighter color patch, preserves source colors in preview, and exports reasons', async () => {
  const pixels = solid();
  patch(pixels, [0, 255, 0, 255]);
  const result = await service.analyze(await png(pixels), 'color.png', options);
  expect(result.defects!.count).toBe(1);
  expect(result.defects!.regions[0]!.signals).toContain('color');
  expect(result.defects!.pixels).toBe(36);
  expect(result.defects!.regions[0]!.signals).not.toContain('intensity');
  const preview = await sharp(
    Buffer.from(result.preview.split(',')[1]!, 'base64'),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect(
    Array.from(preview.subarray((30 * 64 + 30) * 4, (30 * 64 + 30) * 4 + 4)),
  ).toEqual([0, 255, 0, 255]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await service.exportExcel(result));
  const sheet = workbook.worksheets[0]!;
  let reasons: unknown;
  sheet.eachRow((row, index) => {
    if (row.getCell(11).value === 'Tespit nedenleri')
      reasons = sheet.getRow(index + 1).getCell(11).value;
  });
  expect(String(reasons)).toContain('Renk farkı');
});

it('keeps explicit intensity thresholds authoritative', async () => {
  const pixels = solid();
  patch(pixels, [0, 255, 0, 100]);
  const result = await service.analyze(await png(pixels), 'manual.png', {
    ...options,
    lowDensityThreshold: 0,
  });
  expect(result.defects!.count).toBe(0);
  expect(result.defects!.thresholdSource).toBe('user');
  expect(result.defects!.appearance).toBeUndefined();
});

it('can use a transparent background to propose an opaque black sample boundary', async () => {
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = 20; y < 100; y++)
    for (let x = 25; x < 105; x++) pixels[(y * 128 + x) * 4 + 3] = 255;
  const result = await service.analyze(
    await png(pixels, 128, 128),
    'black.png',
    {},
  );
  expect(result.roi.automatic).toBe(true);
  expect(result.metadata['Otomatik sınır referansı']).toBe(
    'Alfa görünürlük maskesi',
  );
  expect(result.measurements[0]!.mean).toBe(0);
  expect(result.measurements[0]!.count).toBeGreaterThan(0);
  expect(result.defects!.count).toBe(0);
});

function gradient() {
  const width = 100,
    height = 64;
  const values = new Float64Array(width * height),
    rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      values[i] = 100 + x;
      rgba.set([values[i]!, values[i]!, values[i]!, 255], i * 4);
    }
  const image: ImageData = {
    width,
    height,
    values,
    rgba,
    display: Uint8Array.from(values),
    valid: new Uint8Array(values.length).fill(1),
    unit: 'gray',
    spacing: null,
    metadata: {},
    warnings: [],
  };
  const roi = image.valid.slice();
  const sorted = () =>
    Array.from(values)
      .filter((_, i) => roi[i])
      .sort((a, b) => a - b);
  return { image, roi, sorted };
}

it('detects a narrow local dark feature missed by the global threshold, without marking a smooth gradient', () => {
  const { image, roi, sorted } = gradient();
  expect(findDefectCandidates(image, roi, sorted()).count).toBe(0);
  for (let y = 15; y < 45; y++) {
    const i = y * image.width + 80;
    image.values[i] = image.display[i] = 130;
    image.rgba!.set([130, 130, 130, 255], i * 4);
  }
  const result = findDefectCandidates(image, roi, sorted());
  expect(result.threshold).toBeLessThan(130);
  expect(result.mask[25 * image.width + 80]).toBe(1);
  expect(result.regions[0]!.signals).toContain('local-contrast');
  expect(result.regions[0]!.signals).not.toContain('intensity');
});

it('ignores color and alpha outside the selected valid ROI', () => {
  const { image, roi, sorted } = gradient();
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < 30; x++) {
      const i = y * image.width + x;
      roi[i] = 0;
      image.rgba!.set([0, 255, 0, 32], i * 4);
    }
  expect(findDefectCandidates(image, roi, sorted()).count).toBe(0);
});
