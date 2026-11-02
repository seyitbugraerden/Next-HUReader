import type { ImageData } from './analysis.types.js';
type Point = [number, number];
export interface SampleSegmentation {
  outlines: Point[][];
  labels: Uint16Array;
  croppedParts: number;
  threshold: number;
  background: 'light' | 'dark';
}

function otsu(histogram: Uint32Array, count: number) {
  let sum = 0,
    leftSum = 0,
    leftCount = 0,
    best = -1,
    threshold = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i]!;
  for (let i = 0; i < 255; i++) {
    leftCount += histogram[i]!;
    leftSum += i * histogram[i]!;
    const rightCount = count - leftCount;
    if (!leftCount || !rightCount) continue;
    const difference = leftSum / leftCount - (sum - leftSum) / rightCount;
    const score = leftCount * rightCount * difference * difference;
    if (score > best) {
      best = score;
      threshold = i;
    }
  }
  return best > 0 ? threshold : null;
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!,
      a = points[first]!,
      b = points[last]!;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = dx * dx + dy * dy;
    let furthest = -1,
      distance = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i]!,
        t = length
          ? Math.max(
              0,
              Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length),
            )
          : 0;
      const d = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
      if (d > distance) {
        distance = d;
        furthest = i;
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function contour(
  labels: Uint16Array,
  id: number,
  w: number,
  h: number,
  box: number[],
): Point[] | null {
  const stride = w + 1,
    edges = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const next = edges.get(a) ?? [];
    next.push(b);
    edges.set(a, next);
  };
  for (let y = box[1]!; y <= box[3]!; y++)
    for (let x = box[0]!; x <= box[2]!; x++) {
      const i = y * w + x;
      if (labels[i] !== id) continue;
      const top = y * stride + x,
        right = top + 1,
        bottom = top + stride,
        corner = bottom + 1;
      if (y === 0 || labels[i - w] !== id) add(top, right);
      if (x === w - 1 || labels[i + 1] !== id) add(right, corner);
      if (y === h - 1 || labels[i + w] !== id) add(corner, bottom);
      if (x === 0 || labels[i - 1] !== id) add(bottom, top);
    }
  let largest: Point[] = [],
    largestArea = 0;
  const direction = (a: number, b: number) =>
    b === a + 1 ? 0 : b === a + stride ? 1 : b === a - 1 ? 2 : 3;
  while (edges.size) {
    const start = edges.keys().next().value!;
    let current = start,
      previous = 0;
    const points: Point[] = [];
    let closed = false;
    for (let step = 0; step < 8 * w * h; step++) {
      points.push([
        (current % stride) - 0.5,
        Math.floor(current / stride) - 0.5,
      ]);
      const next = edges.get(current);
      if (!next?.length) break;
      const rank = (end: number) => {
        const turn = (direction(current, end) - previous + 4) % 4;
        return turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3;
      };
      next.sort((a, b) => rank(a) - rank(b));
      const end = next.shift()!;
      if (!next.length) edges.delete(current);
      previous = direction(current, end);
      current = end;
      if (current === start) {
        closed = true;
        break;
      }
    }
    if (!closed) return null;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) > largestArea) {
      largest = points;
      largestArea = Math.abs(area);
    }
  }
  if (largest.length < 3) return null;
  let far = 1;
  for (let i = 2; i < largest.length; i++)
    if (
      Math.hypot(
        largest[i]![0] - largest[0]![0],
        largest[i]![1] - largest[0]![1],
      ) >
      Math.hypot(
        largest[far]![0] - largest[0]![0],
        largest[far]![1] - largest[0]![1],
      )
    )
      far = i;
  const result = [
    ...simplify(largest.slice(0, far + 1), 0.5).slice(0, -1),
    ...simplify([...largest.slice(far), largest[0]!], 0.5).slice(0, -1),
  ];
  return result.length >= 3 && result.length <= 512 ? result : null;
}

