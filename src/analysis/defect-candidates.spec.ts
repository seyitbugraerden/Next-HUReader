import { findDefectCandidates } from './defect-candidates.js';
import type { ImageData } from './analysis.types.js';
function fixture() {
  const image: ImageData = {
    width: 64,
    height: 64,
    values: new Float64Array(4096).fill(1000),
    valid: new Uint8Array(4096).fill(1),
    display: new Uint8Array(4096),
    unit: 'HU',
    spacing: [0.25, 0.5],
    metadata: {},
    warnings: [],
  };
  const mask = new Uint8Array(4096).fill(1);
  const sorted = () =>
    Array.from(image.values)
      .filter((_, i) => mask[i])
      .sort((a, b) => a - b);
  return { image, mask, sorted };
}
it('separates elongated candidates, compact regions and boundary contact without counting isolated noise', () => {
  const { image, mask, sorted } = fixture();
  for (let y = 10; y < 40; y++) image.values[y * 64 + 20] = -1000;
  for (let y = 40; y < 44; y++)
    for (let x = 40; x < 44; x++) image.values[y * 64 + x] = -1000;
  for (let y = 15; y < 26; y++) image.values[y * 64] = -1000;
  image.values[3 * 64 + 50] = -1000;
  const result = findDefectCandidates(image, mask, sorted());
  expect(result.threshold).toBe(999);
  expect(result.count).toBe(3);
  expect(result.elongatedCount).toBe(2);
  expect(result.boundaryCount).toBe(1);
  expect(result.pixels).toBe(57);
  expect(result.area).toBe(7.125);
  expect(result.regions[0]).toMatchObject({
    pixels: 30,
    widthMm: 0.25,
    heightMm: 15,
    elongated: true,
    touchesBoundary: false,
  });
  expect(result.mask[3 * 64 + 50]).toBe(0);
});
it('does not fabricate candidates in a uniform sample and never includes pixels outside the ROI', () => {
  const { image, mask, sorted } = fixture();
  expect(findDefectCandidates(image, mask, sorted()).count).toBe(0);
  for (let i = 0; i < 4096; i++)
    if (i % 64 < 32) {
      image.values[i] = -1000;
      mask[i] = 0;
    }
  const result = findDefectCandidates(image, mask, sorted(), 1000);
  expect(result.pixels).toBe(2048);
  expect(result.mask[0]).toBe(0);
  expect(result.percent).toBe(100);
  expect(result.thresholdSource).toBe('user');
});

it('removes an exact original component and preserves untouched candidates', () => {
  const { image, mask, sorted } = fixture();
  for (let y = 10; y < 20; y++) image.values[y * 64 + 10] = -1000;
  for (let y = 30; y < 40; y++) image.values[y * 64 + 30] = -1000;
  const automatic = findDefectCandidates(image, mask, sorted());
  expect(automatic.regions[0]!.outline.length).toBeGreaterThanOrEqual(3);
  const result = findDefectCandidates(image, mask, sorted(), undefined, [
    { id: 1, points: null },
  ]);
  expect(result.manuallyEdited).toBe(true);
  expect(result.count).toBe(1);
  expect(result.pixels).toBe(10);
  expect(result.mask[10 * 64 + 10]).toBe(0);
  expect(result.mask[30 * 64 + 30]).toBe(1);
});

it('measures a concave edited boundary, clips to valid ROI pixels, and unions overlaps', () => {
  const { image, mask, sorted } = fixture();
  for (let y = 10; y < 13; y++) image.values[y * 64 + 10] = -1000;
  for (let y = 30; y < 33; y++) image.values[y * 64 + 30] = -1000;
  mask[11 * 64 + 11] = 0;
  const points: [number, number][] = [
    [9.5, 9.5],
    [13.5, 9.5],
    [13.5, 11.5],
    [11.5, 11.5],
    [11.5, 13.5],
    [9.5, 13.5],
  ];
  const result = findDefectCandidates(image, mask, sorted(), undefined, [
    { id: 1, points },
    { id: 2, points },
  ]);
  expect(result.count).toBe(1);
  expect(result.pixels).toBe(11);
  expect(result.area).toBe(1.375);
  expect(result.mask[12 * 64 + 12]).toBe(0); // Concavity remains empty.
  expect(result.mask[11 * 64 + 11]).toBe(0); // Invalid ROI pixel remains excluded.
  expect(result.regions[0]!.mean).toBeCloseTo((3 * -1000 + 8 * 1000) / 11);
  expect(result.percent).toBeCloseTo(1100 / 4095);
  expect(() =>
    findDefectCandidates(image, mask, sorted(), undefined, [
      { id: 3, points: null },
    ]),
  ).toThrow('ön analizi');
  expect(() =>
    findDefectCandidates(image, mask, sorted(), undefined, [
      {
        id: 1,
        points: [
          [1, 1],
          [5, 5],
          [1, 5],
          [5, 1],
        ],
      },
    ]),
  ).toThrow('kesemez');
});
