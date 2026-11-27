import type { AxisConfig, ChartConfig, SpectralAxisDirection } from '../types';
import { activeSpectrumFits } from './spectrum';
import type { ResolvedSeries } from './xySeries';

export const hc = 1239.841984332; // eV·nm
export const spectralDirections = ['wavelengthToEnergy', 'energyToWavelength'] as const;
export type SpectralUnit = 'nm' | 'eV';
const converted = new WeakMap<ResolvedSeries, Map<boolean, ResolvedSeries>>();
const convertedPoints = new WeakMap<ResolvedSeries['points'], Map<boolean, ResolvedSeries['points']>>();

export function spectralOutputUnit(direction: SpectralAxisDirection): SpectralUnit {
  return direction === 'wavelengthToEnergy' ? 'eV' : 'nm';
}

export function spectralColumnUnit(column: string): SpectralUnit | 'unsupported' | undefined {
  const key = column.trim().toLowerCase();
  if (/(?:^|[^a-z])(?:kev|mev|[µμu]m|pm|å|ns|ms|hz)(?:[^a-z]|$)|时间|延迟|(?:^|[^a-z])(?:time|delay)(?:[^a-z]|$)/i.test(key)) {
    return 'unsupported';
  }
  if (/wavelength|波长|lambda|λ|(?:^|[^a-z])nm(?:[^a-z]|$)/i.test(key)) return 'nm';
  if (/energy|能量|(?:^|[^a-z])ev(?:[^a-z]|$)/i.test(key)) return 'eV';
}

export function spectralSeriesUnit(chart: Pick<ChartConfig, 'xAxis' | 'spectralAxis'>, column?: string): SpectralUnit | undefined {
  if (chart.spectralAxis) return spectralOutputUnit(chart.spectralAxis.direction);
  const unit = spectralColumnUnit(column ?? '') ?? spectralColumnUnit(chart.xAxis.label);
  return unit === 'unsupported' ? undefined : unit;
}

export function compatibleSpectralColumn(column: string, direction: SpectralAxisDirection): boolean {
  const unit = spectralColumnUnit(column);
  const expected = direction === 'wavelengthToEnergy' ? 'nm' : 'eV';
  return unit === undefined || unit === expected;
}

export function convertSpectralSeries(series: ResolvedSeries, density: boolean): ResolvedSeries {
  let entries = converted.get(series);
  if (!entries) {
    entries = new Map();
    converted.set(series, entries);
  }
  const cached = entries.get(density);
  if (cached) return cached;
  let transformations = convertedPoints.get(series.points);
  if (!transformations) {
    transformations = new Map();
    convertedPoints.set(series.points, transformations);
  }
  let points = transformations.get(density);
  if (!points) {
    points = series.points.flatMap((point) => {
      if (typeof point.x !== 'number' || point.x <= 0) return [];
      const x = hc / point.x;
      const factor = density ? point.x / x : 1;
      const y = point.y * factor;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      const err = point.err === undefined ? undefined : point.err * factor;
      return [{ ...point, x, y, err: Number.isFinite(err) ? err : undefined }];
    });
    transformations.set(density, points);
  }
  const result = { ...series, points };
  entries.set(density, result);
  return result;
}

function reciprocalBound(value: string): string {
  const numeric = Number(value);
  const reciprocal = hc / numeric;
  return numeric > 0 && Number.isFinite(reciprocal) ? String(reciprocal) : '';
}

function equalBound(value: string, expected: string): boolean {
  if (!value.trim() || !expected) return !value.trim() && !expected;
  const actual = Number(value);
  const target = Number(expected);
  return Number.isFinite(actual) &&
    Math.abs(actual - target) <= 8 * Number.EPSILON * Math.max(Math.abs(actual), Math.abs(target));
}

function axisText({ label, min, max }: AxisConfig) {
  return { label, min, max };
}

export function spectralAxisPatch(
  chart: ChartConfig,
  direction?: SpectralAxisDirection,
  density = false,
  xLabel = '',
): Partial<ChartConfig> {
  const old = chart.spectralAxis;
  if (!old && !direction) return {};
  const toggleReciprocal = Boolean(old) !== Boolean(direction);
  const savedX = old?.originalX ?? { ...axisText(chart.xAxis), includeZero: chart.xAxis.includeZero };
  const mappedX = toggleReciprocal ? {
    min: reciprocalBound(chart.xAxis.max), max: reciprocalBound(chart.xAxis.min),
  } : { min: chart.xAxis.min, max: chart.xAxis.max };
  if (old && !direction) {
    if (equalBound(chart.xAxis.max, reciprocalBound(savedX.min))) mappedX.min = savedX.min;
    if (equalBound(chart.xAxis.min, reciprocalBound(savedX.max))) mappedX.max = savedX.max;
  }

  const useDensity = Boolean(direction) && density;
  const savedY = old?.originalY ?? (useDensity ? axisText(chart.yAxis) : undefined);
  const savedY2 = old?.originalY2 ?? (useDensity ? axisText(chart.y2Axis) : undefined);
  const yAxisPatch = (axis: AxisConfig, saved?: ReturnType<typeof axisText>): AxisConfig => {
    if (useDensity && !old?.density) return { ...axis, label: '', min: '', max: '' };
    if (!useDensity && old?.density && saved) return { ...axis, ...saved };
    return axis;
  };
  const spectrumFits = toggleReciprocal ? activeSpectrumFits(chart).map((fit) => {
    const centers = fit.centers?.map((center) => hc / center);
    return {
      ...fit, centers: centers?.every((center) => Number.isFinite(center) && center > 0) ? centers.sort((a, b) => a - b) : undefined,
    };
  }) : activeSpectrumFits(chart);

  return {
    spectralAxisPreference: direction ? { direction, density: useDensity }
      : old ? { direction: old.direction, density: old.density } : chart.spectralAxisPreference,
    spectralAxis: direction ? {
      direction, density: useDensity, originalX: savedX,
      originalY: useDensity ? savedY : undefined, originalY2: useDensity ? savedY2 : undefined,
    } : undefined,
    xAxis: {
      ...chart.xAxis, ...mappedX,
      label: direction ? xLabel || chart.xAxis.label : savedX.label,
      includeZero: direction ? false : savedX.includeZero,
    },
    yAxis: yAxisPatch(chart.yAxis, savedY),
    y2Axis: yAxisPatch(chart.y2Axis, savedY2),
    spectrumFits,
  };
}
