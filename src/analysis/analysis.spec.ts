import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { AnalysisService, parseOptions } from './analysis.service.js';
import { statistics } from './statistics.js';
import { decodeImage } from './image-decoder.js';
import { dicomFixture } from '../../test/fixtures.js';

const service = new AnalysisService();
const manual = { centerX: 4, centerY: 4, radius: 3, insetPixels: 1 };
async function grayImage(value = 128) {
  return sharp(Buffer.alloc(64, value), {
    raw: { width: 8, height: 8, channels: 1 },
  })
    .png()
    .toBuffer();
}

describe('Numerical analysis', () => {
  it('uses population standard deviation and interpolated percentiles', () => {
    const s = statistics([1, 2, 3, 4], 0.25);
    expect(s.mean).toBe(2.5);
    expect(s.std).toBeCloseTo(Math.sqrt(1.25));
    expect(s.median).toBe(2.5);
    expect(s.p5).toBeCloseTo(1.15);
    expect(s.p95).toBeCloseTo(3.85);
    expect(s.area).toBe(1);
  });
  it('measures circular ROI and histogram without inventing HU or physical area', async () => {
    const r = await service.analyze(await grayImage(), 'sample.png', manual);
    expect(r.unit).toBe('gray');
    expect(r.spacing).toBeNull();
    expect(r.measurements[0]).toMatchObject({
      count: 13,
      mean: 128,
      std: 0,
      area: null,
      min: 128,
      max: 128,
    });
    expect(r.measurements[1]!.count).toBe(29);
    expect(r.measurements[2]!.count).toBe(64);
    expect(r.histogram.reduce((sum, b) => sum + b.count, 0)).toBe(13);
    expect(r.histogram.reduce((sum, b) => sum + b.percent, 0)).toBeCloseTo(100);
  });
  it('labels window-derived values as estimates and uses supplied spacing', async () => {
    const r = await service.analyze(await grayImage(255), 'sample.png', {
      ...manual,
      windowMin: -1000,
      windowMax: 1000,
      spacingX: 0.2,
      spacingY: 0.3,
    });
    expect(r.unit).toBe('estimated-HU');
    expect(r.measurements[0]!.mean).toBe(1000);
    expect(r.measurements[0]!.area).toBeCloseTo(13 * 0.06);
  });
  it('uses the same EXIF orientation as the browser for manual JPEG coordinates', async () => {
    const pixels = Buffer.alloc(200 * 100 * 3);
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 200; x++)
        for (let c = 0; c < 3; c++)
          pixels[(y * 200 + x) * 3 + c] = x < 100 ? 50 : 200;
    const jpeg = await sharp(pixels, {
      raw: { width: 200, height: 100, channels: 3 },
    })
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const r = await service.analyze(jpeg, 'rotated.jpg', {
      centerX: 50,
      centerY: 150,
      radius: 20,
      insetPixels: 0,
    });
    expect([r.width, r.height]).toEqual([100, 200]);
    expect(r.measurements[0]!.mean).toBeCloseTo(200, 0);
  });
  it('fits a synthetic off-center disk and excludes a lower support', async () => {
    const width = 200,
      height = 200,
      pixels = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (Math.hypot(x - 106, y - 95) < 57 || y > 170)
          pixels[y * width + x] = 170;
    const buffer = await sharp(pixels, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const r = await service.analyze(buffer, 'circle.png', {});
    expect(r.roi.x).toBeCloseTo(106, 0);
    expect(r.roi.y).toBeCloseTo(95, 0);
    expect(Math.abs(r.roi.radius - 57)).toBeLessThan(2);
  });
  it.each(['uniform', 'rectangle'])(
    'does not invent a circular sample on a %s image',
    async (kind) => {
      const width = 200,
        height = 200,
        pixels = Buffer.alloc(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (kind === 'uniform' || (x > 40 && x < 160 && y > 30 && y < 175))
            pixels[y * width + x] = 180;
      const image = await sharp(pixels, { raw: { width, height, channels: 1 } })
        .png()
        .toBuffer();
      if (kind === 'uniform') {
        await expect(service.analyze(image, `${kind}.png`, {})).rejects.toThrow(
          'Dairesel numune',
        );
      } else {
        const result = await service.analyze(image, `${kind}.png`, {});
        expect(result.roi.shape).toBe('polygon');
        expect(result.roi.outlines).toHaveLength(1);
        expect(result.measurements[0].mean).toBe(180);
      }
      // Manual ROI remains possible on a deliberately selected region.
      const manualResult = await service.analyze(image, `${kind}.png`, {
        centerX: 100,
        centerY: 100,
        radius: 20,
        insetPixels: 0,
      });
      expect(manualResult.measurements[0]!.mean).toBe(180);
    },
  );
  it('rejects an invalid ROI, empty input, and unsupported images', async () => {
    await expect(
      service.analyze(await grayImage(), 'x.png', { ...manual, radius: 20 }),
    ).rejects.toThrow('sınırları');
    await expect(
      service.analyze(Buffer.from('bad'), 'x.png', manual),
    ).rejects.toThrow('Geçerli PNG');
    expect(() => statistics([], null)).toThrow('geçerli piksel');
  });
  it('validates incomplete, nonfinite and negative options', () => {
    for (const input of [
      { centerX: '1' },
      { spacingX: '.2' },
      { windowMin: '0', windowMax: '-1' },
      { radius: 'NaN' },
      { insetPixels: '-2' },
      { centerX: [] },
    ])
      expect(() => parseOptions(input)).toThrow();
    expect(
      parseOptions({ insetPixels: '0', windowMin: '-1000', windowMax: '1000' }),
    ).toMatchObject({ insetPixels: 0, windowMin: -1000, windowMax: 1000 });
  });
  it('exports four sheets, preserved measurements and a marked preview', async () => {
    const r = await service.analyze(await grayImage(), 'sample.png', manual);
    const buffer = await service.exportExcel(r);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(buffer).buffer);
    expect(book.worksheets.map((s) => s.name)).toEqual([
      'CT Sayıları',
      'DICOM Bilgileri',
      'Histogram (Numune)',
      'Ölçüm Alanı',
    ]);
    expect(book.worksheets[0]!.getCell('E2').value).toBe(128);
    expect(book.worksheets[3]!.getImages()).toHaveLength(1);
  });
});

