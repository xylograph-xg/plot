import type { ActiveTrendlineKind, SeriesMapping } from '../types';
import { isFitModel } from './fitModels';

export function isTrendline(kind: unknown): kind is ActiveTrendlineKind {
  return typeof kind === 'string' && (kind === 'movingAverage' || isFitModel(kind));
}

export function selectedTrendlines(series: Pick<SeriesMapping, 'trendline' | 'trendlines'>): ActiveTrendlineKind[] {
  if (Array.isArray(series.trendlines)) return [...new Set(series.trendlines.filter(isTrendline))];
  return isTrendline(series.trendline) ? [series.trendline] : [];
}

export function trendlineSelection(methods: ActiveTrendlineKind[]): Pick<SeriesMapping, 'trendline' | 'trendlines'> {
  return { trendline: methods[0] ?? 'none', trendlines: methods };
}

export function setTrendline(methods: ActiveTrendlineKind[], kind: ActiveTrendlineKind, enabled: boolean): ActiveTrendlineKind[] {
  if (methods.includes(kind) === enabled) return methods;
  return enabled ? [...methods, kind] : methods.filter((method) => method !== kind);
}

export function trendlineLabel(kind: ActiveTrendlineKind): string {
  return kind === 'movingAverage' ? 'chart.trendMA' : `fit.models.${kind}`;
}
