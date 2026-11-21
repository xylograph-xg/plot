import type { ChartConfig, SpectrumFitConfig, SpectrumShape } from '../types';
import { axisBounds } from './axisBounds';
import { fitFromSeeds, leastSquares } from './fitLeastSquares';
import type { ResolvedSeries } from './xySeries';
import { voigtReal } from './voigt';
import { fitResiduals, type ResidualPoint } from './residuals';

export const spectrumShapes = ['gaussian', 'lorentzian', 'voigt', 'logNormal', 'splitGaussian'] as const;
export const spectrumBaselines = ['constant', 'linear', 'zero'] as const;
export const maxSpectrumPeaks = 5;

type Point = { x: number; y: number };
type Coordinates = [number, number | null][];
interface Peak {
  center: number;
  height: number;
  fwhm: number;
  points: Coordinates;
  centerY: number;
}
type SpectrumResult = {
  peaks: Peak[];
  total: Coordinates;
  residuals: ResidualPoint[];
  r2: number;
  count: number;
} | { error: 'tooFew' | 'failed' | 'centers' | 'axis' };

interface SpectrumView {
  points: Point[];
  peaks?: Point[];
  fits?: Map<string, SpectrumResult>;
}

const cache = new WeakMap<ResolvedSeries, Map<string, SpectrumView>>();

function spectrumView(chart: ChartConfig, series: ResolvedSeries): SpectrumView {
  const xAxis = axisBounds(chart.xAxis);
  const yConfig = series.mapping.y2 ? chart.y2Axis : chart.yAxis;
  const yAxis = axisBounds(yConfig);
  const xLog = chart.xAxis.scale === 'log';
  const yLog = yConfig.scale === 'log';
  let entries = cache.get(series);
  if (!entries) {
    entries = new Map();
    cache.set(series, entries);
  }
  const key = JSON.stringify([xAxis, yAxis, xLog, yLog]);
  const existing = entries.get(key);
  if (existing) return existing;
  const inAxis = (value: number, axis: typeof xAxis, log: boolean) =>
    Number.isFinite(value) && (!log || value > 0) &&
    (axis.min === undefined || value >= axis.min) && (axis.max === undefined || value <= axis.max);
  const sorted = xAxis.invalid || yAxis.invalid ? [] : series.points.flatMap(({ x, y }) =>
    typeof x === 'number' && inAxis(x, xAxis, xLog) && inAxis(y, yAxis, yLog) ? [{ x, y }] : [])
    .sort((a, b) => a.x - b.x);
  const points: Point[] = [];
  let repeats = 0;
  for (const point of sorted) {
    const last = points.at(-1);
    if (last?.x === point.x) {
      repeats += 1;
      last.y += (point.y - last.y) / repeats;
    } else {
      repeats = 1;
      points.push(point);
    }
  }
  const view = { points };
  entries.set(key, view);
  const oldest = entries.keys().next().value;
  if (entries.size > 12 && oldest !== undefined) entries.delete(oldest);
  return view;
}

function peaksIn(points: Point[], count: number): Point[] {
  if (points.length < 3) return [];
  const radius = points.length >= 9 ? 2 : 0;
  const smooth = points.map((_, index) => {
    let sum = 0;
    let weight = 0;
    for (let i = Math.max(0, index - radius); i <= Math.min(points.length - 1, index + radius); i += 1) {
      const current = radius + 1 - Math.abs(i - index);
      sum += points[i].y * current;
      weight += current;
    }
    return sum / weight;
  });
  const [min, max] = smooth.reduce(([low, high], value) => [Math.min(low, value), Math.max(high, value)], [Infinity, -Infinity]);
  const residuals = smooth.map((value, index) => Math.abs(value - points[index].y)).sort((a, b) => a - b);
  const threshold = Math.max((max - min) * 0.06, residuals[Math.floor(residuals.length / 2)] * 5);
  const candidates: { point: Point; prominence: number }[] = [];
  const look = Math.max(2, Math.ceil(points.length * 0.18));
  for (let i = 1; i < smooth.length - 1; i += 1) {
    if (!(smooth[i] > smooth[i - 1] && smooth[i] >= smooth[i + 1])) continue;
    let left = smooth[i];
    let right = smooth[i];
    for (let j = i - 1; j >= Math.max(0, i - look) && smooth[j] <= smooth[i]; j -= 1) left = Math.min(left, smooth[j]);
    for (let j = i + 1; j <= Math.min(i + look, smooth.length - 1) && smooth[j] <= smooth[i]; j += 1) right = Math.min(right, smooth[j]);
    const prominence = smooth[i] - Math.max(left, right);
    if (prominence <= threshold) continue;
    const at = points.slice(Math.max(1, i - radius), Math.min(points.length - 1, i + radius + 1))
      .reduce((top, point) => point.y > top.y ? point : top);
    candidates.push({ point: at, prominence });
  }
  const selected: Point[] = [];
  const spacing = 0.025 * (points[points.length - 1].x - points[0].x);
  for (const { point } of candidates.sort((a, b) => b.prominence - a.prominence)) {
    if (selected.every((other) => Math.abs(other.x - point.x) > spacing)) selected.push(point);
    if (selected.length >= count) break;
  }
  return selected;
}

