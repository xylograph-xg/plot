import type { AutoStartMode, ChartConfig, Dataset, SeriesMapping } from '../types';
import { validPlateauPoints } from './autoStart';
import { namedColumn } from './seriesDataset';
import { spectralAxisPatch } from './spectralAxis';

const storageKey = 'sciplot-default-chart-template';

export interface ChartTemplate {
  version: 1;
  chart: Pick<ChartConfig, 'type' | 'style' | 'xAxis' | 'yAxis' | 'y2Axis' | 'showPeakPositions'>;
  columns: string[];
  series: Omit<SeriesMapping, 'id' | 'datasetId'>[];
  scanOnImport: boolean;
  scanMode?: AutoStartMode;
  scanColumn?: string;
  plateauPoints: number;
}

export function readChartTemplate(): ChartTemplate | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(storageKey);
    const template = stored ? JSON.parse(stored) as ChartTemplate : null;
    if (!template || template.version !== 1 || !template.chart ||
        !Array.isArray(template.columns) || !Array.isArray(template.series) ||
        !validPlateauPoints(template.plateauPoints) ||
        (template.scanMode !== undefined && template.scanMode !== 'drop' && template.scanMode !== 'rise') ||
        (template.scanColumn !== undefined && typeof template.scanColumn !== 'string')) return null;
    return template;
  } catch {
    return null;
  }
}

export function writeChartTemplate(template: ChartTemplate | null): boolean {
  try {
    if (template) window.localStorage.setItem(storageKey, JSON.stringify(template));
    else window.localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export function makeChartTemplate(
  chart: ChartConfig, datasets: Dataset[], scan: Pick<ChartTemplate, 'scanOnImport' | 'plateauPoints' | 'scanMode' | 'scanColumn'>,
): ChartTemplate {
  const primary = datasets.find((data) => data.id === chart.series[0]?.datasetId);
  const { type, style, xAxis, yAxis, y2Axis, showPeakPositions } = { ...chart, ...spectralAxisPatch(chart) };
  return {
    version: 1,
    chart: { type, style, xAxis, yAxis, y2Axis, showPeakPositions },
    columns: primary?.columns ?? [],
    series: primary ? chart.series.filter((series) => series.datasetId === primary.id).map((series) => ({
      name: series.name, xCol: series.xCol, yCol: series.yCol, y2: series.y2,
      errCol: series.errCol, groupCol: series.groupCol, sizeCol: series.sizeCol,
      color: series.color, lineStyle: series.lineStyle, symbol: series.symbol, opacity: series.opacity,
      trendline: series.trendline, trendlines: series.trendlines, errorDisplay: series.errorDisplay,
      normalization: series.normalization,
    })) : [],
    ...scan,
  };
}

export function columnsForTemplate(
  mapping: ChartTemplate['series'][number], template: ChartTemplate, dataset: Dataset, fallback: SeriesMapping,
): Omit<SeriesMapping, 'id' | 'datasetId'> {
  const match = (index: number, defaultIndex: number) => {
    if (index === -1) return -1;
    return namedColumn(dataset.columns, template.columns[index]) ?? defaultIndex;
  };
  return {
    ...mapping,
    xCol: match(mapping.xCol, fallback.xCol),
    yCol: match(mapping.yCol, fallback.yCol),
    errCol: match(mapping.errCol, -1),
    groupCol: match(mapping.groupCol, -1),
    sizeCol: match(mapping.sizeCol, -1),
  };
}
