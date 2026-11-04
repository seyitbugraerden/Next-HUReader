import { BadRequestException } from '@nestjs/common';
import { polygonMembership, validatePolygon } from './roi-geometry.js';
import { contour } from './sample-segmentation.js';
import type { DefectEdit, DefectRegion, ImageData } from './analysis.types.js';

// Exploratory segmentation, not a calibrated fracture/porosity classifier.
// A robust lower-tail threshold adapts to each selected material region.
export function findDefectCandidates(
  image: ImageData,
  roi: Uint8Array,
  sorted: number[],
  suppliedThreshold?: number,
  edits: DefectEdit[] = [],
) {
  const middle = (a: number[]) =>
    a.length % 2
      ? a[Math.floor(a.length / 2)]!
      : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2;
  const median = middle(sorted);
  const deviations = sorted
    .map((v) => Math.abs(v - median))
    .sort((a, b) => a - b);
  const threshold =
    suppliedThreshold ?? median - Math.max(1, 3 * 1.4826 * middle(deviations));
  const automatic = measureCandidates(image, roi, sorted.length, threshold);
  if (!edits.length) {
    const result = automatic;
    return {
      ...result,
      thresholdSource:
        suppliedThreshold === undefined
          ? ('robust' as const)
          : ('user' as const),
      manuallyEdited: false,
    };
  }
  const mask = automatic.mask.slice();
  const editedIds = new Set(edits.map((edit) => edit.id));
  for (const edit of edits) {
    if (edit.id > automatic.count)
      throw new BadRequestException(
        'Boşluk adayı değişti; ön analizi yeniden çalıştırın.',
      );
    if (edit.points)
      validatePolygon(edit.points, image.width, image.height, 512);
  }
  // Clear all replaced originals first; overlapping edits must be order-independent.
  for (let i = 0; i < mask.length; i++)
    if (editedIds.has(automatic.labels[i]!)) mask[i] = 0;
  for (const edit of edits) {
    if (!edit.points) continue;
    const minX = Math.max(
      0,
      Math.floor(Math.min(...edit.points.map((p) => p[0]))),
    );
    const maxX = Math.min(
      image.width - 1,
      Math.ceil(Math.max(...edit.points.map((p) => p[0]))),
    );
    const minY = Math.max(
      0,
      Math.floor(Math.min(...edit.points.map((p) => p[1]))),
    );
    const maxY = Math.min(
      image.height - 1,
      Math.ceil(Math.max(...edit.points.map((p) => p[1]))),
    );
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const index = y * image.width + x;
        if (roi[index] && polygonMembership(edit.points, x, y, 0).full)
          mask[index] = 1;
      }
  }
  const result = measureCandidates(image, roi, sorted.length, threshold, mask);
  return {
    ...result,
    thresholdSource:
      suppliedThreshold === undefined ? ('robust' as const) : ('user' as const),
    manuallyEdited: true,
  };
}

function measureCandidates(
  image: ImageData,
  roi: Uint8Array,
  sampleCount: number,
  threshold: number,
  suppliedMask?: Uint8Array,
) {
  const { width, height, values, spacing } = image;
  const state = new Uint8Array(roi.length);
  const mask = new Uint8Array(roi.length);
  const labels = new Uint32Array(roi.length);
  const queue = new Int32Array(roi.length);
  let total = 0,
    pixels = 0,
    elongatedCount = 0,
    boundaryCount = 0;
  const regions: DefectRegion[] = [];
  for (let i = 0; i < roi.length; i++)
    if (roi[i] && (suppliedMask ? suppliedMask[i] : values[i]! <= threshold))
      state[i] = 1;
  for (let start = 0; start < state.length; start++) {
    if (state[start] !== 1) continue;
    let head = 0,
      tail = 1,
      minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    let sum = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0,
      sxy = 0,
      touchesBoundary = false;
    queue[0] = start;
    state[start] = 2;
    while (head < tail) {
      const index = queue[head++]!,
        x = index % width,
        y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const px = x * (spacing?.[0] ?? 1),
        py = y * (spacing?.[1] ?? 1);
      sum += values[index]!;
      sx += px;
      sy += py;
      sxx += px * px;
      syy += py * py;
      sxy += px * py;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            touchesBoundary = true;
            continue;
          }
          const next = ny * width + nx;
          if (!roi[next]) touchesBoundary = true;
          if (state[next] === 1) {
            state[next] = 2;
            queue[tail++] = next;
          }
        }
    }
    // Suppress isolated one/two-pixel fluctuations; report this rule in the UI.
    if (tail < 3) continue;
    const xx =
      Math.max(0, sxx / tail - (sx / tail) ** 2) +
      (spacing?.[0] ?? 1) ** 2 / 12;
    const yy =
      Math.max(0, syy / tail - (sy / tail) ** 2) +
      (spacing?.[1] ?? 1) ** 2 / 12;
    const xy = sxy / tail - (sx * sy) / tail ** 2;
    const disc = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
    const major = (xx + yy + disc) / 2,
      minor = Math.max(1e-12, (xx + yy - disc) / 2);
    const w = maxX - minX + 1,
      h = maxY - minY + 1;
    const elongated = Math.sqrt(major / minor) >= 3 && Math.max(w, h) >= 6;
    total++;
    pixels += tail;
    if (elongated) elongatedCount++;
    if (touchesBoundary) boundaryCount++;
    for (let i = 0; i < tail; i++) {
      mask[queue[i]!] = 1;
      labels[queue[i]!] = total;
    }
    regions.push({
      id: total,
      outline: [],
      pixels: tail,
      area: spacing ? tail * spacing[0] * spacing[1] : null,
      mean: sum / tail,
      bounds: { x: minX, y: minY, width: w, height: h },
      widthMm: spacing ? w * spacing[0] : null,
      heightMm: spacing ? h * spacing[1] : null,
      elongated,
      touchesBoundary,
    });
    // Bound JSON/Excel output while preserving totals and the complete mask.
    regions.sort((a, b) => b.pixels - a.pixels);
    if (regions.length > 50) regions.length = 50;
  }
  for (const region of regions) {
    const b = region.bounds;
    const traced = contour(labels, region.id, width, height, [
      b.x,
      b.y,
      b.x + b.width - 1,
      b.y + b.height - 1,
    ]);
    region.outline = (
      traced ?? [
        [b.x - 0.5, b.y - 0.5],
        [b.x + b.width - 0.5, b.y - 0.5],
        [b.x + b.width - 0.5, b.y + b.height - 0.5],
        [b.x - 0.5, b.y + b.height - 0.5],
      ]
    ).map(([x, y]) => [Math.max(0, x), Math.max(0, y)] as [number, number]);
    region.outlineApproximate = !traced;
  }
  return {
    mask,
    labels,
    threshold,
    count: total,
    elongatedCount,
    boundaryCount,
    pixels,
    percent: (100 * pixels) / sampleCount,
    area: spacing ? pixels * spacing[0] * spacing[1] : null,
    regions,
    truncated: total > regions.length,
  };
}
