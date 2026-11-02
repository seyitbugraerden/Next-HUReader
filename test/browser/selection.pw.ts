import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

async function point(page: Page, x: number, y: number) {
  await page.locator('#image-canvas').scrollIntoViewIfNeeded();
  return page.locator('#image-canvas').evaluate(
    (canvas: HTMLCanvasElement, p) => {
      const r = canvas.getBoundingClientRect(),
        scale = Math.min(r.width / canvas.width, r.height / canvas.height);
      return {
        x: r.left + (r.width - canvas.width * scale) / 2 + p.x * scale,
        y: r.top + (r.height - canvas.height * scale) / 2 + p.y * scale,
      };
    },
    { x, y },
  );
}
async function move(page: Page, x: number, y: number, steps = 1) {
  const p = await point(page, x, y);
  await page.mouse.move(p.x, p.y, { steps });
}
const red = (page: Page, x = 128, y = 128) =>
  page
    .locator('#image-canvas')
    .evaluate(
      (canvas: HTMLCanvasElement, p) =>
        canvas.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data[0],
      { x, y },
    );

test.beforeEach(async ({ page }) => {
  const buffer = await sharp(Buffer.alloc(512 * 512, 80), {
    raw: { width: 512, height: 512, channels: 1 },
  })
    .png()
    .toBuffer();
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer });
  await page.locator('#go-analyze').click();
  await expect(page.locator('#image-canvas')).toBeVisible();
});

test('a dragged rectangle is visible while the pointer is held and its fill never changes the measured pixels', async ({
  page,
}) => {
  expect(await red(page)).toBe(80);
  await move(page, 64, 64);
  await page.mouse.down();
  await move(page, 400, 400, 12);
  await expect(page.locator('#roi-shape')).toHaveValue('rectangle');
  expect(await red(page)).toBeGreaterThan(80);
  await page.mouse.up();
  const points = await page.locator('input[name=roiPoints]').inputValue();
  expect(JSON.parse(points)).toHaveLength(2);
  expect(await red(page)).toBeGreaterThan(80);
  await page.locator('#analyze').click();
  await expect(page.locator('#go-report')).toBeEnabled();
  await page.locator('#go-report').click();
  await expect(page.locator('#metric-mean')).toHaveText('80,0');
});

test('freehand selection is visibly filled and closes without a duplicate first corner', async ({
  page,
}) => {
  await page.locator('#roi-shape').selectOption('polygon');
  await move(page, 64, 64);
  await page.mouse.down();
  for (const [x, y] of [
    [400, 64],
    [400, 400],
    [64, 400],
    [64, 64],
  ])
    await move(page, x!, y!, 12);
  expect(await red(page)).toBeGreaterThan(80);
  await page.mouse.up();
  const points = JSON.parse(
    await page.locator('input[name=roiPoints]').inputValue(),
  );
  expect(points.length).toBeGreaterThanOrEqual(3);
  expect(points.length).toBeLessThanOrEqual(128);
  expect(points[points.length - 1]).not.toEqual(points[0]);
  await page.locator('#analyze').click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#go-report')).toBeEnabled();
});

test('circle editing starts with a visible radius and dragging does not move the center on release', async ({
  page,
}) => {
  await page.locator('#manual').check();
  expect(Number(await page.locator('input[name=radius]').inputValue())).toBe(
    128,
  );
  await move(page, 256, 256);
  await page.mouse.down();
  await move(page, 350, 256, 8);
  await page.mouse.up();
  expect(
    Number(await page.locator('input[name=centerX]').inputValue()),
  ).toBeCloseTo(256, 0);
  expect(
    Number(await page.locator('input[name=radius]').inputValue()),
  ).toBeCloseTo(94, 0);
  await page.locator('#analyze').click();
  await expect(page.locator('#go-report')).toBeEnabled();
});

test('Escape cancels a new drag and restores the previous visible selection', async ({
  page,
}) => {
  await move(page, 64, 64);
  await page.mouse.down();
  await move(page, 400, 400, 8);
  await page.mouse.up();
  const before = await page.locator('input[name=roiPoints]').inputValue();
  await move(page, 220, 220);
  await page.mouse.down();
  await move(page, 480, 480, 8);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.locator('input[name=roiPoints]').inputValue()).toBe(before);
  expect(await red(page)).toBeGreaterThan(80);
});

test('a scaled preview stays under the pointer during drawing on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#image-canvas').scrollIntoViewIfNeeded();
  const top = (await page.locator('#image-canvas').boundingBox())!.y;
  await move(page, 64, 64);
  await page.mouse.down();
  await move(page, 400, 400, 10);
  expect(
    Math.abs((await page.locator('#image-canvas').boundingBox())!.y - top),
  ).toBeLessThan(2);
  expect(await red(page)).toBeGreaterThan(80);
  await page.mouse.up();
  expect(
    JSON.parse(await page.locator('input[name=roiPoints]').inputValue()),
  ).toHaveLength(2);
  expect(await red(page)).toBeGreaterThan(80);
});

test('dragging beyond the picture keeps the selected corners inside the image', async ({
  page,
}) => {
  await move(page, 400, 400);
  await page.mouse.down();
  const bounds = (await page.locator('#image-canvas').boundingBox())!;
  await page.mouse.move(bounds.x - 30, bounds.y - 30, { steps: 12 });
  await page.mouse.up();
  const points = JSON.parse(
    await page.locator('input[name=roiPoints]').inputValue(),
  );
  expect(points).toHaveLength(2);
  expect(points[1]).toEqual([0, 0]);
  expect(
    points.flat().every((value: number) => value >= 0 && value < 512),
  ).toBe(true);
});
