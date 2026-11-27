import type { EChartsOption } from 'echarts';
import type { ChartConfig, Dataset } from '../types';
import { buildBox, buildDensity, buildHistogram, buildViolin } from './chartOptions/distribution';
import { buildHeatmap } from './chartOptions/matrix';
import { hexOpacity } from './chartOptions/shared';
import { buildPie, buildPolar, buildRadar } from './chartOptions/special';
import { buildXY, type FitLabelOptions } from './chartOptions/xy';
import { getPalette } from './palettes';
import { activeSpectrumFits } from './spectrum';
import { getTheme } from './themes';
import { selectedTrendlines } from './trendlineSelection';

export function buildChartOption(
  chart: ChartConfig, datasets: Dataset[], normalizedAxisLabel = 'Normalized Y', fitLabels: FitLabelOptions = {},
): EChartsOption {
  const { style } = chart;
  const theme = getTheme(style.theme);
  const palette = getPalette(style.palette);
  const fontStyle = {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    color: theme.textColor,
  };

  const hasSubtitle = chart.subtitle !== '';
  const titleBlock = chart.title || hasSubtitle
    ? {
        text: chart.title,
        subtext: chart.subtitle,
        left: 'center' as const,
        textStyle: { ...fontStyle, fontSize: style.titleSize, fontWeight: 'bold' as const },
        subtextStyle: { ...fontStyle, fontSize: style.fontSize, color: theme.axisColor },
      }
    : undefined;

  const legendTop = style.legendPosition === 'top';
  const topOffset =
    (chart.title ? style.titleSize + 14 : 0) +
    (hasSubtitle ? style.fontSize + 8 : 0);
  const gridTop = Math.max(28, topOffset + (legendTop && style.showLegend ? 28 : 8));
  const gridBottom = style.showLegend && style.legendPosition === 'bottom' ? 58 : chart.xAxis.label ? 48 : 36;
  const scrollLegend = style.palette === 'temperature' || activeSpectrumFits(chart).length > 1 ||
    chart.series.some((item) => selectedTrendlines(item).length > 1);
  const sideScrollableLegend = scrollLegend && style.legendPosition === 'right';

  const base: EChartsOption = {
    animation: false,
    backgroundColor: theme.background,
    color: palette,
    textStyle: { fontFamily: style.fontFamily, color: theme.textColor },
    title: titleBlock,
    tooltip: { trigger: 'item', confine: true },
    grid: {
      left: 12,
      right: chart.series.some((s) => s.y2)
        ? 55
        : style.legendPosition === 'right'
          ? 110
          : 20,
      top: gridTop,
      bottom: gridBottom,
      containLabel: true,
    },
  };

  const legend = style.showLegend
    ? {
        show: true,
        type: scrollLegend ? 'scroll' as const : 'plain' as const,
        textStyle: fontStyle,
        itemWidth: 16,
        itemHeight: 9,
        itemGap: sideScrollableLegend ? 4 : 10,
        top: legendTop
          ? topOffset + 2
          : sideScrollableLegend
            ? gridTop - 4
            : style.legendPosition === 'insideTopLeft' || style.legendPosition === 'insideTopRight'
              ? topOffset + 14
              : undefined,
        bottom: sideScrollableLegend ? gridBottom - 8 : style.legendPosition === 'bottom' ? 4 : undefined,
        right:
          style.legendPosition === 'right' || style.legendPosition === 'insideTopRight'
            ? 8
            : undefined,
        left:
          style.legendPosition === 'insideTopLeft'
            ? 60
            : style.legendPosition === 'right' || style.legendPosition === 'insideTopRight'
              ? undefined
              : 'center',
        orient:
          style.legendPosition === 'right' ? ('vertical' as const) : ('horizontal' as const),
        backgroundColor:
          style.legendPosition === 'insideTopLeft' || style.legendPosition === 'insideTopRight'
            ? hexOpacity(theme.background, 0.7)
            : 'transparent',
        borderRadius: 3,
        padding: [4, 8] as [number, number],
      }
    : { show: false };

  switch (chart.type) {
    case 'line':
    case 'area':
    case 'scatter':
    case 'bar':
    case 'barh':
      return buildXY(chart, datasets, base, legend, palette, theme, normalizedAxisLabel, { ...fitLabels, gridTop, gridBottom });
    case 'pie':
      return buildPie(chart, datasets, base, legend, palette, theme);
    case 'box':
      return buildBox(chart, datasets, base, palette, theme);
    case 'violin':
      return buildViolin(chart, datasets, base, palette, theme);
    case 'histogram':
      return buildHistogram(chart, datasets, base, legend, palette, theme);
    case 'density':
      return buildDensity(chart, datasets, base, legend, theme);
    case 'heatmap':
      return buildHeatmap(chart, datasets, base, false, theme);
    case 'correlation':
      return buildHeatmap(chart, datasets, base, true, theme);
    case 'radar':
      return buildRadar(chart, datasets, base, legend, theme);
    case 'polar':
      return buildPolar(chart, datasets, base, legend, theme);
    default:
      return base;
  }
}
