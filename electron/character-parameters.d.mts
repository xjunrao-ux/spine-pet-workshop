export interface CharacterParameters {
  schemaVersion: 2;
  audioStartOffsetMs: number;
  audioEndOffsetMs: number;
  modelScalePercent: number;
  fontSizePx: number;
  bubbleTransparency: number;
  bubbleOffsetY: number;
  [key: string]: unknown;
}
export interface ParameterField {
  key: string; label: string; hint: string; default: number | string;
  unit?: string; min?: number; max?: number; step?: number; reverse?: boolean;
  options?: Array<{value: string; label: string}>;
}
export const PARAMETER_FIELDS: ParameterField[];
export function normalizeParameters(value?: unknown): CharacterParameters;
export function mergeParameters(existing: unknown, patch: unknown): CharacterParameters;
export function speechMetrics(parameters?: unknown, scale?: number, long?: boolean): {fontSize: number; paddingY: number; paddingX: number; backgroundAlpha: number};
export function chooseWalkDirection(value?: unknown, random?: () => number): -1 | 1;
export function modelLayout(bounds: {x: number;y: number;width: number;height: number}, width: number, height: number): {scale: number;x: number;y: number};
export function bubbleTop(parameters: unknown, height: number, bubbleHeight: number, headTop?: number, long?: boolean): number;
export function calibratedSegment(line: {start?: number; end?: number}, parameters?: unknown, duration?: number):
  {start: number; end: number; playable: boolean} | undefined;
