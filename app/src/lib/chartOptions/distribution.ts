import type { EChartsOption, SeriesOption } from 'echarts';
import type { ChartConfig, Dataset, SeriesMapping } from '../../types';
import { numericColumn } from '../parse';
import { boxStats, extent, histogram, jitter, kde, linspace } from '../stats';
import type { ChartTheme } from '../themes';
import { axisOption, hexOpacity, numericXAxisOption, type RenderApi } from './shared';

interface ValueGroup {
  name: string;
  values: number[];
}

const groupedCache = new WeakMap<Dataset, Map<string, ValueGroup[]>>();

/** Values grouped by category — used by box / violin / histogram / density / pie. */
function groupedValues(mapping: SeriesMapping, datasets: Dataset[]): ValueGroup[] {
  const dataset = datasets.find((item) => item.id === mapping.datasetId);
  if (!dataset) return [];
  const { yCol, groupCol, name } = mapping;
  let cache = groupedCache.get(dataset);
  if (!cache) {
    cache = new Map();
    groupedCache.set(dataset, cache);
  }
  const key = JSON.stringify([yCol, groupCol, name]);
  const previous = cache.get(key);
  if (previous) return previous;
  const groups = new Map<string, number[]>();
  if (groupCol >= 0) {
    for (const row of dataset.rows) {
      const value = row[yCol];
      if (typeof value !== 'number') continue;
      const group = String(row[groupCol] ?? '—');
      const values = groups.get(group);
      if (values) values.push(value);
      else groups.set(group, [value]);
    }
  } else {
    groups.set(name || dataset.columns[yCol], numericColumn(dataset, yCol));
  }
  const result = [...groups].map(([name, values]) => ({ name, values }));
  cache.set(key, result);
  const oldest = cache.keys().next().value;
  if (cache.size > 16 && oldest !== undefined) cache.delete(oldest);
  return result;
}

const densityCache = new WeakMap<number[], Map<number, { xs: number[]; density: number[] }>>();

function densityGrid(values: number[], size: number, padding: number) {
  let entries = densityCache.get(values);
  if (!entries) {
    entries = new Map();
    densityCache.set(values, entries);
  }
  const cached = entries.get(size);
  if (cached) return cached;
  const [min, max] = extent(values);
  const pad = max === min ? 1 : (max - min) * padding;
  const xs = linspace(min - pad, max + pad, size);
  const result = { xs, density: kde(values, xs) };
  entries.set(size, result);
  return result;
}

/** Jittered raw data points over box/violin categories. */
function rawPointsSeries(
  groups: { name: string; values: number[] }[],
  symbolSize: number,
  theme: ChartTheme,
): SeriesOption {
  const pts: [number, number][] = [];
  groups.forEach((g, gi) => {
    g.values.forEach((v, k) => pts.push([gi + jitter(gi * 1000 + k) * 0.18, v]));
  });
  return {
    type: 'scatter',
    data: pts,
    symbolSize: Math.max(3, symbolSize * 0.55),
    itemStyle: {
      color: 'transparent',
      borderColor: theme.textColor,
      borderWidth: 0.8,
      opacity: 0.5,
    },
    silent: true,
    z: 4,
  } as SeriesOption;
}

export function buildBox(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  palette: string[],
  theme: ChartTheme,
): EChartsOption {
  const groups = chart.series.flatMap((m) => groupedValues(m, datasets));
  const categories = groups.map((g) => g.name);
  const statistics = groups.map((group) => boxStats(group.values));
  const boxData = statistics.map((s, i) => {
    return {
      value: [s.low, s.q1, s.median, s.q3, s.high],
      itemStyle: {
        color: hexOpacity(palette[i % palette.length], 0.35),
        borderColor: palette[i % palette.length],
        borderWidth: chart.style.lineWidth,
      },
    };
  });
  const outliers: [number, number][] = [];
  statistics.forEach(({ outliers: values }, i) => values.forEach((value) => outliers.push([i, value])));

  const series: SeriesOption[] = [
    { type: 'boxplot', data: boxData, boxWidth: ['25%', '55%'] },
  ];
  if (chart.style.boxShowPoints) {
    series.push(rawPointsSeries(groups, chart.style.symbolSize, theme));
  } else if (outliers.length) {
    series.push({
      type: 'scatter',
      data: outliers,
      symbolSize: chart.style.symbolSize * 0.8,
      itemStyle: { color: 'transparent', borderColor: theme.axisColor, borderWidth: 1 },
    });
  }

  return {
    ...base,
    legend: { show: false },
    xAxis: axisOption(chart.xAxis, chart, theme, true, categories) as never,
    yAxis: axisOption(chart.yAxis, chart, theme, false) as never,
    series,
    tooltip: { trigger: 'item', confine: true },
  };
}

