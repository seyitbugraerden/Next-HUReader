import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dicomFixture } from '../fixtures.js';
import {
  calculate,
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

test('previous-step controls return to earlier pages without losing the analysis', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'previous-page.png',
    mimeType: 'image/png',
    buffer: await disk(80),
  });
  await settled(page);

  await page.locator('#go-analyze').click();
  await expect(page.locator('#panel-analyze')).toBeVisible();
  await page.locator('#panel-analyze [data-step="1"]').click();
  await expect(page.locator('#panel-upload')).toBeVisible();
  await expect(page.locator('.queue-row')).toHaveCount(1);

  await page.locator('#go-analyze').click();
  await calculate(page);
  await page.locator('#go-report').click();
  await expect(page.locator('#panel-report')).toBeVisible();
  await page.locator('.report-context [data-step="2"]').click();
  await expect(page.locator('#panel-analyze')).toBeVisible();
  await expect(page.locator('#review-ready')).toBeVisible();
  await expect(page.locator('#metric-mean')).toHaveText('80,0');

  await page.locator('#go-report').click();
  await page.locator('#panel-report [data-step="1"]').click();
  await expect(page.locator('#panel-upload')).toBeVisible();
  await expect(page.locator('.queue-row')).toHaveCount(1);
});

test('workflow entrance animations respect reduced-motion preferences', async ({
  page,
}) => {
  await page.goto('/');
  const animationDuration = async () =>
    page.locator('#panel-upload').evaluate((panel) => {
      const duration = getComputedStyle(panel).animationDuration.split(',')[0]!;
      const value = Number.parseFloat(duration);
      return duration.endsWith('ms') ? value : value * 1000;
    });

  expect(await animationDuration()).toBeGreaterThan(100);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animationDuration).toBeLessThanOrEqual(1);
});

