import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { settled } from './helpers.js';

async function sample() {
  const width = 128,
    pixels = Buffer.alloc(width * width);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x - 64, y - 64) < 48) pixels[y * width + x] = 170;
      if (
        (x >= 47 && x <= 52 && y >= 45 && y <= 60) ||
        (x >= 76 && x <= 80 && y >= 65 && y <= 78)
      )
        pixels[y * width + x] = 40;
    }
  return sharp(pixels, { raw: { width, height: width, channels: 1 } })
    .png()
    .toBuffer();
}

test('previews candidates, deletes via x, reshapes freely, and exports only confirmed edits', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles([
    { name: 'voids.png', mimeType: 'image/png', buffer: await sample() },
    { name: 'other.png', mimeType: 'image/png', buffer: await sample() },
  ]);
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#preview-mode').selectOption('defects');
  await page.locator('#viewer').hover();
  await page.locator('#preview-defects').click();
  await expect(page.locator('#defect-edit-tools')).toBeVisible();
  await expect(page.locator('[data-remove]')).toHaveCount(2);
  await expect(page.locator('#go-report')).toBeDisabled();
  await page.locator('[data-remove="1"]').click();
  await expect(page.locator('[data-remove]')).toHaveCount(1);
  await page.locator('#undo-defect').click();
  await expect(page.locator('[data-remove]')).toHaveCount(2);
  const polygon = page.locator('polygon[data-region="1"]');
  await polygon.click();
  const handle = page.locator('circle[data-region="1"][data-vertex="0"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('Missing vertex');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 25,
    box.y + box.height / 2 - 20,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.locator('#defect-edit-status')).toContainText(
    '1 aday düzenlendi',
  );
  // Insert a new edge point and pull it outward, then cancel a later move.
  const edge = await polygon.evaluate((node: SVGPolygonElement) => {
    const a = node.points.getItem(1),
      b = node.points.getItem(2);
    const svg = node.ownerSVGElement!,
      rect = svg.getBoundingClientRect();
    return {
      x:
        rect.left +
        (((a.x + b.x) / 2) * rect.width) / svg.viewBox.baseVal.width,
      y:
        rect.top +
        (((a.y + b.y) / 2) * rect.height) / svg.viewBox.baseVal.height,
    };
  });
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 15, edge.y, { steps: 4 });
  await page.mouse.up();
  await expect(
    page.locator('circle[data-region="1"][data-vertex]'),
  ).toHaveCount(5);
  const beforeCancel = await polygon.getAttribute('points');
  const cancelPoint = await page
    .locator('circle[data-region="1"][data-vertex="2"]')
    .boundingBox();
  if (!cancelPoint) throw new Error('Missing inserted vertex');
  await page.mouse.move(
    cancelPoint.x + cancelPoint.width / 2,
    cancelPoint.y + cancelPoint.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(cancelPoint.x + 20, cancelPoint.y + 10);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(polygon).toHaveAttribute('points', beforeCancel!);
  await page.locator('[data-remove="2"]').click();
  const firstId = await page.locator('#active-file').inputValue();
  await page.locator('#active-file').selectOption({ index: 1 });
  await expect(page.locator('#defect-edit-tools')).toBeHidden();
  await page.locator('#active-file').selectOption(firstId);
  await expect(page.locator('[data-remove]')).toHaveCount(1);
  await expect(page.locator('#defect-edit-status')).toContainText(
    '2 aday düzenlendi',
  );
  const responsePromise = page.waitForResponse((r) =>
    r.url().endsWith('/api/analyze'),
  );
  await page.locator('#analyze').click();
  const result = await (await responsePromise).json();
  expect(result.defects.manuallyEdited).toBe(true);
  expect(result.defects.count).toBe(1);
  expect(result.defects.pixels).toBeGreaterThan(96);
  await expect(page.locator('#go-report')).toBeEnabled();
  await page.locator('#reset-defects').click();
  await expect(page.locator('[data-remove]')).toHaveCount(2);
  await expect(page.locator('#go-report')).toBeDisabled();
  await page
    .locator('input[name=insetPixels]')
    .evaluate((input: HTMLInputElement) => {
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await expect(page.locator('#defect-edit-tools')).toBeHidden();
});

test('supports removing and restoring all candidates on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'mobile.png',
    mimeType: 'image/png',
    buffer: await sample(),
  });
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#preview-mode').selectOption('defects');
  await page.locator('#viewer').hover();
  await page.locator('#preview-defects').click();
  await expect(page.locator('[data-remove]')).toHaveCount(2);
  await page.locator('[data-remove="1"]').click();
  await page.locator('[data-remove="2"]').click();
  await expect(page.locator('[data-remove]')).toHaveCount(0);
  const response = page.waitForResponse((r) =>
    r.url().endsWith('/api/analyze'),
  );
  await page.locator('#analyze').click();
  expect((await (await response).json()).defects.count).toBe(0);
  await page.locator('#reset-defects').click();
  await expect(page.locator('[data-remove]')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('image activation supports hover, keyboard and a visible pending analysis', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/defects/preview')) requests++;
  });
  await page.goto('/');
  const action = page.locator('.preview-analysis-action');
  const button = page.locator('#preview-defects');
  await expect(action).toBeHidden();
  await page.locator('#file').setInputFiles({
    name: 'hover.png',
    mimeType: 'image/png',
    buffer: await sample(),
  });
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#preview-mode').selectOption('defects');
  await page.locator('#image-title').hover();
  await expect(action).toHaveCSS('opacity', '0');
  await page.locator('#viewer').hover();
  await expect(action).toHaveCSS('opacity', '1');
  await expect(button).toHaveText('Analiz et');
  await expect(page.locator('#defect-edit-tools')).toBeHidden();
  expect(requests).toBe(0);
  await page.locator('#image-title').hover();
  await page.locator('#preview-pan').focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await expect(action).toHaveCSS('opacity', '1');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/defects/preview', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.keyboard.press('Enter');
    await expect(button).toHaveText('Analiz ediliyor…');
    await expect(button).toBeDisabled();
    await page.locator('#image-title').hover();
    await expect(action).toHaveCSS('opacity', '1');
  } finally {
    release();
  }
  await expect(page.locator('#preview-panel #defect-edit-tools')).toBeVisible();
  await expect(button).toHaveText('Yeniden analiz et (sıfırla)');
  expect(requests).toBe(1);
});

test.describe('touch analysis activation', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test('shows the image action without requiring hover', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file').setInputFiles({
      name: 'touch.png',
      mimeType: 'image/png',
      buffer: await sample(),
    });
    await settled(page);
    await page.locator('#go-analyze').tap();
    await page.locator('#preview-mode').selectOption('defects');
    await expect(page.locator('.preview-analysis-action')).toHaveCSS(
      'opacity',
      '1',
    );
    await page.locator('#preview-defects').tap();
    await expect(
      page.locator('#preview-panel #defect-edit-tools'),
    ).toBeVisible();
    await expect(page.locator('[data-remove]')).toHaveCount(2);
  });
});
