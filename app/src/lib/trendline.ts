import type { AxisConfig, ChartConfig, TrendlineKind } from '../types';
import { axisBounds } from './axisBounds';
import { fitCurve, fitModels, inFitDomain, isFitModel, type CurveFit } from './fitModels';
import { evenlySample, movingAverage } from './stats';
import type { ResolvedSeries } from './xySeries';
import { fitResiduals, type ResidualPoint } from './residuals';

export interface TrendlineResult {
  count: number;
  excluded: number;
  points: [number, number | null][];
  residuals: ResidualPoint[];
  fit?: Omit<CurveFit, 'predict'>;
  error?: 'tooFew' | 'distinctX' | 'failed' | 'outsideAxis';
  minimum?: number;
}

const fitCache = new WeakMap<ResolvedSeries, Map<string, TrendlineResult>>();

function fitAxis(axis: AxisConfig) {
  const { min, max } = axisBounds(axis);
  return { min, max, log: axis.scale === 'log' };
}

function onAxis(value: number, { min, max, log }: ReturnType<typeof fitAxis>): boolean {
  return (!log || value > 0) && (min === undefined || value >= min) && (max === undefined || value <= max);
}

export function calculateTrendline(
  chart: ChartConfig,
  series: ResolvedSeries,
  kind: Exclude<TrendlineKind, 'none'>,
): TrendlineResult {
  const xAxis = fitAxis(chart.xAxis);
  const yAxis = fitAxis(series.mapping.y2 ? chart.y2Axis : chart.yAxis);
  const key = JSON.stringify([kind, xAxis, yAxis]);
  let cache = fitCache.get(series);
  if (!cache) {
    cache = new Map();
    fitCache.set(series, cache);
  }
  const previous = cache.get(key);
  if (previous) return previous;
  const result = buildTrendline(series, kind, xAxis, yAxis);
  cache.set(key, result);
  const oldest = cache.keys().next().value;
  if (cache.size > 16 && oldest !== undefined) cache.delete(oldest);
  return result;
}

function buildTrendline(
  series: ResolvedSeries, kind: Exclude<TrendlineKind, 'none'>,
  xAxis: ReturnType<typeof fitAxis>, yAxis: ReturnType<typeof fitAxis>,
): TrendlineResult {
  const eligible = series.points.flatMap(({ x, y }) =>
    typeof x === 'number' && onAxis(x, xAxis) && onAxis(y, yAxis) ? [{ x, y }] : []);
  const model = isFitModel(kind) ? fitModels[kind] : undefined;
  const numeric = isFitModel(kind) && model?.domain
    ? eligible.filter(({ x }) => inFitDomain(kind, x))
    : eligible;
  const count = numeric.length;
  const excluded = eligible.length - count;
  const minimum = model?.minimum ?? 3;
  const base = { count, excluded, minimum, points: [], residuals: [] };
  if (count < minimum) return { ...base, error: 'tooFew' };

  if (kind === 'movingAverage') {
    numeric.sort((a, b) => a.x - b.x);
    const averages = movingAverage(numeric.map(({ y }) => y), Math.max(3, Math.round(count / 5)));
    return {
      ...base, points: numeric.map(({ x }, index) => [x, averages[index]]),
      residuals: fitResiduals(numeric, (_, index) => averages[index]),
    };
  }
  if (!isFitModel(kind)) return { ...base, error: 'failed' };
  const xs = numeric.map(({ x }) => x);
  const distinct = [...new Set(xs)].sort((a, b) => a - b);
  if (distinct.length < minimum) return { ...base, error: 'distinctX' };
  const requiresSearch = model?.group !== 'polynomial' && model?.group !== 'transforms';
  let optimization: { xs: number[]; ys: number[] } | undefined;
  if (requiresSearch && count > 640) {
    const ordered = [...numeric].sort((a, b) => a.x - b.x);
    let sample = evenlySample(ordered, 640);
    if (new Set(sample.map(({ x }) => x)).size < minimum) {
      const unique = ordered.filter(({ x }, index) => index === 0 || x !== ordered[index - 1].x);
      sample = [...evenlySample(ordered, 640 - minimum), ...evenlySample(unique, minimum)];
    }
    optimization = { xs: sample.map(({ x }) => x), ys: sample.map(({ y }) => y) };
  }
  const result = fitCurve(kind, xs, numeric.map(({ y }) => y), optimization);
  if (!result) return { ...base, error: 'failed' };
  const { predict, ...fit } = result;
  const sample = (x: number): [number, number | null] => {
    const y = predict(x);
    return [x, Number.isFinite(y) && (!yAxis.log || y > 0) ? y : null];
  };
  const curve = (knots: number[]) => sampleXs(knots, xAxis.log, kind === 'linear').map(sample);
  let points: [number, number | null][];
  if (kind === 'reciprocal' && distinct[0] < 0 && distinct[distinct.length - 1] > 0) {
    const negative = distinct.filter((x) => x < 0);
    const positive = distinct.filter((x) => x > 0);
    points = [...curve(negative), [0, null], ...curve(positive)];
  } else {
    points = curve(distinct);
  }
  return points.some((point, index) => index > 0 && point[1] !== null && points[index - 1][1] !== null)
    ? { ...base, points, fit, residuals: fitResiduals(numeric, ({ x }) => predict(x)) }
    : { ...base, fit, error: 'outsideAxis' };
}

function sampleXs(knots: number[], logX: boolean, linear: boolean): number[] {
  const min = knots[0];
  const max = knots[knots.length - 1];
  if (min === max) return [min];
  if (linear && !logX) return [min, max];
  const count = 320;
  const start = logX ? Math.log(min) : min;
  const end = logX ? Math.log(max) : max;
  const geometry = Array.from({ length: count - 1 }, (_, index) => {
    const x = start + ((index + 1) / count) * (end - start);
    return logX ? Math.exp(x) : x;
  });
  const observed = knots.length <= count ? knots : Array.from({ length: count }, (_, index) =>
    knots[Math.round(index * (knots.length - 1) / (count - 1))]);
  return [...new Set([...observed, ...geometry])].sort((a, b) => a - b);
}
