import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { dicomFixture } from '../fixtures.js';
import { settled, calculate } from './helpers.js';

test('color, tone and alpha evidence survives preview, analysis and report navigation', async ({
  page,
}) => {
  const width = 128,
    pixels = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = Math.hypot(x - 64, y - 64) < 48;
      pixels.set(inside ? [170, 170, 170, 255] : [255, 0, 255, 0], i);
      if (y >= 56 && y < 64) {
        if (x >= 40 && x < 44) pixels.set([0, 255, 0, 255], i);
        if (x >= 60 && x < 64) pixels.set([40, 40, 40, 255], i);
        if (x >= 80 && x < 84) pixels.set([170, 170, 170, 100], i);
      }
    }
  const png = await sharp(pixels, {
    raw: { width, height: width, channels: 4 },
  })
    .png()
    .toBuffer();
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'appearance.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#viewer').hover();
  const previewResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/defects/preview'),
  );
  await page.locator('#preview-defects').click();
  const preview = await (await previewResponse).json();
  expect(preview.defects.count).toBe(3);
  const reasons = preview.defects.regions.flatMap(
    (region: { signals: string[] }) => region.signals,
  );
  expect(reasons).toEqual(
    expect.arrayContaining(['color', 'intensity', 'alpha']),
  );
  await expect(page.locator('#defect-edit-status')).toContainText(
    'Renk, ton ve saydamlık',
  );
  await expect(page.locator('polygon[data-region]')).toHaveCount(3);
  await calculate(page);
  await page.locator('#go-report').click();
  await expect(page.locator('#defect-regions tr')).toHaveCount(3);
  await expect(page.locator('#defect-regions')).toContainText('Renk farkı');
  await expect(page.locator('#defect-regions')).toContainText(
    'Saydamlık farkı',
  );
  await expect(page.locator('#defect-regions')).toContainText('Koyu ton');
  await page.locator('#detection-method summary').click();
  await expect(page.locator('#technical-notes')).toContainText(
    'fiziksel boşluk, yoğunluk veya derinlik ölçümü değildir',
  );
});

test('DICOM preview detects a soft grayscale feature from original HU data', async ({
  page,
}) => {
  const width = 128;
  const pixelValues = Array.from({ length: width * width }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width);
    if (Math.hypot(x - 64, y - 64) >= 48) return 0;
    const v =
      140 +
      x * 0.3 +
      y * 0.1 -
      10 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / (2 * 9 ** 2));
    return Math.round(v) * 4 + 24;
  });
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles({
      name: 'soft-tones.dcm',
      mimeType: 'application/dicom',
      buffer: dicomFixture({ width, height: width, pixelValues }),
    });
  await settled(page);
  await page.locator('#go-analyze').click();
  await expect(page.locator('#image-canvas')).toBeVisible();
  await page.locator('#viewer').hover();
  const response = page.waitForResponse((r) =>
    r.url().endsWith('/api/defects/preview'),
  );
  await page.locator('#preview-defects').click();
  const preview = await (await response).json();
  expect(preview.unit).toBe('HU');
  expect(preview.defects.appearance.mode).toBe('tone');
  // The global lower-tail threshold cannot explain this center feature.
  expect(pixelValues[64 * width + 64]! - 1024).toBeGreaterThan(
    preview.defects.threshold,
  );
  expect(
    preview.defects.regions.some(
      (r: {
        bounds: { x: number; y: number; width: number; height: number };
        signals: string[];
      }) =>
        r.signals.includes('local-contrast') &&
        r.bounds.x <= 64 &&
        r.bounds.y <= 64 &&
        r.bounds.x + r.bounds.width > 64 &&
        r.bounds.y + r.bounds.height > 64,
    ),
  ).toBe(true);
  await expect(page.locator('#defect-edit-status')).toContainText(
    'Özgün yoğunlukta yerel ton',
  );
  await calculate(page);
  await page.locator('#go-report').click();
  await expect(page.locator('#defect-regions')).toContainText(
    'Yerel ton farkı',
  );
  await page.locator('#detection-method summary').click();
  await expect(page.locator('#technical-notes')).toContainText(
    'DICOM yerel ton karşılaştırması özgün HU değerleriyle',
  );
});
