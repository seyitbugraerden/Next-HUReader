import { detectFlatPieces } from './flat-sample.js';
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
  const pieces = detectFlatPieces(i)!;
  expect(pieces).toHaveLength(2);
  expect(Math.min(...pieces[0]!.map((p) => p[0]))).toBe(40);
  expect(Math.max(...pieces[0]!.map((p) => p[0]))).toBe(59);
  expect(Math.min(...pieces[1]!.map((p) => p[1]))).toBe(70);
});
it('rejects uniform images, thin support lines and a horizontal table across the image', () => {
  const i = image();
  i.display.fill(160);
  expect(detectFlatPieces(i)).toBeNull();
  i.display.fill(0);
  for (let y = 110; y < 120; y++)
    for (let x = 0; x < 128; x++) i.display[y * 128 + x] = 160;
  for (let y = 0; y < 100; y++) i.display[y * 128 + 80] = 160;
  expect(detectFlatPieces(i)).toBeNull();
});
