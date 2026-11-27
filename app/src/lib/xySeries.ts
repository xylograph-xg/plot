import type { ChartConfig, Dataset, SeriesMapping, SpectralAxisDirection, SpectralAxisPreference } from '../types';
import { compatibleSpectralColumn, convertSpectralSeries, spectralColumnUnit } from './spectralAxis';
import { datasetView } from './rowFilter';

export interface XYPoint {
  x: number | string;
  y: number;
  err?: number;
  size?: number;
  /** original row index in the dataset — used for drag-editing */
  ri: number;
}

export interface ResolvedSeries {
  /** stable id: `m:<mappingId>` or `m:<mappingId>:<group>` */
  sid: string;
  name: string;
  points: XYPoint[];
  mapping: SeriesMapping;
}

const resolvedDatasets = new WeakMap<Dataset, WeakMap<SeriesMapping, ResolvedSeries[]>>();
const datasetPoints = new WeakMap<Dataset, Map<string, { group?: string; points: XYPoint[] }[]>>();

export function resolveSeries(mapping: SeriesMapping, datasets: Dataset[]): ResolvedSeries[] {
  const ds = datasets.find((d) => d.id === mapping.datasetId);
  if (!ds) return [];
  let resolved = resolvedDatasets.get(ds);
  if (!resolved) {
    resolved = new WeakMap();
    resolvedDatasets.set(ds, resolved);
  }
  const existing = resolved.get(mapping);
  if (existing) return existing;
  const { xCol, yCol, errCol, groupCol, sizeCol } = mapping;
  const key = JSON.stringify([xCol, yCol, errCol, groupCol, sizeCol]);
  let data = datasetPoints.get(ds);
  if (!data) {
    data = new Map();
    datasetPoints.set(ds, data);
  }
  let groups = data.get(key);
  if (!groups) {
    groups = resolveDataset(mapping, ds);
    data.set(key, groups);
    const oldest = data.keys().next().value;
    if (data.size > 12 && oldest !== undefined) data.delete(oldest);
  }
  const series = groups.map(({ group, points }) => ({
    mapping, points,
    sid: group === undefined ? `m:${mapping.id}` : `m:${mapping.id}:${group}`,
    name: group ?? (mapping.name || ds.columns[yCol] || 'Series'),
  }));
  resolved.set(mapping, series);
  return series;
}

function resolveDataset(mapping: SeriesMapping, ds: Dataset) {
  const indexed = ds.rows
    .map((r, idx) => ({ r, idx }));
  const mk = (rs: typeof indexed, group?: string) => ({
    group,
    points: rs
      .map(({ r, idx }) => {
        const x = mapping.xCol >= 0 ? r[mapping.xCol] : idx + 1;
        const y = r[mapping.yCol];
        if (x == null || (typeof x === 'number' && !Number.isFinite(x)) ||
            typeof y !== 'number' || !Number.isFinite(y)) return null;
        const p: XYPoint = { x, y, ri: idx };
        if (mapping.errCol >= 0 && typeof r[mapping.errCol] === 'number') {
          p.err = r[mapping.errCol] as number;
        }
        if (mapping.sizeCol >= 0 && typeof r[mapping.sizeCol] === 'number') {
          p.size = r[mapping.sizeCol] as number;
        }
        return p;
      })
      .filter((p): p is XYPoint => p !== null),
  });
  if (mapping.groupCol >= 0) {
    const groups = new Map<string, typeof indexed>();
    for (const item of indexed) {
      const g = String(item.r[mapping.groupCol] ?? '—');
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(item);
    }
    return [...groups.entries()].map(([g, rs]) => mk(rs, g)).filter((group) => group.points.length);
  }
  return [mk(indexed)];
}

export function hasCategoricalX(series: ResolvedSeries[]): boolean {
  return series.some((item) => item.points.some((point) => typeof point.x === 'string'));
}

export function isCurveVisible({ mapping, name }: ResolvedSeries): boolean {
  return mapping.groupCol >= 0 ? !mapping.hiddenGroups?.includes(name) : !mapping.hidden;
}

export function supportsTrendline(type: ChartConfig['type']): boolean {
  return type === 'line' || type === 'scatter' || type === 'area';
}

export function resolveChartSeries(chart: Pick<ChartConfig, 'type' | 'series' | 'spectralAxis'>, datasets: Dataset[]): ResolvedSeries[] {
  const spectral = supportsTrendline(chart.type) ? chart.spectralAxis : undefined;
  return chart.series.flatMap((mapping) => {
    const series = resolveSeries(mapping, datasets);
    if (!spectral) return series;
    const column = datasets.find(({ id }) => id === mapping.datasetId)?.columns[mapping.xCol];
    if (!column || !compatibleSpectralColumn(column, spectral.direction)) return [];
    return series.map((item) => convertSpectralSeries(item, spectral.density));
  });
}

export function spectralAxisSources(chart: Pick<ChartConfig, 'series'>, datasets: Dataset[]) {
  const ids = new Set(chart.series.map(({ datasetId }) => datasetId));
  const views = datasets.filter(({ id }) => ids.has(id)).map(datasetView);
  return chart.series.map((mapping) => {
    const column = views.find(({ id }) => id === mapping.datasetId)?.columns[mapping.xCol];
    let positive = false;
    let skipped = 0;
    for (const { points } of resolveSeries(mapping, views)) {
      for (const { x } of points) {
        if (typeof x === 'number' && x > 0) positive = true;
        else skipped += 1;
      }
    }
    return { column, positive, skipped };
  });
}

export function invalidSpectralSources(
  sources: ReturnType<typeof spectralAxisSources>, direction: SpectralAxisDirection,
) {
  return sources.filter(({ column, positive }) => !column || !positive || !compatibleSpectralColumn(column, direction));
}

export function quickSpectralAxis(chart: ChartConfig, datasets: Dataset[]): SpectralAxisPreference | undefined {
  if (!supportsTrendline(chart.type) || !chart.series.length) return;
  const active = chart.spectralAxis;
  if (active) return active;
  const preference = chart.spectralAxisPreference;
  const units = chart.series.map((mapping) => spectralColumnUnit(
    datasets.find(({ id }) => id === mapping.datasetId)?.columns[mapping.xCol] ?? '',
  )).filter((unit) => unit !== undefined);
  const unit = units.length === 0 ? spectralColumnUnit(chart.xAxis.label)
    : units.every((candidate) => candidate === units[0]) ? units[0] : undefined;
  const inferred = unit === 'nm' ? 'wavelengthToEnergy' : unit === 'eV' ? 'energyToWavelength' : undefined;
  if (!preference && !inferred) return;
  const sources = spectralAxisSources(chart, datasets);
  if (preference && !invalidSpectralSources(sources, preference.direction).length) return preference;
  if (inferred && !invalidSpectralSources(sources, inferred).length) return { direction: inferred, density: false };
}
