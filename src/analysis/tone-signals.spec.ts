import { findDefectCandidates } from './defect-candidates.js';
import { appearanceSignals } from './appearance-signals.js';
import type { ImageData } from './analysis.types.js';

function sample({ feature = true, dicom = false, noise = false } = {}) {
  const width = 128,
    height = 128;
  const values = new Float64Array(width * height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // A broad, blurred feature on uneven illumination. Every pixel remains
      // well above the global dark-tail cutoff, and RGB ratios are all identical.
      let v = 140 + x * 0.3 + y * 0.1;
      if (feature)
        v -= 10 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / (2 * 9 ** 2));
      if (noise) v += ((x * 17 + y * 13) % 5) - 2;
      v = Math.round(v);
      values[i] = dicom ? v * 4 - 1000 : v;
      rgba.set([v, v, v, 255], i * 4);
    }
  const image: ImageData = {
    width,
    height,
    values,
    rgba: dicom ? undefined : rgba,
    display: Uint8Array.from(values, (v) =>
      dicom ? Math.max(0, Math.min(255, (v + 1000) * 0.1275)) : v,
    ),
    valid: new Uint8Array(values.length).fill(1),
    unit: dicom ? 'HU' : 'gray',
    spacing: null,
    metadata: {},
    warnings: [],
  };
  const roi = image.valid.slice();
  const sorted = () =>
    Array.from(values)
      .filter((_, i) => roi[i] && image.valid[i])
      .sort((a, b) => a - b);
  return { image, roi, sorted };
}

it.each([false, true])(
  'finds a broad low-contrast grayscale feature (DICOM: %s)',
  (dicom) => {
    const { image, roi, sorted } = sample({ dicom });
    const original = image.values.slice();
    const result = findDefectCandidates(image, roi, sorted());
    const center = 64 * image.width + 64;
    expect(image.values[center]).toBeGreaterThan(result.threshold);
    expect(result.mask[center]).toBe(1);
    expect(
      result.regions.some((region) =>
        region.signals?.includes('local-contrast'),
      ),
    ).toBe(true);
    expect(result.appearance!.localRadii.length).toBeGreaterThan(1);
    expect(image.values).toEqual(original);
  },
);

it.each([false, true])(
  'does not turn a lighting gradient into candidates (DICOM: %s)',
  (dicom) => {
    const { image, roi, sorted } = sample({ feature: false, dicom });
    expect(findDefectCandidates(image, roi, sorted()).count).toBe(0);
  },
);

it('does not turn small bounded quantization noise into local tonal regions', () => {
  const { image, roi } = sample({ feature: false, noise: true });
  const { signals } = appearanceSignals(image, roi, -Infinity);
  expect(signals.some((signal) => signal & 2)).toBe(false);
});

it('does not infer dark regions from incomplete rings at transparent or ROI boundaries', () => {
  const { image, roi } = sample({ feature: false });
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      if (x < 40 || (x > 90 && y < 70)) {
        roi[y * image.width + x] = 0;
        image.valid[y * image.width + x] = 0;
      }
    }
  const { signals } = appearanceSignals(image, roi, -Infinity);
  expect(signals.some((signal) => signal & 2)).toBe(false);
});

it('preserves tonal segmentation under PNG window calibration', () => {
  const { image, roi } = sample();
  const native = appearanceSignals(image, roi, -Infinity);
  const calibrated: ImageData = {
    ...image,
    unit: 'estimated-HU',
    values: Float64Array.from(image.values, (v) => -1000 + (v * 2000) / 255),
    metadata: { 'Pencere alt sınırı': -1000, 'Pencere üst sınırı': 1000 },
  };
  const estimated = appearanceSignals(calibrated, roi, -Infinity);
  expect(estimated.signals).toEqual(native.signals);
});

it('uses original DICOM values regardless of preview window clipping', () => {
  const { image, roi } = sample({ dicom: true });
  const native = appearanceSignals(image, roi, -Infinity);
  image.display.fill(255);
  expect(appearanceSignals(image, roi, -Infinity).signals).toEqual(
    native.signals,
  );
});
