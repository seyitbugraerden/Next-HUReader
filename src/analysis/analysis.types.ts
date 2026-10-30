export interface AnalysisOptions {
  centerX?: number;
  centerY?: number;
  radius?: number;
  insetPixels?: number;
  spacingX?: number;
  spacingY?: number;
  windowMin?: number;
  windowMax?: number;
}
export interface Circle {
  x: number;
  y: number;
  radius: number;
}
export interface ImageData {
  width: number;
  height: number;
  values: Float64Array;
  display: Uint8Array;
  valid: Uint8Array;
  unit: 'HU' | 'gray' | 'estimated-HU';
  spacing: [number, number] | null;
  metadata: Record<string, string | number>;
  warnings: string[];
}
export interface Statistics {
  count: number;
  area: number | null;
  mean: number;
  std: number;
  median: number;
  min: number;
  max: number;
  p5: number;
  p95: number;
}
export interface AnalysisResult {
  filename: string;
  width: number;
  height: number;
  unit: ImageData['unit'];
  spacing: ImageData['spacing'];
  metadata: ImageData['metadata'];
  warnings: string[];
  roi: Circle & {
    insetPixels: number;
    innerRadius: number;
    automatic: boolean;
  };
  measurements: (Statistics & { label: string })[];
  regions: { label: string; mean: number | null; count: number }[];
  histogram: { lower: number; upper: number; count: number; percent: number }[];
  preview: string;
}
