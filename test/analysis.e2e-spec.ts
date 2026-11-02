import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module.js';
import { dicomFixture } from './fixtures.js';

describe('Analysis HTTP API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  const upload = (path = '/api/analyze') =>
    request(app.getHttpServer())
      .post(path)
      .field('centerX', '4')
      .field('centerY', '4')
      .field('radius', '3')
      .field('insetPixels', '1');
  it('previews DICOM without requiring an automatic ROI or returning patient data', async () => {
    const file = dicomFixture();
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', file, { filename: 'Z01' })
      .expect(400);
    const res = await request(app.getHttpServer())
      .post('/api/preview')
      .attach('file', file, { filename: 'Z01' })
      .expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ width: 8, height: 8, unit: 'HU' });
    expect(res.body).not.toHaveProperty('metadata');
    expect(res.body).not.toHaveProperty('measurements');
    const png = Buffer.from(res.body.preview.split(',')[1], 'base64');
    expect(await sharp(png).metadata()).toMatchObject({
      format: 'png',
      width: 8,
      height: 8,
    });
    await request(app.getHttpServer()).post('/api/preview').expect(400);
    await request(app.getHttpServer())
      .post('/api/preview')
      .attach('file', Buffer.from('broken'), { filename: 'Z01' })
      .expect(400);
  });
  it('returns a usable DICOM measurement and omits patient data', async () => {
    const res = await upload()
      .attach('file', dicomFixture(), { filename: 'Z01.dcm' })
      .expect(201);
    expect(res.body.unit).toBe('HU');
    expect(res.body.measurements[0].mean).toBe(-24);
    expect(res.body.preview).toMatch(/^data:image\/png;base64,/);
    expect(res.body.metadata).not.toHaveProperty('PatientName');
  });
  it('returns grayscale results for PNG', async () => {
    const image = await sharp(Buffer.alloc(64, 100), {
      raw: { width: 8, height: 8, channels: 1 },
    })
      .png()
      .toBuffer();
    const res = await upload()
      .attach('file', image, { filename: 'sample.png' })
      .expect(201);
    expect(res.body.unit).toBe('gray');
    expect(res.body.measurements[0].mean).toBe(100);
  });
  it('measures rectangular and concave areas with an inward margin', async () => {
    const data = Buffer.from(
      Array.from({ length: 64 }, (_, i) => (i % 8) + 10 * Math.floor(i / 8)),
    );
    const image = await sharp(data, {
      raw: { width: 8, height: 8, channels: 1 },
    })
      .png()
      .toBuffer();
    const measure = (shape: string, points: number[][]) =>
      request(app.getHttpServer())
        .post('/api/analyze')
        .field('roiShape', shape)
        .field('roiPoints', JSON.stringify(points))
        .field('insetPixels', '1')
        .field('spacingX', '2')
        .field('spacingY', '3')
        .field('lowDensityThreshold', '44')
        .attach('file', image, 'ramp.png');
    const rectangle = await measure('rectangle', [
      [2, 2],
      [6, 6],
    ]).expect(201);
    expect(rectangle.body.measurements[0]).toMatchObject({
      count: 9,
      mean: 44,
      area: 54,
      min: 33,
      max: 55,
      median: 44,
    });
    expect(rectangle.body.measurements[0].std).toBeCloseTo(Math.sqrt(202 / 3));
    expect(rectangle.body.measurements[1].count).toBe(25);
    expect(rectangle.body.lowDensity.count).toBe(5);
    expect(rectangle.body.lowDensity.percent).toBeCloseTo(500 / 9);
    expect(rectangle.body.regions[4]).toMatchObject({ count: 0, mean: null });
    const polygon = await measure('polygon', [
      [1, 1],
      [6, 1],
      [6, 3],
      [3, 3],
      [3, 6],
      [1, 6],
    ]).expect(201);
    expect(polygon.body.measurements[1].count).toBe(27);
    expect(polygon.body.measurements[0].count).toBe(7);
    expect(polygon.body.measurements[0].mean).toBeCloseTo(220 / 7);
    expect(polygon.body.roi.innerBoundary.length).toBeGreaterThan(0);
    await measure('polygon', [
      [1, 1],
      [6, 6],
      [1, 6],
      [6, 1],
    ]).expect(400);
    await measure('polygon', [
      [1, 1],
      [9, 1],
      [1, 6],
    ]).expect(400);
    await measure('rectangle', [
      [2, 2],
      [2, 6],
    ]).expect(400);
    await request(app.getHttpServer())
      .post('/api/export')
      .field('roiShape', 'polygon')
      .field(
        'roiPoints',
        JSON.stringify([
          [1, 1],
          [6, 1],
          [6, 3],
          [3, 3],
          [3, 6],
          [1, 6],
        ]),
      )
      .field('insetPixels', '1')
      .attach('file', image, 'ramp.png')
      .expect(201);
  });
  it('reports and visualizes a synthetic dark line without calling it a confirmed crack', async () => {
    const pixels = Buffer.alloc(64 * 64, 180);
    for (let y = 10; y < 40; y++) pixels[y * 64 + 20] = 0;
    const image = await sharp(pixels, {
      raw: { width: 64, height: 64, channels: 1 },
    })
      .png()
      .toBuffer();
    const res = await request(app.getHttpServer())
      .post('/api/analyze')
      .field('roiShape', 'rectangle')
      .field('roiPoints', '[[5,5],[58,58]]')
      .field('insetPixels', '2')
      .field('spacingX', '.5')
      .field('spacingY', '.5')
      .field('materialReference', 'marble-excel')
      .attach('file', image, 'line.png')
      .expect(201);
    expect(res.body.defects).toMatchObject({
      count: 1,
      elongatedCount: 1,
      pixels: 30,
      area: 7.5,
      thresholdSource: 'robust',
    });
    expect(res.body.defects.regions[0]).toMatchObject({
      mean: 0,
      widthMm: 0.5,
      heightMm: 15,
    });
    expect(res.body.materialReference).toBeUndefined();
    expect(res.body.warnings.some((w: string) => w.includes('gerçek HU'))).toBe(
      true,
    );
    expect(res.body.interpretation.join(' ')).toContain(
      'doğrulanmış yarık sayısı değildir',
    );
    const overlay = await sharp(
      Buffer.from(res.body.defects.overlay.split(',')[1], 'base64'),
    )
      .raw()
      .toBuffer();
    expect(overlay[(10 * 64 + 20) * 4 + 3]).toBe(150);
    expect(overlay[(10 * 64 + 19) * 4 + 3]).toBe(0);
    const reference = await upload()
      .field('materialReference', 'marble-excel')
      .attach('file', dicomFixture(), 'CT')
      .expect(201);
    expect(reference.body.materialReference.meanDifferenceHU).toBe(214.5);
    expect(reference.body.measurements[0].mean).toBe(-24);
  });
  it('automatically measures separate flat pieces when a circle cannot be found', async () => {
    const data = Buffer.alloc(128 * 128);
    for (const [top, value] of [
      [10, 80],
      [70, 160],
    ])
      for (let y = top!; y < top! + 40; y++)
        for (let x = 40; x < 60; x++) data[y * 128 + x] = value!;
    const image = await sharp(data, {
      raw: { width: 128, height: 128, channels: 1 },
    })
      .png()
      .toBuffer();
    const res = await request(app.getHttpServer())
      .post('/api/analyze')
      .field('insetPixels', '1')
      .attach('file', image, 'flat.png')
      .expect(201);
    expect(res.body.roi).toMatchObject({ automatic: true, shape: 'polygon' });
    expect(res.body.roi.outlines).toHaveLength(2);
    expect(res.body.measurements[0].count).toBe(1368);
    expect(res.body.measurements[0].mean).toBeCloseTo(120, 8);
    expect(
      res.body.parts.map(
        (p: { measurements: { mean: number } }) => p.measurements.mean,
      ),
    ).toEqual([80, 160]);
    expect(res.body.interpretation[0]).toContain('birleşik alan');
    await request(app.getHttpServer())
      .post('/api/export')
      .attach('file', image, 'flat.png')
      .expect(201);
  });
  it.each(['concave', 'rotated', 'light-background', 'multiple-round'])(
    'uses the same automatic pipeline for a %s sample',
    async (kind) => {
      const data = Buffer.alloc(
        128 * 128,
        kind === 'light-background' ? 240 : 0,
      );
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++) {
          const u = (x - 64) * Math.cos(0.7) + (y - 64) * Math.sin(0.7),
            v = -(x - 64) * Math.sin(0.7) + (y - 64) * Math.cos(0.7);
          const included =
            kind === 'multiple-round'
              ? Math.hypot(x - 38, y - 64) < 16 ||
                Math.hypot(x - 90, y - 64) < 16
              : kind === 'rotated'
                ? Math.abs(u) < 35 && Math.abs(v) < 14
                : x >= 20 && x < 90 && y >= 20 && y < 90 && (x < 40 || y < 40);
          if (included)
            data[y * 128 + x] = kind === 'light-background' ? 60 : 180;
        }
      const image = await sharp(data, {
        raw: { width: 128, height: 128, channels: 1 },
      })
        .png()
        .toBuffer();
      const response = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', image, 'sample.png')
        .expect(201);
      expect(response.body.roi).toMatchObject({
        automatic: true,
        shape: 'polygon',
      });
      expect(response.body.parts).toHaveLength(
        kind === 'multiple-round' ? 2 : 1,
      );
      expect(response.body.measurements[0].count).toBeGreaterThan(100);
      expect(response.body.measurements[0].mean).toBeCloseTo(
        kind === 'light-background' ? 60 : 180,
      );
      if (kind === 'concave' || kind === 'light-background') {
        const decoded = await sharp(
          Buffer.from(response.body.roi.labelMask.split(',')[1], 'base64'),
        )
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(decoded.data[(80 * 128 + 80) * decoded.info.channels]).toBe(0);
        expect(decoded.data[(25 * 128 + 25) * decoded.info.channels]).toBe(1);
      }
      await request(app.getHttpServer())
        .post('/api/export')
        .attach('file', image, 'sample.png')
        .expect(201);
    },
  );
  it('downloads a real Excel archive', async () => {
    const res = await upload('/api/export')
      .attach('file', dicomFixture(), { filename: 'Z01.dcm' })
      .expect(201);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('HUReader-rapor.xlsx');
  });
  it('preserves folder-relative paths without using them as filesystem paths', async () => {
    const res = await upload()
      .field('sourcePath', 'Numuneler/seri-1/Z01.dcm')
      .attach('file', dicomFixture(), { filename: 'Z01.dcm' })
      .expect(201);
    expect(res.body.filename).toBe('Numuneler/seri-1/Z01.dcm');
    expect(res.body.measurements[0].mean).toBe(-24);
  });
  it('rejects absolute, traversal and ambiguous relative source paths', async () => {
    for (const sourcePath of [
      '/private/CT.dcm',
      '../CT.dcm',
      'seri/../CT.dcm',
      'seri//CT.dcm',
      'seri\\CT.dcm',
    ]) {
      await upload()
        .field('sourcePath', sourcePath)
        .attach('file', dicomFixture(), { filename: 'Z01.dcm' })
        .expect(400);
    }
  });
  it('rejects missing, invalid and malformed input', async () => {
    await request(app.getHttpServer()).post('/api/analyze').expect(400);
    await upload()
      .attach('file', Buffer.from('not an image'), { filename: 'x.png' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .field('centerX', 'NaN')
      .attach('file', dicomFixture(), { filename: 'Z01.dcm' })
      .expect(400);
  });
});
