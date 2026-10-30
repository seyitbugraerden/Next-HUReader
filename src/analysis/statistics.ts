import { BadRequestException } from '@nestjs/common';
import type { Circle, ImageData, Statistics } from './analysis.types.js';

export function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  return (
    sorted[base]! +
    (sorted[Math.min(base + 1, sorted.length - 1)]! - sorted[base]!) *
      (position - base)
  );
}

export function statistics(
  values: number[],
  pixelArea: number | null,
): Statistics {
  if (!values.length)
    throw new BadRequestException('Ölçüm alanında geçerli piksel bulunamadı.');
  let mean = 0;
  let m2 = 0;
  values.forEach((value, i) => {
    const delta = value - mean;
    mean += delta / (i + 1);
    m2 += delta * (value - mean);
  });
  values.sort((a, b) => a - b);
  return {
    count: values.length,
    area: pixelArea === null ? null : values.length * pixelArea,
    mean,
    std: Math.sqrt(m2 / values.length),
    median: quantile(values, 0.5),
    min: values[0]!,
    max: values[values.length - 1]!,
    p5: quantile(values, 0.05),
    p95: quantile(values, 0.95),
  };
}

// Fit the left/right foreground contour to a circle. Ignore the bottom support.
// A manual ROI is always available because an arbitrary image need not be circular.
export function detectCircle(image: ImageData): Circle | null {
  const { width: w, height: h, display } = image;
  let max = 0;
  for (const v of display) max = Math.max(max, v);
  if (max < 8) return null;
  const threshold = Math.max(12, max * 0.16);
  const points: [number, number][] = [];
  for (
    let y = Math.floor(h * 0.12);
    y < h * 0.78;
    y += Math.max(1, Math.floor(h / 200))
  ) {
    // Longest bright run tolerates small dark holes but ignores isolated marks.
    let first = -1,
      last = -1;
    for (let x = Math.floor(w * 0.1); x < w * 0.9; x++) {
      if (display[y * w + x]! > threshold) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0 && last - first > w * 0.18 && last - first < w * 0.85) {
      points.push([first, y], [last, y]);
    }
  }
  if (points.length < 20) return null;
  let retained = points;
  let circle: Circle | null = null;
  for (let iteration = 0; iteration < 4; iteration++) {
    const a = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (const [x0, y0] of retained) {
      const x = x0 / w,
        y = y0 / w,
        row = [x, y, 1],
        target = -(x * x + y * y);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) a[i]![j]! += row[i]! * row[j]!;
        a[i]![3]! += row[i]! * target;
      }
    }
    for (let i = 0; i < 3; i++) {
      let pivot = i;
      for (let j = i + 1; j < 3; j++)
        if (Math.abs(a[j]![i]!) > Math.abs(a[pivot]![i]!)) pivot = j;
      [a[i], a[pivot]] = [a[pivot]!, a[i]!];
      if (Math.abs(a[i]![i]!) < 1e-9) return null;
      const divisor = a[i]![i]!;
      for (let k = i; k < 4; k++) a[i]![k]! /= divisor;
      for (let j = 0; j < 3; j++)
        if (j !== i) {
          const factor = a[j]![i]!;
          for (let k = i; k < 4; k++) a[j]![k]! -= factor * a[i]![k]!;
        }
    }
    const x = -a[0]![3]! / 2,
      y = -a[1]![3]! / 2;
    const r2 = x * x + y * y - a[2]![3]!;
    if (r2 <= 0) return null;
    circle = { x: x * w, y: y * w, radius: Math.sqrt(r2) * w };
    const residuals = retained.map(([px, py]) =>
      Math.abs(Math.hypot(px - circle!.x, py - circle!.y) - circle!.radius),
    );
    const median = [...residuals].sort((a, b) => a - b)[
      Math.floor(residuals.length / 2)
    ]!;
    retained = retained.filter(
      (_, i) => residuals[i]! <= Math.max(2, median * 2),
    );
    if (retained.length < 12) return null;
  }
  if (
    !circle ||
    circle.radius < Math.min(w, h) * 0.1 ||
    circle.radius > Math.min(w, h) * 0.48 ||
    circle.x - circle.radius < 0 ||
    circle.y - circle.radius < 0 ||
    circle.x + circle.radius > w ||
    circle.y + circle.radius > h
  )
    return null;
  return circle;
}