test('workflow steps are stacked vertically on desktop and mobile', async ({
  page,
}) => {
  await page.goto('/');
  const workflowColumns = () =>
    page.locator('.workflow').evaluate((workflow) => {
      const style = getComputedStyle(workflow);
      return style.gridTemplateColumns.split(' ').length;
    });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(workflowColumns).toBe(1);
  await expect
    .poll(() =>
      page.locator('.wizard-navigation').evaluate((navigation) => {
        const style = getComputedStyle(navigation);
        return style.position === 'sticky' && style.gridColumnStart === '1';
      }),
    )
    .toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(workflowColumns).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test('image source and guidance occupy separate rows', async ({ page }) => {
  await page.goto('/');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.locator('#panel-upload .upload-layout').evaluate(
      (container) => {
        const source = container.querySelector('.upload-card')!.getBoundingClientRect();
        const guide = container.querySelector('.upload-guide')!.getBoundingClientRect();
        return {
          sourceBottom: source.bottom,
          guideTop: guide.top,
          sourceWidth: source.width,
          guideWidth: guide.width,
          contentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      },
    );

    expect(layout.guideTop).toBeGreaterThanOrEqual(layout.sourceBottom);
    expect(layout.guideWidth).toBeGreaterThan(layout.sourceWidth * 0.9);
    expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});

test('all uploaded images can be cancelled and workflow resets to upload', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles([
    { name: 'sample-A.png', mimeType: 'image/png', buffer: await disk(80) },
    { name: 'sample-B.png', mimeType: 'image/png', buffer: await disk(180) },
  ]);
  await settled(page);
  await expect(page.locator('.queue-row')).toHaveCount(2);
  await expect(page.locator('#clear-files')).toBeVisible();
  await page.locator('#go-analyze').click();
  await expect(page.locator('#image-canvas')).toBeVisible();

  const removedId = await page.locator('#active-file').inputValue();
  await page.locator('#remove-active-file').click();
  await expect(page.locator('#active-file option')).toHaveCount(1);
  await expect(page.locator('#active-file')).not.toHaveValue(removedId);
  await expect(page.locator('#image-canvas')).toBeVisible();

  await page.locator('#panel-analyze [data-step="1"]').click();
  await page.locator('#clear-files').click();

  await expect(page.locator('.queue-row')).toHaveCount(0);
  await expect(page.locator('#queue-card')).toBeHidden();
  await expect(page.locator('#file-info')).toBeHidden();
  await expect(page.locator('#file')).toBeEnabled();
  await expect(page.locator('#go-analyze')).toBeDisabled();
  await expect(page.locator('#step-upload')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#panel-upload')).toBeVisible();
  await expect(page.locator('#image-canvas')).toBeHidden();
  await expect
    .poll(() => page.locator('#empty').evaluate((empty) => empty.hidden))
    .toBe(false);
  await expect(page.locator('#file-label')).toHaveText(
    'Görüntüleri sürükleyip bırakın',
  );
});

test('uploaded images show previews and can be removed from their preview card', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles([
    { name: 'first-slice.png', mimeType: 'image/png', buffer: await disk(80) },
    { name: 'second-slice.png', mimeType: 'image/png', buffer: await disk(180) },
  ]);
  await settled(page);

  const cards = page.locator('.queue-preview-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('#queue-card')).toBeVisible();
  await expect(page.locator('.upload-card #queue-card')).toBeVisible();
  await expect(cards.nth(0).locator('.queue-name')).toHaveText(
    'first-slice.png',
  );
  await expect(cards.nth(0).locator('.queue-name')).not.toHaveClass(/badge|file-type/);
  await expect
    .poll(() =>
      cards.nth(0).locator('.queue-preview-image').evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(cards.nth(0).getByRole('button', { name: 'first-slice.png dosyasını kaldır' })).toBeVisible();
  await cards
    .nth(0)
    .getByRole('button', { name: 'first-slice.png dosyasını kaldır' })
    .click();

  await expect(page.locator('.queue-preview-card')).toHaveCount(1);
  await expect(page.locator('.queue-name')).toHaveText('second-slice.png');
});

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
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.continue();
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

test('extensionless DICOM can be previewed before a successful analysis', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'Z01',
    mimeType: 'application/octet-stream',
    buffer: dicomFixture(),
  });
  await expect(page.locator('.queue-preview-image')).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator('.queue-preview-image').evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.locator('#go-analyze').click();
  await expect(page.locator('#image-canvas')).toBeVisible();
  await expect(page.locator('#dimensions')).toHaveText('8 × 8 px');
  await expect(page.locator('#image-badge')).toHaveText('HU');
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#analyze').click();
  await expect(page.locator('#error')).toContainText('Dairesel numune');
  await expect(page.locator('#image-canvas')).toBeVisible();
  await manualSettings(page, '1');
  await page.locator('#analyze').click();
  await expect(page.locator('#metric-mean')).toHaveText('-24,0');
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

test('flat and irregular samples use rectangle and polygon areas in the UI and Excel', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'flat-CT',
    mimeType: 'application/octet-stream',
    buffer: dicomFixture(),
  });
  await page.locator('#go-analyze').click();
  await expect(page.locator('#image-canvas')).toBeVisible();
  await page.locator('#image-canvas').evaluate((canvas: HTMLCanvasElement) => {
    canvas.style.width = '256px';
    canvas.style.height = '256px';
  });
  const clickPixel = async (x: number, y: number) => {
    await page.locator('#image-canvas').scrollIntoViewIfNeeded();
    const point = await page.locator('#image-canvas').evaluate(
      (canvas: HTMLCanvasElement, p) => {
        const rect = canvas.getBoundingClientRect();
        const scale = Math.min(
          rect.width / canvas.width,
          rect.height / canvas.height,
        );
        return {
          x: rect.left + (rect.width - canvas.width * scale) / 2 + p.x * scale,
          y: rect.top + (rect.height - canvas.height * scale) / 2 + p.y * scale,
        };
      },
      { x, y },
    );
    await page.mouse.click(Math.round(point.x), Math.round(point.y));
  };
  await page.locator('#roi-shape').selectOption('rectangle');
  await page.locator('#advanced-settings summary').click();
  await page.locator('input[name=insetPixels]').fill('1');
  await clickPixel(2, 2);
  await clickPixel(6, 6);
  await page.locator('#analyze').click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#metric-count')).toHaveText('9');
  await expect(page.locator('#interpretation')).toContainText('standart sapma');
  await page.locator('#roi-shape').selectOption('polygon');
  for (const [x, y] of [
    [1, 1],
    [6, 1],
    [6, 3],
    [3, 3],
    [3, 6],
    [1, 6],
  ])
    await clickPixel(x!, y!);
  await page.locator('#analyze').click();
  await expect(page.locator('#metric-count')).toHaveText('7');
  await page.locator('#go-report').click();
  const download = page.waitForEvent('download');
  await page.locator('#export-batch').click();
  const path = info.outputPath('polygon.xlsx');
  await (await download).saveAs(path);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  expect(book.getWorksheet('Ölçüm Alanı')!.getCell(2, 9).value).toBe('polygon');
  expect(book.getWorksheet('Ölçüm Alanı')!.getImages()).toHaveLength(1);
});

