import type { ChartType } from '../types';

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Measurement {
  x: number | string;
  y: number | string;
  row: number;
  dataIndex: number;
}

export interface MeasurementSeries {
  index: number;
  name: string;
  datasetId: string;
  points: () => Iterable<Measurement>;
}

export interface SelectedMeasurement extends Pick<Measurement, 'x' | 'y' | 'row'> {
  series: string;
  datasetId: string;
}

export interface ChartSelection {
  chartId: string;
  area: SelectionRect;
  rect: SelectionRect;
  points: SelectedMeasurement[];
}

export function supportsChartSelection(type: ChartType): boolean {
  return type === 'line' || type === 'scatter' || type === 'area' || type === 'bar' || type === 'barh';
}

export function containsPoint({ x, y, width, height }: SelectionRect, px: number, py: number): boolean {
  const tolerance = 1e-7;
  return px >= x - tolerance && py >= y - tolerance && px <= x + width + tolerance && py <= y + height + tolerance;
}
