import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { settled } from './helpers.js';

async function fourVoids() {
  const width = 256;
  const pixels = Buffer.alloc(width * width);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x - 128, y - 128) < 100) pixels[y * width + x] = 170;
      for (const [cx, cy] of [
        [116, 116],
        [129, 116],
        [116, 133],
        [129, 133],
      ]) {
        if (x >= cx! && x < cx! + 4 && y >= cy! && y < cy! + 8)
          pixels[y * width + x] = 40;
      }
    }
  }
  return sharp(pixels, { raw: { width, height: width, channels: 1 } })
    .png()
    .toBuffer();
}

for (const mobile of [false, true]) {
  test(`nearby voids remain separate while zooming and editing (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.locator('#file').setInputFiles({
      name: 'four.png',
      mimeType: 'image/png',
      buffer: await fourVoids(),
    });
    await settled(page);
    await page.locator('#go-analyze').click();
    await page.locator('#preview-mode').selectOption('defects');
    await page.locator('#viewer').hover();
    await page.locator('#preview-defects').click();
    await expect(page.locator('polygon[data-region]')).toHaveCount(4);
    await expect(page.locator('[data-remove]')).toHaveCount(4);
    await expect(page.locator('[data-cluster]')).toHaveCount(0);
    await page.locator('#zoom-in').click();
    await page.locator('#zoom-in').click();
    await expect(page.locator('#zoom-level')).toHaveText('400%');
    await expect(page.locator('polygon[data-region]')).toHaveCount(4);
    // Zoom is presentation only: it does not dirty or rescale image geometry.
    await expect(page.locator('#defect-edit-status')).toContainText(
      '0 aday düzenlendi',
    );
    const polygon = page.locator('polygon[data-region="1"]');
    await expect(polygon).toBeInViewport();
    await page.locator('#preview-pan').click();
    await page.locator('#viewer').scrollIntoViewIfNeeded();
    const originalScroll = await page
      .locator('#viewer')
      .evaluate((node) => node.scrollLeft);
    const regionBox = await polygon.boundingBox();
    if (!regionBox) throw new Error('Missing zoomed region');
    await page.mouse.move(
      regionBox.x + regionBox.width / 2,
      regionBox.y + regionBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      regionBox.x + regionBox.width / 2 - 15,
      regionBox.y + regionBox.height / 2 - 10,
      { steps: 3 },
    );
    await page.mouse.up();
    expect(
      await page.locator('#viewer').evaluate((node) => node.scrollLeft),
    ).toBeGreaterThan(originalScroll);
    await expect(page.locator('#defect-edit-status')).toContainText(
      '0 aday düzenlendi',
    );
    await page.locator('#preview-pan').click();
    await polygon.click();
    const handle = page.locator('circle[data-region="1"][data-vertex="0"]');
    const before = await polygon.getAttribute('points');
    const box = await handle.boundingBox();
    if (!box) throw new Error('Missing zoomed handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - 6,
      box.y + box.height / 2 - 6,
      { steps: 3 },
    );
    await page.mouse.up();
    await expect(polygon).not.toHaveAttribute('points', before!);
    await expect(page.locator('#defect-edit-status')).toContainText(
      '1 aday düzenlendi',
    );
    await page.locator('#undo-defect').click();
    await expect(polygon).toHaveAttribute('points', before!);
    await page.locator('#zoom-fit').click();
    await expect(page.locator('#zoom-level')).toHaveText('100%');
    await expect(page.locator('polygon[data-region]')).toHaveCount(4);
    await expect(page.locator('[data-cluster]')).toHaveCount(0);
    await page.locator('#zoom-in').click();
    await expect(page.locator('#zoom-level')).toHaveText('200%');
    await page.locator('#zoom-out').click();
    await expect(page.locator('#zoom-level')).toHaveText('100%');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('trackpad pinch zooms around the pointer and plain scrolling stays native', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'trackpad.png',
    mimeType: 'image/png',
    buffer: await fourVoids(),
  });
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#preview-mode').selectOption('defects');
  await expect(page.locator('#image-canvas')).toBeVisible();
  await page.locator('#zoom-in').click();
  await page.locator('#zoom-in').click();
  const pinch = await page.locator('#viewer').evaluate((viewer) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#image-canvas')!;
    const bounds = viewer.getBoundingClientRect();
    const clientX = bounds.left + viewer.clientWidth / 2 - 30;
    const clientY = bounds.top + viewer.clientHeight / 2 + 15;
    const imagePoint = () => {
      const rect = canvas.getBoundingClientRect();
      return [
        ((clientX - rect.left) * canvas.width) / rect.width,
        ((clientY - rect.top) * canvas.height) / rect.height,
      ];
    };
    const before = imagePoint();
    const event = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -30,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    return { before, after: imagePoint(), prevented: event.defaultPrevented };
  });
  expect(pinch.prevented).toBe(true);
  expect(pinch.after[0]).toBeCloseTo(pinch.before[0]!, 0);
  expect(pinch.after[1]).toBeCloseTo(pinch.before[1]!, 0);
  const zoomed = await page.locator('#zoom-level').textContent();
  expect(Number.parseInt(zoomed!)).toBeGreaterThan(400);
  const plainPrevented = await page.locator('#viewer').evaluate((viewer) => {
    const event = new WheelEvent('wheel', {
      deltaY: 40,
      bubbles: true,
      cancelable: true,
    });
    viewer.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(plainPrevented).toBe(false);
  await expect(page.locator('#zoom-level')).toHaveText(zoomed!);
  await page.locator('#viewer').evaluate((viewer) => {
    viewer.dispatchEvent(
      new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: 200,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  // Exercise Safari's separate gesture path and ensure a gesture cannot also
  // apply Chromium-style wheel zoom if both event families are delivered.
  await page.locator('#viewer').evaluate((viewer) => {
    viewer.dispatchEvent(new Event('gesturestart', { cancelable: true }));
    const change = new Event('gesturechange', { cancelable: true });
    Object.defineProperty(change, 'scale', { value: 2 });
    viewer.dispatchEvent(change);
    viewer.dispatchEvent(
      new WheelEvent('wheel', { ctrlKey: true, deltaY: -50, cancelable: true }),
    );
    viewer.dispatchEvent(new Event('gestureend', { cancelable: true }));
  });
  await expect(page.locator('#zoom-level')).toHaveText('200%');
});