test('candidate overlays can be inspected without invalidating the measurement', async ({
  page,
}) => {
  const { default: sharp } = await import('sharp');
  const pixels = Buffer.alloc(64 * 64, 180);
  for (let y = 10; y < 40; y++) pixels[y * 64 + 20] = 0;
  const buffer = await sharp(pixels, {
    raw: { width: 64, height: 64, channels: 1 },
  })
    .png()
    .toBuffer();
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles({ name: 'line.png', mimeType: 'image/png', buffer });
  await page.locator('#go-analyze').click();
  await page.locator('#manual').check();
  for (const [name, value] of Object.entries({
    centerX: '32',
    centerY: '32',
    radius: '30',
    insetPixels: '1',
  }))
    await page.locator(`input[name=${name}]`).fill(value);
  await page.locator('#analyze').click();
  await expect(page.locator('#defect-summary')).toContainText(
    '1 aday bölge; 1 ince/uzamış aday',
  );
  const redAtLine = () =>
    page
      .locator('#image-canvas')
      .evaluate(
        (canvas: HTMLCanvasElement) =>
          canvas.getContext('2d')!.getImageData(20, 20, 1, 1).data[0],
      );
  await expect.poll(redAtLine).toBeGreaterThan(0);
  await page.locator('#show-candidates').uncheck();
  await expect.poll(redAtLine).toBe(0);
  await expect(page.locator('#go-report')).toBeEnabled();
  await page.locator('#show-candidates').check();
  await expect.poll(redAtLine).toBeGreaterThan(0);
  await page.locator('#go-report').click();
  await expect(page.locator('#export')).toBeEnabled();
});

test('default analysis needs no material reference or technical settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: await disk(80),
  });
  await page.locator('#go-analyze').click();
  await expect(page.locator('#material-reference')).toHaveCount(0);
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open');
  await expect(page.locator('input[name=insetPixels]')).toBeHidden();
  await expect(page.locator('input[name=lowDensityThreshold]')).toBeHidden();
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/analyze'));
  await page.locator('#analyze').click();
  const payload = (await sent).postData() || '';
  expect(payload).not.toContain('name="materialReference"');
  expect(payload).not.toContain('name="insetPixels"');
  expect(payload).not.toContain('name="lowDensityThreshold"');
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#go-report')).toBeEnabled();
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open');
  await page.locator('#go-report').click();
  await expect(page.locator('#metric-mean')).toHaveText('80,0');
  await expect(page.locator('#detection-method')).not.toHaveAttribute('open');
  await expect(page.locator('#interpretation')).not.toContainText(
    'medyan ve mutlak sapmasından',
  );
});

test('automatic flat-piece fallback returns results and exports each piece without manual settings', async ({
  page,
}, info) => {
  const { default: sharp } = await import('sharp');
  const pixels = Buffer.alloc(128 * 128);
  for (const [top, value] of [
    [10, 80],
    [70, 160],
  ])
    for (let y = top!; y < top! + 40; y++)
      for (let x = 40; x < 60; x++) pixels[y * 128 + x] = value!;
  const buffer = await sharp(pixels, {
    raw: { width: 128, height: 128, channels: 1 },
  })
    .png()
    .toBuffer();
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer });
  await page.locator('#go-analyze').click();
  await page.locator('#analyze').click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#go-report')).toBeEnabled();
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open');
  await page.locator('#go-report').click();
  await expect(page.locator('#metric-mean')).toHaveText('120,0');
  await expect(page.locator('#part-measurements tr')).toHaveCount(2);
  await expect(page.locator('#part-measurements tr').nth(0)).toContainText(
    '80,0',
  );
  await expect(page.locator('#part-measurements tr').nth(1)).toContainText(
    '160,0',
  );
  await expect(page.locator('#interpretation')).toContainText('birleşik alan');
  const download = page.waitForEvent('download');
  await page.locator('#export-batch').click();
  const path = info.outputPath('flat-pieces.xlsx');
  await (await download).saveAs(path);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  const sheet = book.getWorksheet('CT Sayıları')!;
  expect(sheet.rowCount).toBe(6);
  expect(sheet.getCell(5, 4).value).toBe('Otomatik parça 1');
  expect(sheet.getCell(6, 7).value).toBe(160);
  expect(book.getWorksheet('Ölçüm Alanı')!.getImages()).toHaveLength(1);
});

