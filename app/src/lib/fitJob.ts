import type { ActiveTrendlineKind, ChartConfig, SpectrumFitConfig } from '../types';
import type { ResolvedSeries } from './xySeries';
import { calculateSpectrum, type SpectrumResult } from './spectrum';
import { calculateTrendline, type TrendlineResult } from './trendline';

export type FitRequest = { chart: ChartConfig; series: ResolvedSeries } & (
  { type: 'trendline'; kind: ActiveTrendlineKind } | { type: 'spectrum'; config: SpectrumFitConfig }
);
export type FitResult = { type: 'trendline'; value: TrendlineResult } | { type: 'spectrum'; value: SpectrumResult };

export function runFit(request: FitRequest): FitResult {
  const { chart, series } = request;
  return request.type === 'trendline'
    ? { type: 'trendline', value: calculateTrendline(chart, series, request.kind) }
    : { type: 'spectrum', value: calculateSpectrum(chart, series, request.config) };
}
