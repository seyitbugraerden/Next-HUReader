import { toneSignals } from './tone-signals.js';
import type { AppearanceReference, ImageData } from './analysis.types.js';

// These are image appearance signals, not physical density/depth estimates.
// Integer histograms keep reference estimation bounded even for large images.
function reference(histogram: Uint32Array, floor: number) {
  const count = histogram.reduce((sum, value) => sum + value, 0);
  function median(hist: Uint32Array) {
    let total = 0;
    for (let i = 0; i < hist.length; i++) {
      total += hist[i]!;
      if (total > (count - 1) / 2) return i;
    }
    return 0;
  }
  const center = median(histogram);
  const deviations = new Uint32Array(histogram.length);
  histogram.forEach((count, value) => {
    deviations[Math.abs(value - center)]! += count;
  });
  return [center, Math.max(floor, 3 * 1.4826 * median(deviations))] as const;
}
function chroma(rgba: Uint8Array, i: number): [number, number] {
  const r = rgba[i * 4]!,
    g = rgba[i * 4 + 1]!,
    b = rgba[i * 4 + 2]!;
  const sum = r + g + b;
  // Near black, normalized chroma is dominated by quantization noise.
  return sum < 30
    ? [85, 85]
    : [Math.round((255 * r) / sum), Math.round((255 * b) / sum)];
}
export function appearanceSignals(
  image: ImageData,
  roi: Uint8Array,
  intensityThreshold: number,
  automatic = true,
) {
  const { rgba, values, valid } = image;
  const signals = new Uint8Array(roi.length);
  for (let i = 0; i < roi.length; i++)
    if (roi[i] && valid[i] && values[i]! <= intensityThreshold) signals[i] = 1;
  if (!automatic) return { signals };
  const tone = toneSignals(image, roi, signals);
  const appearance: AppearanceReference = {
    mode: rgba ? 'color-tone-alpha' : 'tone',
    localRadius: tone.radii.at(-1) ?? 0,
    localRadii: tone.radii,
    localNoise: tone.noise,
    localContrastFloor: tone.threshold,
  };
  if (!rgba) return { signals, appearance };
  const red = new Uint32Array(256),
    blue = new Uint32Array(256),
    alpha = new Uint32Array(256);
  for (let i = 0; i < roi.length; i++) {
    if (!roi[i] || !valid[i]) continue;
    const [r, b] = chroma(rgba, i);
    red[r]++;
    blue[b]++;
    alpha[rgba[i * 4 + 3]!]++;
  }
  const [r, rt] = reference(red, 12),
    [b, bt] = reference(blue, 12),
    [a, at] = reference(alpha, 16);
  Object.assign(appearance, {
    color: [r, b],
    colorThresholds: [rt, bt],
    alpha: a,
    alphaThreshold: at,
  });
  for (let i = 0; i < roi.length; i++) {
    if (!roi[i] || !valid[i]) continue;
    const [cr, cb] = chroma(rgba, i);
    if (Math.abs(cr - r) > rt || Math.abs(cb - b) > bt) signals[i]! |= 4;
    if (Math.abs(rgba[i * 4 + 3]! - a) > at) signals[i]! |= 8;
  }
  return { signals, appearance };
}
