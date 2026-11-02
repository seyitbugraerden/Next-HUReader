import { detectSampleAreas } from './sample-segmentation.js';
import type { ImageData } from './analysis.types.js';
function image(): ImageData {
  return {
    width: 128,
    height: 128,
    display: new Uint8Array(16384),
    values: new Float64Array(16384),
    valid: new Uint8Array(16384).fill(1),
    unit: 'gray',
    spacing: null,
    metadata: {},
    warnings: [],
  };
}
it('proposes separate outlines for flat pieces without cutting an internal dark hole out of the material', () => {
  const i = image();
  for (const top of [10, 70])
    for (let y = top; y < top + 40; y++)
      for (let x = 40; x < 60; x++) i.display[y * 128 + x] = 160;
  for (let y = 25; y < 30; y++)
    for (let x = 48; x < 52; x++) i.display[y * 128 + x] = 0;
  const pieces = detectSampleAreas(i)!.outlines;
  expect(pieces).toHaveLength(2);
  expect(Math.min(...pieces[0]!.map((p) => p[0]))).toBe(39.5);
  expect(Math.max(...pieces[0]!.map((p) => p[0]))).toBe(59.5);
  expect(Math.min(...pieces[1]!.map((p) => p[1]))).toBe(69.5);
});
it('rejects uniform images, thin support lines and a horizontal table across the image', () => {
  const i = image();
  i.display.fill(160);
  expect(detectSampleAreas(i)).toBeNull();
  i.display.fill(0);
  for (let y = 110; y < 120; y++)
    for (let x = 0; x < 128; x++) i.display[y * 128 + x] = 160;
  for (let y = 0; y < 100; y++) i.display[y * 128 + 80] = 160;
  expect(detectSampleAreas(i)).toBeNull();
});

it('follows a concave sample instead of filling its outer bounding rectangle and retains enclosed dark pixels', () => {
  const i = image();
  for (let y = 20; y < 90; y++)
    for (let x = 20; x < 90; x++)
      if (x < 40 || y < 40) i.display[y * 128 + x] = 160;
  for (let y = 25; y < 29; y++)
    for (let x = 25; x < 29; x++) i.display[y * 128 + x] = 0;
  i.valid[27 * 128 + 27] = 0;
  const result = detectSampleAreas(i)!;
  expect(result.outlines).toHaveLength(1);
  expect(result.outlines[0]!.length).toBeGreaterThan(4);
  expect(result.labels[80 * 128 + 80]).toBe(0);
  expect(result.labels[80 * 128 + 25]).toBe(1);
  expect(result.labels[25 * 128 + 80]).toBe(1);
  expect(result.labels[26 * 128 + 26]).toBe(1);
  expect(result.labels[27 * 128 + 27]).toBe(0);
});
it('adapts to a dark irregular sample on a light background', () => {
  const i = image();
  i.display.fill(240);
  for (let y = 20; y < 90; y++)
    for (let x = 20; x < 90; x++)
      if (x < 40 || y < 40) i.display[y * 128 + x] = 60;
  const result = detectSampleAreas(i)!;
  expect(result.background).toBe('light');
  expect(result.labels[25 * 128 + 25]).toBe(1);
  expect(result.labels[80 * 128 + 80]).toBe(0);
  expect(result.labels[0]).toBe(0);
});
it('supports a rotated sample without requiring an elongated axis-aligned box', () => {
  const i = image();
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const u = (x - 64) * Math.cos(0.7) + (y - 64) * Math.sin(0.7),
        v = -(x - 64) * Math.sin(0.7) + (y - 64) * Math.cos(0.7);
      if (Math.abs(u) < 35 && Math.abs(v) < 14) i.display[y * 128 + x] = 140;
    }
  const result = detectSampleAreas(i)!;
  expect(result.outlines).toHaveLength(1);
  expect(result.labels[64 * 128 + 64]).toBe(1);
  expect(result.labels[30 * 128 + 30]).toBe(0);
});
it('excludes a lower horizontal CT support even when it does not span the whole frame', () => {
  const i = image();
  i.unit = 'HU';
  for (let y = 30; y < 75; y++)
    for (let x = 45; x < 75; x++) i.display[y * 128 + x] = 160;
  for (let y = 110; y < 122; y++)
    for (let x = 5; x < 100; x++) i.display[y * 128 + x] = 160;
  const result = detectSampleAreas(i)!;
  expect(result.outlines).toHaveLength(1);
  expect(result.labels[50 * 128 + 60]).toBe(1);
  expect(result.labels[115 * 128 + 50]).toBe(0);
});