describe('DICOM decoding', () => {
  it('applies rescale and preserves X/Y spacing orientation', async () => {
    const image = await decodeImage(dicomFixture(), {});
    expect(image.unit).toBe('HU');
    expect(image.values[0]).toBe(-24);
    expect(image.spacing).toEqual([0.25, 0.5]);
  });
  it('reads signed pixels and excludes padding in stored-value space', async () => {
    const image = await decodeImage(
      dicomFixture({
        signed: true,
        padding: true,
        slope: '2',
        intercept: '10',
      }),
      {},
    );
    expect(image.valid[0]).toBe(0);
    expect(image.valid[1]).toBe(1);
    expect(image.values[1]).toBe(-190);
  });
  it('rejects compressed, multiframe, and invalid rescale files', async () => {
    await expect(
      decodeImage(dicomFixture({ compressed: true }), {}),
    ).rejects.toThrow('sıkıştırılmamış');
    await expect(
      decodeImage(dicomFixture({ frames: '2' }), {}),
    ).rejects.toThrow('Tek kareli');
    await expect(
      decodeImage(dicomFixture({ slope: 'NaN' }), {}),
    ).rejects.toThrow('RescaleSlope');
  });
});

it('identifies derived averaged DICOM images without treating them as original slices', async () => {
  const image = await decodeImage(
    dicomFixture({ imageType: 'DERIVED\\SECONDARY\\REFORMATTED\\AVERAGE' }),
    {},
  );
  expect(image.metadata['Görüntü türü']).toContain('AVERAGE');
  expect(image.warnings.some((w) => w.includes('özgün kesitlerle'))).toBe(true);
});
