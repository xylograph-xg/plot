import type { AutoStartRule, Dataset, RowFilter } from '../types';

export const defaultPlateauPoints = 5;

export function validPlateauPoints(points: number): boolean {
  return Number.isInteger(points) && points >= 3 && points <= 30;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : values[middle - 1] / 2 + values[middle] / 2;
}

function dropStart(values: number[], plateauPoints: number): number | undefined {
  const follow = Math.min(5, plateauPoints);
  if (values.length < plateauPoints + follow) return;

  // Estimate the high and low levels from medians so a single outlier cannot set the range.
  let high = -Infinity;
  let low = Infinity;
  for (let start = 0; start <= values.length - follow; start += 1) {
    const window = values.slice(start, start + follow);
    if (!window.every(Number.isFinite)) continue;
    const level = median(window);
    high = Math.max(high, level);
    low = Math.min(low, level);
  }
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return;

  for (let index = plateauPoints; index <= values.length - follow; index += 1) {
    const step = values[index - 1] - values[index];
    if (!(step > range * 0.012)) continue;
    const before = values.slice(index - plateauPoints, index);
    const after = values.slice(index, index + follow);
    if (!before.every(Number.isFinite) || !after.every(Number.isFinite)) continue;
    const baseline = median([...before]);
    if (baseline < low + range * 0.6) continue;

    const noise = median(before.slice(1).map((value, point) => Math.abs(value - before[point])));
    const offset = baseline - values[index];
    if (step <= noise * 2.5 || offset < Math.max(noise * 3, range * 0.018)) continue;
    const half = Math.floor(plateauPoints / 2);
    const drift = Math.abs(median(before.slice(0, half)) - median(before.slice(-half)));
    if (drift > Math.max(noise * 2, range * 0.025)) continue;
    if (before.some((value) => Math.abs(value - baseline) > Math.max(range * 0.045, noise * 3))) continue;

    const sustained = baseline - median([...after]);
    if (sustained >= Math.max(range * 0.045, noise * 4) &&
        after.every((value) => baseline - value >= Math.min(offset * 0.55, sustained * 0.55))) {
      return index + 1;
    }
  }
}

function riseStart(values: number[], plateauPoints: number): number | undefined {
  const start = values.findIndex(Number.isFinite);
  if (start < 0) return;
  const early = values.slice(start, start + plateauPoints);
  if (early.length !== plateauPoints || !early.every(Number.isFinite)) return;
  const baseline = median([...early]);
  const noise = Math.max(
    1.4826 * median(early.map((value) => Math.abs(value - baseline))),
    median(early.slice(1).map((value, index) => Math.abs(value - early[index]))),
  );
  const excursions = values.slice(start + plateauPoints).filter(Number.isFinite)
    .map((value) => value - baseline).sort((a, b) => a - b);
  if (!excursions.length) return;
  const upper = excursions[Math.floor((excursions.length - 1) * 0.98)];
  const signal = upper > noise * 8 ? upper : excursions[excursions.length - 1];
  const minRise = Math.max(8 * noise, 4 * Math.abs(baseline), 0.08 * signal);
  for (let index = start + plateauPoints; index < values.length; index += 1) {
    const rise = values[index] - baseline;
    if (!(values[index] > 0 && rise > minRise && values[index] - values[index - 1] > 0.75 * rise)) continue;
    const before = values.slice(index - plateauPoints, index);
    if (before.every((value) => Math.abs(value - baseline) <= Math.max(noise * 3, rise * 0.15))) return index + 1;
  }
}

/** Return the original 1-based row where the selected transition starts. */
export function findAutoStart(dataset: Dataset, { column, plateauPoints, mode }: AutoStartRule): number | undefined {
  if (column < 0 || column >= dataset.columns.length || !validPlateauPoints(plateauPoints)) return;
  const values = dataset.rows.map((row) => {
    const value = row[column];
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  });
  return mode === 'rise' ? riseStart(values, plateauPoints) : dropStart(values, plateauPoints);
}

export function scanRowFilter(dataset: Dataset, rule: AutoStartRule): RowFilter | 'notFound' | 'beyondEnd' {
  const first = findAutoStart(dataset, rule);
  if (first === undefined) return 'notFound';
  const filter = dataset.rowFilter;
  if (filter?.last !== undefined && first > filter.last) return 'beyondEnd';
  return { ...filter, first, autoStart: rule };
}
