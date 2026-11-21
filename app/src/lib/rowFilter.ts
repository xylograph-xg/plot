import type { CellValue, Dataset, RowFilter } from '../types';

function matches(cell: CellValue | undefined, condition: NonNullable<RowFilter['condition']>) {
  const { operator, value } = condition;
  if (operator === 'empty') return cell == null;
  if (cell == null) return false;
  if (operator === 'equals') return String(cell) === value;
  if (operator === 'contains') return String(cell).includes(value);
  if (typeof cell !== 'number') return false;
  const threshold = Number(value);
  return operator === 'gte' ? cell >= threshold : cell <= threshold;
}

export function visibleRowIndices(dataset: Dataset): number[] {
  const { first = 1, last = dataset.rows.length, condition } = dataset.rowFilter ?? {};
  const indices: number[] = [];
  for (let index = first - 1; index < Math.min(last, dataset.rows.length); index += 1) {
    if (!condition || matches(dataset.rows[index]?.[condition.column], condition)) indices.push(index);
  }
  return indices;
}

const views = new WeakMap<Dataset, Dataset>();

export function datasetView(dataset: Dataset): Dataset {
  if (!dataset.rowFilter) return dataset;
  const existing = views.get(dataset);
  if (existing) return existing;
  const view = { ...dataset, rows: visibleRowIndices(dataset).map((index) => dataset.rows[index]) };
  views.set(dataset, view);
  return view;
}
