import { test, expect } from '@playwright/test';
import { dicomFixture } from '../fixtures.js';
import { settled, calculate } from './helpers.js';

for (const mobile of [false, true]) {
  test(`partitions the full DICOM ROI into selectable dark-to-light regions (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const width = 128;
    const pixelValues = Array.from({ length: width * width }, (_, i) => {
      const x = i % width,
        y = Math.floor(i / width);
      if (Math.hypot(x - 64, y - 64) >= 48) return 0;
      return x < 53 ? 424 : x < 75 ? 1024 : 1824;
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#preview-mode')).toHaveValue('tones');
    await page
      .locator('#file')
      .setInputFiles({
        name: 'three-tones.dcm',
        mimeType: 'application/dicom',
        buffer: dicomFixture({ width, height: width, pixelValues }),
      });
    await settled(page);
    await page.locator('#go-analyze').click();
    await page.locator('#tone-levels').fill('3');
    await page.locator('#viewer').hover();
    const response = page.waitForResponse((r) =>
      r.url().endsWith('/api/defects/preview'),
    );
    await page.locator('#preview-defects').click();
    const preview = await (await response).json();
    const tones = preview.toneSegmentation;
    expect(tones.bands.map((b: { mean: number }) => b.mean)).toEqual([
      -600, 0, 800,
    ]);
    expect(
      tones.bands.reduce(
        (sum: number, b: { pixels: number }) => sum + b.pixels,
        0,
      ),
    ).toBe(tones.pixels);
    await expect(page.locator('#tone-preview-details')).toBeVisible();
    await expect(page.locator('#tone-legend > span')).toHaveCount(3);
    await expect(page.locator('#defect-edit-tools')).toBeHidden();
    await expect(page.locator('[data-remove]')).toHaveCount(0);
    const canvas = page.locator('#image-canvas');
    await canvas.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const p = await canvas.evaluate((node: HTMLCanvasElement) => {
          const box = node.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        });
        await page.mouse.click(p.x, p.y);
        return page.locator('#tone-region-readout').textContent();
      })
      .toContain('Ton 2');
    await expect(page.locator('#tone-region-readout')).toContainText(
      'Ortalama 0 HU',
    );
    await calculate(page);
    await page.locator('#go-report').click();
    await expect(page.locator('#tone-report')).toBeVisible();
    await expect(page.locator('#tone-bands tr')).toHaveCount(3);
    await expect(page.locator('#tone-summary')).toContainText(
      'pikselin tamamı bölgelendi',
    );
    await page.locator('.report-context [data-step="2"]').click();
    await page.locator('#tone-levels').fill('2');
    await expect(page.locator('#go-report')).toBeDisabled();
    await expect(page.locator('#tone-preview-details')).toBeHidden();
    await page.locator('#viewer').hover();
    await page.locator('#preview-defects').click();
    await expect(page.locator('#tone-legend > span')).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}
