import type { ImageData } from './analysis.types.js';
type Point = [number, number];
function hull(points: Point[]): Point[] {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const point of list) {
      while (
        out.length > 1 &&
        cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0
      )
        out.pop();
      out.push(point);
    }
    return out.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

// Conservative fallback for well-separated, bright, elongated solid pieces.
// Convex outlines preserve dark interior pixels for subsequent defect analysis.
export function detectFlatPieces(image: ImageData): Point[][] | null {
  const { width: w, height: h, display, valid } = image;
  if (w < 32 || h < 32) return null;
  let max = 0;
  for (let i = 0; i < display.length; i++)
    if (valid[i]) max = Math.max(max, display[i]!);
  if (max < 32) return null;
  const threshold = Math.max(16, max * 0.32);
  let foreground = 0;
  for (let i = 0; i < display.length; i++)
    if (valid[i] && display[i]! > threshold) foreground++;
  if (foreground > w * h * 0.5) return null;
  const eroded = new Uint8Array(w * h),
    queue = new Int32Array(w * h);
  const radius = 2;
  for (let y = radius; y < h - radius; y++)
    for (let x = radius; x < w - radius; x++) {
      let bright = true;
      for (let dy = -radius; dy <= radius && bright; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const i = (y + dy) * w + x + dx;
          if (!valid[i] || display[i]! <= threshold) {
            bright = false;
            break;
          }
        }
      if (bright) eroded[y * w + x] = 1;
    }
  const pieces: Point[][] = [];
  let covered = 0;
  for (let start = 0; start < eroded.length; start++) {
    if (!eroded[start]) continue;
    let head = 0,
      tail = 1,
      minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    queue[0] = start;
    eroded[start] = 0;
    const rowLeft = new Int32Array(h).fill(w),
      rowRight = new Int32Array(h).fill(-1);
    while (head < tail) {
      const i = queue[head++]!,
        x = i % w,
        y = Math.floor(i / w);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      rowLeft[y] = Math.min(rowLeft[y]!, x);
      rowRight[y] = Math.max(rowRight[y]!, x);
      for (const next of [i - 1, i + 1, i - w, i + w]) {
        if (eroded[next]) {
          eroded[next] = 0;
          queue[tail++] = next;
        }
      }
    }
    const width = maxX - minX + 1,
      height = maxY - minY + 1,
      aspect = Math.max(width, height) / Math.min(width, height);
    if (
      tail < Math.max(32, w * h * 0.001) ||
      Math.min(width, height) < Math.max(6, Math.min(w, h) * 0.018) ||
      tail / (width * height) < 0.85 ||
      aspect < 1.35 ||
      aspect > 12 ||
      width > w * 0.8
    )
      continue;
    const edge: Point[] = [];
    for (let y = minY; y <= maxY; y++)
      if (rowRight[y]! >= 0) edge.push([rowLeft[y]!, y], [rowRight[y]!, y]);
    const outline = hull(
      hull(edge).flatMap(([x, y]): Point[] => [
        [Math.max(0, x - radius), Math.max(0, y - radius)],
        [Math.min(w - 1, x + radius), Math.max(0, y - radius)],
        [Math.min(w - 1, x + radius), Math.min(h - 1, y + radius)],
        [Math.max(0, x - radius), Math.min(h - 1, y + radius)],
      ]),
    );
    if (outline.length < 3) continue;
    pieces.push(outline);
    covered += width * height;
    if (pieces.length > 12 || covered > w * h * 0.5) return null;
  }
  return pieces.length
    ? pieces.sort(
        (a, b) =>
          Math.min(...a.map((p) => p[1])) - Math.min(...b.map((p) => p[1])),
      )
    : null;
}
