import { useCallback, useEffect, useRef } from 'react';
import type { ECElementEvent } from 'echarts';
import { useShallow } from 'zustand/react/shallow';
import { visibleRowIndices } from '../../lib/rowFilter';
import { supportsChartSelection } from '../../lib/chartSelection';
import { chartPlotRect } from '../../lib/projectChartSelection';
import { useChartRenderer } from './useChartRenderer';
import { ChartSelectionLayer } from './ChartSelectionLayer';
import { useStore } from '../../store/useStore';
import type { CellValue, ChartConfig, Dataset, SeriesMapping } from '../../types';
import type { ResidualPlot } from '../../lib/residuals';

interface Props {
  chart: ChartConfig;
  width: number;
  height: number;
  onResiduals: (id: string, plot: ResidualPlot | null) => void;
}

export function ChartPanel({ chart, width, height, onResiduals }: Props) {
  const datasets = useStore(useShallow((s) =>
    s.datasets.filter((dataset) => chart.series.some((series) => series.datasetId === dataset.id))));
  const editPoints = useStore((s) => s.editPoints);
  const selecting = useStore((s) => s.tool === 'selectData');
  const activeChartId = useStore((s) => s.activeChartId);

  const reportResiduals = useCallback((plot: ResidualPlot | null) => onResiduals(chart.id, plot), [chart.id, onResiduals]);
  const marker = useRef<HTMLSpanElement>(null);
  const { ref, instRef, selectRectangle } = useChartRenderer(chart, datasets, reportResiduals);
  useEffect(() => () => reportResiduals(null), [reportResiduals]);

  // ---- drag-edit data points ----
  useEffect(() => {
    const inst = instRef.current;
    const el = ref.current;
    const preview = marker.current;
    if (!inst || !el || !preview || !editPoints || chart.spectralAxis) return;
    const editable = chart.type === 'line' || chart.type === 'scatter' || chart.type === 'area';
    if (!editable) return;

    let dragging: { mapping: SeriesMapping; dataset: Dataset; rowIndex: number; seriesIndex: number } | null = null;
    let pending: MouseEvent | null = null;
    let frame = 0;

    const onDown = (params: ECElementEvent) => {
      const sid = params.seriesId;
      if (typeof sid !== 'string' || !sid.startsWith('m:')) return;
      const value = params.value as number[];
      if (!Array.isArray(value) || value.length < 3) return;
      const mappingId = sid.split(':')[1];
      const mapping = chart.series.find((series) => series.id === mappingId);
      if (!mapping || (mapping.normalization && mapping.normalization !== 'none')) return;
      const dataset = useStore.getState().datasets.find((item) => item.id === mapping.datasetId);
      if (!dataset) return;
      const rowIndex = dataset.rowFilter ? visibleRowIndices(dataset)[value[2]] : value[2];
      if (!Number.isInteger(rowIndex)) return;
      dragging = { mapping, dataset, rowIndex, seriesIndex: params.seriesIndex ?? 0 };
    };

    const pixel = (event: MouseEvent): [number, number] => {
      const rect = el.getBoundingClientRect();
      const scale = rect.width / el.offsetWidth || 1;
      return [(event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale];
    };

    const onMove = (event: MouseEvent) => {
      if (!dragging) return;
      pending = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending) return;
        const [x, y] = pixel(pending);
        preview.hidden = false;
        preview.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      });
    };

    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      dragging = null;
      pending = null;
      preview.hidden = true;
    };

    const onUp = (event: MouseEvent) => {
      const drag = dragging;
      const moved = pending !== null;
      reset();
      if (!drag || !moved) return;
      const coord = inst.convertFromPixel({ seriesIndex: drag.seriesIndex }, pixel(event));
      if (!Array.isArray(coord) || !coord.slice(0, 2).every(Number.isFinite) || coord.length < 2) return;
      const { mapping, rowIndex } = drag;
      const state = useStore.getState();
      const dataset = state.datasets.find(({ id }) => id === mapping.datasetId);
      if (dataset !== drag.dataset) return;
      const row = dataset.rows[rowIndex];
      if (!row) return;
      const changes = new Map<number, CellValue>();
      if (mapping.xCol >= 0 && typeof row[mapping.xCol] === 'number') {
        changes.set(mapping.xCol, Number(coord[0].toFixed(4)));
      }
      changes.set(mapping.yCol, Number(coord[1].toFixed(4)));
      state.updateCells(mapping.datasetId, rowIndex, changes);
    };

    inst.on('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', reset);
    return () => {
      inst.off('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', reset);
      reset();
    };
  }, [editPoints, chart, instRef, ref]);

  const isActive = chart.id === activeChartId;

  return (
    <div className="relative" style={{ width, height }}>
      <div
        data-chart-panel="true"
        ref={ref}
        style={{
          width,
          height,
          outline: isActive ? '1.5px solid var(--color-accent)' : '1px solid transparent',
          outlineOffset: -1,
          cursor: editPoints && !chart.spectralAxis ? 'crosshair' : 'default',
        }}
        onMouseDown={() => useStore.getState().setActiveChart(chart.id)}
      />
      <span ref={marker} hidden aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 size-2.5 rounded-full border border-white bg-(--color-accent)" />
      {supportsChartSelection(chart.type) && <ChartSelectionLayer key={selecting ? 'drawing' : 'idle'}
        chartId={chart.id} choosing={selecting}
        getGrid={() => instRef.current ? chartPlotRect(instRef.current) : undefined} onSelect={selectRectangle} />}
    </div>
  );
}