// A shared foreground pipeline for non-circular silhouettes, not a trained
// material classifier. Enclosed dark pixels are kept for defect measurements.
export function detectSampleAreas(image: ImageData): SampleSegmentation | null {
  const { width: w, height: h, display, valid } = image,
    n = w * h;
  if (Math.min(w, h) < 32) return null;
  const histogram = new Uint32Array(256),
    border: number[] = [];
  let validCount = 0,
    lo = 255,
    hi = 0;
  for (let i = 0; i < n; i++)
    if (valid[i]) {
      const v = display[i]!;
      histogram[v]++;
      validCount++;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      const x = i % w,
        y = Math.floor(i / w);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border.push(v);
    }
  if (hi - lo < 16) return null;
  const threshold = otsu(histogram, validCount);
  if (threshold === null) return null;
  border.sort((a, b) => a - b);
  const light =
    image.unit === 'gray' &&
    border.length > 0 &&
    border[Math.floor(border.length / 2)]! > threshold;
  const foreground = new Uint8Array(n);
  let foregroundCount = 0;
  for (let i = 0; i < n; i++)
    if (
      valid[i] &&
      (light ? display[i]! <= threshold : display[i]! > threshold)
    ) {
      foreground[i] = 1;
      foregroundCount++;
    }
  if (foregroundCount > n * 0.85 || foregroundCount < 16) return null;
  const radius = Math.min(2, Math.max(1, Math.floor(Math.min(w, h) / 256)));
  const eroded = new Uint8Array(n),
    queue = new Int32Array(n),
    seeds = new Uint16Array(n);
  for (let y = radius; y < h - radius; y++)
    for (let x = radius; x < w - radius; x++) {
      let yes = true;
      for (let dy = -radius; dy <= radius && yes; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          if (!foreground[(y + dy) * w + x + dx]) {
            yes = false;
            break;
          }
      if (yes) eroded[y * w + x] = 1;
    }
  let count = 0;
  for (let start = 0; start < n; start++) {
    if (!eroded[start]) continue;
    let head = 0,
      tail = 1,
      minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    queue[0] = start;
    eroded[start] = 0;
    while (head < tail) {
      const i = queue[head++]!,
        x = i % w,
        y = Math.floor(i / w);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const next of [i - 1, i + 1, i - w, i + w])
        if (eroded[next]) {
          eroded[next] = 0;
          queue[tail++] = next;
        }
    }
    const width = maxX - minX + 1,
      height = maxY - minY + 1,
      short = Math.min(width, height),
      long = Math.max(width, height);
    if (
      tail < Math.max(16, n * 0.0005) ||
      short < Math.max(4, Math.min(w, h) * 0.012) ||
      long / short > 25 ||
      (width > w * 0.8 && height < h * 0.25) ||
      (image.unit === 'HU' &&
        minY > h * 0.6 &&
        width > 2 * height &&
        height < h * 0.2 &&
        width > w * 0.1)
    )
      continue;
    const sides =
      Number(minX <= radius) +
      Number(minY <= radius) +
      Number(maxX >= w - radius - 1) +
      Number(maxY >= h - radius - 1);
    if (sides >= 3) continue;
    if (++count > 32) return null;
    for (let i = 0; i < tail; i++) seeds[queue[i]!] = count;
  }
  if (!count) return null;
  const labels = new Uint16Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!foreground[i]) continue;
      if (seeds[i]) {
        labels[i] = seeds[i]!;
        continue;
      }
      let closest = Infinity,
        id = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const seed = seeds[ny * w + nx]!,
            d = dx * dx + dy * dy;
          if (seed && d < closest) {
            closest = d;
            id = seed;
          }
        }
      labels[i] = id;
    }
  const boxes = Array.from({ length: count }, () => [w, h, 0, 0]);
  for (let i = 0; i < n; i++)
    if (labels[i]) {
      const b = boxes[labels[i]! - 1]!,
        x = i % w,
        y = Math.floor(i / w);
      b[0] = Math.min(b[0]!, x);
      b[1] = Math.min(b[1]!, y);
      b[2] = Math.max(b[2]!, x);
      b[3] = Math.max(b[3]!, y);
    }
  let selectedCount = 0;
  for (const label of labels) if (label) selectedCount++;
  if (
    selectedCount < Math.max(32, n * 0.005) ||
    (count > 1 && selectedCount < n * 0.01)
  )
    return null;
  const outlines: Point[][] = [];
  let croppedParts = 0;
  for (let id = 1; id <= count; id++) {
    const b = boxes[id - 1]!,
      left = Math.max(0, b[0]! - 1),
      top = Math.max(0, b[1]! - 1),
      right = Math.min(w - 1, b[2]! + 1),
      bottom = Math.min(h - 1, b[3]! + 1);
    const bw = right - left + 1,
      bh = bottom - top + 1,
      exterior = new Uint8Array(bw * bh);
    let head = 0,
      tail = 0;
    const visit = (x: number, y: number) => {
      const local = y * bw + x;
      if (!exterior[local] && labels[(top + y) * w + left + x] !== id) {
        exterior[local] = 1;
        queue[tail++] = local;
      }
    };
    for (let x = 0; x < bw; x++) {
      visit(x, 0);
      visit(x, bh - 1);
    }
    for (let y = 0; y < bh; y++) {
      visit(0, y);
      visit(bw - 1, y);
    }
    while (head < tail) {
      const i = queue[head++]!,
        x = i % bw,
        y = Math.floor(i / bw);
      if (x > 0) visit(x - 1, y);
      if (x + 1 < bw) visit(x + 1, y);
      if (y > 0) visit(x, y - 1);
      if (y + 1 < bh) visit(x, y + 1);
    }
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = (top + y) * w + left + x;
        if (!exterior[y * bw + x] && !labels[i] && valid[i]) labels[i] = id;
      }
    const outline = contour(labels, id, w, h, b);
    if (!outline) return null;
    outlines.push(outline);
    if (b[0] === 0 || b[1] === 0 || b[2] === w - 1 || b[3] === h - 1)
      croppedParts++;
  }
  return {
    outlines,
    labels,
    croppedParts,
    threshold,
    background: light ? 'light' : 'dark',
  };
}
