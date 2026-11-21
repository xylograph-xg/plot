import type { ChartConfig, ChartStyle, Dataset, SeriesMapping } from '../types';
import { numericColumnIndices } from './parse';
import { datasetView } from './rowFilter';
import { trendlineSelection } from './trendlineSelection';
import { spectralAxisPatch } from './spectralAxis';

export const presetIds = ['scatter', 'decay', 'spectrum', 'ratio', 'arrhenius', 'power'] as const;
export type PresetId = typeof presetIds[number];

const time = /^(?:延迟时间|延迟|时间|time|delay(?:start)?|t)(?:[(（]?(?:ns|[μµu]s|ms|s)[)）]?)?$/i;
const wavelength = /^(?:波长|wavelength|lambda|λ)(?:[(（]?nm[)）]?)?$/i;
const intensity = /^(?:counts(?:perbin)?|intensity|signal|每道计数|计数|强度|磷光强度)(?:[(（](?:a\.?u\.?|counts)[)）])?$/i;
const ratio = /^(?:bluegreenratio|flashoverxenon|ratio)$/i;
const temperatures = /^(?:ratio)?(\d+(?:\.\d+)?)k(?:\d+(?:\.\d+)?nm)?$/i;
const tempColumn = /^(?:temperaturek|temperature|tempk|温度(?:[(（]?k[)）]?)?)$/i;
const numericName = (name: string) => name.trim().replace(/[\s_-]/g, '');

interface Mapping {
  xCol: number;
  yCol: number;
  groupCol?: number;
  name?: string;
}

function mappingForDataset(preset: PresetId, dataset: Dataset) {
  const view = datasetView(dataset);
  const numeric = numericColumnIndices(view);
  const lookup = (pattern: RegExp) => numeric.find((index) => pattern.test(numericName(dataset.columns[index])));
  const headers = dataset.columns.map(numericName);
  let xCol: number | undefined;
  let yCols: number[];
  let groupCol = -1;
  let xLabel: string;
  let yLabel: string;
  if (preset === 'arrhenius') {
    xCol = lookup(/^(?:reciprocalT1000perK|1000\/T(?:[(（]K[−-]?1[)）])?|inverseTemperatureKinv|1\/T)$/i);
    const yCol = lookup(/^ln(?:ratio|I|intensity|counts|netcounts)$/i);
    if (xCol === undefined || yCol === undefined) return;
    const windows = headers.flatMap((item, index) =>
      /^(?:delay(?:lo|hi)s|delay(?:lo|hi)ms|window(?:start|end|lo|hi)ms|(?:start|end)ms(?:afteroff)?)$/i.test(item) ? [index] : []);
    if (windows.some((index) => new Set(view.rows.map((row) => row[index])).size > 1)) return 'windows' as const;
    xLabel = /1000/.test(headers[xCol]) ? '10³/T (K⁻¹)' : '1/T (K⁻¹)';
    yLabel = /^lnratio$/i.test(headers[yCol]) ? 'ln R' : 'ln I';
    yCols = [yCol];
  } else {
    xCol = lookup(preset === 'spectrum' ? wavelength : time);
    if (xCol === undefined) return;
    xLabel = dataset.columns[xCol].trim();
    yLabel = preset === 'ratio' ? 'R' : '';
    const wide = numeric.flatMap((index) => {
      const match = temperatures.exec(headers[index]);
      return match && (preset === 'ratio' ? /^ratio/i.test(headers[index]) : !/^ratio/i.test(headers[index]))
        ? [{ index, temperature: Number(match[1]) }] : [];
    }).sort((left, right) => left.temperature - right.temperature);
    if (wide.length) {
      yCols = wide.map(({ index }) => index);
      if (preset === 'spectrum') {
        yCols.push(...numeric.filter((index) => /^phosdelay/i.test(headers[index])));
      }
    } else {
      const yCol = lookup(preset === 'ratio' ? ratio : intensity);
      if (yCol === undefined) return;
      yCols = [yCol];
      groupCol = headers.findIndex((name) => tempColumn.test(name));
    }
  }
  const mappings: Mapping[] = yCols.map((yCol) => ({ xCol, yCol, groupCol }));
  return { xLabel, yLabel, mappings };
}

export function chartPreset(preset: PresetId, chart: ChartConfig, datasets: Dataset[], makeSeries: (id: string) => SeriesMapping):
  Partial<ChartConfig> | 'columns' | 'windows' | 'units' {
  const original = { ...chart, ...spectralAxisPatch(chart) };
  const scatter = preset === 'scatter' || preset === 'arrhenius';
  const logarithmic = preset === 'decay' || preset === 'power';
  const fit = scatter ? 'linear' : preset === 'power' ? 'power' : 'none';
  const selectedFit = trendlineSelection(fit === 'none' ? [] : [fit]);
  const normalization = preset === 'spectrum' ? 'peak' : 'none';
  let { series } = chart;
  let xLabel = original.xAxis.label;
  let yLabel = original.yAxis.label;
  if (preset !== 'scatter') {
    if (!datasets.length) return 'columns';
    const next: SeriesMapping[] = [];
    const axes = [];
    for (const dataset of datasets) {
      const match = mappingForDataset(preset, dataset);
      if (!match) return 'columns';
      if (match === 'windows') return match;
      axes.push(match);
      const existing = chart.series.filter(({ datasetId }) => datasetId === dataset.id);
      for (const mapping of match.mappings) {
        const previous = existing.find(({ xCol, yCol, groupCol }) =>
          xCol === mapping.xCol && yCol === mapping.yCol && groupCol === mapping.groupCol);
        next.push({
          ...(previous ?? makeSeries(dataset.id)), ...mapping,
          sizeCol: -1, y2: false, ...selectedFit, normalization,
        });
      }
    }
    const first = axes[0];
    // Equal axis units may have different labels, such as time_ms and 延迟时间 (ms).
    const unit = (label: string) => /(?:ns|[μµu]s|ms|nm|s)[)）]?$/i.exec(numericName(label))?.[0]
      .toLowerCase().replace(/[)）]/, '').replace(/[μµ]/, 'u');
    const comparable = (left: string, right: string) =>
      numericName(left) === numericName(right) || (unit(left) !== undefined && unit(left) === unit(right));
    if (axes.some((axis) => !comparable(first.xLabel, axis.xLabel) || first.yLabel !== axis.yLabel)) return 'units';
    xLabel = first.xLabel;
    yLabel = first.yLabel;
    series = next;
  } else {
    series = series.map((item) => ({ ...item, ...selectedFit, normalization }));
  }
  const style: ChartStyle = {
    ...chart.style, showSymbols: scatter, smooth: false, step: false, stack: false, showLegend: true,
    palette: scatter ? 'okabe-ito' : 'temperature', legendPosition: scatter ? 'top' : 'right',
  };
  const axis = (current: ChartConfig['xAxis'], label: string, log: boolean) => ({
    ...current, label, scale: log ? 'log' as const : 'linear' as const, min: '', max: '',
  });
  return {
    type: scatter ? 'scatter' : 'line', series, style,
    showPeakPositions: preset === 'spectrum', spectrumFit: undefined, spectrumFits: [], spectralAxis: undefined,
    xAxis: { ...axis(original.xAxis, xLabel, preset === 'power'), includeZero: preset !== 'spectrum' },
    yAxis: axis(original.yAxis, yLabel, logarithmic),
    y2Axis: scatter ? axis(original.y2Axis, original.y2Axis.label, false) : original.y2Axis,
  };
}
