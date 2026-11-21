export type ResidualPoint = [x: number, difference: number];

export interface FitResidualSeries {
  id: string;
  name: string;
  color: string;
  rightAxis: boolean;
  points: ResidualPoint[];
}

export interface ResidualPlot {
  series: FitResidualSeries[];
  width: number;
  left: number;
  right: number;
  xAt: (x: number) => number;
}

export function fitResiduals(points: { x: number; y: number }[], predict: (point: { x: number; y: number }, index: number) => number):
  ResidualPoint[] {
  return points.flatMap((point, index) => {
    const predicted = predict(point, index);
    const difference = point.y - predicted;
    const precision = 32 * Number.EPSILON * Math.max(Math.abs(point.y), Math.abs(predicted));
    return Number.isFinite(difference) ? [[point.x, Math.abs(difference) <= precision ? 0 : difference]] : [];
  });
}
