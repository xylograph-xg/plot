import type { AxisConfig, ChartConfig, TickFormat } from '../../types';
import { axisBounds } from '../axisBounds';
import type { ChartTheme } from '../themes';

/** Minimal typing for ECharts custom-series renderItem api. */
export interface RenderApi {
  value: (dim: number) => number;
  coord: (point: (number | string)[]) => number[];
  size: (dataSize: number[]) => number[];
}

export const LINE_TYPE: Record<string, 'solid' | 'dashed' | 'dotted'> = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
};
function tickFormatter(fmt: TickFormat): ((v: number) => string) | undefined {
  switch (fmt) {
    case 'fixed0':
      return (v) => v.toFixed(0);
    case 'fixed1':
      return (v) => v.toFixed(1);
    case 'fixed2':
      return (v) => v.toFixed(2);
    case 'scientific':
      return (v) => (v === 0 ? '0' : v.toExponential(1).replace('e+', 'e'));
    case 'percent':
      return (v) => `${(v * 100).toFixed(0)}%`;
    default:
      return undefined;
  }
}

export function axisOption(
  cfg: AxisConfig,
  chart: ChartConfig,
  theme: ChartTheme,
  isCategory: boolean,
  categories?: string[],
) {
  const { min, max } = axisBounds(cfg);
  const fontStyle = {
    fontFamily: chart.style.fontFamily,
    fontSize: chart.style.fontSize,
    color: theme.textColor,
  };
  const rotate = cfg.labelRotate || (isCategory && (categories?.length ?? 0) > 8 ? 45 : 0);
  return {
    type: isCategory
      ? ('category' as const)
      : cfg.scale === 'log'
        ? ('log' as const)
        : ('value' as const),
    name: cfg.label,
    nameLocation: 'middle' as const,
    nameGap: isCategory ? (rotate ? 45 : 30) : 38,
    nameTextStyle: { ...fontStyle, fontSize: chart.style.fontSize + 1 },
    scale: !isCategory && cfg.includeZero === false,
    min: isCategory ? undefined : min,
    max: isCategory ? undefined : max,
    data: categories,
    axisLine: {
      show: !theme.hideAxisLine,
      lineStyle: { color: theme.axisColor, width: 1 },
    },
    axisTick: {
      show: !theme.hideAxisLine,
      inside: cfg.tickInside,
      lineStyle: { color: theme.axisColor },
    },
    axisLabel: {
      ...fontStyle,
      rotate,
      formatter: isCategory ? undefined : tickFormatter(cfg.tickFormat),
    },
    splitLine: {
      show: cfg.showGrid,
      lineStyle: { color: theme.gridColor, type: theme.gridType },
    },
  };
}

export function numericXAxisOption(chart: ChartConfig, theme: ChartTheme) {
  const axis = axisOption({ ...chart.xAxis, includeZero: false }, chart, theme, false);
  const log = axis.type === 'log';
  const padded = ({ min, max }: { min: number; max: number }, side: -1 | 1) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || (log && min <= 0)) return;
    const edge = side < 0 ? min : max;
    const margin = 0.03 * (log ? Math.log(max) - Math.log(min) || 1 : max - min || Math.abs(min) || 1);
    const limit = log ? Math.exp(Math.log(edge) + side * margin) : edge + side * margin;
    if (!Number.isFinite(limit) || (log && limit <= 0)) return edge;
    const opposite = side < 0 ? axis.max : axis.min;
    if (opposite !== undefined && (limit - opposite) * side <= 0) return;
    return limit;
  };
  return {
    ...axis,
    min: axis.min ?? ((extent: { min: number; max: number }) => padded(extent, -1)),
    max: axis.max ?? ((extent: { min: number; max: number }) => padded(extent, 1)),
    axisLabel: { ...axis.axisLabel, showMinLabel: axis.min === undefined ? false : undefined,
      showMaxLabel: axis.max === undefined ? false : undefined },
  };
}

export function hexOpacity(color: string, opacity: number): string {
  if (opacity >= 1 || !color.startsWith('#') || color.length !== 7) return color;
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0');
  return color + alpha;
}
