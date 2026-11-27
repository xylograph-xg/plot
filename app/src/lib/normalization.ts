import type { NormalizationKind } from '../types';
import type { ResolvedSeries } from './xySeries';

export const normalizationKinds: NormalizationKind[] = ['none', 'max', 'peak', 'first', 'minMax', 'zScore'];

export function normalizationTransform(
  kind: NormalizationKind, points: ResolvedSeries['points'],
): { offset: number; scale: number } | undefined {
  if (kind === 'none') return { offset: 0, scale: 1 };
  if (!points.length) return;
  const [min, max] = points.reduce(([low, high], { y }) => [Math.min(low, y), Math.max(high, y)], [Infinity, -Infinity]);
  let offset = 0;
  let scale = 1;
  switch (kind) {
    case 'max': scale = max; break;
    case 'peak': scale = Math.max(Math.abs(min), Math.abs(max)); break;
    case 'first': scale = points[0].y; break;
    case 'minMax': offset = min; scale = max - min; break;
    case 'zScore':
      if (min === max) return;
      offset = points.reduce((sum, { y }) => sum + y / points.length, 0);
      scale = Math.sqrt(points.reduce((sum, { y }) => sum + (y - offset) ** 2 / points.length, 0));
      break;
  }
  if (scale === 0 || !Number.isFinite(scale) || !Number.isFinite(offset)) return;
  return { offset, scale };
}

const cache = new WeakMap<ResolvedSeries, ResolvedSeries>();
const normalizedPoints = new WeakMap<ResolvedSeries['points'], Map<NormalizationKind, ResolvedSeries['points']>>();

export function normalizedSeries(series: ResolvedSeries): ResolvedSeries {
  const kind = series.mapping.normalization ?? 'none';
  if (kind === 'none') return series;
  const existing = cache.get(series);
  if (existing) return existing;
  let entries = normalizedPoints.get(series.points);
  if (!entries) {
    entries = new Map();
    normalizedPoints.set(series.points, entries);
  }
  let points = entries.get(kind);
  if (!points) {
    const transform = normalizationTransform(kind, series.points);
    points = transform ? series.points.flatMap((point) => {
      const y = (point.y - transform.offset) / transform.scale;
      if (!Number.isFinite(y)) return [];
      const err = point.err === undefined ? undefined : point.err / Math.abs(transform.scale);
      return [{ ...point, y, err: Number.isFinite(err) ? err : undefined }];
    }) : [];
    entries.set(kind, points);
  }
  const result = { ...series, points };
  cache.set(series, result);
  return result;
}