export function buildViolin(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  palette: string[],
  theme: ChartTheme,
): EChartsOption {
  const groups = chart.series.flatMap((m) => groupedValues(m, datasets));
  const categories = groups.map((g) => g.name);

  const violinData = groups.map((g, gi) => {
    if (g.values.length < 2)
      return { gi, ys: [] as number[], ds: [] as number[], color: palette[gi % palette.length] };
    const { xs: ys, density: ds } = densityGrid(g.values, 60, 0.15);
    const dmax = Math.max(...ds) || 1;
    return { gi, ys, ds: ds.map((d) => d / dmax), color: palette[gi % palette.length] };
  });

  // median + quartile markers
  const medians: [number, number][] = [];
  const quartiles: { gi: number; q1: number; q3: number }[] = [];
  groups.forEach((g, gi) => {
    if (!g.values.length) return;
    const st = boxStats(g.values);
    medians.push([gi, st.median]);
    quartiles.push({ gi, q1: st.q1, q3: st.q3 });
  });

  const series: SeriesOption[] = [
    {
      type: 'custom',
      renderItem: (params: { dataIndex: number }, api: RenderApi) => {
        const item = violinData[params.dataIndex];
        if (item.ys.length === 0) return { type: 'group', children: [] };
        const halfBand = api.size([1, 0])[0] * 0.38;
        const right: number[][] = [];
        const left: number[][] = [];
        for (let i = 0; i < item.ys.length; i++) {
          const c = api.coord([item.gi, item.ys[i]]);
          right.push([c[0] + item.ds[i] * halfBand, c[1]]);
          left.push([c[0] - item.ds[i] * halfBand, c[1]]);
        }
        const points = [...right, ...left.reverse()];
        return {
          type: 'polygon',
          shape: { points, smooth: 0.2 },
          style: {
            fill: hexOpacity(item.color, 0.4),
            stroke: item.color,
            lineWidth: chart.style.lineWidth,
          },
        };
      },
      data: violinData.map((v) => [v.gi, 0]),
      z: 2,
    } as SeriesOption,
    // inner quartile sticks
    {
      type: 'custom',
      silent: true,
      renderItem: (params: { dataIndex: number }, api: RenderApi) => {
        const q = quartiles[params.dataIndex];
        if (!q) return { type: 'group', children: [] };
        const p1 = api.coord([q.gi, q.q1]);
        const p3 = api.coord([q.gi, q.q3]);
        return {
          type: 'line',
          shape: { x1: p1[0], y1: p1[1], x2: p3[0], y2: p3[1] },
          style: { stroke: theme.textColor, lineWidth: 3, lineCap: 'round' },
        };
      },
      data: quartiles.map((q) => [q.gi, 0]),
      z: 3,
    } as SeriesOption,
    {
      type: 'scatter',
      data: medians,
      symbolSize: chart.style.symbolSize * 0.9,
      itemStyle: { color: theme.background, borderColor: theme.textColor, borderWidth: 1.5 },
      silent: true,
      z: 4,
    },
  ];
  if (chart.style.boxShowPoints) {
    series.push(rawPointsSeries(groups, chart.style.symbolSize, theme));
  }

  return {
    ...base,
    legend: { show: false },
    xAxis: axisOption(chart.xAxis, chart, theme, true, categories) as never,
    yAxis: axisOption(chart.yAxis, chart, theme, false) as never,
    series,
    tooltip: { show: false },
  };
}

// ---------------------------------------------------------------- histogram / density

export function buildHistogram(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  legend: object,
  palette: string[],
  theme: ChartTheme,
): EChartsOption {
  const series: SeriesOption[] = [];
  const resolved = chart.series.flatMap((m) => groupedValues(m, datasets));
  resolved.forEach((g, i) => {
    if (!g.values.length) return;
    const bins = histogram(g.values, chart.style.histogramBins);
    const color = palette[i % palette.length];
    series.push({
      type: 'custom',
      name: g.name,
      encode: { x: [0, 1], y: 2 },
      renderItem: (_params: unknown, api: RenderApi) => {
        const x0 = api.value(0);
        const x1 = api.value(1);
        const c = api.value(2);
        const p0 = api.coord([x0, c]);
        const p1 = api.coord([x1, 0]);
        return {
          type: 'rect',
          shape: { x: p0[0], y: p0[1], width: p1[0] - p0[0], height: p1[1] - p0[1] },
          style: {
            fill: hexOpacity(color, resolved.length > 1 ? 0.6 : 0.8),
            stroke: color,
            lineWidth: 1,
          },
        };
      },
      data: bins.map((b) => [b.x0, b.x1, b.count]),
      z: 2,
    } as SeriesOption);

    // KDE overlay curve scaled to counts
    const { xs, density: dens } = densityGrid(g.values, 100, 0);
    const binWidth = bins.length ? bins[0].x1 - bins[0].x0 : 1;
    const scale = g.values.length * binWidth;
    series.push({
      type: 'line',
      name: `${g.name} KDE`,
      data: xs.map((x, k) => [x, dens[k] * scale]),
      symbol: 'none',
      smooth: true,
      lineStyle: { width: chart.style.lineWidth, color, type: 'solid' },
      silent: true,
      tooltip: { show: false },
      z: 3,
    } as SeriesOption);
  });
  return {
    ...base,
    legend,
    xAxis: numericXAxisOption(chart, theme) as never,
    yAxis: axisOption(chart.yAxis, chart, theme, false) as never,
    series,
    tooltip: { show: false },
  };
}

export function buildDensity(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  legend: object,
  theme: ChartTheme,
): EChartsOption {
  const resolved = chart.series.flatMap((m) => groupedValues(m, datasets));
  const series: SeriesOption[] = resolved.map((g) => {
    if (g.values.length < 2) return { type: 'line', name: g.name, data: [] };
    const { xs, density: ds } = densityGrid(g.values, 120, 0);
    return {
      type: 'line',
      name: g.name,
      data: xs.map((x, i) => [x, ds[i]]),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: chart.style.lineWidth },
      areaStyle: { opacity: 0.2 },
    };
  });
  return {
    ...base,
    legend,
    xAxis: numericXAxisOption(chart, theme) as never,
    yAxis: axisOption(chart.yAxis, chart, theme, false) as never,
    series,
  };
}
