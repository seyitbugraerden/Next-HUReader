import { segmentTones } from './tone-segmentation.js';
import { AnalysisService, parseOptions } from './analysis.service.js';
import { dicomFixture } from '../../test/fixtures.js';
import type { ImageData } from './analysis.types.js';
import ExcelJS from 'exceljs';

function image(width = 30, height = 12): ImageData {
  const values = Float64Array.from(
    { length: width * height },
    (_, i) => [-600, 0, 800][Math.floor((i % width) / (width / 3))]!,
  );
  return {
    width,
    height,
    values,
    display: new Uint8Array(values.length).fill(128),
    valid: new Uint8Array(values.length).fill(1),
    unit: 'HU',
    spacing: [0.2, 0.5],
    metadata: {},
    warnings: [],
  };
}
it('partitions dark, middle and bright values exhaustively and measures the original HU', () => {
  const data = image(),
    roi = data.valid.slice(),
    original = data.values.slice();
  const result = segmentTones(data, roi, 3);
  expect(result.bands).toHaveLength(3);
  expect(result.bands.map((b) => b.mean)).toEqual([-600, 0, 800]);
  expect(result.bands.map((b) => b.pixels)).toEqual([120, 120, 120]);
  expect(result.bands.reduce((sum, b) => sum + b.percent, 0)).toBeCloseTo(100);
  expect(result.bands.reduce((sum, b) => sum + b.area!, 0)).toBeCloseTo(36);
  expect(result.count).toBe(3);
  expect(result.bandMap.every((id) => id >= 1 && id <= 3)).toBe(true);
  expect(result.labels.every((id) => id > 0)).toBe(true);
  expect(data.values).toEqual(original);
});
it('separates disconnected pieces with the same tone', () => {
  const data = image();
  for (let i = 0; i < data.values.length; i++)
    if (data.values[i] === 800) data.values[i] = -600;
  const result = segmentTones(data, data.valid, 2);
  expect(result.count).toBe(3);
  expect(result.bands).toHaveLength(2);
  expect(result.regions.filter((r) => r.band === 1)).toHaveLength(2);
});
it('excludes invalid and out-of-ROI values even when their hidden intensities are extreme', () => {
  const data = image(),
    roi = data.valid.slice();
  roi[0] = 0;
  data.valid[1] = 0;
  data.values[0] = 1e9;
  data.values[1] = -1e9;
  const result = segmentTones(data, roi, 3);
  expect(result.pixels).toBe(358);
  expect(result.labels[0]).toBe(0);
  expect(result.bandMap[1]).toBe(0);
  expect(result.bands.map((b) => b.mean)).toEqual([-600, 0, 800]);
});
it('represents a uniform sample as one real tone rather than fabricating levels', () => {
  const data = image();
  data.values.fill(42);
  const result = segmentTones(data, data.valid, 8);
  expect(result.bands).toHaveLength(1);
  expect(result.count).toBe(1);
  expect(result.bands[0]).toMatchObject({
    mean: 42,
    min: 42,
    max: 42,
    std: 0,
    percent: 100,
  });
});
it('preserves rare bright and dark tones when most pixels have the same value', () => {
  const data = image();
  data.values.fill(100);
  data.values[0] = -600;
  data.values[1] = 800;
  const result = segmentTones(data, data.valid, 5);
  expect(result.bands.map((b) => b.mean)).toEqual([-600, 100, 800]);
  expect(result.pixels).toBe(data.values.length);
});
it('keeps every pixel counted when the detail list is capped', () => {
  const data = image(60, 60);
  for (let y = 0; y < 60; y++)
    for (let x = 0; x < 60; x++)
      data.values[y * 60 + x] = (x % 2) + (y % 2) * 2;
  const result = segmentTones(data, data.valid, 4);
  expect(result.truncated).toBe(true);
  expect(result.regions).toHaveLength(200);
  expect(result.bands.reduce((sum, b) => sum + b.pixels, 0)).toBe(3600);
  expect(result.labels.every((id) => id > 0)).toBe(true);
});
it('does not depend on preview windowing', () => {
  const data = image();
  const first = segmentTones(data, data.valid, 3);
  data.display.fill(255);
  expect(segmentTones(data, data.valid, 3).bandMap).toEqual(first.bandMap);
});
it('validates tone level inputs', () => {
  for (const v of [1, 9, 2.5, true, [], {}, 'x'])
    expect(() => parseOptions({ toneLevels: v })).toThrow();
  expect(parseOptions({ toneLevels: '5' }).toneLevels).toBe(5);
});
it('integrates tone coverage and numeric tables into a DICOM analysis and Excel export', async () => {
  const service = new AnalysisService(),
    data = image(30, 30);
  const result = await service.analyze(
    dicomFixture({
      width: 30,
      height: 30,
      pixelValues: Array.from(data.values, (v) => v + 1024),
    }),
    'tones.dcm',
    { centerX: 15, centerY: 15, radius: 14, insetPixels: 0, toneLevels: 3 },
  );
  expect(result.toneSegmentation!.pixels).toBe(result.measurements[0]!.count);
  expect(result.toneSegmentation!.bands.map((b) => b.mean)).toEqual([
    -600, 0, 800,
  ]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await service.exportExcel(result));
  const rows: unknown[] = [];
  book.worksheets[0]!.eachRow((row) => rows.push(row.getCell(1).value));
  expect(rows).toContain('Ton sınıfı');
  expect(rows).toContain('Ton bölgesi');
});
