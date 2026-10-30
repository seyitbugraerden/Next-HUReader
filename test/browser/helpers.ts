import sharp from 'sharp';
import { expect, type Page } from '@playwright/test';

export async function disk(value: number, red = false): Promise<Buffer> {
  const data = Buffer.alloc(128 * 128 * 3);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      if (Math.hypot(x - 64, y - 64) < 40) {
        for (let c = 0; c < 3; c++)
          data[(y * 128 + x) * 3 + c] = red && c > 0 ? 0 : value;
      }
    }
  return sharp(data, { raw: { width: 128, height: 128, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

export async function settled(page: Page): Promise<void> {
  await expect(page.locator('#choose-folder')).toBeEnabled();
}
export async function calculate(page: Page): Promise<void> {
  await page.locator('#analyze').click();
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
}

export function flatImage(value: number): Promise<Buffer> {
  return sharp(Buffer.alloc(64, value), {
    raw: { width: 8, height: 8, channels: 1 },
  })
    .png()
    .toBuffer();
}
export async function manualSettings(page: Page, inset: string): Promise<void> {
  await page.locator('#manual').check();
  for (const [name, value] of Object.entries({
    centerX: '4',
    centerY: '4',
    radius: '3',
    insetPixels: inset,
  }))
    await page.locator(`input[name=${name}]`).fill(value);
}
export async function calibration(
  page: Page,
  x: string,
  y: string,
  estimated = false,
): Promise<void> {
  if (
    !(await page
      .locator('.settings-card details')
      .evaluate((details: HTMLDetailsElement) => details.open))
  )
    await page.locator('.settings-card summary').click();
  await page.locator('input[name=spacingX]').fill(x);
  await page.locator('input[name=spacingY]').fill(y);
  if (estimated) {
    await page.locator('#estimate').check();
    await page.locator('input[name=windowMin]').fill('-1000');
    await page.locator('input[name=windowMax]').fill('1000');
  }
}