export function spectrumPeaks(chart: ChartConfig, series: ResolvedSeries): Point[] {
  const view = spectrumView(chart, series);
  return view.peaks ??= peaksIn(view.points, 3);
}

export function isSpectrumTarget(config: SpectrumFitConfig, series: ResolvedSeries): boolean {
  return config.seriesId === series.mapping.id &&
    config.group === (series.mapping.groupCol >= 0 ? series.name : undefined);
}

export function activeSpectrumFits(chart: Pick<ChartConfig, 'spectrumFit' | 'spectrumFits'>): SpectrumFitConfig[] {
  return chart.spectrumFits ?? (chart.spectrumFit ? [chart.spectrumFit] : []);
}

function profile(shape: SpectrumShape, center: number, width: number, extra: number) {
  if (shape === 'gaussian') return (x: number) => Math.exp(-0.5 * ((x - center) / width) ** 2);
  if (shape === 'lorentzian') return (x: number) => 1 / (1 + ((x - center) / width) ** 2);
  if (shape === 'splitGaussian') {
    return (x: number) => Math.exp(-0.5 * ((x - center) / (x < center ? width : extra)) ** 2);
  }
  if (shape === 'logNormal') return (x: number) => {
    // Width is the local Gaussian scale at the mode, and extra is signed skew.
    const z = (x - center) / width;
    if (Math.abs(extra) < 1e-8) return Math.exp(-0.5 * z ** 2);
    const shifted = extra * z;
    return shifted <= -1 ? 0 : Math.exp(-0.5 * (Math.log1p(shifted) / extra) ** 2);
  };
  const scale = width * Math.SQRT2;
  const g = extra / scale;
  const top = voigtReal(0, g);
  return (x: number) => Math.max(0, voigtReal((x - center) / scale, g) / top);
}

function halfWidths(shape: SpectrumShape, fn: (x: number) => number, center: number, width: number, extra: number): [number, number] {
  const gaussianHalf = Math.sqrt(2 * Math.LN2);
  if (shape === 'gaussian') return [width * gaussianHalf, width * gaussianHalf];
  if (shape === 'lorentzian') return [width, width];
  if (shape === 'splitGaussian') return [width * gaussianHalf, extra * gaussianHalf];
  if (shape === 'logNormal') {
    if (Math.abs(extra) < 1e-8) return [width * gaussianHalf, width * gaussianHalf];
    return [-width * Math.expm1(-extra * gaussianHalf) / extra, width * Math.expm1(extra * gaussianHalf) / extra];
  }
  let low = 0;
  let high = 5 * (width + extra);
  for (let n = 0; n < 32; n += 1) {
    const middle = (low + high) / 2;
    if (fn(center + middle) > 0.5) low = middle;
    else high = middle;
  }
  const half = (low + high) / 2;
  return [half, half];
}

