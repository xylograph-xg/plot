import { expect, it } from 'vitest';
import { useStore } from './useStore';

it('records both coordinates in one undo and restores compatible row order across edits', () => {
  const dataset = { id: 'points', name: 'Points', columns: ['X', 'Y'], rows: [[1, 3], [2, 4]] };
  const history = useStore.temporal;
  const rows = () => useStore.getState().datasets.find(({ id }) => id === dataset.id)?.rows;
  useStore.getState().openLocalDataset(dataset);
  const before = history.getState().pastStates.length;
  useStore.getState().updateCells(dataset.id, 0, new Map([[0, 5], [1, 6]]));
  expect(rows()).toEqual([[5, 6], [2, 4]]);
  expect(history.getState().pastStates).toHaveLength(before + 1);
  useStore.getState().updateCell(dataset.id, 0, 1, 6);
  expect(history.getState().pastStates).toHaveLength(before + 1);
  useStore.getState().sortByColumn(dataset.id, 0, true);
  expect(rows()).toEqual([[2, 4], [5, 6]]);
  history.undo();
  history.undo();
  expect(rows()).toEqual(dataset.rows);
  history.redo();
  history.redo();
  expect(rows()).toEqual([[2, 4], [5, 6]]);
});

it('opens a temperature spectrum with an unlabeled wavelength column in peak fitting', () => {
  const dataset = { id: 'temperature-spectrum', name: '502-1.xlsx', columns: ['Col1', '77 K', '330k'],
    rows: [[360, 1, 4], [500, 9, 3], [650, 3, 1]] };
  const active = () => {
    const { activeChartId, charts } = useStore.getState();
    return charts.find(({ id }) => id === activeChartId)!;
  };
  useStore.getState().openLocalDataset(dataset);
  expect(active()).toMatchObject({ fileDatasetId: dataset.id, type: 'scatter', showSpectrumSettings: true,
    showPeakPositions: true, spectrumFits: [], xAxis: { label: 'λ (nm)' }, series: [
      { xCol: 0, yCol: 1, trendline: 'none', normalization: 'max' },
      { xCol: 0, yCol: 2, trendline: 'none', normalization: 'max' },
    ] });

  useStore.getState().updateChart(active().id, { showSpectrumSettings: false });
  useStore.getState().focusLocalDataset(dataset.id);
  expect(active().showSpectrumSettings).toBe(false);

  useStore.getState().openLocalDataset({ ...dataset, id: 'temperature-decay', columns: ['Time (ns)', '77 K', '330k'] });
  expect(active().showPeakPositions).toBeFalsy();
  expect(active().series[0].trendline).toBe('linear');
});
