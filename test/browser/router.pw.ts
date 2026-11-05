import { test, expect } from '@playwright/test';
import { calculate, disk, settled } from './helpers.js';

test('browser history preserves files and analysis across workflow routes', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/upload$/);
  await page.locator('#file').setInputFiles({
    name: 'history.png',
    mimeType: 'image/png',
    buffer: await disk(80),
  });
  await settled(page);
  await page.locator('#go-analyze').click();
  await expect(page).toHaveURL(/#\/analyze$/);
  await calculate(page);
  await page.locator('#go-report').click();
  await expect(page).toHaveURL(/#\/report$/);
  await page.goBack();
  await expect(page.locator('#panel-analyze')).toBeVisible();
  await expect(page.locator('#review-ready')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#panel-upload')).toBeVisible();
  await expect(page.locator('.queue-row')).toHaveCount(1);
  await page.goForward();
  await page.goForward();
  await expect(page.locator('#panel-report')).toBeVisible();
  await expect(page.locator('#metric-mean')).toHaveText('80,0');
});

for (const path of ['/analyze', '/report', '/unknown']) {
  test(`unavailable direct route ${path} falls back on load and refresh`, async ({
    page,
  }) => {
    await page.goto(`/#${path}`);
    await expect(page).toHaveURL(/#\/upload$/);
    await expect(page.locator('#panel-upload')).toBeVisible();
    await page.reload();
    await expect(page.locator('#panel-upload')).toBeVisible();
  });
}

test('clearing files reconciles the URL and stale history routes', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'clear.png',
    mimeType: 'image/png',
    buffer: await disk(80),
  });
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#panel-analyze [data-step="1"]').click();
  await page.locator('#clear-files').click();
  await page.goBack();
  await expect(page).toHaveURL(/#\/upload$/);
  await expect(page.locator('#panel-upload')).toBeVisible();
});
