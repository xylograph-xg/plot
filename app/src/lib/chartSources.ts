import type { ChartConfig, Dataset, DatasetSource } from '../types';

export function datasetId(root: string, fileId: string, tableName: string): string {
  return JSON.stringify([root, fileId, tableName]);
}

export function panelLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export function datasetSource(dataset: Dataset): DatasetSource | undefined {
  const source = dataset.source;
  if (typeof source?.root === 'string' && typeof source.fileId === 'string') return source;
  // Projects saved before source metadata used the original file and sheet in the ID.
  if (typeof dataset.id !== 'string' || !dataset.id.startsWith('[')) return;
  try {
    const parts: unknown = JSON.parse(dataset.id);
    if (!Array.isArray(parts)) return;
    const [root, fileId, label] = parts;
    if (typeof root !== 'string' || typeof fileId !== 'string' || typeof label !== 'string') return;
    const base = fileId.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? '';
    const prefix = base + ' · ';
    return { root, fileId, sheet: label.startsWith(prefix) ? label.slice(prefix.length) : undefined };
  } catch (error) {
    console.warn('Decode dataset ID', error);
    return undefined;
  }
}

export function chartSources(chart: ChartConfig, datasets: Dataset[]): Dataset[] {
  const firstOnly = chart.type === 'pie' || chart.type === 'heatmap' ||
    chart.type === 'correlation' || chart.type === 'radar';
  const series = chart.series ?? [];
  const mappings = firstOnly ? series.slice(0, 1) : series;
  const ids = new Set(mappings.map(({ datasetId }) => datasetId));
  return datasets.filter(({ id }) => ids.has(id));
}

export function pathParents(id: string): string[] {
  const parts = id.split('/').slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function commonSourceDirectory(datasets: Dataset[], root: string | null): string {
  const sources = datasets.map(datasetSource);
  const first = sources[0];
  if (!root || !first || !sources.every((source) => source?.root === root)) return '';
  return pathParents(first.fileId).reverse().find((directory) =>
    sources.every((source) => source?.fileId.startsWith(directory + '/'))) ?? '';
}

export function chartLabel(chart: ChartConfig, index: number, fallback: (panel: string) => string): string {
  return chart.title?.trim() || fallback(panelLabel(index));
}
