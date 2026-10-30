import { test, expect } from '@playwright/test';
import { disk, settled, calculate } from './helpers.js';

test('same name, size and timestamp do not merge different image contents', async ({
  page,
}) => {
  const dark = await disk(80),
    bright = await disk(180);
  expect(dark.length).toBe(bright.length);
  await page.goto('/');
  const add = async (buffer: Buffer) => {
    await page.locator('#file').evaluate(
      (input: HTMLInputElement, bytes) => {
        const data = new DataTransfer();
        data.items.add(
          new File([new Uint8Array(bytes)], 'same.png', {
            type: 'image/png',
            lastModified: 1234,
          }),
        );
        input.files = data.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      [...buffer],
    );
    await settled(page);
  };
  await add(dark);
  await add(bright);
  await expect(page.locator('.queue-row')).toHaveCount(2);
  await add(dark);
  await expect(page.locator('.queue-row')).toHaveCount(2);
  await page.locator('#go-analyze').click();
  await page.locator('#analyze-all').click();
  await expect(page.locator('#analyze-all')).toBeEnabled();
  await page.locator('#go-report').click();
  await expect(page.locator('#batch-measurements tr').nth(0)).toContainText(
    '80,0',
  );
  await expect(page.locator('#batch-measurements tr').nth(1)).toContainText(
    '180,0',
  );
});

test('an unreadable file does not stop importing remaining files', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').evaluate(
    (input: HTMLInputElement, bytes) => {
      const original = Object.getOwnPropertyDescriptor(
        Blob.prototype,
        'arrayBuffer',
      )!.value as (this: Blob) => Promise<ArrayBuffer>;
      Blob.prototype.arrayBuffer = function () {
        return this.size === 3
          ? Promise.reject(new Error('Test: file cannot be read'))
          : original.call(this);
      };
      const files = new DataTransfer();
      files.items.add(new File(['bad'], 'A-unreadable.bin'));
      files.items.add(
        new File([new Uint8Array(bytes)], 'B-good.png', { type: 'image/png' }),
      );
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [...(await disk(80))],
  );
  await settled(page);
  await expect(page.locator('.queue-row')).toHaveCount(1);
  await expect(page.locator('.queue-name')).toHaveText('B-good.png');
  await expect(page.locator('#import-summary')).not.toContainText(
    'inceleniyor',
  );
});

test('late original image cannot replace the calculated grayscale preview', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src',
    );
    if (!descriptor?.set) return;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value: string) {
        if (value.startsWith('blob:')) {
          const callback = this.onload;
          this.onload = (event: Event) =>
            setTimeout(() => callback?.call(this, event), 800);
        }
        descriptor.set!.call(this, value);
      },
    });
  });
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'red.png',
    mimeType: 'image/png',
    buffer: await disk(200, true),
  });
  await settled(page);
  await page.locator('#go-analyze').click();
  await calculate(page);
  await expect
    .poll(async () =>
      page.locator('#image-canvas').evaluate((canvas: HTMLCanvasElement) => {
        const pixel = canvas.getContext('2d')!.getImageData(60, 60, 1, 1).data;
        return pixel[0] === pixel[1] && pixel[1] === pixel[2] && pixel[0]! > 0;
      }),
    )
    .toBe(true);
  // Wait for the deliberately delayed original image callback, not for network readiness.
  await page.waitForTimeout(1000);
  const pixel = await page
    .locator('#image-canvas')
    .evaluate((canvas: HTMLCanvasElement) => [
      ...canvas.getContext('2d')!.getImageData(60, 60, 1, 1).data,
    ]);
  expect(pixel[0]).toBe(pixel[1]);
  expect(pixel[1]).toBe(pixel[2]);
});

test('ambiguous automatic ROI blocks the report and can recover with manual selection', async ({
  page,
}) => {
  const sharp = (await import('sharp')).default;
  const uniform = await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 3,
      background: { r: 80, g: 80, b: 80 },
    },
  })
    .png()
    .toBuffer();
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles({
      name: 'uniform.png',
      mimeType: 'image/png',
      buffer: uniform,
    });
  await settled(page);
  await page.locator('#go-analyze').click();
  await page.locator('#analyze').click();
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#error')).toContainText('Dairesel numune');
  await expect(page.locator('#step-report')).toBeDisabled();
  await page.locator('#manual').check();
  for (const [name, value] of Object.entries({
    centerX: '64',
    centerY: '64',
    radius: '30',
    insetPixels: '5',
  }))
    await page.locator(`input[name=${name}]`).fill(value);
  await calculate(page);
  await expect(page.locator('#review-ready')).toBeVisible();
  await page.locator('#go-report').click();
  await expect(page.locator('#metric-mean')).toHaveText('80,0');
});