test('different shapes share automatic batch analysis while retaining their own results and Excel outlines', async ({
  page,
}, info) => {
  const { default: sharp } = await import('sharp');
  const pixels = Buffer.alloc(128 * 128);
  for (let y = 20; y < 90; y++)
    for (let x = 20; x < 90; x++)
      if (x < 40 || y < 40) pixels[y * 128 + x] = 180;
  const buffer = await sharp(pixels, {
    raw: { width: 128, height: 128, channels: 1 },
  })
    .png()
    .toBuffer();
  await page.goto('/');
  await page.locator('#file').setInputFiles([
    { name: 'irregular.png', mimeType: 'image/png', buffer },
    { name: 'round.png', mimeType: 'image/png', buffer: await disk(80) },
  ]);
  await page.locator('#go-analyze').click();
  await page.locator('#analyze-all').click();
  await expect(page.locator('#batch-counts')).toContainText('2/2 hesaplandı');
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open');
  await page.locator('#go-report').click();
  await expect(page.locator('#metric-mean')).toHaveText('180,0');
  const options = await page
    .locator('#report-active-file option')
    .evaluateAll((nodes) =>
      nodes.map((n) => ({ value: n.value, text: n.textContent! })),
    );
  await page
    .locator('#report-active-file')
    .selectOption(options.find((o) => o.text.includes('round.png'))!.value);
  await expect(page.locator('#metric-mean')).toHaveText('80,0');
  await expect(page.locator('#part-results')).toBeHidden();
  await page
    .locator('#report-active-file')
    .selectOption(options.find((o) => o.text.includes('irregular.png'))!.value);
  await expect(page.locator('#metric-mean')).toHaveText('180,0');
  await expect(page.locator('#part-measurements tr')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.locator('#export-batch').click();
  const path = info.outputPath('mixed-shapes.xlsx');
  await (await download).saveAs(path);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  expect(book.getWorksheet('CT Sayıları')!.rowCount).toBe(8);
  expect(book.getWorksheet('Ölçüm Alanı')!.getCell(2, 9).value).toBe('polygon');
  expect(book.getWorksheet('Ölçüm Alanı')!.getCell(3, 9).value).toBe('circle');
  expect(book.getWorksheet('Ölçüm Alanı')!.getImages()).toHaveLength(2);
});

test('uncertain images request a visual boundary and recover without technical inputs', async ({
  page,
}) => {
  const { default: sharp } = await import('sharp');
  const buffer = await sharp(Buffer.alloc(128 * 128, 80), {
    raw: { width: 128, height: 128, channels: 1 },
  })
    .png()
    .toBuffer();
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles({ name: 'uncertain.png', mimeType: 'image/png', buffer });
  await page.locator('#go-analyze').click();
  await page.locator('#analyze').click();
  await expect(page.locator('#draw-area')).toBeVisible();
  await expect(page.locator('#batch-counts')).toContainText(
    '1 alan seçimi bekliyor',
  );
  await expect(page.locator('#batch-counts')).not.toContainText('1 hata');
  await page.locator('#draw-area').click();
  await expect(page.locator('#roi-shape')).toHaveValue('polygon');
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open');
  for (const [x, y] of [
    [10, 10],
    [110, 10],
    [110, 110],
    [10, 110],
  ])
    await page.locator('#image-canvas').click({ position: { x: x!, y: y! } });
  await page.locator('#analyze').click();
  await expect(page.locator('#go-report')).toBeEnabled();
  await expect(page.locator('#batch-counts')).toHaveText('1/1 hesaplandı');
  await page.locator('#go-report').click();
  await expect(page.locator('#metric-mean')).toHaveText('80,0');
});
