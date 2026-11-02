import { BadRequestException } from '@nestjs/common';
type Point = [number, number];

function cross(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a: Point, b: Point, p: Point) {
  return (
    Math.abs(cross(a, b, p)) < 1e-9 &&
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1])
  );
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
export function validatePolygon(
  points: Point[],
  width: number,
  height: number,
) {
  if (
    points.length < 3 ||
    points.length > 128 ||
    points.some(
      (p) =>
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        p[0] < 0 ||
        p[1] < 0 ||
        p[0] > width ||
        p[1] > height,
    )
  )
    throw new BadRequestException('Görüntü içinde 3–128 geçerli köşe seçin.');
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9)
      throw new BadRequestException('Ardışık köşeler aynı olamaz.');
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j]!, points[(j + 1) % points.length]!))
        throw new BadRequestException('Çokgenin kenarları birbirini kesemez.');
    }
  }
  if (Math.abs(area) < 1e-6)
    throw new BadRequestException('Ölçüm alanı sıfır olamaz.');
}
export function polygonMembership(
  points: Point[],
  x: number,
  y: number,
  inset: number,
) {
  let inside = false,
    distance = Infinity;
  const p: Point = [x, y];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
    );
    distance = Math.min(
      distance,
      Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy),
    );
    if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) * dx) / dy)
      inside = !inside;
  }
  const full =
    inside ||
    points.some((a, i) => onSegment(a, points[(i + 1) % points.length]!, p));
  return { full, inner: full && distance + 1e-9 >= inset };
}
