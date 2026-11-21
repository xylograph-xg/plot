import { useCallback, useEffect } from 'react';
import type { ECElementEvent } from 'echarts';
import { useShallow } from 'zustand/react/shallow';
import { visibleRowIndices } from '../../lib/rowFilter';
import { useChartRenderer } from './useChartRenderer';
import { useStore } from '../../store/useStore';
import type { ChartConfig } from '../../types';
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
  const activeChartId = useStore((s) => s.activeChartId);

  const reportResiduals = useCallback((plot: ResidualPlot | null) => onResiduals(chart.id, plot), [chart.id, onResiduals]);
  const { ref, instRef } = useChartRenderer(chart, datasets, reportResiduals);
  useEffect(() => () => reportResiduals(null), [reportResiduals]);

  // ---- drag-edit data points ----
  useEffect(() => {
    const inst = instRef.current;
    const el = ref.current;
    if (!inst || !el || !editPoints || chart.spectralAxis) return;
    const editable = chart.type === 'line' || chart.type === 'scatter' || chart.type === 'area';
    if (!editable) return;

    let dragging: { mappingId: string; rowIndex: number; seriesIndex: number } | null = null;

    const onDown = (params: ECElementEvent) => {
      const sid = params.seriesId;
      if (typeof sid !== 'string' || !sid.startsWith('m:')) return;
      const value = params.value as number[];
      if (!Array.isArray(value) || value.length < 3) return;
      const mappingId = sid.split(':')[1];
      const mapping = chart.series.find((series) => series.id === mappingId);
      if (!mapping || (mapping.normalization && mapping.normalization !== 'none')) return;
      const dataset = useStore.getState().datasets.find((item) => item.id === mapping?.datasetId);
      const rowIndex = dataset?.rowFilter ? visibleRowIndices(dataset)[value[2]] : value[2];
      if (!Number.isInteger(rowIndex)) return;
      dragging = {
        mappingId,
        rowIndex,
        seriesIndex: params.seriesIndex ?? 0,
      };
    };

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = el.getBoundingClientRect();
      const scale = rect.width / el.offsetWidth || 1;
      const px = (e.clientX - rect.left) / scale;
      const py = (e.clientY - rect.top) / scale;
      const coord = inst.convertFromPixel({ seriesIndex: dragging.seriesIndex }, [px, py]);
      if (!coord) return;
      const state = useStore.getState();
      const mapping = chart.series.find((m) => m.id === dragging!.mappingId);
      if (!mapping) return;
      const ds = state.datasets.find((d) => d.id === mapping.datasetId);
      if (!ds) return;
      const row = ds.rows[dragging.rowIndex];
      if (!row) return;
      if (mapping.xCol >= 0 && typeof row[mapping.xCol] === 'number') {
        state.updateCell(ds.id, dragging.rowIndex, mapping.xCol, +coord[0].toFixed(4));
      }
      state.updateCell(ds.id, dragging.rowIndex, mapping.yCol, +coord[1].toFixed(4));
    };

    const onUp = () => {
      dragging = null;
    };

    inst.on('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      inst.off('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editPoints, chart, instRef, ref]);

  const isActive = chart.id === activeChartId;

  return (
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
  );
}
