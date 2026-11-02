export interface AnalysisOptions {
  roiShape?: 'circle' | 'rectangle' | 'polygon';
  roiPoints?: [number, number][];
  lowDensityThreshold?: number;
  materialReference?: 'none' | 'marble-excel';
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
    shape?: 'circle' | 'rectangle' | 'polygon';
    points?: [number, number][];
    outlines?: [number, number][][];
    labelMask?: string;
    detection?: {
      method: 'foreground';
      threshold: number;
      background: 'light' | 'dark';
      croppedParts: number;
    };
    innerBoundary?: [number, number][];
    insetPixels: number;
    innerRadius: number;
    automatic: boolean;
  };
  measurements: (Statistics & { label: string })[];
  regions: { label: string; mean: number | null; count: number }[];
  histogram: { lower: number; upper: number; count: number; percent: number }[];
  preview: string;
  interpretation?: string[];
  technicalNotes?: string[];
  parts?: { index: number; measurements: Statistics | null }[];
  lowDensity?: { threshold: number; count: number; percent: number };
  defects?: DefectCandidates;
  materialReference?: {
    name: string;
    source: string;
    meanDifferenceHU: number;
    derivedImage: boolean;
  };
}

export interface DefectRegion {
  pixels: number;
  area: number | null;
  mean: number;
  bounds: { x: number; y: number; width: number; height: number };
  widthMm: number | null;
  heightMm: number | null;
  elongated: boolean;
  touchesBoundary: boolean;
}
export interface DefectCandidates {
  threshold: number;
  thresholdSource: 'user' | 'robust';
  count: number;
  elongatedCount: number;
  boundaryCount: number;
  pixels: number;
  percent: number;
  area: number | null;
  regions: DefectRegion[];
  truncated: boolean;
  overlay: string;
}