function fitSpectrum(points: Point[], config: SpectrumFitConfig, yLog: boolean): SpectrumResult {
  const { shape, count, centers, baseline = 'linear' } = config;
  const dimensions = shape === 'gaussian' || shape === 'lorentzian' ? 2 : 3;
  const backgroundColumns = baseline === 'linear' ? 2 : baseline === 'constant' ? 1 : 0;
  if (!spectrumShapes.includes(shape) || !Number.isInteger(count) || count < 1 || count > maxSpectrumPeaks) {
    return { error: 'failed' };
  }
  if (points.length <= backgroundColumns + count * (dimensions + 1)) return { error: 'tooFew' };
  const origin = points[0].x;
  const span = points[points.length - 1].x - origin;
  if (!(span > 0 && Number.isFinite(span))) return { error: 'axis' };
  if (centers && (centers.length !== count || new Set(centers).size !== count ||
    centers.some((x) => !Number.isFinite(x) || x <= origin || x >= origin + span))) return { error: 'centers' };
  const [low, high] = points.reduce(([min, max], { y }) => [Math.min(min, y), Math.max(max, y)], [Infinity, -Infinity]);
  const yScale = high - low;
  if (!(yScale > 0 && Number.isFinite(yScale))) return { error: 'failed' };
  const reference = baseline === 'zero' ? 0 : low;
  // A constant background for nonnegative intensities must also be nonnegative.
  const backgroundFloor = baseline === 'constant' && low >= 0 ? -reference / yScale : undefined;
  const normalized = points.map(({ x, y }) => ({ x: (x - origin) / span, y: (y - reference) / yScale }));
  const spacing = normalized.slice(1).map(({ x }, index) => x - normalized[index].x).sort((a, b) => a - b);
  const minWidth = Math.max(1e-6, 0.55 * spacing[Math.floor(spacing.length / 2)]);
  const observed = peaksIn(normalized, count).map(({ x }) => x);
  const extraBounds = shape === 'logNormal' ? [{ min: -2, max: 2 }]
    : dimensions === 3 ? [{ min: shape === 'voigt' ? minWidth * 0.05 : minWidth, max: 0.8 }] : [];
  const bounds = Array.from({ length: count }, () => [
    { min: 0, max: 1 }, { min: minWidth, max: 0.8 }, ...extraBounds,
  ]).flat();
  const steps = bounds.map((_, index) => {
    const parameter = index % dimensions;
    if (parameter === 0) return 0.055;
    return shape === 'logNormal' && parameter === 2 ? 0.25 : 0.03;
  });
  const inputs = (sample: Point[]) => {
    const xs = sample.map(({ x }) => x);
    const ys = sample.map(({ y }) => y);
    const background = backgroundColumns ? [new Float64Array(sample.length).fill(1)] : [];
    const floorYs = backgroundFloor === undefined ? undefined : ys.map((y) => y - backgroundFloor);
    return { xs, ys, floorYs, background: backgroundColumns === 2 ? [...background, xs] : background };
  };
  const profiles = (params: number[]) => Array.from({ length: count }, (_, index) =>
    profile(shape, params[index * dimensions], params[index * dimensions + 1],
      dimensions === 3 ? params[index * dimensions + 2] : 0));
  const solve = (data: ReturnType<typeof inputs>, params: number[]) => {
    const positions = params.filter((_, index) => index % dimensions === 0).sort((a, b) => a - b);
    if (positions.some((position, index) => index > 0 && position - positions[index - 1] < minWidth * 0.5)) return null;
    const peakColumns = profiles(params).map((fn) => Float64Array.from(data.xs, fn));
    let solution = leastSquares([...data.background, ...peakColumns], data.ys);
    if (solution && backgroundFloor !== undefined && data.floorYs && solution.coefficients[0] < backgroundFloor) {
      const fixed = leastSquares(peakColumns, data.floorYs);
      solution = fixed && { ...fixed, coefficients: [backgroundFloor, ...fixed.coefficients] };
    }
    return solution && solution.coefficients.slice(backgroundColumns).every((amplitude) => amplitude > 1e-7) ? solution : null;
  };

  const initial = centers?.map((x) => (x - origin) / span);
  const peak = normalized.reduce((best, point) => point.y > best.y ? point : best).x;
  const start = initial ?? [...observed];
  const guided = Array.from({ length: count }, (_, index) =>
    Math.max(0.015, Math.min(0.985, peak + (index - (count - 1) / 2) * 0.14)));
  for (const position of guided) {
    if (start.length >= count) break;
    if (start.every((value) => Math.abs(value - position) > 0.035)) start.push(position);
  }
  const uniform = Array.from({ length: count }, (_, index) => (index + 1) / (count + 1));
  const seed = (positions: number[], width: number, skew: number) => positions.flatMap((x) => {
    switch (shape) {
      case 'voigt': return [x, width * 0.75, width * 0.55];
      case 'logNormal': return [x, width, skew];
      case 'splitGaussian': return [x, width * Math.exp(-skew), width * Math.exp(skew)];
      default: return [x, width];
    }
  });
  const asymmetric = shape === 'logNormal' || shape === 'splitGaussian';
  const secondary = initial ?? (observed.length === count ? observed : guided);
  const guesses = [
    seed(start.length === count ? start : guided, 0.12 / Math.sqrt(count), 0),
    seed(secondary, 0.055 / Math.sqrt(count), 0.55),
    seed(asymmetric ? secondary : initial ?? uniform, 0.085 / Math.sqrt(count), -0.55),
  ];
  const sample = normalized.length <= 640 ? normalized : Array.from({ length: 640 }, (_, index) =>
    normalized[Math.round(index * (normalized.length - 1) / 639)]);
  const optimization = inputs(sample);
  const trial = fitFromSeeds(bounds, guesses, steps, (params) => solve(optimization, params));
  if (!trial) return { error: 'failed' };
  const full = sample === normalized ? optimization : inputs(normalized);
  const solution = sample === normalized ? trial : solve(full, trial.shape);
  if (!solution) return { error: 'failed' };

  const params = trial.shape;
  const [offset = 0, slope = 0] = solution.coefficients.slice(0, backgroundColumns);
  const heights = solution.coefficients.slice(backgroundColumns).map((height) => yScale * height);
  const components = profiles(params);
  const backgroundAt = (x: number) => reference + yScale * (offset + slope * x);
  const totalAt = (x: number) => components.reduce((sum, fn, index) => sum + heights[index] * fn(x), backgroundAt(x));
  const grid = [...new Set([
    ...Array.from({ length: 481 }, (_, index) => index / 480),
    ...params.filter((_, i) => i % dimensions === 0),
  ])].sort((a, b) => a - b);
  const render = (values: (x: number) => number): Coordinates => grid.map((x) => {
    const value = values(x);
    return [origin + x * span, !yLog || value > 0 ? value : null];
  });
  const mean = full.ys.reduce((sum, y) => sum + y / full.ys.length, 0);
  const variation = full.ys.reduce((sum, y) => sum + (y - mean) ** 2, 0);
  return {
    peaks: components.map((fn, index) => {
      const [center, width, extra = 0] = params.slice(index * dimensions, (index + 1) * dimensions);
      const [left, right] = halfWidths(shape, fn, center, width, extra);
      return {
        center: origin + center * span, height: heights[index], centerY: heights[index],
        fwhm: span * (left + right),
        points: render((x) => fn(x) * heights[index]),
      };
    }).sort((a, b) => a.center - b.center),
    total: render(totalAt),
    residuals: fitResiduals(points, ({ x }) => totalAt((x - origin) / span)),
    r2: 1 - solution.error / variation,
    count: points.length,
  };
}

export function calculateSpectrum(chart: ChartConfig, series: ResolvedSeries, config: SpectrumFitConfig): SpectrumResult {
  const view = spectrumView(chart, series);
  const key = JSON.stringify([config.shape, config.count, config.centers, config.baseline]);
  const fits = view.fits ??= new Map();
  const cached = fits.get(key);
  if (cached) return cached;
  const yAxis = series.mapping.y2 ? chart.y2Axis : chart.yAxis;
  const result = axisBounds(chart.xAxis).invalid || axisBounds(yAxis).invalid
    ? { error: 'axis' as const }
    : fitSpectrum(view.points, config, yAxis.scale === 'log');
  fits.set(key, result);
  const oldest = fits.keys().next().value;
  if (fits.size > 16 && oldest !== undefined) fits.delete(oldest);
  return result;
}
