import type { EChartsOption } from 'echarts';
import type { ChartConfig, Dataset } from '../../types';
import { numericColumn, numericColumnIndices } from '../parse';
import { extent } from '../stats';
import type { ChartTheme } from '../themes';
import { resolveSeries } from '../xySeries';
import { LINE_TYPE } from './shared';

export function buildPie(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  legend: object,
  palette: string[],
  theme: ChartTheme,
): EChartsOption {
  const { style } = chart;
  const mapping = chart.series[0];
  if (!mapping) return { ...base, legend };
  const ds = datasets.find((d) => d.id === mapping.datasetId);
  if (!ds) return { ...base, legend };

  // label column: groupCol if set, else xCol; value column: yCol
  const labelCol = mapping.groupCol >= 0 ? mapping.groupCol : mapping.xCol;
  const agg = new Map<string, number>();
  ds.rows.forEach((r, i) => {
    const v = r[mapping.yCol];
    if (typeof v !== 'number') return;
    const label = labelCol >= 0 ? String(r[labelCol] ?? `Item ${i + 1}`) : `Item ${i + 1}`;
    agg.set(label, (agg.get(label) ?? 0) + v);
  });

  const inner = style.pieDonut > 0 ? `${Math.round(style.pieDonut * 70)}%` : '0%';
  return {
    ...base,
    legend,
    series: [
      {
        type: 'pie',
        radius: [inner, '68%'],
        center: ['50%', '55%'],
        data: [...agg.entries()].map(([name, value], i) => ({
          name,
          value,
          itemStyle: { color: palette[i % palette.length] },
        })),
        label: {
          show: style.pieShowLabels,
          formatter: '{b}\n{d}%',
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          color: theme.textColor,
        },
        labelLine: { show: style.pieShowLabels },
        itemStyle: {
          borderColor: theme.background,
          borderWidth: 1.5,
        },
        emphasis: {
          itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.25)' },
        },
      },
    ],
    tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
  };
}

export function buildRadar(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  legend: object,
  theme: ChartTheme,
): EChartsOption {
  const mapping = chart.series[0];
  const ds = mapping ? datasets.find((d) => d.id === mapping.datasetId) : undefined;
  if (!ds) return base;
  const numCols = numericColumnIndices(ds);
  if (numCols.length < 3) return base;
  const labelCol = ds.columns.findIndex((_, i) => !numCols.includes(i));
  const indicators = numCols.map((i) => {
    const vals = numericColumn(ds, i);
    return { name: ds.columns[i], max: vals.length ? extent(vals)[1] * 1.1 : 1 };
  });
  const rows = ds.rows.slice(0, 8);
  const fontStyle = {
    fontFamily: chart.style.fontFamily,
    fontSize: chart.style.fontSize,
    color: theme.textColor,
  };
  return {
    ...base,
    legend,
    radar: {
      indicator: indicators,
      center: ['50%', '55%'],
      radius: '62%',
      axisName: fontStyle,
      splitLine: { lineStyle: { color: theme.gridColor } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: theme.gridColor } },
    },
    series: [
      {
        type: 'radar',
        data: rows.map((r, ri) => ({
          name: labelCol >= 0 ? String(r[labelCol] ?? `R${ri + 1}`) : `R${ri + 1}`,
          value: numCols.map((ci) => (typeof r[ci] === 'number' ? (r[ci] as number) : 0)),
          lineStyle: { width: chart.style.lineWidth },
          areaStyle: { opacity: 0.12 },
        })),
        symbolSize: chart.style.showSymbols ? chart.style.symbolSize * 0.7 : 0,
      },
    ],
  };
}

export function buildPolar(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  legend: object,
  theme: ChartTheme,
): EChartsOption {
  const resolved = chart.series.flatMap((m) => resolveSeries(m, datasets));
  const fontStyle = {
    fontFamily: chart.style.fontFamily,
    fontSize: chart.style.fontSize,
    color: theme.textColor,
  };
  // auto angle range from data
  const xsAll = resolved.flatMap((s) =>
    s.points.map((p) => (typeof p.x === 'number' ? p.x : 0)),
  );
  const angleMax = xsAll.length && extent(xsAll)[1] <= 360 ? 360 : undefined;
  return {
    ...base,
    legend,
    polar: { radius: '68%', center: ['50%', '55%'] },
    angleAxis: {
      type: 'value',
      min: 0,
      max: angleMax,
      axisLabel: fontStyle,
      splitLine: { lineStyle: { color: theme.gridColor } },
      axisLine: { lineStyle: { color: theme.axisColor } },
    },
    radiusAxis: {
      axisLabel: fontStyle,
      splitLine: { lineStyle: { color: theme.gridColor, type: theme.gridType } },
      axisLine: { show: false },
    },
    series: resolved.map((s, i) => ({
      type: 'line',
      name: s.name,
      coordinateSystem: 'polar',
      data: s.points.map((p) => [p.y, typeof p.x === 'number' ? p.x : 0]),
      smooth: chart.style.smooth,
      symbol: chart.style.showSymbols ? 'circle' : 'none',
      symbolSize: chart.style.symbolSize,
      lineStyle: {
        width: chart.style.lineWidth,
        color: s.mapping.color || undefined,
        type: LINE_TYPE[s.mapping.lineStyle],
      },
      itemStyle: s.mapping.color ? { color: s.mapping.color } : undefined,
      z: 2 + i,
    })),
  };
}
