import type { Dataset, SeriesMapping } from '../types';

export function namedColumn(columns: string[], name: string): number | undefined {
  const index = columns.indexOf(name);
  return index >= 0 && index === columns.lastIndexOf(name) ? index : undefined;
}

export function rebindSeries(mapping: SeriesMapping, previous: Dataset, next: Dataset): SeriesMapping {
  const match = (index: number, fallback: number) => {
    if (index < 0) return index;
    return namedColumn(next.columns, previous.columns[index]) ?? fallback;
  };
  return {
    ...mapping,
    datasetId: next.id,
    xCol: match(mapping.xCol, 0),
    yCol: match(mapping.yCol, Math.min(1, next.columns.length - 1)),
    errCol: match(mapping.errCol, -1),
    groupCol: match(mapping.groupCol, -1),
    sizeCol: match(mapping.sizeCol, -1),
  };
}
