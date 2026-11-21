import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import { buildChartOption } from '../../lib/echartsOption';
import type { FitResidualSeries, ResidualPlot } from '../../lib/residuals';
import { datasetView } from '../../lib/rowFilter';
import { trendlineLabel } from '../../lib/trendlineSelection';
import type { ChartConfig, Dataset } from '../../types';

function projectResiduals(inst: echarts.ECharts, series: FitResidualSeries[], logX: boolean): ResidualPlot | null {
  if (!series.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const item of series) {
    for (const [x] of item.points) {
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  }
  const pixelMin = inst.convertToPixel({ xAxisIndex: 0 }, min);
  const pixelMax = inst.convertToPixel({ xAxisIndex: 0 }, max);
  if (!Number.isFinite(pixelMin) || !Number.isFinite(pixelMax)) return null;
  const middleX = (pixelMin + pixelMax) / 2;
  const width = inst.getWidth();
  const height = inst.getHeight();
  const inside = (x: number, y: number) => inst.containPixel({ gridIndex: 0 }, [x, y]);
  let middleY = height / 2;
  if (!inside(middleX, middleY)) {
    for (middleY = 0; middleY < height && !inside(middleX, middleY); middleY += 1) {
      // Locate a row within the plot when the grid is vertically off-center.
    }
    if (middleY >= height) return null;
  }
  const edge = (outside: number) => {
    let within = middleX;
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const halfway = (outside + within) / 2;
      if (inside(halfway, middleY)) within = halfway;
      else outside = halfway;
    }
    return within;
  };
  const scale = logX ? Math.log : (x: number) => x;
  const from = scale(min);
  const to = scale(max);
  const xAt = from === to ? () => pixelMin : (x: number) =>
    pixelMin + (scale(x) - from) * (pixelMax - pixelMin) / (to - from);
  return { series, width, left: edge(0), right: edge(width), xAt };
}

export function useChartRenderer(chart: ChartConfig, datasets: Dataset[], onResiduals: (plot: ResidualPlot | null) => void) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);
  const updateResiduals = useRef<() => void>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inst = echarts.init(el, undefined, { renderer: 'svg' });
    instRef.current = inst;
    const observer = new ResizeObserver(() => {
      inst.resize();
      updateResiduals.current?.();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    const residuals: FitResidualSeries[] = [];
    inst.setOption(buildChartOption(chart, datasets.map(datasetView), t('normalization.axis'), {
      size: () => ({ width: inst.getWidth(), height: inst.getHeight() }), movingAverage: t('chart.trendMA'),
      model: (kind) => t(trendlineLabel(kind)),
      spectralDensity: (unit) => t('spectralAxis.densityLabel', { unit }),
      spectrum: {
        total: (shape) => t('spectrum.total', { shape: t(`spectrum.short.${shape}`) }),
        peak: (index) => t('spectrum.component', { index }),
      },
      residuals,
    }), { notMerge: true });
    let selected: Record<string, boolean> = {};
    const update = () => onResiduals(projectResiduals(inst, residuals.filter(({ name }) => selected[name] !== false),
      chart.xAxis.scale === 'log'));
    const onLegend = (event: unknown) => {
      selected = (event as { selected: Record<string, boolean> }).selected;
      update();
    };
    updateResiduals.current = update;
    inst.on('legendselectchanged', onLegend);
    update();
    return () => {
      inst.off('legendselectchanged', onLegend);
      updateResiduals.current = undefined;
    };
  }, [chart, datasets, t, onResiduals]);

  return { ref, instRef };
}
