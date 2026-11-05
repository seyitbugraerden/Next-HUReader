import type { ImageData } from './analysis.types.js';

// Compare a small core with a surrounding ring. Keeping the target out of the
// reference prevents broad tonal features from inflating their own threshold.
export function toneSignals(
  image: ImageData,
  roi: Uint8Array,
  signals: Uint8Array,
) {
  const { width, height, values, valid } = image;
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < roi.length; i++)
    if (roi[i] && valid[i]) {
      low = Math.min(low, values[i]!);
      high = Math.max(high, values[i]!);
    }
  const calibration =
    image.unit === 'estimated-HU'
      ? (Number(image.metadata['Pencere üst sınırı']) -
          Number(image.metadata['Pencere alt sınırı'])) /
        255
      : 1;
  const scale =
    Number.isFinite(calibration) && calibration > 0 ? calibration : 1;
  const step =
    image.unit === 'HU' ? Math.max(1e-6, (high - low) / 4095) : scale;
  const differences = new Uint32Array(4096);
  let pairs = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!roi[i] || !valid[i]) continue;
      for (const next of [
        x + 1 < width ? i + 1 : -1,
        y + 1 < height ? i + width : -1,
      ]) {
        if (next < 0 || !roi[next] || !valid[next]) continue;
        differences[
          Math.min(
            4095,
            Math.round(Math.abs(values[i]! - values[next]!) / step),
          )
        ]++;
        pairs++;
      }
    }
  let medianDifference = 0,
    cumulative = 0;
  for (let i = 0; i < differences.length; i++) {
    cumulative += differences[i]!;
    if (cumulative > (pairs - 1) / 2) {
      medianDifference = i * step;
      break;
    }
  }
  const noise = medianDifference / 0.954;
  const floor =
    image.unit === 'HU' ? Math.max(1, (high - low) * 0.001) : 3 * scale;
  const threshold = Math.max(floor, 3 * noise);
  const limit = Math.floor((Math.min(width, height) - 1) / 2);
  const radii = [3, 7, 15, 31].filter((radius) => radius <= limit);
  // Sliding windows use O(width) memory and O(pixels) work per scale.
  function window(radius: number) {
    const sums = new Float64Array(width),
      squares = new Float64Array(width),
      ys = new Float64Array(width),
      counts = new Int32Array(width);
    function row(y: number, sign: number) {
      if (y < 0 || y >= height) return;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!roi[i] || !valid[i]) continue;
        const value = values[i]!;
        sums[x]! += sign * value;
        squares[x]! += sign * value * value;
        ys[x]! += sign * y * value;
        counts[x]! += sign;
      }
    }
    for (let y = 0; y < radius; y++) row(y, 1);
    return {
      sum: 0,
      square: 0,
      xv: 0,
      yv: 0,
      count: 0,
      nextRow(y: number) {
        row(y + radius, 1);
        row(y - radius - 1, -1);
        this.sum = 0;
        this.square = 0;
        this.xv = 0;
        this.yv = 0;
        this.count = 0;
        for (let x = 0; x < Math.min(radius, width); x++) {
          this.sum += sums[x]!;
          this.square += squares[x]!;
          this.xv += x * sums[x]!;
          this.yv += ys[x]!;
          this.count += counts[x]!;
        }
      },
      advance(x: number) {
        const add = x + radius,
          remove = x - radius - 1;
        if (add < width) {
          this.sum += sums[add]!;
          this.square += squares[add]!;
          this.xv += add * sums[add]!;
          this.yv += ys[add]!;
          this.count += counts[add]!;
        }
        if (remove >= 0) {
          this.sum -= sums[remove]!;
          this.square -= squares[remove]!;
          this.xv -= remove * sums[remove]!;
          this.yv -= ys[remove]!;
          this.count -= counts[remove]!;
        }
      },
    };
  }
  for (const radius of radii) {
    const innerRadius = Math.floor(radius / 2);
    const outer = window(radius),
      inner = window(innerRadius),
      core = window(1);
    const ringArea = (2 * radius + 1) ** 2 - (2 * innerRadius + 1) ** 2;
    const axisMoment = (r: number) =>
      ((2 * r + 1) * r * (r + 1) * (2 * r + 1)) / 3;
    const ringMoment = axisMoment(radius) - axisMoment(innerRadius);
    for (let y = 0; y < height; y++) {
      outer.nextRow(y);
      inner.nextRow(y);
      core.nextRow(y);
      for (let x = 0; x < width; x++) {
        outer.advance(x);
        inner.advance(x);
        core.advance(x);
        const i = y * width + x;
        if (!roi[i] || !valid[i]) continue;
        const count = outer.count - inner.count;
        // Incomplete/asymmetric rings near ROI edges can turn ordinary lighting
        // gradients into false candidates. Do not infer missing background.
        if (count !== ringArea || core.count < 9) continue;
        const sum = outer.sum - inner.sum;
        const background = sum / count;
        // Remove a fitted linear lighting gradient before estimating ring noise.
        // A nearby bright feature then cannot create a dark halo around itself.
        const sx = (outer.xv - inner.xv - x * sum) / ringMoment;
        const sy = (outer.yv - inner.yv - y * sum) / ringMoment;
        const variance = Math.max(
          0,
          (outer.square - inner.square) / count -
            background * background -
            ((sx * sx + sy * sy) * ringMoment) / count,
        );
        const adaptiveThreshold = Math.max(threshold, 2 * Math.sqrt(variance));
        if (
          background - values[i]! > adaptiveThreshold &&
          background - core.sum / core.count > adaptiveThreshold
        )
          signals[i]! |= 2;
      }
    }
  }
  return { radii, noise, threshold };
}
