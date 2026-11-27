import type { EChartsOption } from 'echarts';
import type { ChartConfig, Dataset } from '../../types';
import { DIVERGING_RAMP, HEATMAP_RAMP } from '../palettes';
import { numericColumnIndices } from '../parse';
import { pearson } from '../stats';
import type { ChartTheme } from '../themes';

export function buildHeatmap(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  isCorrelation: boolean,
  theme: ChartTheme,
): EChartsOption {
  const mapping = chart.series[0];
  const ds = mapping ? datasets.find((d) => d.id === mapping.datasetId) : undefined;
  if (!ds) return base;
  const numCols = numericColumnIndices(ds);
  if (numCols.length === 0) return base;

  let xCats: string[];
  let yCats: string[];
  let data: [number, number, number][];
  let vmin: number;
  let vmax: number;

  if (isCorrelation) {
    const columns = numCols.map((column) => Float64Array.from(ds.rows, (row) =>
      typeof row[column] === 'number' ? row[column] : NaN));
    xCats = numCols.map((column) => ds.columns[column]);
    yCats = xCats;
    data = [];
    for (let i = 0; i < columns.length; i += 1) {
      for (let j = i; j < columns.length; j += 1) {
        const value = Number(pearson(columns[i], columns[j]).toFixed(3));
        data.push([i, j, value]);
        if (i !== j) data.push([j, i, value]);
      }
    }
    vmin = -1;
    vmax = 1;
  } else {
    const labelCol = ds.columns.findIndex((_, i) => !numCols.includes(i));
    yCats = ds.rows.map((r, ri) => (labelCol >= 0 ? String(r[labelCol] ?? ri + 1) : `R${ri + 1}`));
    xCats = numCols.map((i) => ds.columns[i]);
    data = [];
    vmin = Infinity;
    vmax = -Infinity;
    ds.rows.forEach((r, ri) => {
      numCols.forEach((ci, xi) => {
        const v = r[ci];
        if (typeof v === 'number') {
          data.push([xi, ri, v]);
          vmin = Math.min(vmin, v);
          vmax = Math.max(vmax, v);
        }
      });
    });
    if (!data.length) return base;
  }

  const fontStyle = {
    fontFamily: chart.style.fontFamily,
    fontSize: chart.style.fontSize,
    color: theme.textColor,
  };

  return {
    ...base,
    grid: { left: 12, right: 80, top: chart.title ? 50 : 25, bottom: 45, containLabel: true },
    xAxis: {
      type: 'category',
      data: xCats,
      axisLabel: { ...fontStyle, rotate: xCats.length > 8 ? 45 : 0 },
      axisTick: { show: false },
      axisLine: { show: false },
      name: chart.xAxis.label,
      nameLocation: 'middle',
      nameGap: 32,
      nameTextStyle: fontStyle,
    },
    yAxis: {
      type: 'category',
      data: yCats,
      inverse: true,
      axisLabel: fontStyle,
      axisTick: { show: false },
      axisLine: { show: false },
      name: chart.yAxis.label,
      nameLocation: 'middle',
      nameGap: 70,
      nameTextStyle: fontStyle,
    },
    visualMap: {
      min: vmin,
      max: vmax,
      calculable: false,
      orient: 'vertical',
      right: 5,
      top: 'center',
      itemHeight: 120,
      textStyle: { ...fontStyle, fontSize: Math.max(8, chart.style.fontSize - 1) },
      inRange: { color: isCorrelation ? DIVERGING_RAMP : HEATMAP_RAMP },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: chart.style.showDataLabels || (isCorrelation && xCats.length <= 10),
          fontSize: Math.max(8, chart.style.fontSize - 2),
          fontFamily: chart.style.fontFamily,
        },
        itemStyle: { borderColor: theme.background, borderWidth: 1 },
      },
    ],
    legend: { show: false },
    tooltip: { trigger: 'item', confine: true },
  };
}
