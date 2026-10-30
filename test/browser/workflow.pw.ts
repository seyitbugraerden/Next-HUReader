import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dicomFixture } from '../fixtures.js';
import {
  calibration,
  disk,
  flatImage,
  manualSettings,
  settled,
} from './helpers.js';

function rows(sheet: ExcelJS.Worksheet): ExcelJS.CellValue[][] {
  const result: ExcelJS.CellValue[][] = [];
  sheet.eachRow((row, index) => {
    if (index > 1)
      result.push(
        Array.from(
          { length: sheet.columnCount },
          (_, i) => row.getCell(i + 1).value,
        ),
      );
  });
  return result;
}

test('per-file geometry, calibration, stale results and both Excel reports remain consistent', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const responses: Promise<Record<string, unknown>>[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('/api/analyze') && response.ok())
      responses.push(response.json());
  });
  await page.route('**/api/analyze', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.fulfill({ response });
  });
  await page.goto('/');
  await expect(page.locator('#step-analyze')).toBeDisabled();
  await page.locator('#file').setInputFiles([
    { name: 'A.png', mimeType: 'image/png', buffer: await flatImage(80) },
    { name: 'B.png', mimeType: 'image/png', buffer: await flatImage(180) },
    {
      name: 'bad.dcm',
      mimeType: 'application/dicom',
      buffer: Buffer.from('broken'),
    },
  ]);
  await settled(page);
  await page.locator('#go-analyze').click();
  const options = await page
    .locator('#active-file option')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ id: node.value, label: node.textContent! })),
    );
  const a = options.find((option) => option.label.includes('A.png'))!.id;
  const b = options.find((option) => option.label.includes('B.png'))!.id;
  await page.locator('#active-file').selectOption(a);
  await manualSettings(page, '1');
  await calibration(page, '.2', '.3');
  await page.locator('#active-file').selectOption(b);
  await manualSettings(page, '0');
  await calibration(page, '.5', '.5', true);
  await page.locator('#analyze-all').click();
  await expect(page.locator('#active-file')).toBeDisabled();
  await expect(page.locator('#step-upload')).toBeDisabled();
  await expect(page.locator('#analyze-all')).toBeEnabled();
  await expect(page.locator('#batch-counts')).toContainText(
    '2/3 hesaplandı · 1 hata',
  );
  await expect(page.locator('#active-file')).toHaveValue(b);
  await expect(page.locator('#estimate')).toBeChecked();
  const results = await Promise.all(responses);
  const actualA = results.find((result) => result.filename === 'A.png') as {
    measurements: { count: number; mean: number; area: number }[];
  };
  const actualB = results.find((result) => result.filename === 'B.png') as {
    measurements: { count: number; mean: number; area: number }[];
  };
  expect(actualA.measurements[0]).toMatchObject({ count: 13, mean: 80 });
  expect(actualA.measurements[0]!.area).toBeCloseTo(0.78);
  expect(actualB.measurements[0]!.count).toBe(29);
  expect(actualB.measurements[0]!.area).toBe(7.25);
  expect(actualB.measurements[0]!.mean).toBeCloseTo((180 / 255) * 2000 - 1000);
  for (let index = 0; index < 6; index++) {
    await page.locator('#active-file').selectOption(a);
    await expect(page.locator('#metric-mean')).toHaveText('80,0');
    await expect(page.locator('#estimate')).not.toBeChecked();
    await page.locator('#active-file').selectOption(b);
    await expect(page.locator('#metric-mean')).toHaveText('411,8');
    await expect(page.locator('#estimate')).toBeChecked();
  }
  await expect(page.locator('#batch-counts')).toContainText('2/3');
  await page.locator('#go-report').click();
  const batchDownload = page.waitForEvent('download');
  await page.locator('#export-batch').click();
  const batchPath = info.outputPath('batch.xlsx');
  await (await batchDownload).saveAs(batchPath);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(batchPath);
  expect(book.worksheets).toHaveLength(6);
  expect(book.getWorksheet('CT Sayıları')!.rowCount).toBe(7);
  expect(book.getWorksheet('Ölçüm Alanı')!.getImages()).toHaveLength(2);
  const measurements = rows(book.getWorksheet('CT Sayıları')!);
  const aRow = measurements.find((row) => row[1] === 'A.png')!,
    bRow = measurements.find((row) => row[1] === 'B.png')!;
  expect(aRow[2]).toBe('Gri ton (0–255)');
  expect(aRow[4]).toBe(13);
  expect(aRow[5]).toBeCloseTo(0.78);
  expect(aRow[6]).toBe(80);
  expect(bRow[2]).toBe('Yaklaşık HU');
  expect(bRow[4]).toBe(29);
  expect(bRow[5]).toBe(7.25);
  expect(bRow[6]).toBeCloseTo((180 / 255) * 2000 - 1000);
  expect(
    rows(book.getWorksheet('İşlem Durumu')!).find(
      (row) => row[1] === 'bad.dcm',
    )?.[2],
  ).toBe('Hata');
  await expect(page.locator('#export')).toBeEnabled();
  const singleDownload = page.waitForEvent('download');
  await page.locator('#export').click();
  const singlePath = info.outputPath('single.xlsx');
  await (await singleDownload).saveAs(singlePath);
  const single = new ExcelJS.Workbook();
  await single.xlsx.readFile(singlePath);
  expect(single.getWorksheet('CT Sayıları')!.getCell('A2').value).toBe('B.png');
  expect(single.getWorksheet('CT Sayıları')!.getCell('E2').value).toBeCloseTo(
    (180 / 255) * 2000 - 1000,
  );
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#step-analyze').click();
  await page.locator('input[name=insetPixels]').fill('1');
  await expect(page.locator('#batch-counts')).toContainText('1/3');
  await page.locator('#go-report').click();
  await expect(page.locator('#report-active-file option')).toHaveCount(1);
  const staleDownload = page.waitForEvent('download');
  await page.locator('#export-batch').click();
  const stalePath = info.outputPath('stale-excluded.xlsx');
  await (await staleDownload).saveAs(stalePath);
  const stale = new ExcelJS.Workbook();
  await stale.xlsx.readFile(stalePath);
  expect(stale.getWorksheet('CT Sayıları')!.rowCount).toBe(4);
  expect(
    rows(stale.getWorksheet('İşlem Durumu')!).find(
      (row) => row[1] === 'B.png',
    )?.[2],
  ).toBe('Yeniden hesaplanmalı');
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#step-analyze').click();
  await page.locator('#active-file').selectOption(b);
  await page.locator('input[name=radius]').fill('999');
  await page.locator('#analyze').click();
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#batch-counts')).toContainText('1/3');
  await page.locator('input[name=radius]').fill('3');
  await page.locator('#analyze').click();
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#batch-counts')).toContainText('2/3');
  await page.locator('#go-report').click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const stage of ['upload', 'analyze', 'report']) {
      await page.locator(`#step-${stage}`).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('folder paths and extensionless DICOM survive selection, reimport and reports', async ({
  page,
}, info) => {
  const root = info.outputPath('Numuneler');
  await mkdir(join(root, 'seri-A'), { recursive: true });
  await mkdir(join(root, 'seri-B'), { recursive: true });
  await writeFile(join(root, 'seri-A', 'Z01.png'), await disk(80));
  await writeFile(join(root, 'seri-B', 'Z01.png'), await disk(180));
  await writeFile(join(root, 'seri-B', 'Z02'), dicomFixture());
  await writeFile(join(root, 'notes.txt'), 'skip');
  await writeFile(join(root, 'broken.dcm'), 'bad');
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#choose-folder').click();
  await (await chooser).setFiles(root);
  await settled(page);
  await expect(page.locator('.queue-row')).toHaveCount(4);
  await expect(
    page.locator('.queue-name').filter({ hasText: 'seri-A/Z01.png' }),
  ).toHaveCount(1);
  await expect(
    page.locator('.queue-name').filter({ hasText: 'seri-B/Z01.png' }),
  ).toHaveCount(1);
  await page.locator('#folder').setInputFiles(root);
  await settled(page);
  await expect(page.locator('.queue-row')).toHaveCount(4);
  await expect(page.locator('#import-summary')).toContainText(
    '4 dosya zaten listede',
  );
  await page.locator('#go-analyze').click();
  const ctId = await page
    .locator('#active-file option')
    .evaluateAll(
      (options) =>
        options.find((option) => option.textContent!.includes('/Z02'))!.value,
    );
  await page.locator('#active-file').selectOption(ctId);
  await manualSettings(page, '1');
  await page.locator('#analyze-all').click();
  await expect(page.locator('#analyze-all')).toBeEnabled();
  await expect(page.locator('#batch-counts')).toContainText(
    '3/4 hesaplandı · 1 hata',
  );
  await expect(page.locator('#image-badge')).toHaveText('HU');
  await expect(page.locator('#metric-mean')).toHaveText('-24,0');
  await page.locator('#go-report').click();
  const download = page.waitForEvent('download');
  await page.locator('#export-batch').click();
  const path = info.outputPath('folder.xlsx');
  await (await download).saveAs(path);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  const measurements = rows(book.getWorksheet('CT Sayıları')!);
  expect(
    measurements.find((row) => row[1] === 'Numuneler/seri-A/Z01.png')?.[6],
  ).toBe(80);
  expect(
    measurements.find((row) => row[1] === 'Numuneler/seri-B/Z01.png')?.[6],
  ).toBe(180);
  const ct = measurements.find((row) => row[1] === 'Numuneler/seri-B/Z02')!;
  expect(ct[2]).toBe('HU');
  expect(ct[4]).toBe(13);
  expect(ct[5]).toBe(1.625);
  expect(ct[6]).toBe(-24);
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#step-upload').click();
  while (await page.locator('.queue-row').count())
    await page.locator('.queue-row button').first().click();
  await expect(page.locator('#go-analyze')).toBeDisabled();
  await expect(page.locator('#step-report')).toBeDisabled();
  await expect(page.locator('#queue-card')).toBeHidden();
});
