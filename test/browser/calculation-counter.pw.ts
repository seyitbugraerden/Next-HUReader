import { test, expect } from '@playwright/test';
import {
  calculate,
  disk,
  flatImage,
  manualSettings,
  settled,
} from './helpers.js';

async function twoImages(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('#file').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: await disk(80) },
    { name: 'b.png', mimeType: 'image/png', buffer: await disk(180) },
  ]);
  await settled(page);
  await page.locator('#go-analyze').click();
  await expect(page.locator('#batch-counts')).toHaveText('0/2 hesaplandı');
}

test('counter tracks confirmed measurements, stale settings, errors, retries and removal', async ({
  page,
}) => {
  await twoImages(page);
  const count = page.locator('#batch-counts');
  await page.locator('#viewer').hover();
  await page.locator('#preview-defects').click();
  await expect(page.locator('#tone-preview-details')).toBeVisible();
  await expect(count).toHaveText('0/2 hesaplandı');
  await calculate(page);
  await expect(count).toHaveText('1/2 hesaplandı');
  const firstId = await page.locator('#active-file').inputValue();
  await page.locator('#active-file').selectOption({ index: 1 });
  await expect(count).toHaveText('1/2 hesaplandı');
  await calculate(page);
  await expect(count).toHaveText('2/2 hesaplandı');
  await page.locator('#show-candidates').uncheck();
  await page.locator('#zoom-in').click();
  await expect(count).toHaveText('2/2 hesaplandı');
  await page.locator('#active-file').selectOption(firstId);
  await page.locator('#tone-levels').fill('3');
  await expect(count).toHaveText('1/2 hesaplandı');
  await page.route(
    '**/api/analyze',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Kontrollü test hatası' }),
      }),
    { times: 1 },
  );
  await page.locator('#analyze').click();
  await expect(page.locator('#error')).toHaveText('Kontrollü test hatası');
  await expect(count).toHaveText('1/2 hesaplandı · 1 hata');
  await calculate(page);
  await expect(count).toHaveText('2/2 hesaplandı');
  await page.locator('#remove-active-file').click();
  await expect(count).toHaveText('1/1 hesaplandı');
  await page.locator('#step-upload').click();
  await page.locator('#clear-files').click();
  await expect(count).toHaveText('0/0 hesaplandı');
  await expect(page.locator('#go-analyze')).toBeDisabled();
});

test('batch counter updates after each successful response, before the entire batch finishes', async ({
  page,
}) => {
  await twoImages(page);
  const count = page.locator('#batch-counts');
  const releases: (() => void)[] = [];
  let requests = 0;
  await page.route('**/api/analyze', async (route) => {
    const index = requests++;
    const gate = new Promise<void>((resolve) => {
      releases[index] = resolve;
    });
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.locator('#analyze-all').click();
    await expect.poll(() => requests).toBe(1);
    await expect(count).toHaveText('0/2 hesaplandı');
    releases[0]!();
    await expect.poll(() => requests).toBe(2);
    await expect(count).toHaveText('1/2 hesaplandı');
    await expect(page.locator('#analyze-all')).toBeDisabled();
    releases[1]!();
    await expect(count).toHaveText('2/2 hesaplandı');
    await expect(page.locator('#analyze-all')).toBeEnabled();
    await expect(page.locator('#metric-mean')).toHaveText('80,0');
    await page.locator('#active-file').selectOption({ index: 1 });
    await expect(page.locator('#metric-mean')).toHaveText('180,0');
  } finally {
    releases.forEach((release) => release());
  }
});

test('ROI selection requests do not count as completed measurements or generic errors', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles([
    { name: 'a-good.png', mimeType: 'image/png', buffer: await disk(80) },
    { name: 'b-area.png', mimeType: 'image/png', buffer: await flatImage(128) },
  ]);
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#analyze-all').click();
  await expect(page.locator('#analyze-all')).toBeEnabled();
  await expect(page.locator('#batch-counts')).toHaveText(
    '1/2 hesaplandı · 1 alan seçimi bekliyor',
  );
  await page.locator('#active-file').selectOption({ index: 1 });
  await manualSettings(page, '1');
  await calculate(page);
  await expect(page.locator('#batch-counts')).toHaveText('2/2 hesaplandı');
});
