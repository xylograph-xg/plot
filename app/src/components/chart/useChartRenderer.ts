import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import { buildChartOption } from '../../lib/echartsOption';
import { type MeasurementSeries, type SelectionRect } from '../../lib/chartSelection';
import { chartPlotRect, projectChartSelection } from '../../lib/projectChartSelection';
import { chartSvgRenderers, renderChartSvg } from '../../lib/chartSvg';
import type { FitResidualSeries, ResidualPlot } from '../../lib/residuals';
import { datasetView } from '../../lib/rowFilter';
import { trendlineLabel } from '../../lib/trendlineSelection';
import { resolveChartSeries, supportsTrendline } from '../../lib/xySeries';
import type { ChartConfig, Dataset } from '../../types';
import { useStore } from '../../store/useStore';
import { useFitResults } from './useFitResults';

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
  const bounds = chartPlotRect(inst);
  if (!bounds) return null;
  const scale = logX ? Math.log : (x: number) => x;
  const from = scale(min);
  const to = scale(max);
  const xAt = from === to ? () => pixelMin : (x: number) =>
    pixelMin + (scale(x) - from) * (pixelMax - pixelMin) / (to - from);
  return { series, width: inst.getWidth(), left: bounds.x, right: bounds.x + bounds.width, xAt };
}

type ChartOption = echarts.EChartsOption;

function retainLegend(option: ChartOption, selected: Record<string, boolean>): ChartOption {
  if (!option.legend || Array.isArray(option.legend)) return option;
  return { ...option, legend: { ...option.legend, selected } };
}

function mergeable(previous: ChartOption, next: ChartOption) {
  const before = Array.isArray(previous.series) ? previous.series : [];
  const after = Array.isArray(next.series) ? next.series : [];
  return before.length === after.length && after.every((item, index) => {
    const old = before[index];
    return item.id !== undefined && item.id === old.id && item.type === old.type &&
      item.type !== 'custom' &&
      (item.type !== 'line' || (old.type === 'line' && item.step === old.step && item.stack === old.stack));
  });
}

function optionPatch(previous: ChartOption, next: ChartOption): ChartOption {
  const before = previous.series;
  const after = next.series;
  if (!Array.isArray(before) || !Array.isArray(after)) return next;
  const series = after.map((item, index) => {
    if (!('data' in item) || !('data' in before[index]) || item.data !== before[index].data) return item;
    const patch = { ...item };
    delete patch.data;
    return patch;
  });
  return { ...next, series: series as ChartOption['series'] };
}

export function useChartRenderer(chart: ChartConfig, datasets: Dataset[], onResiduals: (plot: ResidualPlot | null) => void) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);
  const current = useRef<{
    option?: ChartOption;
    type?: ChartConfig['type'];
    selected: Record<string, boolean>;
    update?: () => void;
    select?: (rect: SelectionRect) => void;
  }>({ selected: {} });
  const [dimensions, setDimensions] = useState({ width: 454, height: 340 });
  const views = useMemo(() => datasets.map(datasetView), [datasets]);
  const { series, spectralAxis, type } = chart;
  const raw = useMemo(() => resolveChartSeries({ series, spectralAxis, type }, views), [series, spectralAxis, type, views]);
  const fits = useFitResults(chart, raw);
  const computation = useMemo(() => {
    const residuals: FitResidualSeries[] = [];
    const measurements: MeasurementSeries[] = [];
    const size = () => dimensions;
    const option = buildChartOption(chart, views, t('normalization.axis'), {
      size, movingAverage: t('chart.trendMA'), model: (kind) => t(trendlineLabel(kind)),
      spectralDensity: (unit) => t('spectralAxis.densityLabel', { unit }),
      spectrum: {
        total: (shape) => t('spectrum.total', { shape: t(`spectrum.short.${shape}`) }),
        peak: (index) => t('spectrum.component', { index }),
      },
      residuals,
      measurements,
      fitResults: fits,
      rawSeries: supportsTrendline(chart.type) ? raw : undefined,
    });
    return { option, residuals, measurements };
  }, [chart, views, raw, fits, t, dimensions]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const state = current.current;
    const inst = echarts.init(el, undefined, { renderer: 'canvas' });
    instRef.current = inst;
    const observer = new ResizeObserver(() => {
      inst.resize();
      const width = inst.getWidth();
      const height = inst.getHeight();
      setDimensions((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      state.update?.();
    });
    observer.observe(el);
    inst.on('legendselectchanged', (event: unknown) => {
      state.selected = (event as { selected: Record<string, boolean> }).selected;
      state.update?.();
    });
    chartSvgRenderers.set(el, () => {
      if (!state.option) throw new Error('Chart is still loading');
      return renderChartSvg(retainLegend(state.option, state.selected), inst.getWidth(), inst.getHeight());
    });
    return () => {
      observer.disconnect();
      chartSvgRenderers.delete(el);
      inst.dispose();
      instRef.current = null;
      state.option = undefined;
      state.update = undefined;
      state.select = undefined;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    const el = ref.current;
    if (!inst || !el) return;
    const state = current.current;
    const { option, residuals, measurements } = computation;
    const previous = state.option;
    const next = retainLegend(option, state.selected);
    if (previous && state.type === chart.type && mergeable(previous, next)) {
      inst.setOption(optionPatch(previous, next), { replaceMerge: ['title', 'legend', 'xAxis', 'yAxis'] });
    } else {
      inst.setOption(next, { notMerge: true });
    }
    state.option = option;
    state.type = chart.type;
    el.toggleAttribute('data-fit-pending', fits.pending);
    const saveSelection = (grid: SelectionRect, area: SelectionRect) => {
      const projected = projectChartSelection(inst, grid, area, measurements, datasets, state.selected, chart.type);
      useStore.getState().setDataSelection({ chartId: chart.id, area, ...projected });
    };
    state.select = (rect) => {
      const grid = chartPlotRect(inst);
      if (!grid || !grid.width || !grid.height) return;
      saveSelection(grid, { x: (rect.x - grid.x) / grid.width, y: (rect.y - grid.y) / grid.height,
        width: rect.width / grid.width, height: rect.height / grid.height });
    };
    state.update = () => {
      onResiduals(projectResiduals(inst, residuals.filter(({ name }) => state.selected[name] !== false), chart.xAxis.scale === 'log'));
      const { dataSelection, activeChartId, setDataSelection } = useStore.getState();
      if (activeChartId !== chart.id || dataSelection?.chartId !== chart.id) return;
      const grid = chartPlotRect(inst);
      if (grid && measurements.length) saveSelection(grid, dataSelection.area);
      else setDataSelection(null);
    };
    state.update();
  }, [chart.id, chart.type, chart.xAxis.scale, computation, datasets, fits.pending, onResiduals]);

  return { ref, instRef, selectRectangle: (rect: SelectionRect) => current.current.select?.(rect) };
}
