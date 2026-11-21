import type { ActiveTrendlineKind, ChartConfig, Dataset } from '../types';
import { useStore } from '../store/useStore';
import { isTrendline, selectedTrendlines, setTrendline, trendlineSelection } from './trendlineSelection';

export interface FitWindowData {
  chart: ChartConfig;
  datasets: Dataset[];
}

export type FitModelChoice = [seriesId: string, method: ActiveTrendlineKind, enabled: boolean];

interface FitWindowBridge {
  open(data: FitWindowData, title: string): Promise<number>;
  update(id: number, data: FitWindowData | null): void;
  onClosed(callback: (id: number) => void): () => void;
  onApply(callback: (chartId: string, models: FitModelChoice[]) => void): () => void;
  get(): Promise<FitWindowData | null>;
  onChange(callback: (data: FitWindowData | null) => void): () => void;
  apply(models: FitModelChoice[]): Promise<boolean>;
}

declare global {
  interface Window {
    fitWindows?: FitWindowBridge;
  }
}

const sessions = new Map<number, { chartId: string; data: FitWindowData | null }>();

function snapshot(chartId: string): FitWindowData | null {
  const state = useStore.getState();
  const chart = state.charts.find((item) => item.id === chartId);
  if (!chart) return null;
  const ids = new Set(chart.series.map(({ datasetId }) => datasetId));
  return { chart, datasets: state.datasets.filter((item) => ids.has(item.id)) };
}

function sync(id: number, session: { chartId: string; data: FitWindowData | null }) {
  const data = snapshot(session.chartId);
  const previous = session.data;
  if (previous === data ||
      (previous && data && previous.chart === data.chart && previous.datasets.length === data.datasets.length &&
        previous.datasets.every((dataset, index) => dataset === data.datasets[index]))) return;
  session.data = data;
  window.fitWindows?.update(id, data);
}

export async function openFitWindow(chartId: string, title: string): Promise<void> {
  const bridge = window.fitWindows;
  const data = snapshot(chartId);
  if (!bridge || !data) throw new Error('No fit is available for this chart');
  const id = await bridge.open(data, title);
  const session = { chartId, data };
  sessions.set(id, session);
  sync(id, session);
}

export function startFitWindowSync() {
  const bridge = window.fitWindows;
  if (!bridge) return;
  const unsubscribe = useStore.subscribe(() => {
    for (const [id, session] of sessions) sync(id, session);
  });
  const close = bridge.onClosed((id) => sessions.delete(id));
  const apply = bridge.onApply((chartId, choices) => {
    const state = useStore.getState();
    const chart = state.charts.find((item) => item.id === chartId);
    if (!chart) return;
    const series = chart.series.map((item) => {
      const active = selectedTrendlines(item);
      const methods = choices.reduce((next, [id, method, enabled]) =>
        id === item.id && isTrendline(method) ? setTrendline(next, method, enabled) : next, active);
      return methods === active ? item : { ...item, ...trendlineSelection(methods) };
    });
    if (series.some((item, index) => item !== chart.series[index])) state.updateChart(chartId, { series });
  });
  return () => {
    unsubscribe();
    close();
    apply();
  };
}
