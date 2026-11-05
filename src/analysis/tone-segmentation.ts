import type { ImageData } from './analysis.types.js';

export interface ToneMeasurement {
  pixels: number;
  area: number | null;
  percent: number;
  mean: number;
  std: number;
  min: number;
  max: number;
}
export interface ToneBand extends ToneMeasurement {
  id: number;
  lower: number;
  upper: number;
  color: [number, number, number];
}
export interface ToneRegion extends ToneMeasurement {
  id: number;
  band: number;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface ToneSegmentation {
  method: 'intensity-kmeans';
  requestedLevels: number;
  pixels: number;
  count: number;
  bands: ToneBand[];
  regions: ToneRegion[];
  truncated: boolean;
  overlay: string;
  labelMap: string;
}
const palette = [
  [68, 1, 84],
  [70, 50, 126],
  [54, 92, 141],
  [39, 127, 142],
  [31, 161, 135],
  [74, 193, 109],
  [160, 218, 57],
  [253, 231, 37],
] as [number, number, number][];

// Exhaustive partition of valid ROI pixels. Clustering uses original intensities,
// never preview colors or the candidate mask; no pixel is dropped as "noise".
export function segmentTones(image: ImageData, roi: Uint8Array, levels = 5) {
  const { width, height, values, valid, spacing } = image;
  const indices = (i: number) => !!roi[i] && !!valid[i];
  let min = Infinity,
    max = -Infinity,
    pixels = 0;
  for (let i = 0; i < values.length; i++)
    if (indices(i)) {
      min = Math.min(min, values[i]!);
      max = Math.max(max, values[i]!);
      pixels++;
    }
  if (!pixels)
    throw new Error('Ton bölgelemesi için geçerli piksel bulunamadı.');
  const histogram = new Uint32Array(1024),
    sums = new Float64Array(1024);
  const bin = (v: number) =>
    max === min
      ? 0
      : Math.min(1023, Math.floor((1023 * (v - min)) / (max - min)));
  for (let i = 0; i < values.length; i++)
    if (indices(i)) {
      const b = bin(values[i]!);
      histogram[b]++;
      sums[b]! += values[i]!;
    }
  let centers: number[] = [];
  for (let c = 0; c < levels; c++) {
    const target = c === 0 ? 1 : (pixels * c) / (levels - 1);
    let count = 0;
    for (let b = 0; b < histogram.length; b++) {
      count += histogram[b]!;
      if (count >= target && histogram[b]) {
        centers.push(sums[b]! / histogram[b]!);
        break;
      }
    }
  }
  centers = [...new Set(centers)].sort((a, b) => a - b);
  const nearest = (v: number, means: number[]) => {
    let id = 0;
    for (let c = 1; c < means.length; c++)
      if (Math.abs(v - means[c]!) < Math.abs(v - means[id]!)) id = c;
    return id;
  };
  for (let iteration = 0; iteration < 40; iteration++) {
    const totals = centers.map(() => 0),
      counts = centers.map(() => 0);
    for (let b = 0; b < histogram.length; b++)
      if (histogram[b]) {
        const c = nearest(sums[b]! / histogram[b]!, centers);
        totals[c]! += sums[b]!;
        counts[c]! += histogram[b]!;
      }
    const next = centers.flatMap((_, c) =>
      counts[c] ? [totals[c]! / counts[c]!] : [],
    );
    const settled =
      next.length === centers.length &&
      next.every((v, c) => Math.abs(v - centers[c]!) <= 1e-9);
    centers = next;
    if (settled) break;
  }
  const thresholds = centers.slice(1).map((v, c) => (v + centers[c]!) / 2);
  const bandMap = new Uint8Array(values.length),
    labels = new Uint32Array(values.length);
  const area = spacing ? spacing[0] * spacing[1] : null;
  function accumulator() {
    return { pixels: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity };
  }
  function add(a: ReturnType<typeof accumulator>, value: number) {
    a.pixels++;
    const delta = value - a.mean;
    a.mean += delta / a.pixels;
    a.m2 += delta * (value - a.mean);
    a.min = Math.min(a.min, value);
    a.max = Math.max(a.max, value);
  }
  function measure(a: ReturnType<typeof accumulator>): ToneMeasurement {
    return {
      pixels: a.pixels,
      mean: a.mean,
      std: Math.sqrt(Math.max(0, a.m2 / a.pixels)),
      min: a.min,
      max: a.max,
      area: area === null ? null : a.pixels * area,
      percent: (100 * a.pixels) / pixels,
    };
  }
  const totals = centers.map(accumulator);
  for (let i = 0; i < values.length; i++)
    if (indices(i)) {
      let b = 0;
      while (b < thresholds.length && values[i]! > thresholds[b]!) b++;
      bandMap[i] = b + 1;
      add(totals[b]!, values[i]!);
    }
  const bands: ToneBand[] = totals.map((a, c) => ({
    id: c + 1,
    ...measure(a),
    lower: c ? thresholds[c - 1]! : min,
    upper: thresholds[c] ?? max,
    color:
      palette[
        Math.round((c * (palette.length - 1)) / Math.max(1, centers.length - 1))
      ]!,
  }));
  const queue = new Int32Array(values.length);
  const regions: ToneRegion[] = [];
  let count = 0;
  for (let start = 0; start < values.length; start++) {
    if (!bandMap[start] || labels[start]) continue;
    const id = ++count,
      band = bandMap[start]!;
    let head = 0,
      tail = 1,
      left = width,
      right = 0,
      top = height,
      bottom = 0;
    const stats = accumulator();
    queue[0] = start;
    labels[start] = id;
    while (head < tail) {
      const i = queue[head++]!,
        x = i % width,
        y = Math.floor(i / width);
      add(stats, values[i]!);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if ((!dx && !dy) || nx < 0 || nx >= width || ny < 0 || ny >= height)
            continue;
          const next = ny * width + nx;
          if (bandMap[next] === band && !labels[next]) {
            labels[next] = id;
            queue[tail++] = next;
          }
        }
    }
    if (regions.length === 200 && stats.pixels <= regions[199]!.pixels)
      continue;
    regions.push({
      id,
      band,
      ...measure(stats),
      bounds: {
        x: left,
        y: top,
        width: right - left + 1,
        height: bottom - top + 1,
      },
    });
    regions.sort((a, b) => b.pixels - a.pixels || a.id - b.id);
    if (regions.length > 200) regions.length = 200;
  }
  return {
    bandMap,
    labels,
    method: 'intensity-kmeans' as const,
    requestedLevels: levels,
    pixels,
    count,
    bands,
    regions,
    truncated: count > regions.length,
  };
}
