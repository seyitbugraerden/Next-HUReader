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
  it('downloads a real Excel archive', async () => {
    const res = await upload('/api/export')
      .attach('file', dicomFixture(), { filename: 'Z01.dcm' })
      .expect(201);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('HUReader-rapor.xlsx');
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
